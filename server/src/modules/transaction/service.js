/**
 * Layanan modul transaksi penjualan (Fase 7).
 *
 * Aturan kunci:
 *   - Server MENGHITUNG ULANG harga/total dari katalog; input klien hanya
 *     berisi productId + qty (+ diskon/pembayaran). Harga tidak bisa di-override
 *     kasir (matriks: "Ubah harga jual" hanya Owner).
 *   - Diskon per transaksi (persen/nominal), diterapkan SEBELUM pajak.
 *   - Pajak per outlet: eksklusif (ditambahkan) atau inklusif (sudah termasuk).
 *   - Penomoran invoice atomik per (outlet, hari) memakai counter + upsert.
 *   - Pengurangan stok + pencatatan item/pajak/total terjadi dalam SATU
 *     transaksi DB. Baris stok dikunci lewat `UPDATE ... WHERE quantity >= qty`
 *     sehingga penjualan konkuren tidak pernah menghasilkan stok negatif.
 *   - Anti-duplikasi: `clientRef` unik per outlet; permintaan ulang mengembalikan
 *     transaksi yang sama (idempoten).
 *   - Void oleh Owner mengembalikan stok ke outlet.
 */
import { query, withTransaction } from '../../config/db.js';
import { NotFoundError, ConflictError } from '../../middleware/error.js';
import { writeAudit } from '../audit/service.js';

export const TRANSACTION_COLUMNS = `id, business_id, outlet_id, cashier_id, invoice_no,
  status, subtotal, discount_type, discount_value, discount_total, tax_rate,
  tax_inclusive, tax_total, total, paid_amount, change_amount, note, client_ref,
  voided_at, voided_by, created_at, updated_at`;

/**
 * Bagi `total` (integer) ke `weights` secara proporsional. Sisa dibagikan ke
 * bobot dengan bagian pecahan terbesar agar jumlah hasil = `total` persis.
 */
const allocate = (total, weights) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);

  const raw = weights.map((w) => (total * w) / sum);
  const result = raw.map((v) => Math.floor(v));
  let remainder = total - result.reduce((a, b) => a + b, 0);

  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  for (let k = 0; k < remainder; k += 1) result[order[k % order.length].i] += 1;
  return result;
};

/**
 * Hitung diskon, pajak, total, dan alokasi per item. Semua integer sen.
 * @returns {{discountType: string|null, discountValue: number|null,
 *   discountTotal: number, taxTotal: number, total: number, lines: Array}}
 */
const computeTotals = ({ items, subtotal, discount, taxRate, taxInclusive }) => {
  let discountType = null;
  let discountValue = null;
  let discountTotal = 0;

  if (discount) {
    discountType = discount.type;
    if (discount.type === 'percent') {
      const basisPoints = Math.round(discount.value * 100); // 1% = 100 bp
      discountValue = basisPoints;
      discountTotal = Math.round((subtotal * basisPoints) / 10000);
    } else {
      discountValue = Math.round(discount.value);
      discountTotal = discountValue;
    }
    if (discountTotal > subtotal) {
      throw new ConflictError('Diskon melebihi subtotal transaksi');
    }
  }

  const discounted = subtotal - discountTotal;
  const rateBp = Math.round(Number(taxRate) * 100); // basis points

  let taxTotal = 0;
  let total = discounted;
  if (rateBp > 0) {
    if (taxInclusive) {
      // Harga sudah termasuk pajak: pisahkan porsi pajak dari total.
      taxTotal = Math.round((discounted * rateBp) / (10000 + rateBp));
      total = discounted;
    } else {
      taxTotal = Math.round((discounted * rateBp) / 10000);
      total = discounted + taxTotal;
    }
  }

  const bases = items.map((it) => it.unit_price * it.qty);
  const itemDiscounts = allocate(discountTotal, bases);
  const taxBases = bases.map((b, idx) => b - itemDiscounts[idx]);
  const itemTaxes = rateBp > 0 ? allocate(taxTotal, taxBases) : bases.map(() => 0);

  const lines = items.map((it, idx) => {
    const base = bases[idx];
    const disc = itemDiscounts[idx];
    const tax = itemTaxes[idx];
    const lineTotal = taxInclusive ? base - disc : base - disc + tax;
    return {
      ...it,
      base,
      discount_amount: disc,
      tax_amount: tax,
      line_total: lineTotal,
    };
  });

  return { discountType, discountValue, discountTotal, taxTotal, total, lines };
};

// ============================================================ Scope kasir ====
/**
 * Ambil outlet/bisnis milik kasir (global query, tanpa lock) untuk operasi
 * baca. Mengembalikan 404 bila outlet/bisnis sudah dihapus.
 */
const cashierScope = async (cashierId) => {
  const { rows } = await query(
    `SELECT c.id AS cashier_id, c.status AS cashier_status,
            o.id AS outlet_id, o.business_id, o.name AS outlet_name,
            o.status AS outlet_status, o.tax_rate, o.tax_inclusive,
            b.status AS business_status, b.timezone
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
       JOIN businesses b ON b.id = o.business_id
      WHERE c.id = $1 AND o.deleted_at IS NULL AND b.deleted_at IS NULL`,
    [cashierId]
  );
  if (!rows[0]) throw new NotFoundError('Outlet kasir tidak ditemukan');
  return rows[0];
};

// ================================================================ Detail =====
const loadDetail = async (db, businessId, transactionId) => {
  const { rows } = await db.query(
    `SELECT t.*, o.name AS outlet_name, c.full_name AS cashier_name
       FROM transactions t
       JOIN outlets o ON o.id = t.outlet_id
       LEFT JOIN cashiers c ON c.id = t.cashier_id
      WHERE t.id = $1 AND t.business_id = $2`,
    [transactionId, businessId]
  );
  const transaction = rows[0];
  if (!transaction) throw new NotFoundError('Transaksi tidak ditemukan');

  const items = await db.query(
    `SELECT id, product_id, product_name, sku, unit_price, qty,
            discount_amount, tax_amount, line_total
       FROM transaction_items WHERE transaction_id = $1
      ORDER BY created_at ASC, id ASC`,
    [transactionId]
  );
  const payments = await db.query(
    `SELECT id, method, amount, reference, provider, status, created_at
       FROM payments WHERE transaction_id = $1
      ORDER BY created_at ASC, id ASC`,
    [transactionId]
  );

  return { ...transaction, items: items.rows, payments: payments.rows };
};

// ============================================================== Penjualan ====
/** Buat penjualan (kasir). Outlet diturunkan dari akun kasir. */
export const createSale = async ({ cashierId, data, ip }) => {
  return withTransaction(async (client) => {
    // 1. Scope kasir + kunci baris outlet (serialkan per outlet).
    const { rows: scopeRows } = await client.query(
      `SELECT c.id AS cashier_id, c.status AS cashier_status,
              o.id AS outlet_id, o.business_id, o.name AS outlet_name,
              o.status AS outlet_status, o.tax_rate, o.tax_inclusive,
              b.status AS business_status, b.timezone
         FROM cashiers c
         JOIN outlets o ON o.id = c.outlet_id
         JOIN businesses b ON b.id = o.business_id
        WHERE c.id = $1 AND o.deleted_at IS NULL AND b.deleted_at IS NULL
        FOR UPDATE OF o`,
      [cashierId]
    );
    const scope = scopeRows[0];
    if (!scope) throw new NotFoundError('Outlet kasir tidak ditemukan');
    if (scope.cashier_status !== 'active') throw new ConflictError('Akun kasir tidak aktif');
    if (scope.outlet_status !== 'active') throw new ConflictError('Outlet sedang nonaktif');
    if (scope.business_status !== 'active') throw new ConflictError('Bisnis sedang nonaktif');

    // 2. Idempotensi: clientRef sama -> kembalikan transaksi yang sama.
    if (data.clientRef) {
      const existing = await client.query(
        `SELECT id FROM transactions WHERE outlet_id = $1 AND client_ref = $2`,
        [scope.outlet_id, data.clientRef]
      );
      if (existing.rows[0]) {
        const detail = await loadDetail(client, scope.business_id, existing.rows[0].id);
        return { transaction: detail, idempotent: true };
      }
    }

    // 3. Ambil produk (harga dari katalog, bukan dari klien).
    const productIds = data.items.map((it) => it.productId);
    const dupes = productIds.filter((v, i) => productIds.indexOf(v) !== i);
    if (dupes.length) throw new ConflictError('Keranjang memuat produk duplikat');

    const { rows: prodRows } = await client.query(
      `SELECT id, name, sku, price, track_stock, status
         FROM products
        WHERE id = ANY($1::uuid[]) AND business_id = $2 AND deleted_at IS NULL`,
      [productIds, scope.business_id]
    );
    const byId = new Map(prodRows.map((p) => [p.id, p]));

    const items = data.items.map((it) => {
      const p = byId.get(it.productId);
      if (!p) throw new NotFoundError('Produk tidak ditemukan di bisnis ini');
      if (p.status !== 'active') throw new ConflictError(`Produk "${p.name}" sedang nonaktif`);
      return {
        product_id: p.id,
        product_name: p.name,
        sku: p.sku,
        unit_price: Number(p.price),
        qty: it.qty,
        track_stock: p.track_stock,
      };
    });

    const subtotal = items.reduce((a, it) => a + it.unit_price * it.qty, 0);
    if (subtotal <= 0) throw new ConflictError('Subtotal transaksi harus lebih dari 0');

    const totals = computeTotals({
      items,
      subtotal,
      discount: data.discount,
      taxRate: scope.tax_rate,
      taxInclusive: scope.tax_inclusive,
    });

    // 4. Validasi pembayaran (tunai boleh lebih -> kembalian; non-tunai pas).
    const { method } = data.payment;
    const paid = data.payment.amount;
    let change = 0;
    if (method === 'cash') {
      if (paid < totals.total) throw new ConflictError('Uang tunai kurang dari total');
      change = paid - totals.total;
    } else if (paid !== totals.total) {
      throw new ConflictError('Jumlah pembayaran non-tunai harus sama dengan total');
    }

    // 5. Nomor invoice atomik per (outlet, hari) — pakai zona waktu bisnis.
    const { rows: dayRows } = await client.query(
      `SELECT to_char((now() AT TIME ZONE $1::text)::date, 'YYYY-MM-DD') AS day_str,
              to_char((now() AT TIME ZONE $1::text)::date, 'YYYYMMDD')  AS ymd`,
      [scope.timezone]
    );
    const { day_str: dayStr, ymd } = dayRows[0];

    const { rows: seqRows } = await client.query(
      `INSERT INTO outlet_invoice_counters (outlet_id, day, last_seq)
       VALUES ($1, $2, 1)
       ON CONFLICT (outlet_id, day)
       DO UPDATE SET last_seq = outlet_invoice_counters.last_seq + 1
       RETURNING last_seq`,
      [scope.outlet_id, dayStr]
    );
    const invoiceNo = `INV-${ymd}-${String(seqRows[0].last_seq).padStart(4, '0')}`;

    // 6. Kepala transaksi.
    const { rows: txRows } = await client.query(
      `INSERT INTO transactions
         (business_id, outlet_id, cashier_id, invoice_no, status, subtotal,
          discount_type, discount_value, discount_total, tax_rate, tax_inclusive,
          tax_total, total, paid_amount, change_amount, note, client_ref)
       VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING ${TRANSACTION_COLUMNS}`,
      [
        scope.business_id,
        scope.outlet_id,
        cashierId,
        invoiceNo,
        subtotal,
        totals.discountType,
        totals.discountValue,
        totals.discountTotal,
        scope.tax_rate,
        scope.tax_inclusive,
        totals.taxTotal,
        totals.total,
        paid,
        change,
        data.note ?? null,
        data.clientRef ?? null,
      ]
    );
    const transaction = txRows[0];

    // 7. Item + pengurangan stok (row lock via WHERE quantity >= qty).
    for (const line of totals.lines) {
      await client.query(
        `INSERT INTO transaction_items
           (transaction_id, product_id, product_name, sku, unit_price, qty,
            discount_amount, tax_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          transaction.id,
          line.product_id,
          line.product_name,
          line.sku,
          line.unit_price,
          line.qty,
          line.discount_amount,
          line.tax_amount,
          line.line_total,
        ]
      );

      if (line.track_stock) {
        const upd = await client.query(
          `UPDATE product_stocks
              SET quantity = quantity - $3, updated_at = now()
            WHERE product_id = $1 AND outlet_id = $2 AND quantity >= $3`,
          [line.product_id, scope.outlet_id, line.qty]
        );
        if (upd.rowCount === 0) {
          throw new ConflictError(`Stok "${line.product_name}" tidak mencukupi`);
        }
      }
    }

    // 8. Pembayaran.
    await client.query(
      `INSERT INTO payments (transaction_id, method, amount, reference, status)
       VALUES ($1, $2, $3, $4, 'paid')`,
      [transaction.id, method, paid, data.payment.reference ?? null]
    );

    // 9. Audit.
    await writeAudit({
      client,
      actorRole: 'cashier',
      actorId: cashierId,
      businessId: scope.business_id,
      action: 'transaction.create',
      entityType: 'transaction',
      entityId: transaction.id,
      after: { invoice_no: invoiceNo, total: totals.total, item_count: items.length },
      ip,
    });

    const detail = await loadDetail(client, scope.business_id, transaction.id);
    return { transaction: detail, idempotent: false };
  });
};

// ================================================================== Baca =====
export const listTransactions = async ({ businessId, filters }) => {
  const where = ['t.business_id = $1'];
  const values = [businessId];
  let i = 2;

  if (filters.outletId) {
    where.push(`t.outlet_id = $${i++}`);
    values.push(filters.outletId);
  }
  if (filters.cashierId) {
    where.push(`t.cashier_id = $${i++}`);
    values.push(filters.cashierId);
  }
  if (filters.status) {
    where.push(`t.status = $${i++}`);
    values.push(filters.status);
  }
  if (filters.dateFrom) {
    where.push(`t.created_at >= $${i++}::date`);
    values.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    where.push(`t.created_at < ($${i++}::date + interval '1 day')`);
    values.push(filters.dateTo);
  }

  const whereSql = where.join(' AND ');
  const limit = filters.limit;
  const offset = (filters.page - 1) * limit;

  const { rows } = await query(
    `SELECT t.id, t.invoice_no, t.status, t.subtotal, t.discount_total,
            t.tax_total, t.total, t.paid_amount, t.change_amount,
            t.created_at, t.voided_at, t.outlet_id, o.name AS outlet_name,
            t.cashier_id, c.full_name AS cashier_name
       FROM transactions t
       JOIN outlets o ON o.id = t.outlet_id
       LEFT JOIN cashiers c ON c.id = t.cashier_id
      WHERE ${whereSql}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, limit, offset]
  );

  const count = await query(
    `SELECT count(*)::int AS n FROM transactions t WHERE ${whereSql}`,
    values
  );

  return { items: rows, total: count.rows[0].n };
};

/** Daftar transaksi outlet milik kasir (outlet dari akun, bukan input klien). */
export const listOutletTransactions = async ({ cashierId, filters }) => {
  const scope = await cashierScope(cashierId);
  return listTransactions({
    businessId: scope.business_id,
    filters: { ...filters, outletId: scope.outlet_id },
  });
};

export const getTransaction = async (businessId, transactionId) =>
  loadDetail({ query }, businessId, transactionId);

export const getOutletTransaction = async (cashierId, transactionId) => {
  const scope = await cashierScope(cashierId);
  const detail = await loadDetail({ query }, scope.business_id, transactionId);
  if (detail.outlet_id !== scope.outlet_id) {
    throw new NotFoundError('Transaksi tidak ditemukan');
  }
  return detail;
};

// ================================================================== Void =====
/** Batalkan transaksi (Owner) + kembalikan stok. */
export const voidTransaction = async ({ businessId, transactionId, actor, ip }) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${TRANSACTION_COLUMNS} FROM transactions
        WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [transactionId, businessId]
    );
    const transaction = rows[0];
    if (!transaction) throw new NotFoundError('Transaksi tidak ditemukan');
    if (transaction.status !== 'completed') {
      throw new ConflictError('Hanya transaksi berstatus selesai yang dapat dibatalkan');
    }

    // Kembalikan stok untuk produk yang masih melacak stok.
    const { rows: items } = await client.query(
      `SELECT ti.product_id, ti.qty, p.track_stock
         FROM transaction_items ti
         LEFT JOIN products p ON p.id = ti.product_id
        WHERE ti.transaction_id = $1`,
      [transactionId]
    );
    for (const it of items) {
      if (it.product_id && it.track_stock) {
        await client.query(
          `UPDATE product_stocks
              SET quantity = quantity + $3, updated_at = now()
            WHERE product_id = $1 AND outlet_id = $2`,
          [it.product_id, transaction.outlet_id, it.qty]
        );
      }
    }

    await client.query(
      `UPDATE transactions
          SET status = 'voided', voided_at = now(), voided_by = $2
        WHERE id = $1`,
      [transactionId, actor.id]
    );

    await writeAudit({
      client,
      actorRole: actor.role,
      actorId: actor.id,
      businessId,
      action: 'transaction.void',
      entityType: 'transaction',
      entityId: transactionId,
      before: { status: transaction.status },
      after: { status: 'voided' },
      ip,
    });

    return loadDetail(client, businessId, transactionId);
  });
};

export default {
  createSale,
  listTransactions,
  listOutletTransactions,
  getTransaction,
  getOutletTransaction,
  voidTransaction,
};
