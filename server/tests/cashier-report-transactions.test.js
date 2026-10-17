/**
 * Tes integrasi 17 Okt 2026 — Laporan Transaksi untuk KASIR.
 *
 * Keputusan pemilik (dipilih dari daftar pekerjaan lanjutan):
 *   B1 satu baris per TRANSAKSI (bukan per item) + kartu ringkasan,
 *   B2 ekspor Excel (.xlsx) tersedia untuk kasir,
 *   B3 tab "Laporan" baru dengan rentang bawaan HARI INI.
 * Ditambah keputusan A5a: cakupan = SEMUA transaksi outlet kasir (bukan hanya
 * transaksi kasir itu sendiri).
 *
 * Yang dijamin tes ini:
 *   - `GET /api/cashier/reports/transactions` mengembalikan SATU BARIS PER
 *     TRANSAKSI (penjualan 2 item = 1 baris) + ringkasan + rekap metode.
 *   - Outlet SELALU dari akun kasir: parameter `outletId` diabaikan, transaksi
 *     outlet lain (bisnis yang sama) tidak pernah muncul.
 *   - Angka identik dengan laporan Owner untuk outlet & rentang yang sama
 *     (satu sumber: `reportService` yang sama).
 *   - Rentang bawaan = hari ini (zona waktu bisnis).
 *   - Ekspor .xlsx berisi 3 sheet dengan angka sama seperti layar.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import ExcelJS from 'exceljs';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'LaporanKasir123!';
const TZ = 'Asia/Jakarta';

let tokenA, tokenB, adminToken, cashierToken, ownerA;
let businessA, businessB, outletA1, outletA2, outletB1;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const ownerPath = (businessId, tail = '') => `/businesses/${businessId}${tail}`;
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));
const ownerGet = (token, path) => request.get(`/api/owner${path}`, auth(token));
const ownerPatch = (token, path, body) => request.patch(`/api/owner${path}`, body, auth(token));
const lapKasir = (q = '') => request.get(`/api/cashier/reports/transactions${q}`, auth(cashierToken));
const lapKasirExport = (q = '') =>
  request.binary(`/api/cashier/reports/transactions/export${q}`, auth(cashierToken));

/** Ambil nilai kolom B dari baris yang labelnya (kolom A) cocok. */
const cellByLabel = (ws, label) => {
  for (let r = 1; r <= ws.rowCount; r += 1) {
    if (ws.getCell(r, 1).value === label) return ws.getCell(r, 2).value;
  }
  return undefined;
};

const todayTz = async () => {
  const { rows } = await query(
    `SELECT to_char((now() AT TIME ZONE $1::text)::date, 'YYYY-MM-DD') AS d`,
    [TZ]
  );
  return rows[0].d;
};

const yesterdayTz = async () => {
  const { rows } = await query(
    `SELECT to_char(((now() AT TIME ZONE $1::text)::date - 1), 'YYYY-MM-DD') AS d`,
    [TZ]
  );
  return rows[0].d;
};

/** Sisipkan transaksi + item langsung (status/metode/waktu tertentu). */
const insertTx = async ({
  businessId,
  outletId,
  invoiceNo,
  status = 'completed',
  total,
  productName,
  method = 'cash',
  backdate = null,
}) => {
  const { rows } = await query(
    `INSERT INTO transactions
       (business_id, outlet_id, invoice_no, status, subtotal, discount_total,
        tax_rate, tax_inclusive, tax_total, total, paid_amount, change_amount, created_at)
     VALUES ($1,$2,$3,$4,$5,0,0,FALSE,0,$5,$5,0, COALESCE(now() - $6::interval, now()))
     RETURNING id`,
    [businessId, outletId, invoiceNo, status, total, backdate]
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

/** Ringkasan langsung dari DB untuk satu outlet (pembanding angka server). */
const dbSummaryOutlet = async (businessId, outletId) => {
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0) AS total,
            COUNT(*) FILTER (WHERE status = 'voided')::int    AS voided,
            COALESCE(SUM(total) FILTER (WHERE status = 'voided'), 0) AS voided_total
       FROM transactions WHERE business_id = $1 AND outlet_id = $2`,
    [businessId, outletId]
  );
  return {
    completed: rows[0].completed,
    total: Number(rows[0].total),
    voided: rows[0].voided,
    voided_total: Number(rows[0].voided_total),
  };
};

before(async () => {
  const emails = ['uji-ck-a@nova.test', 'uji-ck-b@nova.test'];
  const leftovers = (await query(`SELECT id FROM owners WHERE email = ANY($1::text[])`, [emails]))
    .rows;
  if (leftovers.length) {
    const ids = leftovers.map((r) => r.id);
    await query(`DELETE FROM refresh_tokens WHERE user_role = 'owner' AND user_id = ANY($1::uuid[])`, [
      ids,
    ]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
    await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
  }
  const staleAdmin = (
    await query(`SELECT id FROM platform_admins WHERE email = 'uji-ck-admin@nova.test'`)
  ).rows;
  if (staleAdmin.length) {
    const ids = staleAdmin.map((r) => r.id);
    await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [ids]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
    await query('DELETE FROM platform_admins WHERE id = ANY($1::uuid[])', [ids]);
  }

  const insOwner = async (email, name) => {
    const r = await query(
      `INSERT INTO owners (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [email, await hashPassword(PASSWORD), name]
    );
    return r.rows[0].id;
  };

  ownerA = await insOwner('uji-ck-a@nova.test', 'Owner Laporan Kasir A');
  const ownerB = await insOwner('uji-ck-b@nova.test', 'Owner Laporan Kasir B');
  tokenA = signAccessToken({ userId: ownerA, role: 'owner' });
  tokenB = signAccessToken({ userId: ownerB, role: 'owner' });

  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    ['uji-ck-admin@nova.test', await hashPassword(PASSWORD), 'Admin Laporan Kasir Uji']
  );
  adminToken = signAccessToken({ userId: admin.rows[0].id, role: 'platform_admin' });

  // Bisnis A: DUA outlet (untuk membuktikan isolasi outlet), produk, 1 kasir
  // di outlet 1.
  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis Laporan Kasir' })).body
    .business.id;
  outletA1 = (
    await ownerPost(tokenA, ownerPath(businessA, '/outlets'), { name: 'Outlet Kasir Utama' })
  ).body.outlet.id;
  // Outlet KEDUA pada bisnis yang sama: dibuat lewat SQL karena paket "Gratis"
  // (plan bawaan) membatasi 1 outlet — kuota itu aturan produk yang TIDAK boleh
  // diubah, sedangkan tes ini memang perlu dua outlet untuk membuktikan isolasi.
  outletA2 = (
    await query(
      `INSERT INTO outlets (business_id, name, address, phone, tax_rate, tax_inclusive, status)
       VALUES ($1, 'Outlet Kasir Kedua', NULL, NULL, 0, FALSE, 'active')
       RETURNING id`,
      [businessA]
    )
  ).rows[0].id;

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
    fullName: 'Kasir Laporan Uji',
    email: 'uji-ck-kasir@nova.test',
    password: PASSWORD,
    outletId: outletA1,
  });
  await ownerPatch(tokenA, ownerPath(businessA, `/products/${kopi.id}/stocks/${outletA1}`), {
    quantity: 20,
  });
  await ownerPatch(tokenA, ownerPath(businessA, `/products/${roti.id}/stocks/${outletA1}`), {
    quantity: 20,
  });

  const login = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'uji-ck-kasir@nova.test',
    password: PASSWORD,
  });
  assert.strictEqual(login.status, 200, `login kasir gagal: ${login.body?.error?.message ?? ''}`);
  cashierToken = login.body.accessToken;

  // Penjualan NYATA (kasir) — DUA item dalam satu transaksi (harus jadi 1 baris).
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

  const sale2 = await request.post(
    '/api/cashier/transactions',
    { items: [{ productId: kopi.id, qty: 1 }], payment: { method: 'qr', amount: 15000 } },
    auth(cashierToken)
  );
  assert.strictEqual(sale2.status, 201, 'penjualan QRIS harus berhasil');

  // Transaksi sisipan outlet 1: satu SELESAI (kartu 20.000) + satu VOID (5.000).
  await insertTx({
    businessId: businessA,
    outletId: outletA1,
    invoiceNo: 'UJI-CK-0003',
    total: 20000,
    productName: 'Menu Sisipan',
    method: 'card',
  });
  await insertTx({
    businessId: businessA,
    outletId: outletA1,
    invoiceNo: 'UJI-CK-0004',
    status: 'voided',
    total: 5000,
    productName: 'Menu Batal',
  });
  // Transaksi KEMARIN (completed) — membuktikan rentang bawaan = hari ini.
  await insertTx({
    businessId: businessA,
    outletId: outletA1,
    invoiceNo: 'UJI-CK-KEMARIN',
    total: 30000,
    productName: 'Menu Kemarin',
    backdate: '1 day',
  });
  // Transaksi outlet KEDUA (bisnis yang sama) — tidak boleh muncul untuk kasir
  // outlet 1, dan tidak boleh ikut dihitung ringkasannya.
  await insertTx({
    businessId: businessA,
    outletId: outletA2,
    invoiceNo: 'UJI-CK-OUTLET2',
    total: 77000,
    productName: 'Menu Outlet 2',
  });

  // Bisnis B: data yang tidak boleh terlihat sama sekali.
  businessB = (await ownerPost(tokenB, '/businesses', { name: 'Bisnis Laporan Kasir B' })).body
    .business.id;
  outletB1 = (
    await ownerPost(tokenB, ownerPath(businessB, '/outlets'), { name: 'Outlet Bisnis B' })
  ).body.outlet.id;
  await insertTx({
    businessId: businessB,
    outletId: outletB1,
    invoiceNo: 'UJI-CK-B-0001',
    total: 99000,
    productName: 'Menu Bisnis B',
  });
});

after(async () => {
  const owners = (
    await query(`SELECT id FROM owners WHERE email = ANY($1::text[])`, [
      ['uji-ck-a@nova.test', 'uji-ck-b@nova.test'],
    ])
  ).rows;
  const ids = owners.map((r) => r.id);
  if (ids.length) {
    await query(`DELETE FROM refresh_tokens WHERE user_role = 'owner' AND user_id = ANY($1::uuid[])`, [
      ids,
    ]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
    await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
  }
  const admins = (
    await query(`SELECT id FROM platform_admins WHERE email = 'uji-ck-admin@nova.test'`)
  ).rows;
  if (admins.length) {
    const aid = admins.map((r) => r.id);
    await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [aid]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [aid]);
    await query('DELETE FROM platform_admins WHERE id = ANY($1::uuid[])', [aid]);
  }
});

test('Laporan kasir: satu baris per TRANSAKSI + ringkasan + rekap metode', async () => {
  const today = await todayTz();
  const res = await lapKasir(`?from=${today}&to=${today}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));

  const body = res.body;
  assert.strictEqual(body.business.name, 'Bisnis Laporan Kasir');
  assert.strictEqual(body.business.timezone, TZ);
  assert.strictEqual(body.period.from, today);
  assert.strictEqual(body.period.to, today);
  assert.strictEqual(body.outlet.id, outletA1, 'outlet selalu dari akun kasir');
  assert.strictEqual(body.outlet.name, 'Outlet Kasir Utama');
  assert.strictEqual(body.cashier, null, 'laporan mencakup semua kasir outlet (A5a)');
  assert.strictEqual(body.truncated, false);
  assert.strictEqual(body.top_products, undefined, 'tanpa produk terlaris (keputusan B1)');

  // Ringkasan = angka DB outlet 1 (hari ini: 40.000 + 15.000 + 20.000).
  const db = await dbSummaryOutlet(businessA, outletA1);
  assert.strictEqual(body.summary.status, 'completed');
  assert.strictEqual(body.summary.total, 40000 + 15000 + 20000);
  assert.strictEqual(body.summary.transactions, 3);
  assert.strictEqual(body.summary.avg_total, Math.round(body.summary.total / 3));
  assert.strictEqual(body.summary.voided_transactions, db.voided);
  assert.strictEqual(body.summary.voided_total, 5000);
  assert.strictEqual(body.summary.refunded_transactions, 0);

  // 3 baris (bukan 4 walau salah satunya 2 item): penjualan 2 item = 1 baris.
  assert.strictEqual(body.rows.length, 3);
  const k = body.rows.find((r) => r.invoice_no === 'UJI-CK-0003');
  assert.ok(k, 'transaksi sisipan harus muncul');
  assert.strictEqual(k.total, 20000);
  assert.deepStrictEqual(k.methods, ['card']);
  assert.strictEqual(k.items, 1);
  assert.strictEqual(k.cashier_name, null, 'transaksi sisipan tidak punya kasir');
  assert.match(k.time, /^\d{2}:\d{2}$/, 'jam lokal zona bisnis');
  assert.strictEqual(k.date, today);

  // Penjualan kasir 2 item: satu baris, jumlah item 3, metode tunai.
  const sale = body.rows.find((r) => r.total === 40000);
  assert.ok(sale, 'penjualan 2 item harus jadi SATU baris');
  assert.strictEqual(sale.items, 3, '2 kopi + 1 roti = 3 item dalam satu baris');
  assert.deepStrictEqual(sale.methods, ['cash']);
  assert.strictEqual(sale.cashier_name, 'Kasir Laporan Uji');

  // Kolom NO tidak ada (layar), tapi urutan = TERBARU DULU (sesuai DB).
  const { rows: dbOrder } = await query(
    `SELECT id FROM transactions
      WHERE business_id = $1 AND outlet_id = $2 AND status = 'completed'
        AND created_at >= ($3::date)::timestamp AT TIME ZONE $4::text
        AND created_at < (($3::date)::timestamp + interval '1 day') AT TIME ZONE $4::text
      ORDER BY created_at DESC, invoice_no DESC`,
    [businessA, outletA1, today, TZ]
  );
  assert.deepStrictEqual(
    body.rows.map((r) => r.id),
    dbOrder.map((r) => r.id),
    'urutan terbaru dulu (created_at DESC, invoice_no DESC)'
  );

  // Rekap metode: tunai 40.000 (53,3%), kartu 20.000 (26,7%), QRIS 15.000 (20%).
  assert.deepStrictEqual(
    body.payment_methods.map((m) => [m.method, m.total, m.transactions, m.percent]),
    [
      ['cash', 40000, 1, 53.3],
      ['card', 20000, 1, 26.7],
      ['qr', 15000, 1, 20],
    ]
  );
});

test('Laporan kasir: angka identik dengan laporan Owner (outlet & rentang sama)', async () => {
  const today = await todayTz();
  const kasir = await lapKasir(`?from=${today}&to=${today}`);
  const owner = await ownerGet(
    tokenA,
    ownerPath(businessA, `/reports/transactions?from=${today}&to=${today}&outletId=${outletA1}`)
  );
  assert.strictEqual(owner.status, 200, JSON.stringify(owner.body));

  assert.strictEqual(kasir.body.summary.transactions, owner.body.summary.transactions);
  assert.strictEqual(kasir.body.summary.total, owner.body.summary.total);
  assert.strictEqual(kasir.body.summary.voided_total, owner.body.summary.voided_total);
  assert.deepStrictEqual(
    kasir.body.payment_methods.map((m) => [m.method, m.total, m.percent]),
    owner.body.payment_methods.map((m) => [m.method, m.total, m.percent]),
    'rekap metode identik (satu sumber perhitungan)'
  );
  // Laporan Owner baris per ITEM -> 4 baris (3 tx + 1 baris tambahan item kedua).
  assert.strictEqual(owner.body.rows.length, 4);
  assert.strictEqual(kasir.body.rows.length, 3);
});

test('Laporan kasir: isolasi outlet (outletId diabaikan, outlet lain tidak bocor)', async () => {
  const today = await todayTz();
  // Kasir mencoba meminta outlet kedua lewat query -> HARUS diabaikan.
  const res = await lapKasir(`?from=${today}&to=${today}&outletId=${outletA2}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.outlet.id, outletA1, 'outlet tetap dari akun kasir');

  const invoices = res.body.rows.map((r) => r.invoice_no);
  assert.ok(!invoices.includes('UJI-CK-OUTLET2'), 'transaksi outlet lain tidak boleh muncul');
  assert.ok(!invoices.includes('UJI-CK-B-0001'), 'transaksi bisnis lain tidak boleh muncul');
  assert.strictEqual(res.body.summary.total, 75000, 'ringkasan hanya outlet kasir (bukan 152.000)');
});

test('Laporan kasir: rentang bawaan = HARI INI (zona waktu bisnis)', async () => {
  const res = await lapKasir('');
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const today = await todayTz();
  assert.strictEqual(res.body.period.from, today);
  assert.strictEqual(res.body.period.to, today);
  const invoices = res.body.rows.map((r) => r.invoice_no);
  assert.ok(!invoices.includes('UJI-CK-KEMARIN'), 'transaksi kemarin tidak termasuk bawaan');
  assert.strictEqual(res.body.summary.total, 75000);

  // Preset lain tetap didukung (minggu ini mencakup kemarin).
  const week = await lapKasir('?period=week');
  assert.strictEqual(week.status, 200, JSON.stringify(week.body));
  const weekInvoices = week.body.rows.map((r) => r.invoice_no);
  assert.ok(weekInvoices.includes('UJI-CK-KEMARIN'), 'period=week mencakup transaksi kemarin');
  assert.strictEqual(week.body.summary.total, 75000 + 30000);

  // Mode "Kustom" di layar memakai `date` (satu tanggal) — harus sama persis
  // dengan rentang hari ini.
  const kustom = await lapKasir(`?date=${today}`);
  assert.strictEqual(kustom.status, 200, JSON.stringify(kustom.body));
  assert.strictEqual(kustom.body.period.from, today);
  assert.strictEqual(kustom.body.period.to, today);
  assert.strictEqual(kustom.body.summary.total, 75000);
  const kemarin = await lapKasir(`?date=${await yesterdayTz()}`);
  assert.strictEqual(kemarin.status, 200, JSON.stringify(kemarin.body));
  assert.deepStrictEqual(kemarin.body.rows.map((r) => r.invoice_no), ['UJI-CK-KEMARIN']);
  assert.strictEqual(kemarin.body.summary.total, 30000);
});

test('Laporan kasir: filter status void & pencarian nomor transaksi', async () => {
  const today = await todayTz();
  const vo = await lapKasir(`?from=${today}&to=${today}&status=voided`);
  assert.strictEqual(vo.status, 200, JSON.stringify(vo.body));
  assert.strictEqual(vo.body.summary.status, 'voided');
  assert.strictEqual(vo.body.summary.transactions, 1);
  assert.strictEqual(vo.body.summary.total, 5000);
  assert.deepStrictEqual(vo.body.rows.map((r) => r.invoice_no), ['UJI-CK-0004']);
  assert.deepStrictEqual(vo.body.rows[0].methods, [], 'transaksi void tanpa pembayaran');

  const cari = await lapKasir(`?from=${today}&to=${today}&search=UJI-CK-0003`);
  assert.strictEqual(cari.status, 200, JSON.stringify(cari.body));
  assert.deepStrictEqual(cari.body.rows.map((r) => r.invoice_no), ['UJI-CK-0003']);
  assert.strictEqual(cari.body.summary.transactions, 1, 'ringkasan ikut filter pencarian');
});

test('Laporan kasir: limit + truncated', async () => {
  const today = await todayTz();
  const res = await lapKasir(`?from=${today}&to=${today}&limit=2`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.rows.length, 2);
  assert.strictEqual(res.body.truncated, true);
  // Ringkasan tetap angka penuh (bukan angka baris yang ditampilkan).
  assert.strictEqual(res.body.summary.transactions, 3);
  assert.strictEqual(res.body.summary.total, 75000);
});

test('Laporan kasir: validasi query (limit, period, rentang terbalik)', async () => {
  const today = await todayTz();
  for (const q of ['limit=0', 'limit=1001', 'limit=abc', 'period=kapanpun']) {
    const bad = await lapKasir(`?${q}`);
    assert.strictEqual(bad.status, 422, `harus 422 untuk ${q}`);
  }
  const dibalik = await lapKasir('?from=2026-10-17&to=2026-10-01');
  assert.strictEqual(dibalik.status, 422);
  assert.ok(
    JSON.stringify(dibalik.body).includes('sebelum'),
    'pesan menyebut tanggal akhir sebelum awal'
  );

  // Batas ekspor berbeda (bawaan 2000, maksimum 20000).
  for (const q of ['limit=0', 'limit=20001']) {
    const bad = await lapKasirExport(`?${q}`);
    assert.strictEqual(bad.status, 422, `ekspor harus 422 untuk ${q}`);
  }
  const ok = await lapKasirExport(`?from=${today}&to=${today}&limit=20000`);
  assert.strictEqual(ok.status, 200);
});

test('Laporan kasir: peran — tanpa token 401, owner/admin 403', async () => {
  const anon = await request.get('/api/cashier/reports/transactions');
  assert.strictEqual(anon.status, 401);

  const asOwner = await request.get('/api/cashier/reports/transactions', auth(tokenA));
  assert.strictEqual(asOwner.status, 403, 'owner tidak memakai rute kasir');

  const asAdmin = await request.get('/api/cashier/reports/transactions', auth(adminToken));
  assert.strictEqual(asAdmin.status, 403, 'admin platform tidak memakai rute kasir');

  const anonExport = await request.get('/api/cashier/reports/transactions/export');
  assert.strictEqual(anonExport.status, 401);

  // Kasir dari bisnis lain (outlet bisnis B) tidak melihat data bisnis A.
  const otherOwner = await ownerPost(tokenB, ownerPath(businessB, '/cashiers'), {
    fullName: 'Kasir Bisnis B',
    email: 'uji-ck-kasir-b@nova.test',
    password: PASSWORD,
    outletId: outletB1,
  });
  assert.ok([200, 201].includes(otherOwner.status), JSON.stringify(otherOwner.body));
  const loginB = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'uji-ck-kasir-b@nova.test',
    password: PASSWORD,
  });
  assert.strictEqual(loginB.status, 200);
  const resB = await request.get('/api/cashier/reports/transactions', auth(loginB.body.accessToken));
  assert.strictEqual(resB.status, 200);
  assert.strictEqual(resB.body.business.name, 'Bisnis Laporan Kasir B');
  assert.strictEqual(resB.body.outlet.id, outletB1);
  assert.deepStrictEqual(resB.body.rows.map((r) => r.invoice_no), ['UJI-CK-B-0001']);
});

test('Ekspor Excel kasir: 3 sheet, baris per transaksi + TOTAL, persentase', async () => {
  const today = await todayTz();
  const res = await lapKasirExport(`?from=${today}&to=${today}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.buffer.length > 1000, 'buffer xlsx tidak boleh kosong');
  assert.match(
    res.headers.get('content-type') ?? '',
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
  );
  assert.match(
    res.headers.get('content-disposition') ?? '',
    /KASIR_NOVA_Laporan_Transaksi_Kasir_\d{4}-\d{2}-\d{2}_sampai_\d{4}-\d{2}-\d{2}\.xlsx/
  );

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.buffer);
  assert.deepStrictEqual(
    wb.worksheets.map((w) => w.name),
    ['Ringkasan', 'Daftar Transaksi', 'Rekap Metode Pembayaran'],
    'tanpa sheet Produk Terlaris (keputusan B1)'
  );

  // Ringkasan: informasi + angka sama seperti layar.
  const ws = wb.getWorksheet('Ringkasan');
  assert.strictEqual(cellByLabel(ws, 'Nama Bisnis'), 'Bisnis Laporan Kasir');
  assert.strictEqual(cellByLabel(ws, 'Outlet'), 'Outlet Kasir Utama');
  assert.strictEqual(cellByLabel(ws, 'Jumlah transaksi'), 3);
  assert.strictEqual(cellByLabel(ws, 'Total omzet'), 750, 'sen -> rupiah');
  assert.strictEqual(cellByLabel(ws, 'Rata-rata per transaksi'), 250);
  assert.strictEqual(cellByLabel(ws, 'Jumlah item (qty) pada berkas ini'), 5);

  // Daftar Transaksi: 3 baris transaksi (penjualan 2 item tetap SATU baris)
  // + baris TOTAL. Tanggal diformat dd/mm/yyyy, nominal rupiah.
  const det = wb.getWorksheet('Daftar Transaksi');
  assert.strictEqual(det.rowCount, 5, 'header + 3 transaksi + TOTAL');
  const saleRow = [2, 3, 4]
    .map((r) => ({
      invoice: det.getCell(r, 2).value,
      items: det.getCell(r, 5).value,
      total: det.getCell(r, 6).value,
      method: det.getCell(r, 7).value,
    }))
    .find((r) => r.total === 400);
  assert.ok(saleRow, 'penjualan 40.000 harus ada sebagai satu baris');
  assert.strictEqual(saleRow.items, 3, 'satu baris memuat 3 item');
  assert.strictEqual(saleRow.method, 'Tunai');
  assert.strictEqual(det.getCell(5, 2).value, 'TOTAL');
  assert.strictEqual(det.getCell(5, 5).value, 5);
  assert.strictEqual(det.getCell(5, 6).value, 750);
  assert.match(String(det.getCell(2, 3).value), /^\d{2}\/\d{2}\/\d{4}$/, 'tanggal dd/mm/yyyy');

  // Rekap Metode Pembayaran: omzet menurun + persentase format persen.
  const met = wb.getWorksheet('Rekap Metode Pembayaran');
  assert.deepStrictEqual(
    [2, 3, 4].map((r) => [met.getCell(r, 1).value, met.getCell(r, 3).value]),
    [
      ['Tunai', 400],
      ['Kartu', 200],
      ['QRIS', 150],
    ]
  );
  assert.ok(Math.abs(met.getCell(2, 4).value - 0.533) < 1e-6, '53,3% tersimpan 0,533');
  assert.strictEqual(met.getCell(2, 4).numFmt, '0.0%');
  assert.strictEqual(met.getCell(5, 1).value, 'TOTAL');
  assert.strictEqual(met.getCell(5, 3).value, 750);
  assert.strictEqual(met.getCell(5, 4).value, 1);
});

test('Ekspor Excel kasir: peringatan TERPOTONG & rentang mengikuti layar', async () => {
  const today = await todayTz();
  const res = await lapKasirExport(`?from=${today}&to=${today}&limit=2`);
  assert.strictEqual(res.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.buffer);

  const ws = wb.getWorksheet('Ringkasan');
  let warning = null;
  for (let r = 1; r <= ws.rowCount; r += 1) {
    if (ws.getCell(r, 1).value === 'PERINGATAN') warning = ws.getCell(r, 2).value;
  }
  assert.ok(warning, 'peringatan TERPOTONG harus ada saat limit terpakai');
  assert.match(warning, /TERPOTONG/);
  assert.strictEqual(cellByLabel(ws, 'Jumlah transaksi'), 3, 'ringkasan tetap angka penuh');
  assert.strictEqual(cellByLabel(ws, 'Jumlah baris transaksi pada berkas ini'), 2);

  const det = wb.getWorksheet('Daftar Transaksi');
  assert.strictEqual(det.rowCount, 4, 'header + 2 transaksi + TOTAL');

  // Void tidak ikut ekspor bawaan (hanya `completed`).
  const invoices = [2, 3, 4].map((r) => det.getCell(r, 2).value);
  assert.ok(!invoices.includes('UJI-CK-0004'), 'transaksi void tidak ikut bawaan');
});
