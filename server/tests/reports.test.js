/**
 * Tes integrasi Fase 9 — Laporan Penjualan.
 *
 * Kriteria selesai:
 *   - Laporan harian/mingguan/bulanan/tahunan via agregat SQL dengan cakupan
 *     tenant (business_id) yang dijamin.
 *   - Ekspor CSV/JSON.
 *   - Laporan untuk 2 business_id terisolasi: hasilnya tidak bocor lintas
 *     tenant; peran salah tidak bisa mengakses.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'LaporanUji123!';
const TZ = 'Asia/Jakarta';

let ownerAId, ownerBId, adminId;
let tokenA, tokenB, adminToken, cashierAToken;
let businessA, businessB;
let outletA1, outletB1;
let cashierAId;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const ownerPath = (businessId, tail = '') => `/businesses/${businessId}${tail}`;
const ownerGet = (token, path) => request.get(`/api/owner${path}`, auth(token));
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));
const ownerPatch = (token, path, body) => request.patch(`/api/owner${path}`, body, auth(token));
const adminGet = (token, path) => request.get(`/api/platform/businesses${path}`, auth(token));
const reports = (biz, q = '') => ownerPath(biz, `/reports${q}`);

const todayTz = async () => {
  const { rows } = await query(
    `SELECT to_char((now() AT TIME ZONE $1::text)::date, 'YYYY-MM-DD') AS d`,
    [TZ]
  );
  return rows[0].d;
};

/** Sisipkan transaksi langsung (untuk backdating & variasi status). */
const insertTransaction = async ({
  businessId,
  outletId,
  invoiceNo,
  status = 'completed',
  subtotal,
  taxRate = 0,
  taxTotal = 0,
  discountTotal = 0,
  total,
  agoDays = 0,
  productName = 'Produk Laporan',
  qty = 1,
}) => {
  const { rows } = await query(
    `INSERT INTO transactions
       (business_id, outlet_id, invoice_no, status, subtotal, discount_type,
        discount_value, discount_total, tax_rate, tax_inclusive, tax_total,
        total, paid_amount, change_amount)
     VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6,$7,FALSE,$8,$9,$9,0)
     RETURNING id`,
    [businessId, outletId, invoiceNo, status, subtotal, discountTotal, taxRate, taxTotal, total]
  );
  const id = rows[0].id;

  await query(
    `INSERT INTO transaction_items
       (transaction_id, product_name, sku, unit_price, qty, discount_amount, tax_amount, line_total)
     VALUES ($1,$2,'SKU-LAP',$3,$4,$5,$6,$7)`,
    [id, productName, subtotal, qty, discountTotal, taxTotal, total]
  );

  if (status === 'completed') {
    await query(
      `INSERT INTO payments (transaction_id, method, amount, status) VALUES ($1,'cash',$2,'paid')`,
      [id, total]
    );
  }

  if (agoDays > 0) {
    await query(
      `UPDATE transactions SET created_at = created_at - make_interval(days => $2) WHERE id = $1`,
      [id, agoDays]
    );
  }
  return id;
};

before(async () => {
  const cls = ['uji-lap-a@nova.test', 'uji-lap-b@nova.test'];
  const leftovers = (await query(`SELECT id FROM owners WHERE email = ANY($1::text[])`, [cls])).rows;
  if (leftovers.length) {
    await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
      'owner',
      leftovers.map((r) => r.id),
    ]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
      leftovers.map((r) => r.id),
    ]);
    await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [leftovers.map((r) => r.id)]);
  }
  // Admin uji suite ini (bisa tersisa bila run sebelumnya crash sebelum cleanup).
  const admins = (
    await query(`SELECT id FROM platform_admins WHERE email = 'uji-lap-admin@nova.test'`)
  ).rows;
  if (admins.length) {
    await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
      'platform_admin',
      admins.map((r) => r.id),
    ]);
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
      admins.map((r) => r.id),
    ]);
    await query('DELETE FROM platform_admins WHERE id = ANY($1::uuid[])', [
      admins.map((r) => r.id),
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

  ownerAId = await insOwner('uji-lap-a@nova.test', 'Owner Laporan A');
  ownerBId = await insOwner('uji-lap-b@nova.test', 'Owner Laporan B');
  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });

  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    ['uji-lap-admin@nova.test', await hashPassword(PASSWORD), 'Admin Laporan Uji']
  );
  adminId = admin.rows[0].id;
  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });

  // Bisnis A: outlet pajak 10% (eksklusif), satu produk, satu kasir.
  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis Laporan A' })).body.business.id;
  outletA1 = (
    await ownerPost(tokenA, ownerPath(businessA, '/outlets'), { name: 'Outlet LA1', taxRate: 10 })
  ).body.outlet.id;
  const product = (
    await ownerPost(tokenA, ownerPath(businessA, '/products'), {
      name: 'Nasi Goreng',
      price: 15000,
      trackStock: true,
    })
  ).body.product;
  await ownerPost(tokenA, ownerPath(businessA, '/cashiers'), {
    fullName: 'Kasir Laporan A',
    email: 'klap-a@nova.test',
    password: PASSWORD,
    outletId: outletA1,
  });
  const la = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'klap-a@nova.test',
    password: PASSWORD,
  });
  cashierAToken = la.body.accessToken;
  const cashierLogin = await query(`SELECT id FROM cashiers WHERE email = 'klap-a@nova.test'`);
  cashierAId = cashierLogin.rows[0].id;

  // Stok awal untuk produk track_stock (penjualan nyata butuh stok).
  await ownerPatch(
    tokenA,
    ownerPath(businessA, `/products/${product.id}/stocks/${outletA1}`),
    { quantity: 20 }
  );

  // Bisnis B: outlet pajak 0% (untuk uji isolasi).
  businessB = (await ownerPost(tokenB, '/businesses', { name: 'Bisnis Laporan B' })).body.business.id;
  outletB1 = (await ownerPost(tokenB, ownerPath(businessB, '/outlets'), { name: 'Outlet LB1' }))
    .body.outlet.id;

  // Satu penjualan nyata via API (kasir): 2×15.000 + PPN 10% = 33.000.
  const sale = await request.post(
    '/api/cashier/transactions',
    { items: [{ productId: product.id, qty: 2 }], payment: { method: 'cash', amount: 50000 } },
    auth(cashierAToken)
  );
  assert.strictEqual(sale.status, 201, 'penjualan nyata harus berhasil');

  // Transaksi tambahan bisnis A (backdated) + satu voided hari ini.
  await insertTransaction({ businessId: businessA, outletId: outletA1, invoiceNo: 'LAP-A-0002', subtotal: 10000, taxRate: 10, taxTotal: 1000, total: 11000, productName: 'Es Teh' });
  await insertTransaction({ businessId: businessA, outletId: outletA1, invoiceNo: 'LAP-A-0003', subtotal: 15000, taxTotal: 0, total: 15000, agoDays: 1, productName: 'Kopi Susu' });
  await insertTransaction({ businessId: businessA, outletId: outletA1, invoiceNo: 'LAP-A-0004', subtotal: 20000, taxTotal: 0, total: 20000, agoDays: 3, productName: 'Roti Bakar' });
  await insertTransaction({ businessId: businessA, outletId: outletA1, invoiceNo: 'LAP-A-0005', status: 'voided', subtotal: 5000, taxTotal: 0, total: 5000, productName: 'Air Mineral' });

  // Transaksi bisnis B (yang TIDAK boleh bocor ke laporan A).
  await insertTransaction({ businessId: businessB, outletId: outletB1, invoiceNo: 'LAP-B-0001', subtotal: 99000, taxTotal: 0, total: 99000, productName: 'Menu Bisnis B' });
});

after(async () => {
  const ids = [ownerAId, ownerBId];
  await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [
    [...ids, cashierAId],
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
    [...ids, adminId],
  ]);
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
});

/** Perbandingan laporan API dengan agregasi SQL langsung pada business_id. */
const dbGrouped = async (businessId, groupBy) => {
  const { rows } = await query(
    `SELECT to_char(DATE_TRUNC($2::text, t.created_at AT TIME ZONE $3::text), 'YYYY-MM-DD') AS period_start,
            COUNT(*) FILTER (WHERE t.status = 'completed')::int                  AS transactions,
            COALESCE(COUNT(ti.id) FILTER (WHERE t.status = 'completed'), 0)::int AS items_sold,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'completed'), 0)      AS total,
            COALESCE(SUM(t.total) FILTER (WHERE t.status = 'voided'), 0)         AS voided_total
       FROM transactions t
       LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
      WHERE t.business_id = $1
      GROUP BY 1
      ORDER BY 1`,
    [businessId, groupBy, TZ]
  );
  return rows.map((r) => ({
    period_start: r.period_start,
    transactions: r.transactions,
    items_sold: r.items_sold,
    total: Number(r.total),
    voided_total: Number(r.voided_total),
  }));
};

const dbCompletedTotal = async (businessId) => {
  const { rows } = await query(
    `SELECT COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0) AS n,
            COALESCE(SUM(total) FILTER (WHERE status = 'voided'), 0)    AS v
       FROM transactions WHERE business_id = $1`,
    [businessId]
  );
  return { completed: Number(rows[0].n), voided: Number(rows[0].v) };
};

test('Laporan grouped = agregasi SQL yang sama (day/week/month/year)', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;
  for (const groupBy of ['day', 'week', 'month', 'year']) {
    const res = await ownerGet(tokenA, reports(businessA, `?groupBy=${groupBy}&${wide}`));
    assert.strictEqual(res.status, 200, `${groupBy}: harus 200`);
    assert.ok(Array.isArray(res.body), `${groupBy}: body harus array`);

    const sql = await dbGrouped(businessA, groupBy);
    assert.strictEqual(res.body.length, sql.length, `${groupBy}: jumlah periode sama`);
    for (let i = 0; i < sql.length; i += 1) {
      assert.strictEqual(res.body[i].period_start, sql[i].period_start);
      assert.strictEqual(res.body[i].transactions, sql[i].transactions);
      assert.strictEqual(res.body[i].items_sold, sql[i].items_sold);
      assert.strictEqual(res.body[i].total, sql[i].total);
      assert.strictEqual(res.body[i].voided_total, sql[i].voided_total);
    }
  }

  // Mingguan: period_start selalu Senin.
  const weekly = await ownerGet(tokenA, reports(businessA, `?groupBy=week&${wide}`));
  for (const row of weekly.body) {
    const day = new Date(`${row.period_start}T00:00:00Z`).getUTCDay();
    assert.strictEqual(day, 1, `awal minggu harus Senin, dapat ${row.period_start}`);
  }

  // Total pendapatan lintas periode = jumlah transaksi completed (bukan voided).
  const monthly = await ownerGet(tokenA, reports(businessA, `?groupBy=month&${wide}`));
  const sumCompleted = monthly.body.reduce((a, r) => a + Number(r.total), 0);
  const { completed } = await dbCompletedTotal(businessA);
  assert.strictEqual(sumCompleted, completed, 'total lintas periode = total completed');
});

test('Ringkasan rentang sempit = angka yang diketahui (void dipisah)', async () => {
  const today = await todayTz();
  const res = await ownerGet(
    tokenA,
    reports(businessA, `/summary?from=${today}&to=${today}`)
  );
  assert.strictEqual(res.status, 200);

  const { summary, top_products } = res.body;
  // Hari ini: penjualan nyata 33.000 + sisipan 11.000 (total 44.000, 2 transaksi) + void 5.000.
  assert.strictEqual(summary.transactions, 2);
  assert.strictEqual(summary.total, 44000);
  assert.strictEqual(summary.avg_total, 22000);
  assert.strictEqual(summary.voided_total, 5000);
  assert.ok(summary.active_outlets >= 1);

  const names = top_products.map((p) => p.product_name);
  assert.ok(names.includes('Nasi Goreng'), 'produk dari penjualan nyata ada di top produk');
});

test('Filter outlet & tanggal mempersempit laporan', async () => {
  const today = await todayTz();
  const res = await ownerGet(
    tokenA,
    reports(businessA, `/summary?outletId=${outletA1}&from=${today}&to=${today}`)
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.summary.total, 44000);

  const autre = await ownerGet(tokenA, reports(businessA, '?groupBy=day&outletId=nope'));
  assert.strictEqual(autre.status, 422, 'outletId bukan UUID -> 422');

  const badRange = await ownerGet(
    tokenA,
    reports(businessA, `/summary?from=${today}&to=2000-01-01`)
  );
  assert.strictEqual(badRange.status, 422, 'dateTo sebelum dateFrom -> 422');
});

test('Isolasi tenant: laporan bisnis lain = 404; admin lintas platform baca', async () => {
  const denied = await ownerGet(tokenB, reports(businessA));
  assert.strictEqual(denied.status, 404, 'owner B tidak boleh melihat laporan bisnis A');

  const adminRows = await adminGet(
    adminToken,
    `/${businessA}/reports?groupBy=month&from=2000-01-01&to=${await todayTz()}`
  );
  assert.strictEqual(adminRows.status, 200, 'admin dapat membaca laporan bisnis A');
  const sumA = adminRows.body.reduce((a, r) => a + Number(r.total), 0);
  const { completed: expectedA } = await dbCompletedTotal(businessA);
  assert.strictEqual(sumA, expectedA, 'laporan admin A = total A');

  const adminB = await adminGet(
    adminToken,
    `/${businessB}/reports?groupBy=month&from=2000-01-01&to=${await todayTz()}`
  );
  const sumB = adminB.body.reduce((a, r) => a + Number(r.total), 0);
  const { completed: expectedB } = await dbCompletedTotal(businessB);
  assert.strictEqual(sumB, expectedB, 'laporan admin B = total B');
  assert.notStrictEqual(sumA, sumB, 'dua bisnis terisolasi');

  // Owner A tidak berhak melihat laporan bisnis B via platform.
  const ownerAsAdmin = await adminGet(tokenA, `/${businessB}/reports`);
  assert.strictEqual(ownerAsAdmin.status, 403);
});

test('Peran salah tidak bisa mengakses laporan', async () => {
  const asCashierOwner = await ownerGet(cashierAToken, reports(businessA));
  assert.strictEqual(asCashierOwner.status, 403, 'kasir tidak boleh di route owner');

  const asCashierPlatform = await adminGet(cashierAToken, `/${businessA}/reports`);
  assert.strictEqual(asCashierPlatform.status, 403, 'kasir tidak boleh di route platform');
});

test('Ekspor CSV & JSON (owner + admin)', async () => {
  const csv = await ownerGet(tokenA, reports(businessA, '/export?format=csv'));
  assert.strictEqual(csv.status, 200);
  assert.ok(csv.headers.get('content-type')?.startsWith('text/csv'), 'CSV harus bercontent-type text/csv');
  assert.match(csv.body, /^invoice_no,status,outlet_name,/, 'baris header CSV');
  assert.match(csv.body, /LAP-A-0002/, 'baris transaksi ada di CSV');
  assert.match(csv.body, /voided/, 'status voided ikut diekspor');

  const json = await ownerGet(tokenA, reports(businessA, '/export?format=json'));
  assert.strictEqual(json.status, 200);
  assert.ok(Array.isArray(json.body.items));
  assert.ok(json.body.items.length >= 4, 'JSON memuat seluruh transaksi A');
  const found = json.body.items.find((t) => t.invoice_no === 'LAP-A-0002');
  assert.strictEqual(found.total, 11000, 'nilai numerik sudah dikonversi Number');

  const adminCsv = await adminGet(adminToken, `/${businessA}/reports/export?format=csv`);
  assert.strictEqual(adminCsv.status, 200);
  assert.match(adminCsv.body, /LAP-A-0003/, 'admin dapat mengekspor CSV');

  const badFormat = await ownerGet(tokenA, reports(businessA, '/export?format=pdf'));
  assert.strictEqual(badFormat.status, 422, 'format tidak dikenal -> 422');
});