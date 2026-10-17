/**
 * Tes integrasi 17 Okt 2026 — Laporan Transaksi siap-cetak.
 *
 * Kriteria selesai (keputusan Pemilik: A1a halaman cetak HTML, A2b hanya
 * Owner, A3a satu baris per item, A4a prefix `INV-`, A5a cakupan outlet):
 *   - `GET /api/owner/businesses/:id/reports/transactions` mengembalikan SATU
 *     BARIS PER ITEM (bukan per transaksi) + ringkasan, rekap metode pembayaran
 *     (persentase), dan produk terlaris (urut qty).
 *   - Cakupan tenant dijamin: bisnis lain 404, kasir 403, admin baca-saja 200,
 *     dan filter outlet milik bisnis lain tidak membocorkan data.
 *   - Default hanya transaksi `completed`; voided/refunded dilaporkan terpisah.
 *   - Filter outlet/kasir/status/pencarian + `limit`/`truncated`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import ExcelJS from 'exceljs';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'LaporanTrx123!';
const TZ = 'Asia/Jakarta';

let tokenA, tokenB, adminToken;
let businessA, businessB;
let outletT1, outletB1;
let cashierId;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const ownerPath = (businessId, tail = '') => `/businesses/${businessId}${tail}`;
const ownerGet = (token, path) => request.get(`/api/owner${path}`, auth(token));
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));
const ownerPatch = (token, path, body) => request.patch(`/api/owner${path}`, body, auth(token));
const adminGet = (token, path) => request.get(`/api/platform/businesses${path}`, auth(token));
const lapTx = (biz, q = '') => ownerPath(biz, `/reports/transactions${q}`);
const lapTxExport = (biz, q = '') => ownerPath(biz, `/reports/transactions/export${q}`);

/** Ambil nilai kolom B dari baris yang labelnya (kolom A) cocok. */
const cellByLabel = (ws, label) => {
  for (let r = 1; r <= ws.rowCount; r += 1) {
    if (ws.getCell(r, 1).value === label) return ws.getCell(r, 2).value;
  }
  return undefined;
};

/** Unduh + buka berkas .xlsx Laporan Transaksi (header & tipe diperiksa). */
const loadTrxWorkbook = async (token, path) => {
  const res = await request.binary(`/api/owner${path}`, auth(token));
  assert.strictEqual(res.status, 200, `ekspor xlsx laporan transaksi harus 200: ${path}`);
  assert.ok(res.buffer.length > 1000, 'buffer xlsx tidak boleh kosong');
  assert.match(
    res.headers.get('content-type') ?? '',
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
  );
  assert.match(
    res.headers.get('content-disposition') ?? '',
    /KASIR_NOVA_Laporan_Transaksi_\d{4}-\d{2}-\d{2}_sampai_\d{4}-\d{2}-\d{2}\.xlsx/
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.buffer);
  return { res, wb };
};

const todayTz = async () => {
  const { rows } = await query(
    `SELECT to_char((now() AT TIME ZONE $1::text)::date, 'YYYY-MM-DD') AS d`,
    [TZ]
  );
  return rows[0].d;
};

/** Sisipkan transaksi + item langsung (untuk status/metode tertentu). */
const insertTx = async ({
  businessId,
  outletId,
  invoiceNo,
  status = 'completed',
  total,
  productName,
  method = 'cash',
}) => {
  const { rows } = await query(
    `INSERT INTO transactions
       (business_id, outlet_id, invoice_no, status, subtotal, discount_total,
        tax_rate, tax_inclusive, tax_total, total, paid_amount, change_amount)
     VALUES ($1,$2,$3,$4,$5,0,0,FALSE,0,$5,$5,0)
     RETURNING id`,
    [businessId, outletId, invoiceNo, status, total]
  );
  const id = rows[0].id;
  await query(
    `INSERT INTO transaction_items
       (transaction_id, product_name, sku, unit_price, qty, discount_amount, tax_amount, line_total)
     VALUES ($1,$2,'SKU-UJI',$3,1,0,0,$3)`,
    [id, productName, total]
  );
  if (status === 'completed') {
    await query(
      `INSERT INTO payments (transaction_id, method, amount, status) VALUES ($1,$2,$3,'paid')`,
      [id, method, total]
    );
  }
  return id;
};

before(async () => {
  const emails = ['uji-tr-a@nova.test', 'uji-tr-b@nova.test'];
  const leftovers = (await query(`SELECT id FROM owners WHERE email = ANY($1::text[])`, [emails]))
    .rows;
  if (leftovers.length) {
    const ids = leftovers.map((r) => r.id);
    await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
      'owner',
      ids,
    ]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
    await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
  }
  const staleAdmin = (
    await query(`SELECT id FROM platform_admins WHERE email = 'uji-tr-admin@nova.test'`)
  ).rows;
  if (staleAdmin.length) {
    await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [
      staleAdmin.map((r) => r.id),
    ]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
      staleAdmin.map((r) => r.id),
    ]);
    await query('DELETE FROM platform_admins WHERE id = ANY($1::uuid[])', [
      staleAdmin.map((r) => r.id),
    ]);
  }

  const insOwner = async (email, name) => {
    const r = await query(
      `INSERT INTO owners (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [email, await hashPassword(PASSWORD), name]
    );
    return r.rows[0].id;
  };

  const ownerA = await insOwner('uji-tr-a@nova.test', 'Owner Transaksi A');
  const ownerB = await insOwner('uji-tr-b@nova.test', 'Owner Transaksi B');
  tokenA = signAccessToken({ userId: ownerA, role: 'owner' });
  tokenB = signAccessToken({ userId: ownerB, role: 'owner' });

  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    ['uji-tr-admin@nova.test', await hashPassword(PASSWORD), 'Admin Transaksi Uji']
  );
  adminToken = signAccessToken({ userId: admin.rows[0].id, role: 'platform_admin' });

  // Bisnis A (outlet tanpa pajak) + 2 produk + 1 kasir.
  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis Transaksi Uji' })).body
    .business.id;
  outletT1 = (await ownerPost(tokenA, ownerPath(businessA, '/outlets'), { name: 'Outlet Utama Uji' }))
    .body.outlet.id;
  const kopi = (
    await ownerPost(tokenA, ownerPath(businessA, '/products'), {
      name: 'Kopi Susu',
      price: 15000,
      trackStock: true,
    })
  ).body.product;
  const roti = (
    await ownerPost(tokenA, ownerPath(businessA, '/products'), {
      name: 'Roti Bakar',
      price: 10000,
      trackStock: true,
    })
  ).body.product;
  await ownerPost(tokenA, ownerPath(businessA, '/cashiers'), {
    fullName: 'Kasir Transaksi Uji',
    email: 'uji-tr-kasir@nova.test',
    password: PASSWORD,
    outletId: outletT1,
  });
  cashierId = (
    await query(`SELECT id FROM cashiers WHERE email = 'uji-tr-kasir@nova.test'`)
  ).rows[0].id;
  await ownerPatch(tokenA, ownerPath(businessA, `/products/${kopi.id}/stocks/${outletT1}`), {
    quantity: 20,
  });
  await ownerPatch(tokenA, ownerPath(businessA, `/products/${roti.id}/stocks/${outletT1}`), {
    quantity: 20,
  });

  const login = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'uji-tr-kasir@nova.test',
    password: PASSWORD,
  });
  const cashierToken = login.body.accessToken;

  // Penjualan NYATA (kasir) dengan DUA item -> harus menjadi 2 baris laporan.
  const sale1 = await request.post(
    '/api/cashier/transactions',
    {
      items: [
        { productId: kopi.id, qty: 2 },
        { productId: roti.id, qty: 1 },
      ],
      payment: { method: 'cash', amount: 100000 },
    },
    auth(cashierToken)
  );
  assert.strictEqual(
    sale1.status,
    201,
    `penjualan 2 item harus berhasil: ${sale1.body?.error?.message ?? ''}`
  );

  // Penjualan nyata kedua (QRIS).
  const sale2 = await request.post(
    '/api/cashier/transactions',
    { items: [{ productId: kopi.id, qty: 1 }], payment: { method: 'qr', amount: 15000 } },
    auth(cashierToken)
  );
  assert.strictEqual(sale2.status, 201, 'penjualan QRIS harus berhasil');

  // Transaksi sisipan: satu SELESAI (kartu 20.000) + satu VOID (5.000).
  await insertTx({
    businessId: businessA,
    outletId: outletT1,
    invoiceNo: 'UJI-TRX-0003',
    total: 20000,
    productName: 'Menu Sisipan',
    method: 'card',
  });
  await insertTx({
    businessId: businessA,
    outletId: outletT1,
    invoiceNo: 'UJI-TRX-0004',
    status: 'voided',
    total: 5000,
    productName: 'Menu Batal',
  });

  // Bisnis B (owner B): data yang TIDAK boleh bocor ke laporan bisnis A.
  businessB = (await ownerPost(tokenB, '/businesses', { name: 'Bisnis Transaksi B' })).body
    .business.id;
  outletB1 = (await ownerPost(tokenB, ownerPath(businessB, '/outlets'), { name: 'Outlet Bisnis B' }))
    .body.outlet.id;
  await insertTx({
    businessId: businessB,
    outletId: outletB1,
    invoiceNo: 'UJI-B-0001',
    total: 99000,
    productName: 'Menu Bisnis B',
  });
});

after(async () => {
  const owners = (
    await query(`SELECT id FROM owners WHERE email = ANY($1::text[])`, [
      ['uji-tr-a@nova.test', 'uji-tr-b@nova.test'],
    ])
  ).rows;
  const ids = owners.map((r) => r.id);
  if (ids.length) {
    await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [ids]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
    await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
  }
  const admins = (
    await query(`SELECT id FROM platform_admins WHERE email = 'uji-tr-admin@nova.test'`)
  ).rows;
  if (admins.length) {
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
      admins.map((r) => r.id),
    ]);
    await query('DELETE FROM platform_admins WHERE id = ANY($1::uuid[])', [
      admins.map((r) => r.id),
    ]);
  }
});

/** Total & jumlah transaksi langsung dari DB (pembanding server). */
const dbSummary = async (businessId) => {
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0) AS total,
            COUNT(*) FILTER (WHERE status = 'voided')::int    AS voided,
            COALESCE(SUM(total) FILTER (WHERE status = 'voided'), 0) AS voided_total
       FROM transactions WHERE business_id = $1`,
    [businessId]
  );
  return {
    completed: rows[0].completed,
    total: Number(rows[0].total),
    voided: rows[0].voided,
    voided_total: Number(rows[0].voided_total),
  };
};

test('Laporan transaksi: satu baris per item + ringkasan & rekap metode', async () => {
  const today = await todayTz();
  const res = await ownerGet(tokenA, lapTx(businessA, `?from=${today}&to=${today}`));
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));

  const body = res.body;
  assert.strictEqual(body.business.name, 'Bisnis Transaksi Uji');
  assert.strictEqual(body.business.timezone, TZ);
  assert.strictEqual(body.period.from, today);
  assert.strictEqual(body.period.to, today);
  assert.ok(!Number.isNaN(Date.parse(body.printed_at)), 'printed_at berupa tanggal ISO');
  assert.strictEqual(body.outlet, null, 'tanpa filter outlet -> kop tanpa nama outlet');
  assert.strictEqual(body.cashier, null);
  assert.strictEqual(body.truncated, false);

  // Ringkasan: 3 transaksi selesai (2 penjualan nyata + 1 sisipan) = 75.000 sen.
  const db = await dbSummary(businessA);
  assert.strictEqual(body.summary.status, 'completed');
  assert.strictEqual(body.summary.transactions, db.completed);
  assert.strictEqual(body.summary.total, 40000 + 15000 + 20000);
  assert.strictEqual(body.summary.avg_total, Math.round(body.summary.total / db.completed));
  assert.strictEqual(body.summary.voided_transactions, db.voided);
  assert.strictEqual(body.summary.voided_total, 5000);
  assert.strictEqual(body.summary.refunded_transactions, 0);

  // BARIS PER ITEM: penjualan 2 item = 2 baris (invoice sama, produk berbeda).
  const rowsKopi = body.rows.filter((r) => r.product_name === 'Kopi Susu');
  assert.strictEqual(rowsKopi.length, 2, 'Kopi Susu muncul pada 2 transaksi');
  const duaItem = rowsKopi.find((r) => r.qty === 2);
  assert.ok(duaItem, 'baris dengan qty 2 ada');
  assert.strictEqual(duaItem.unit_price, 15000);
  assert.strictEqual(duaItem.line_total, 30000);
  assert.match(duaItem.invoice_no, /^INV-\d{8}-\d{4}$/, 'prefix INV- dipertahankan (A4a)');
  assert.strictEqual(duaItem.date, today);
  assert.match(duaItem.time, /^\d{2}:\d{2}$/);
  assert.ok(Array.isArray(duaItem.methods) && duaItem.methods.includes('cash'));
  assert.strictEqual(duaItem.outlet_name, 'Outlet Utama Uji');
  assert.strictEqual(duaItem.cashier_name, 'Kasir Transaksi Uji');
  assert.ok(Object.prototype.hasOwnProperty.call(duaItem, 'sku'), 'kolom sku tersedia');
  assert.ok(Object.prototype.hasOwnProperty.call(duaItem, 'discount_amount'));

  // Void tidak jadi baris default, sisipan selesai ikut.
  assert.ok(!body.rows.some((r) => r.invoice_no === 'UJI-TRX-0004'), 'void tidak jadi baris');
  assert.ok(body.rows.some((r) => r.invoice_no === 'UJI-TRX-0003'));
  assert.strictEqual(body.rows.length, 4, '4 baris item (2+1+1)');

  // Rekap metode pembayaran (hanya pembayaran LUNAS) + persentase.
  const methods = Object.fromEntries(body.payment_methods.map((m) => [m.method, m]));
  assert.deepStrictEqual(
    body.payment_methods.map((m) => m.method),
    ['cash', 'card', 'qr'],
    'urut total desc'
  );
  assert.strictEqual(methods.cash.total, 40000);
  assert.strictEqual(methods.card.total, 20000);
  assert.strictEqual(methods.qr.total, 15000);
  assert.strictEqual(methods.cash.label, 'Tunai');
  assert.strictEqual(methods.qr.label, 'QRIS');
  assert.strictEqual(methods.cash.percent, 53.3);
  assert.strictEqual(methods.card.percent, 26.7);
  assert.strictEqual(methods.qr.percent, 20);
  const totalPercent = body.payment_methods.reduce((n, m) => n + m.percent, 0);
  assert.strictEqual(totalPercent, 100, 'persentase metode berjumlah 100');

  // Produk terlaris (urut QTY sesuai contoh Pemilik) + kolom omzet.
  assert.strictEqual(body.top_products[0].product_name, 'Kopi Susu');
  assert.strictEqual(body.top_products[0].qty, 3);
  assert.strictEqual(body.top_products[0].revenue, 45000);
  const qty = body.top_products.map((p) => p.qty);
  assert.deepStrictEqual([...qty].sort((a, b) => b - a), qty, 'qty menurun');
});

test('Filter outlet & kasir; outlet bisnis lain tidak bocor', async () => {
  const today = await todayTz();
  const byOutlet = await ownerGet(
    tokenA,
    lapTx(businessA, `?from=${today}&to=${today}&outletId=${outletT1}`)
  );
  assert.strictEqual(byOutlet.status, 200);
  assert.strictEqual(byOutlet.body.outlet.name, 'Outlet Utama Uji');
  assert.strictEqual(byOutlet.body.summary.transactions, 3);
  assert.strictEqual(byOutlet.body.summary.total, 75000);
  assert.strictEqual(byOutlet.body.rows.length, 4);
  assert.ok(byOutlet.body.rows.every((r) => r.outlet_name === 'Outlet Utama Uji'));

  // Outlet milik bisnis LAIN: valid UUID, tetapi bukan milik bisnis ini -> kosong.
  const foreign = await ownerGet(
    tokenA,
    lapTx(businessA, `?from=${today}&to=${today}&outletId=${outletB1}`)
  );
  assert.strictEqual(foreign.status, 200);
  assert.strictEqual(foreign.body.summary.transactions, 0);
  assert.strictEqual(foreign.body.summary.total, 0);
  assert.strictEqual(foreign.body.rows.length, 0, 'tidak ada data bisnis lain yang bocor');
  assert.strictEqual(foreign.body.outlet, null, 'outlet bisnis lain tidak dinamai');

  const byCashier = await ownerGet(
    tokenA,
    lapTx(businessA, `?from=${today}&to=${today}&cashierId=${cashierId}`)
  );
  assert.strictEqual(byCashier.status, 200);
  assert.strictEqual(byCashier.body.cashier.name, 'Kasir Transaksi Uji');
  assert.strictEqual(byCashier.body.summary.transactions, 2, 'hanya 2 penjualan kasir');
  assert.strictEqual(byCashier.body.summary.total, 55000);
  assert.ok(byCashier.body.rows.every((r) => r.cashier_name === 'Kasir Transaksi Uji'));
});

test('Status voided & pencarian invoice', async () => {
  const today = await todayTz();
  const voided = await ownerGet(
    tokenA,
    lapTx(businessA, `?from=${today}&to=${today}&status=voided`)
  );
  assert.strictEqual(voided.status, 200);
  assert.strictEqual(voided.body.summary.status, 'voided');
  assert.strictEqual(voided.body.summary.transactions, 1);
  assert.strictEqual(voided.body.summary.total, 5000);
  assert.strictEqual(voided.body.rows.length, 1);
  assert.strictEqual(voided.body.rows[0].invoice_no, 'UJI-TRX-0004');
  assert.strictEqual(voided.body.rows[0].product_name, 'Menu Batal');
  assert.deepStrictEqual(voided.body.payment_methods, [], 'void tidak punya pembayaran lunas');

  const searched = await ownerGet(
    tokenA,
    lapTx(businessA, `?from=${today}&to=${today}&search=UJI-TRX-0003`)
  );
  assert.strictEqual(searched.status, 200);
  assert.strictEqual(searched.body.summary.transactions, 1);
  assert.strictEqual(searched.body.rows.length, 1);

  const byMethod = await ownerGet(
    tokenA,
    lapTx(businessA, `?from=${today}&to=${today}&paymentMethod=card`)
  );
  assert.strictEqual(byMethod.status, 200);
  assert.strictEqual(byMethod.body.summary.total, 20000);
});

test('Laporan keuangan: kembalian tunai TIDAK menambah omzet (metode & outlet)', async () => {
  const today = await todayTz();
  const res = await ownerGet(
    tokenA,
    ownerPath(businessA, `/reports/finance?from=${today}&to=${today}`)
  );
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const b = res.body;

  // Data uji: penjualan tunai total 40.000 DIBAYAR 100.000 (kembalian 60.000),
  // QRIS 15.000, sisipan kartu 20.000 -> omzet 75.000, BUKAN 135.000.
  // (Perbaikan 17 Okt 2026: omzet memakai transactions.total, bukan payments.amount.)
  assert.strictEqual(b.income.cash, 40000, 'kembalian tunai tidak masuk omzet');
  assert.strictEqual(b.income.card, 20000);
  assert.strictEqual(b.income.qris, 15000);
  assert.strictEqual(b.income.total, 75000, 'total pendapatan bebas kembalian');
  assert.strictEqual(b.gross_profit, b.income.total - b.hpp);

  const outlet = b.outlets.find((o) => o.outlet_id === outletT1);
  assert.ok(outlet, 'outlet uji ada di rekap per outlet');
  assert.strictEqual(outlet.income, 75000, 'omzet outlet bebas kembalian');
  assert.strictEqual(outlet.gross_profit, outlet.income - outlet.hpp);

  const sumPayments = await query(
    `SELECT COALESCE(SUM(p.amount), 0) AS tendered, COALESCE(SUM(t.total), 0) AS revenue
       FROM payments p JOIN transactions t ON t.id = p.transaction_id
      WHERE t.business_id = $1 AND t.status = 'completed' AND p.status = 'paid'`,
    [businessA]
  );
  assert.strictEqual(Number(sumPayments.rows[0].tendered), 135000, 'uang diterima termasuk kembalian');
  assert.strictEqual(Number(sumPayments.rows[0].revenue), 75000, 'omzet riil');
});

test('limit & truncated; validasi query 422', async () => {
  const today = await todayTz();
  const limited = await ownerGet(tokenA, lapTx(businessA, `?from=${today}&to=${today}&limit=2`));
  assert.strictEqual(limited.status, 200);
  assert.strictEqual(limited.body.rows.length, 2);
  assert.strictEqual(limited.body.truncated, true, 'ditandai terpotong');
  assert.strictEqual(limited.body.summary.transactions, 3, 'ringkasan tetap utuh');

  for (const q of ['limit=0', 'limit=99999', 'limit=dua']) {
    const bad = await ownerGet(tokenA, lapTx(businessA, `?${q}`));
    assert.strictEqual(bad.status, 422, `${q} harus 422`);
  }
  const badStatus = await ownerGet(tokenA, lapTx(businessA, '?status=selesai'));
  assert.strictEqual(badStatus.status, 422, 'status tidak dikenal -> 422');
  const badRange = await ownerGet(tokenA, lapTx(businessA, `?from=${today}&to=2000-01-01`));
  assert.strictEqual(badRange.status, 422, 'to < from -> 422');
  const badOutlet = await ownerGet(tokenA, lapTx(businessA, '?outletId=nope'));
  assert.strictEqual(badOutlet.status, 422, 'outletId bukan UUID -> 422');
});

test('Isolasi tenant & peran: bisnis lain 404, kasir 403, admin 200', async () => {
  const otherBusiness = await ownerGet(tokenB, lapTx(businessA));
  assert.strictEqual(otherBusiness.status, 404, 'owner B tidak boleh melihat bisnis A');

  const bTotals = await dbSummary(businessB);
  const asB = await ownerGet(tokenB, lapTx(businessB));
  assert.strictEqual(asB.status, 200);
  assert.strictEqual(asB.body.summary.total, bTotals.total);
  assert.strictEqual(asB.body.rows[0].product_name, 'Menu Bisnis B');
  assert.notStrictEqual(asB.body.summary.total, (await dbSummary(businessA)).total);

  // Kasir tidak boleh membuat laporan ini (keputusan A2b).
  const cashierLogin = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'uji-tr-kasir@nova.test',
    password: PASSWORD,
  });
  const denied = await ownerGet(cashierLogin.body.accessToken, lapTx(businessA));
  assert.strictEqual(denied.status, 403, 'kasir tidak boleh di route owner');

  // Admin platform hanya baca (lintas platform).
  const admin = await adminGet(adminToken, `/${businessA}/reports/transactions`);
  assert.strictEqual(admin.status, 200, 'admin dapat membaca (baca-saja)');
  assert.strictEqual(admin.body.summary.total, (await dbSummary(businessA)).total);
});

// ---------------------------------------------------------------------------
// Ekspor Excel Laporan Transaksi (17 Okt 2026 — permintaan Owner).
// ---------------------------------------------------------------------------

test('Ekspor Excel Laporan Transaksi: 4 sheet, satu baris per item, angka rupiah', async () => {
  const today = await todayTz();
  const [y, m, d] = today.split('-');
  const tglID = `${d}/${m}/${y}`;

  const { wb } = await loadTrxWorkbook(tokenA, lapTxExport(businessA, `?from=${today}&to=${today}`));

  assert.deepStrictEqual(
    wb.worksheets.map((ws) => ws.name),
    ['Ringkasan', 'Detail Transaksi', 'Rekap Metode Pembayaran', 'Produk Terlaris']
  );

  // --- Sheet Ringkasan: informasi + ringkasan (angka RUPIAH, bukan sen) -----
  const ring = wb.getWorksheet('Ringkasan');
  assert.strictEqual(ring.getCell('A1').value, 'KASIR NOVA — Laporan Transaksi');
  assert.strictEqual(cellByLabel(ring, 'Nama Bisnis'), 'Bisnis Transaksi Uji');
  assert.strictEqual(cellByLabel(ring, 'Zona Waktu'), TZ);
  assert.strictEqual(cellByLabel(ring, 'Periode'), `${tglID} s.d. ${tglID}`);
  assert.strictEqual(cellByLabel(ring, 'Filter Outlet'), 'Semua outlet');
  assert.strictEqual(cellByLabel(ring, 'Filter Kasir'), 'Semua kasir');
  assert.strictEqual(cellByLabel(ring, 'Filter Status Transaksi'), 'Selesai (bawaan)');
  assert.strictEqual(cellByLabel(ring, 'Jumlah transaksi'), 3);
  assert.strictEqual(cellByLabel(ring, 'Total omzet'), 750, '75.000 sen -> Rp 750');
  assert.strictEqual(cellByLabel(ring, 'Rata-rata per transaksi'), 250);
  assert.strictEqual(cellByLabel(ring, 'Jumlah item (qty) pada berkas ini'), 5);
  assert.strictEqual(cellByLabel(ring, 'Jumlah baris item pada berkas ini'), 4);
  assert.strictEqual(cellByLabel(ring, 'Transaksi dibatalkan (void)'), 1);
  assert.strictEqual(cellByLabel(ring, 'Nilai transaksi void'), 50);
  assert.strictEqual(cellByLabel(ring, 'Refund'), undefined, 'tidak ada baris refund');
  assert.strictEqual(
    cellByLabel(ring, 'PERINGATAN'),
    undefined,
    'tanpa limit -> tidak ada peringatan terpotong'
  );

  // --- Sheet Detail Transaksi: SATU BARIS PER ITEM + baris TOTAL ------------
  const det = wb.getWorksheet('Detail Transaksi');
  assert.strictEqual(det.rowCount, 6, '4 baris item + 1 baris TOTAL + judul');
  assert.deepStrictEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((c) => det.getCell(1, c).value),
    [
      'No',
      'Nomor Transaksi',
      'Tanggal',
      'Waktu',
      'Outlet',
      'Kasir',
      'Produk',
      'SKU',
      'Qty',
      'Harga Satuan',
      'Diskon',
      'Subtotal Baris',
      'Metode Pembayaran',
    ]
  );
  assert.deepStrictEqual(
    [2, 3, 4, 5].map((r) => det.getCell(r, 1).value),
    [1, 2, 3, 4],
    'nomor baris urut'
  );
  // Penjualan nyata pertama (2 item) menjadi 2 baris teratas, urut nama produk.
  assert.strictEqual(det.getCell(2, 7).value, 'Kopi Susu');
  assert.strictEqual(det.getCell(2, 9).value, 2);
  assert.strictEqual(det.getCell(2, 10).value, 150, 'harga satuan 15.000 sen -> Rp 150');
  assert.strictEqual(det.getCell(2, 12).value, 300, 'subtotal 30.000 sen -> Rp 300');
  assert.strictEqual(det.getCell(3, 7).value, 'Roti Bakar');
  assert.strictEqual(det.getCell(2, 3).value, tglID, 'tanggal tampilan Indonesia');
  assert.match(String(det.getCell(2, 4).value), /^\d{2}:\d{2}$/);
  assert.strictEqual(det.getCell(2, 5).value, 'Outlet Utama Uji');
  assert.strictEqual(det.getCell(2, 6).value, 'Kasir Transaksi Uji');
  assert.match(String(det.getCell(2, 2).value), /^INV-\d{8}-\d{4}$/);
  assert.strictEqual(det.getCell(2, 13).value, 'Tunai', 'metode dilabeli bahasa Indonesia');
  assert.strictEqual(det.getCell(5, 2).value, 'UJI-TRX-0003', 'transaksi sisipan ikut');
  // Baris TOTAL (tebal) menjumlahkan qty & subtotal.
  const totalRow = det.getRow(6);
  assert.strictEqual(totalRow.getCell(2).value, 'TOTAL');
  assert.strictEqual(totalRow.getCell(9).value, 5);
  assert.strictEqual(totalRow.getCell(12).value, 750);
  assert.strictEqual(det.getCell(6, 2).font.bold, true, 'baris TOTAL dicetak tebal');

  // --- Sheet Rekap Metode Pembayaran: omzet (+ persentase sebagai persen) ---
  const met = wb.getWorksheet('Rekap Metode Pembayaran');
  assert.deepStrictEqual(
    [2, 3, 4].map((r) => [met.getCell(r, 1).value, met.getCell(r, 3).value]),
    [
      ['Tunai', 400],
      ['Kartu', 200],
      ['QRIS', 150],
    ],
    'urut omzet menurun, dalam rupiah'
  );
  assert.ok(Math.abs(met.getCell(2, 4).value - 0.533) < 1e-6, '53,3% tersimpan sebagai 0,533');
  assert.strictEqual(met.getCell(2, 4).numFmt, '0.0%', 'sel persentase berformat persen');
  assert.strictEqual(met.getCell(5, 1).value, 'TOTAL');
  assert.strictEqual(met.getCell(5, 3).value, 750);

  // --- Sheet Produk Terlaris: urut qty --------------------------------------
  const prod = wb.getWorksheet('Produk Terlaris');
  assert.strictEqual(prod.getCell(2, 2).value, 'Kopi Susu');
  assert.strictEqual(prod.getCell(2, 3).value, 3);
  assert.strictEqual(prod.getCell(2, 4).value, 450, '45.000 sen -> Rp 450');
  // Qty seri (1 vs 1) diurutkan omzet menurun: sisipan 20.000 di atas roti 10.000.
  assert.strictEqual(prod.getCell(3, 2).value, 'Menu Sisipan');
  assert.strictEqual(prod.getCell(3, 4).value, 200);
  assert.strictEqual(prod.getCell(4, 2).value, 'Roti Bakar');
  assert.strictEqual(prod.getCell(4, 4).value, 100);
});

test('Ekspor Excel laporan transaksi: filter, peringatan terpotong, isolasi tenant & peran', async () => {
  const today = await todayTz();

  // Filter status void: 1 baris item, tanpa pembayaran lunas (placeholder).
  const { wb: wbVoid } = await loadTrxWorkbook(
    tokenA,
    lapTxExport(businessA, `?from=${today}&to=${today}&status=voided`)
  );
  const ringV = wbVoid.getWorksheet('Ringkasan');
  assert.strictEqual(cellByLabel(ringV, 'Filter Status Transaksi'), 'Dibatalkan');
  assert.strictEqual(cellByLabel(ringV, 'Jumlah transaksi'), 1);
  assert.strictEqual(cellByLabel(ringV, 'Nilai transaksi void'), 50);
  const detV = wbVoid.getWorksheet('Detail Transaksi');
  assert.strictEqual(detV.rowCount, 3, 'judul + 1 baris item + baris TOTAL');
  assert.strictEqual(detV.getCell(2, 2).value, 'UJI-TRX-0004');
  assert.strictEqual(detV.getCell(2, 13).value, '—');
  assert.strictEqual(detV.getCell(3, 2).value, 'TOTAL');
  const metV = wbVoid.getWorksheet('Rekap Metode Pembayaran');
  assert.strictEqual(metV.getCell(2, 1).value, '—', 'void tidak punya pembayaran lunas');

  // Filter outlet bisnis lain: berkas tetap dibuat, seluruh angka nol.
  const { wb: wbForeignOutlet } = await loadTrxWorkbook(
    tokenA,
    lapTxExport(businessA, `?from=${today}&to=${today}&outletId=${outletB1}`)
  );
  assert.strictEqual(cellByLabel(wbForeignOutlet.getWorksheet('Ringkasan'), 'Total omzet'), 0);
  assert.strictEqual(
    wbForeignOutlet.getWorksheet('Detail Transaksi').rowCount,
    2,
    'hanya baris TOTAL (tanpa data bisnis lain)'
  );

  // `limit` kecil: berkas tetap dibuat + PERINGATAN pada sheet Ringkasan.
  const { wb: wbLim } = await loadTrxWorkbook(
    tokenA,
    lapTxExport(businessA, `?from=${today}&to=${today}&limit=2`)
  );
  const ringL = wbLim.getWorksheet('Ringkasan');
  assert.strictEqual(cellByLabel(ringL, 'Jumlah baris item pada berkas ini'), 2);
  assert.match(String(cellByLabel(ringL, 'PERINGATAN')), /TERPOTONG/);
  const detL = wbLim.getWorksheet('Detail Transaksi');
  assert.strictEqual(detL.rowCount, 4, 'judul + 2 baris item + baris TOTAL');
  assert.strictEqual(detL.getCell(4, 2).value, 'TOTAL');

  // Batas baris ekspor: bawaan 5000, Maksimum 20000.
  for (const q of ['limit=0', 'limit=20001', 'limit=dua']) {
    const bad = await ownerGet(tokenA, lapTxExport(businessA, `?${q}`));
    assert.strictEqual(bad.status, 422, `${q} harus 422 pada ekspor`);
  }
  const okMax = await ownerGet(tokenA, lapTxExport(businessA, '?limit=20000'));
  assert.strictEqual(okMax.status, 200, 'limit 20000 diterima pada ekspor');

  // Isolasi tenant & peran (sama seperti halaman cetak).
  const foreign = await ownerGet(tokenB, lapTxExport(businessA));
  assert.strictEqual(foreign.status, 404, 'owner B tidak boleh mengekspor bisnis A');
  const cashierLogin = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'uji-tr-kasir@nova.test',
    password: PASSWORD,
  });
  const denied = await ownerGet(cashierLogin.body.accessToken, lapTxExport(businessA));
  assert.strictEqual(denied.status, 403, 'kasir tidak boleh mengekspor laporan Owner');

  const admin = await request.binary(
    `/api/platform/businesses/${businessA}/reports/transactions/export`,
    auth(adminToken)
  );
  assert.strictEqual(admin.status, 200, 'admin dapat membaca (baca-saja)');
  assert.ok(admin.buffer.length > 1000, 'berkas admin berupa xlsx valid');
  const wbAdmin = new ExcelJS.Workbook();
  await wbAdmin.xlsx.load(admin.buffer);
  assert.strictEqual(
    cellByLabel(wbAdmin.getWorksheet('Ringkasan'), 'Total omzet'),
    750,
    'angka ekspor admin sama dengan Owner'
  );
});
