/**
 * Layanan tagihan langganan (payment gateway).
 *
 * Alur Owner self-service:
 *   1. `createInvoiceForPlan` — Owner memilih paket + kanal. Server membuat
 *      baris `subscription_invoices` lalu meminta nomor VA/QR ke gateway.
 *   2. `handleDuitkuCallback` — gateway mengirim callback bertanda tangan;
 *      tanda tangan diverifikasi (HMAC-SHA256) LALU tagihan ditandai lunas dan
 *      langganan diaktifkan dalam satu transaksi DB.
 *   3. `syncInvoiceStatus` — Owner dapat memeriksa status ke gateway secara
 *      manual (cadangan bila callback belum sampai).
 *
 * Aturan yang dipegang modul ini:
 *   - Nominal tagihan SELALU dari `subscription_plans.price` (sen), bukan dari
 *     klien. Konversi sen -> rupiah hanya untuk permintaan ke gateway.
 *   - Aktivasi langganan memakai pola `assignSubscription`: langganan aktif lama
 *     -> `expired`, lalu dibuat baris aktif baru (masa berlaku dari sekarang).
 *   - Callback hanya dipercaya setelah tanda tangan cocok DAN unit kerjanya
 *     idempoten (callback ganda tidak pernah mengaktifkan langganan dua kali).
 *   - Saat callback sukses, jejak audit ditulis atas nama OWNER yang memulai
 *     tagihan (peran `system` tidak ada di enum `user_role`).
 */
import { randomBytes } from 'node:crypto';
import env from '../../config/env.js';
import { query, withTransaction } from '../../config/db.js';
import { AppError, NotFoundError, UnauthorizedError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';
import {
  activeChannels,
  channelInfo,
  describePayments,
  expiryMinutesFor,
  requireProvider,
} from '../../payments/index.js';
import { stripSignature } from '../../payments/duitku.js';

const INVOICE_COLUMNS = `id, business_id, plan_id, subscription_id, order_id, amount, status,
  provider, payment_method, provider_reference, va_number, qr_string, payment_url,
  expires_at, paid_at, failed_at, attempts, created_by, created_at, updated_at`;

const JOINED_COLUMNS = `i.${INVOICE_COLUMNS.split(',').map((c) => c.trim()).join(', i.')},
  p.name AS plan_name, p.price AS plan_price, p.duration_days AS plan_duration_days,
  p.max_outlets AS plan_max_outlets, p.max_cashiers AS plan_max_cashiers`;

/** sen -> rupiah bulat; null bila bukan kelipatan 100 (tidak bisa dibebankan). */
const senToRupiah = (sen) => {
  const n = Number(sen);
  if (!Number.isInteger(n) || n < 0) return null;
  if (n % 100 !== 0) return null;
  return n / 100;
};

const rupiah = (n) => `Rp ${Number(n).toLocaleString('id-ID')}`;

/** Nomor pesanan kita (<= 50 char, unik) yang dikirim sebagai merchantOrderId. */
const generateOrderId = () => {
  const d = new Date();
  const pad = (v, len = 2) => String(v).padStart(len, '0');
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `SINV-${stamp}-${randomBytes(4).toString('hex').toUpperCase()}`;
};

/** URL callback gateway (wajib publik). */
const resolveCallbackUrl = () => {
  const cfg = env.payments;
  if (cfg.callbackUrl) return cfg.callbackUrl;
  if (cfg.apiBaseUrl) return `${cfg.apiBaseUrl}/api/payments/duitku/callback`;
  throw new AppError(
    'URL callback gateway belum dikonfigurasi (isi PAYMENT_CALLBACK_URL atau PAYMENT_API_BASE_URL).',
    503
  );
};

/** URL pengembalian setelah pembayaran (wajib diisi, hanya untuk redirect). */
const resolveReturnUrl = () => {
  const cfg = env.payments;
  if (cfg.returnUrl) return cfg.returnUrl;
  if (cfg.ownerPanelUrl) return `${cfg.ownerPanelUrl}/index.html?pembayaran=selesai`;
  if (cfg.apiBaseUrl) return `${cfg.apiBaseUrl}/api/payments/duitku/return`;
  throw new AppError(
    'URL pengembalian gateway belum dikonfigurasi (isi PAYMENT_RETURN_URL atau PAYMENT_OWNER_PANEL_URL).',
    503
  );
};

const invoiceDto = (row) => {
  const info = channelInfo(row.payment_method);
  return {
    id: row.id,
    business_id: row.business_id,
    order_id: row.order_id,
    status: row.status,
    amount: Number(row.amount),
    provider: row.provider,
    payment_method: row.payment_method,
    payment_method_label: info.label ?? row.payment_method,
    payment_kind: info.kind,
    va_number: row.va_number,
    qr_string: row.qr_string,
    payment_url: row.payment_url,
    provider_reference: row.provider_reference,
    expires_at: row.expires_at,
    paid_at: row.paid_at,
    failed_at: row.failed_at,
    subscription_id: row.subscription_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    plan: {
      id: row.plan_id,
      name: row.plan_name ?? null,
      price: row.plan_price !== undefined ? Number(row.plan_price) : null,
      duration_days: row.plan_duration_days ?? null,
      max_outlets: row.plan_max_outlets ?? null,
      max_cashiers: row.plan_max_cashiers ?? null,
    },
  };
};

/**
 * Daftar paket aktif untuk dipilih Owner.
 *
 * Semua paket aktif dikembalikan (termasuk yang gratis) dengan penanda
 * `purchasable`: hanya paket berharga > 0 dan dapat ditagih (kelipatan Rp 1)
 * yang boleh dibuatkan tagihan.
 */
export const listPurchasablePlans = async () => {
  const { rows } = await query(
    `SELECT id, name, max_outlets, max_cashiers, price, duration_days, features, is_default
       FROM subscription_plans
      WHERE is_active = true
      ORDER BY price ASC, name ASC`
  );
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    max_outlets: p.max_outlets,
    max_cashiers: p.max_cashiers,
    price: Number(p.price),
    duration_days: p.duration_days,
    features: p.features,
    is_default: p.is_default,
    purchasable: Number(p.price) > 0 && senToRupiah(p.price) !== null,
  }));
};

/** Ringkasan checkout: daftar paket + status gateway + kanal aktif. */
export const checkoutOptions = async () => ({
  gateway: describePayments(),
  plans: await listPurchasablePlans(),
});

/** Riwayat tagihan satu bisnis (terbaru lebih dahulu). */
export const listInvoices = async ({ businessId, status = null, page = 1, limit = 20 }) => {
  const conds = ['i.business_id = $1'];
  const params = [businessId];
  if (status) {
    params.push(status);
    conds.push(`i.status = $${params.length}`);
  }
  const where = `WHERE ${conds.join(' AND ')}`;

  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total FROM subscription_invoices i ${where}`,
    params
  );

  const { rows } = await query(
    `SELECT ${JOINED_COLUMNS}
       FROM subscription_invoices i
       JOIN subscription_plans p ON p.id = i.plan_id
       ${where}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );

  return { items: rows.map(invoiceDto), total: countRows[0].total, page, limit };
};

/** Satu tagihan milik bisnis (anti-IDOR: wajib cocok business_id). */
export const getInvoiceRow = async (businessId, invoiceId) => {
  const { rows } = await query(
    `SELECT ${JOINED_COLUMNS}
       FROM subscription_invoices i
       JOIN subscription_plans p ON p.id = i.plan_id
      WHERE i.id = $1 AND i.business_id = $2`,
    [invoiceId, businessId]
  );
  if (!rows[0]) throw new NotFoundError('Tagihan tidak ditemukan');
  return rows[0];
};

export const getInvoice = async ({ businessId, invoiceId }) =>
  invoiceDto(await getInvoiceRow(businessId, invoiceId));

/**
 * Buat (atau pakai ulang) tagihan untuk sebuah paket lalu minta nomor
 * pembayaran ke gateway.
 */
export const createInvoiceForPlan = async ({ businessId, planId, paymentMethod, actor, ip }) => {
  const method = String(paymentMethod ?? '').trim().toUpperCase();
  const allowed = activeChannels().map((c) => c.code);
  if (!allowed.includes(method)) {
    throw new AppError(
      allowed.length
        ? `Metode pembayaran tidak tersedia. Pilihan: ${allowed.join(', ')}`
        : 'Belum ada metode pembayaran yang aktif di server ini',
      422,
      { fields: [{ path: 'paymentMethod', message: 'Metode pembayaran tidak tersedia' }] }
    );
  }

  const provider = requireProvider();
  const cfg = env.payments;

  const { rows: planRows } = await query(
    `SELECT id, name, price, duration_days, is_active FROM subscription_plans WHERE id = $1`,
    [planId]
  );
  const plan = planRows[0];
  if (!plan || !plan.is_active) throw new NotFoundError('Paket tidak ditemukan atau nonaktif');

  const amountRupiah = senToRupiah(plan.price);
  if (amountRupiah === null) {
    throw new AppError('Harga paket tidak dapat ditagih (harus kelipatan Rp 1)', 422);
  }
  if (amountRupiah <= 0) {
    throw new AppError('Paket gratis tidak memerlukan pembayaran', 422);
  }
  if (amountRupiah < cfg.minAmountIdr) {
    throw new AppError(
      `Nominal tagihan di bawah minimum gateway (${rupiah(cfg.minAmountIdr)}).`,
      422,
      { fields: [{ path: 'planId', message: 'Harga paket di bawah minimum gateway' }] }
    );
  }

  const { rows: bizRows } = await query(
    `SELECT b.id, b.name, o.id AS owner_id, o.email AS owner_email, o.full_name AS owner_name
       FROM businesses b
       JOIN owners o ON o.id = b.owner_id
      WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [businessId]
  );
  const biz = bizRows[0];
  if (!biz) throw new NotFoundError('Bisnis tidak ditemukan');
  if (!biz.owner_email || biz.owner_email.length > 50) {
    throw new AppError(
      'Email pemilik tidak dapat dipakai gateway (wajib ada, maks 50 karakter).',
      422
    );
  }

  // Tagihan pending yang masih berlaku untuk paket+kanal sama: pakai ulang agar
  // Owner tidak mendapat dua nomor VA untuk tagihan yang sama (idempoten).
  const { rows: existing } = await query(
    `SELECT ${JOINED_COLUMNS}
       FROM subscription_invoices i
       JOIN subscription_plans p ON p.id = i.plan_id
      WHERE i.business_id = $1 AND i.status = 'pending'
        AND i.plan_id = $2 AND i.payment_method = $3
        AND (i.expires_at IS NULL OR i.expires_at > now())
      ORDER BY i.created_at DESC
      LIMIT 1`,
    [businessId, plan.id, method]
  );
  if (existing[0]) return { invoice: invoiceDto(existing[0]), reused: true };

  const orderId = generateOrderId();
  const expiryMinutes = expiryMinutesFor(method, cfg.expiryMinutes);
  const expiresAt = new Date(Date.now() + expiryMinutes * 60_000);

  // Hanya satu tagihan pending per bisnis (index unik parsial): tagihan pending
  // lain dibatalkan agar tidak ada dua nomor pembayaran aktif.
  let inserted;
  try {
    inserted = await withTransaction(async (client) => {
      await client.query(
        `UPDATE subscription_invoices SET status = 'canceled'
          WHERE business_id = $1 AND status = 'pending'`,
        [businessId]
      );
      const { rows } = await client.query(
        `INSERT INTO subscription_invoices
           (business_id, plan_id, order_id, amount, status, provider, payment_method,
            expires_at, created_by)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
         RETURNING ${INVOICE_COLUMNS}`,
        [businessId, plan.id, orderId, plan.price, provider.name, method, expiresAt, actor?.id ?? null]
      );
      await writeAudit({
        client,
        actorRole: actor?.role ?? 'owner',
        actorId: actor?.id ?? biz.owner_id,
        businessId,
        action: 'subscription.invoice_created',
        entityType: 'subscription_invoice',
        entityId: rows[0].id,
        after: {
          order_id: orderId,
          plan_id: plan.id,
          amount: Number(plan.price),
          provider: provider.name,
          payment_method: method,
        },
        ip,
      });
      return rows[0];
    });
  } catch (err) {
    if (err?.code === '23505') {
      // Balapan dua permintaan: pakai tagihan pending yang sudah ada.
      const { rows } = await query(
        `SELECT ${JOINED_COLUMNS}
           FROM subscription_invoices i
           JOIN subscription_plans p ON p.id = i.plan_id
          WHERE i.business_id = $1 AND i.status = 'pending'
          ORDER BY i.created_at DESC LIMIT 1`,
        [businessId]
      );
      if (rows[0]) return { invoice: invoiceDto(rows[0]), reused: true };
    }
    throw err;
  }

  const invoice = inserted;

  // Panggilan jaringan TIDAK di dalam transaksi DB (jangan kunci baris saat I/O).
  let charge;
  try {
    charge = await provider.createInvoice({
      orderId,
      amountIdr: amountRupiah,
      method,
      productDetails: `Langganan ${plan.name} - ${biz.name}`.slice(0, 255),
      email: biz.owner_email,
      customerName: biz.owner_name || biz.name,
      callbackUrl: resolveCallbackUrl(),
      returnUrl: resolveReturnUrl(),
      expiryMinutes,
    });
  } catch (err) {
    // Tandai gagal agar tidak memblokir percobaan berikutnya (index pending).
    await query(
      `UPDATE subscription_invoices
          SET status = 'failed', failed_at = now(), attempts = attempts + 1
        WHERE id = $1 AND status = 'pending'`,
      [invoice.id]
    );
    throw err;
  }

  const { rows: updated } = await query(
    `UPDATE subscription_invoices
        SET provider_reference = $2, va_number = $3, qr_string = $4, payment_url = $5,
            inquiry_payload = $6::jsonb
      WHERE id = $1
      RETURNING ${INVOICE_COLUMNS}`,
    [
      invoice.id,
      charge.reference,
      charge.vaNumber,
      charge.qrString,
      charge.paymentUrl,
      JSON.stringify({ ...charge.raw, signature: undefined }),
    ]
  );

  const { rows: withPlan } = await query(
    `SELECT ${JOINED_COLUMNS}
       FROM subscription_invoices i
       JOIN subscription_plans p ON p.id = i.plan_id
      WHERE i.id = $1`,
    [updated[0].id]
  );

  return { invoice: invoiceDto(withPlan[0]), reused: false };
};

/**
 * Tandai tagihan lunas + aktifkan/perpanjang langganan (idempoten).
 *
 * `source`: 'callback' (webhook gateway) atau 'sync' (cek status manual).
 */
const applyPaidInvoice = async ({ invoiceId, paymentInfo = {}, ip = null, source = 'callback' }) =>
  withTransaction(async (client) => {
    const { rows: invRows } = await client.query(
      `SELECT ${INVOICE_COLUMNS} FROM subscription_invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId]
    );
    const invoice = invRows[0];
    if (!invoice) throw new NotFoundError('Tagihan tidak ditemukan');
    if (invoice.status === 'paid') return { alreadyPaid: true, invoice };

    const { rows: bizRows } = await client.query(
      `SELECT id, owner_id FROM businesses WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [invoice.business_id]
    );
    const biz = bizRows[0];
    if (!biz) throw new NotFoundError('Bisnis tidak ditemukan');

    const { rows: planRows } = await client.query(
      `SELECT id, name, duration_days FROM subscription_plans WHERE id = $1`,
      [invoice.plan_id]
    );
    const plan = planRows[0];
    if (!plan) throw new NotFoundError('Paket tagihan tidak ditemukan');

    const { rows: activeRows } = await client.query(
      `SELECT id, plan_id, status FROM subscriptions
        WHERE business_id = $1 AND status = 'active' FOR UPDATE`,
      [invoice.business_id]
    );
    if (activeRows[0]) {
      await client.query(`UPDATE subscriptions SET status = 'expired' WHERE id = $1`, [
        activeRows[0].id,
      ]);
    }

    // Masa berlaku dihitung dari sekarang (pola sama dengan `assignSubscription`
    // milik Admin Platform) — bukan ditambahkan ke sisa masa langganan lama.
    const { rows: subRows } = await client.query(
      `INSERT INTO subscriptions (business_id, plan_id, status, started_at, expires_at, auto_renew)
       VALUES ($1, $2, 'active', now(), now() + make_interval(days => $3), false)
       RETURNING id, business_id, plan_id, status, started_at, expires_at, auto_renew`,
      [invoice.business_id, invoice.plan_id, plan.duration_days]
    );

    const { rows: updRows } = await client.query(
      `UPDATE subscription_invoices
          SET status = 'paid', paid_at = now(), subscription_id = $2,
              provider_reference = COALESCE($3, provider_reference),
              callback_payload = COALESCE($4::jsonb, callback_payload)
        WHERE id = $1
        RETURNING ${INVOICE_COLUMNS}`,
      [invoice.id, subRows[0].id, paymentInfo.reference ?? null, paymentInfo.payloadJson ?? null]
    );

    await writeAudit({
      client,
      actorRole: 'owner',
      actorId: invoice.created_by ?? biz.owner_id,
      businessId: invoice.business_id,
      action: source === 'sync' ? 'subscription.invoice_paid_sync' : 'subscription.invoice_paid',
      entityType: 'subscription',
      entityId: subRows[0].id,
      before: { plan_id: activeRows[0]?.plan_id ?? null, status: activeRows[0]?.status ?? null },
      after: {
        plan_id: invoice.plan_id,
        plan_name: plan.name,
        status: 'active',
        invoice_id: invoice.id,
        order_id: invoice.order_id,
        payment_method: invoice.payment_method,
        amount: Number(invoice.amount),
        source,
        reference: paymentInfo.reference ?? null,
      },
      ip,
    });

    return { alreadyPaid: false, invoice: updRows[0], subscription: subRows[0], plan };
  });

/** Tandai tagihan tidak terbayar (gagal/kedaluwarsa) — tanpa mengaktifkan paket. */
const markInvoiceUnpaid = async ({ invoiceId, payloadJson = null, ip = null, source = 'callback' }) => {
  const { rows: current } = await query(
    `SELECT ${INVOICE_COLUMNS} FROM subscription_invoices WHERE id = $1`,
    [invoiceId]
  );
  const invoice = current[0];
  if (!invoice) throw new NotFoundError('Tagihan tidak ditemukan');
  if (invoice.status === 'paid') return { alreadyPaid: true, invoice };

  const expired = invoice.expires_at && new Date(invoice.expires_at) <= new Date();
  const status = expired ? 'expired' : 'failed';

  const { rows } = await query(
    `UPDATE subscription_invoices
        SET status = $2, failed_at = now(),
            callback_payload = COALESCE($3::jsonb, callback_payload)
      WHERE id = $1 AND status <> 'paid'
      RETURNING ${INVOICE_COLUMNS}`,
    [invoiceId, status, payloadJson]
  );
  if (!rows[0]) return { alreadyPaid: true, invoice };

  // `audit_logs.actor_id` NOT NULL: pakai Owner pembuat tagihan, dengan
  // cadangan Owner bisnis (kolom `created_by` bisa NULL bila akun Owner dihapus
  // — walau praktis bisnisnya ikut terhapus karena ON DELETE CASCADE).
  const { rows: bizRows } = await query(`SELECT owner_id FROM businesses WHERE id = $1`, [
    invoice.business_id,
  ]);
  const actorId = invoice.created_by ?? bizRows[0]?.owner_id ?? null;
  if (actorId) {
    await writeAudit({
      actorRole: 'owner',
      actorId,
      businessId: invoice.business_id,
      action: 'subscription.invoice_unpaid',
      entityType: 'subscription_invoice',
      entityId: invoice.id,
      before: { status: invoice.status },
      after: { status, order_id: invoice.order_id, source },
      ip,
    });
  } else {
    console.warn('[payment] audit tagihan tidak terbayar dilewati (actor_id kosong)');
  }

  return { alreadyPaid: false, invoice: rows[0], status };
};

/**
 * Proses callback gateway (endpoint publik). Melempar 401 bila tanda tangan
 * tidak sah; mengembalikan `{ status: 'ignored' }` untuk tagihan tak dikenal
 * agar gateway tidak mengulang tanpa henti.
 */
export const handleDuitkuCallback = async ({ body = {}, ip = null }) => {
  const provider = requireProvider();
  if (provider.name !== 'duitku') {
    throw new AppError('Penyedia gateway aktif tidak cocok dengan endpoint ini', 503);
  }

  const verdict = provider.verifyCallback(body);
  if (!verdict.ok) {
    console.warn('[payment] callback ditolak:', verdict.reason);
    throw new UnauthorizedError('Callback gateway tidak sah');
  }

  const { rows } = await query(
    `SELECT ${INVOICE_COLUMNS} FROM subscription_invoices WHERE order_id = $1`,
    [verdict.orderId]
  );
  const invoice = rows[0];
  if (!invoice) {
    console.warn('[payment] callback untuk tagihan tak dikenal:', verdict.orderId);
    return { status: 'ignored', reason: 'tagihan_tidak_dikenal', order_id: verdict.orderId };
  }
  if (invoice.provider !== provider.name) {
    return { status: 'ignored', reason: 'penyedia_tidak_cocok', order_id: verdict.orderId };
  }

  const payloadJson = JSON.stringify(stripSignature(body));
  const expectedRupiah = senToRupiah(invoice.amount);
  if (verdict.amountIdr !== expectedRupiah) {
    await query(
      `UPDATE subscription_invoices SET callback_payload = $2::jsonb WHERE id = $1`,
      [invoice.id, payloadJson]
    );
    throw new AppError(
      `Nominal callback (${rupiah(verdict.amountIdr)}) tidak sesuai tagihan (${rupiah(expectedRupiah)})`,
      400
    );
  }

  if (verdict.resultCode === '00') {
    const applied = await applyPaidInvoice({
      invoiceId: invoice.id,
      paymentInfo: { reference: verdict.reference, payloadJson },
      ip,
      source: 'callback',
    });
    return {
      status: applied.alreadyPaid ? 'sudah_lunas' : 'lunas',
      invoice_id: invoice.id,
      subscription_id: applied.subscription?.id ?? null,
    };
  }

  const marked = await markInvoiceUnpaid({ invoiceId: invoice.id, payloadJson, ip, source: 'callback' });
  return {
    status: marked.alreadyPaid ? 'sudah_lunas' : 'gagal',
    invoice_id: invoice.id,
  };
};

/**
 * Cek status tagihan ke gateway atas permintaan Owner (tombol "Cek status").
 * Duitku membatasi hit rate -> hanya dipanggil manual + dibatasi rate limiter.
 */
export const syncInvoiceStatus = async ({ businessId, invoiceId, ip = null }) => {
  const provider = requireProvider();
  const row = await getInvoiceRow(businessId, invoiceId);

  if (row.status !== 'pending') {
    return { invoice: invoiceDto(row), checked: false, gateway_status: null };
  }

  const result = await provider.checkStatus(row.order_id);
  const payloadJson = JSON.stringify(stripSignature({ ...result.raw, checked_at: new Date().toISOString() }));

  await query(
    `UPDATE subscription_invoices SET attempts = attempts + 1 WHERE id = $1`,
    [row.id]
  );

  if (result.statusCode === '00') {
    const expectedRupiah = senToRupiah(row.amount);
    if (result.amountIdr !== expectedRupiah) {
      await query(
        `UPDATE subscription_invoices SET callback_payload = $2::jsonb WHERE id = $1`,
        [row.id, payloadJson]
      );
      throw new AppError(
        `Nominal transaksi gateway (${rupiah(result.amountIdr)}) tidak sesuai tagihan (${rupiah(expectedRupiah)})`,
        409
      );
    }
    await applyPaidInvoice({
      invoiceId: row.id,
      paymentInfo: { reference: result.reference, payloadJson },
      ip,
      source: 'sync',
    });
  } else if (result.statusCode === '02') {
    await markInvoiceUnpaid({ invoiceId: row.id, payloadJson, ip, source: 'sync' });
  } else {
    await query(
      `UPDATE subscription_invoices SET callback_payload = $2::jsonb WHERE id = $1`,
      [row.id, payloadJson]
    );
  }

  return {
    invoice: await getInvoice({ businessId, invoiceId }),
    checked: true,
    gateway_status: { code: result.statusCode, message: result.statusMessage },
  };
};

export default {
  checkoutOptions,
  listPurchasablePlans,
  listInvoices,
  getInvoice,
  createInvoiceForPlan,
  handleDuitkuCallback,
  syncInvoiceStatus,
};
