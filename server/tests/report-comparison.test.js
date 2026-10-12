/**
 * Tes integrasi Fase 16 — Laporan Lintas-Bisnis & Perbandingan Outlet.
 *
 * Kriteria:
 *   - `GET /api/owner/businesses/:id/reports/outlets` membandingkan tiap outlet
 *     (termasuk outlet tanpa transaksi) dengan filter/rentang yang sama.
 *   - `GET /api/owner/reports/businesses` membandingkan seluruh bisnis milik
 *     Owner; bisnis tenant lain TIDAK bocor.
 *   - Agregat TIDAK berlipat untuk transaksi multi-item (perbaikan bug fan-out
 *     pada `groupedReport`).
 *   - Ekspor .xlsx perbandingan (2 sheet: Ringkasan + tabel) & proteksi formula
 *     injection; format json tersedia.
 *   - Otorisasi: kasir 403, owner lain 404, format/rentang tidak valid 422.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import ExcelJS from 'exceljs';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'BandingUji123!';
const TZ = 'Asia/Jakarta';

let ownerAId, ownerBId;
let tokenA, tokenB, cashierToken;
let businessA, businessA2, businessB;
let outletA1, outletA2, outletA3;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const ownerGet = (token, path) => request.get(`/api/owner${path}`, auth(token));
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));
const ownerPath = (businessId, tail = '') => `/businesses/${businessId}${tail}`;

const todayTz = async () => {
  const { rows } = await query(
    `SELECT to_char((now() AT TIME ZONE $1::text)::date, 'YYYY-MM-DD') AS d`,
    [TZ]
  );
  return rows[0].d;
};

/** Sisipkan transaksi (+ item per baris & pembayaran) langsung ke DB. */
const insertTx = async ({
  businessId,
  outletId,
  invoiceNo,
  status = 'completed',
  total,
  items = [total],
  method = 'cash',
  payStatus = 'paid',
  agoDays = 0,
}) => {
  const { rows } = await query(
    `INSERT INTO transactions
       (business_id, outlet_id, invoice_no, status, subtotal, discount_type,
        discount_value, discount_total, tax_rate, tax_inclusive, tax_total,
        total, paid_amount, change_amount)
     VALUES ($1,$2,$3,$4,$5,NULL,NULL,0,0,FALSE,0,$5,$5,0)
     RETURNING id`,
    [businessId, outletId, invoiceNo, status, total]
  );
  const id = rows[0].id;
  for (const lineTotal of items) {
    await query(
      `INSERT INTO transaction_items
         (transaction_id, product_name, sku, unit_price, qty, discount_amount, tax_amount, line_total)
       VALUES ($1,$2,'SKU-CMP',$3,1,0,0,$3)`,
      [id, 'Item Uji', lineTotal]
    );
  }
  if (method) {
    await query(
      `INSERT INTO payments (transaction_id, method, amount, status) VALUES ($1,$2,$3,$4)`,
      [id, method, total, payStatus]
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

/** Sisipkan outlet langsung (tes agregasi; kuota outlet langganan tidak diuji). */
const insertOutlet = async (businessId, name) => {
  const { rows } = await query(
    `INSERT INTO outlets (business_id, name) VALUES ($1,$2) RETURNING id`,
    [businessId, name]
  );
  return rows[0].id;
};

/** Indeks baris tabel (mulai baris 2) yang kolomnya bernilai tertentu. */
const rowIndexByValue = (ws, colIdx, value) => {
  for (let r = 2; r <= ws.rowCount; r += 1) {
    if (ws.getCell(r, colIdx).value === value) return r;
  }
  return -1;
};

const loadWorkbook = async (token, path) => {
  const res = await request.binary(`/api/owner${path}`, auth(token));
  assert.strictEqual(res.status, 200, `ekspor xlsx harus 200: ${path}`);
  assert.ok(res.buffer.length > 1000, 'buffer xlsx tidak boleh kosong');
  assert.match(
    res.headers.get('content-type') ?? '',
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.buffer);
  return { res, wb };
};

before(async () => {
  // Bersihkan sisa run sebelumnya (idempoten).
  const emails = ['uji-banding-a@nova.test', 'uji-banding-b@nova.test'];
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
  const cashiers = (
    await query(`SELECT id FROM cashiers WHERE email = 'uji-banding-k@nova.test'`)
  ).rows;
  if (cashiers.length) {
    await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
      'cashier',
      cashiers.map((r) => r.id),
    ]);
    await query('DELETE FROM cashiers WHERE id = ANY($1::uuid[])', [cashiers.map((r) => r.id)]);
  }

  const insOwner = async (email, name) => {
    const r = await query(
      `INSERT INTO owners (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [email, await hashPassword(PASSWORD), name]
    );
    return r.rows[0].id;
  };

  ownerAId = await insOwner('uji-banding-a@nova.test', 'Owner Banding A');
  ownerBId = await insOwner('uji-banding-b@nova.test', 'Owner Banding B');
  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });

  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis Banding A' })).body.business
    .id;
  // Nama bisnis berbahaya untuk menguji proteksi formula injection pada Excel.
  businessA2 = (await ownerPost(tokenA, '/businesses', { name: '=SUM(1+1)' })).body.business.id;
  businessB = (await ownerPost(tokenB, '/businesses', { name: 'Bisnis Banding B' })).body.business
    .id;

  // Outlet dibuat langsung di DB: kuota langganan default hanya 1 outlet, dan
  // yang diuji di sini adalah agregasi laporan, bukan kuota langganan.
  outletA1 = await insertOutlet(businessA, 'Outlet BA1');
  outletA2 = await insertOutlet(businessA, 'Outlet BA2');
  // Nama outlet berbahaya untuk uji sanitasi Excel.
  outletA3 = await insertOutlet(businessA, '=cmd|/C calc!A0');
  const outletA2b = await insertOutlet(businessA2, 'Outlet BA2b');
  const outletB1 = await insertOutlet(businessB, 'Outlet BB1');
  void outletA3;

  // Kasir bisnis A (untuk uji peran).
  await ownerPost(tokenA, ownerPath(businessA, '/cashiers'), {
    fullName: 'Kasir Banding A',
    email: 'uji-banding-k@nova.test',
    password: PASSWORD,
    outletId: outletA1,
  });
  const login = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'uji-banding-k@nova.test',
    password: PASSWORD,
  });
  cashierToken = login.body.accessToken;

  // Data bisnis A (semua zona Asia/Jakarta):
  //   OA1: 1 selesai multi-item (30.000, 3 baris) + 1 selesai 20.000 (5 hari lalu)
  //        + 1 void 5.000
  //   OA2: 1 selesai multi-item (40.000, 2 baris) + 1 refund 7.000
  //   OA3: tanpa transaksi
  await insertTx({
    businessId: businessA,
    outletId: outletA1,
    invoiceNo: 'CMP-A-0001',
    total: 30000,
    items: [10000, 10000, 10000],
  });
  await insertTx({
    businessId: businessA,
    outletId: outletA1,
    invoiceNo: 'CMP-A-0002',
    total: 20000,
    agoDays: 5,
  });
  await insertTx({
    businessId: businessA,
    outletId: outletA1,
    invoiceNo: 'CMP-A-0003',
    status: 'voided',
    total: 5000,
  });
  await insertTx({
    businessId: businessA,
    outletId: outletA2,
    invoiceNo: 'CMP-A-0004',
    total: 40000,
    items: [20000, 20000],
  });
  await insertTx({
    businessId: businessA,
    outletId: outletA2,
    invoiceNo: 'CMP-A-0005',
    status: 'refunded',
    total: 7000,
    method: 'wallet',
    payStatus: 'refunded',
  });
  // Bisnis A2 (owner A).
  await insertTx({
    businessId: businessA2,
    outletId: outletA2b,
    invoiceNo: 'CMP-A2-0001',
    total: 10000,
  });
  // Bisnis B (owner B) — tidak boleh bocor ke owner A.
  await insertTx({
    businessId: businessB,
    outletId: outletB1,
    invoiceNo: 'CMP-B-0001',
    total: 99000,
  });
});

after(async () => {
  const ids = [ownerAId, ownerBId];
  await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [ids]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
});

test('Perbandingan outlet: agregat per outlet (termasuk outlet kosong)', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;

  const res = await ownerGet(tokenA, ownerPath(businessA, `/reports/outlets?${wide}`));
  assert.strictEqual(res.status, 200);
  const { items, totals } = res.body;
  const byName = Object.fromEntries(items.map((i) => [i.outlet_name, i]));

  assert.strictEqual(byName['Outlet BA1'].transactions, 2);
  assert.strictEqual(byName['Outlet BA1'].items_sold, 4, '3 + 1 item, tidak berlipat');
  assert.strictEqual(byName['Outlet BA1'].total, 50000);
  assert.strictEqual(byName['Outlet BA1'].voided_total, 5000);

  assert.strictEqual(byName['Outlet BA2'].transactions, 1);
  assert.strictEqual(byName['Outlet BA2'].items_sold, 2);
  assert.strictEqual(byName['Outlet BA2'].total, 40000);
  assert.strictEqual(byName['Outlet BA2'].refunded_total, 7000);

  // Outlet tanpa transaksi tetap tampil dengan nilai nol.
  assert.strictEqual(byName['=cmd|/C calc!A0'].transactions, 0);
  assert.strictEqual(byName['=cmd|/C calc!A0'].total, 0);

  assert.strictEqual(items[0].outlet_name, 'Outlet BA1', 'diurutkan menurut omzet');
  assert.deepStrictEqual(totals, {
    transactions: 3,
    items_sold: 6,
    subtotal: 90000,
    discount_total: 0,
    tax_total: 0,
    total: 90000,
    voided_total: 5000,
    refunded_total: 7000,
    outlets: 3,
  });
});

test('Perbandingan outlet: rentang tanggal mempersempit (transaksi lampau keluar)', async () => {
  const today = await todayTz();
  const res = await ownerGet(
    tokenA,
    ownerPath(businessA, `/reports/outlets?from=${today}&to=${today}`)
  );
  assert.strictEqual(res.status, 200);
  const byName = Object.fromEntries(res.body.items.map((i) => [i.outlet_name, i]));

  assert.strictEqual(byName['Outlet BA1'].transactions, 1, 'transaksi 5 hari lalu tidak ikut');
  assert.strictEqual(byName['Outlet BA1'].items_sold, 3);
  assert.strictEqual(byName['Outlet BA1'].total, 30000);
  assert.strictEqual(res.body.totals.total, 70000);
  assert.strictEqual(res.body.totals.transactions, 2);
});

test('grouped report tidak berlipat untuk transaksi multi-item (perbaikan fan-out)', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;

  const grouped = await ownerGet(tokenA, ownerPath(businessA, `/reports?groupBy=day&${wide}`));
  assert.strictEqual(grouped.status, 200);
  const sumTotal = grouped.body.reduce((a, r) => a + r.total, 0);
  const sumItems = grouped.body.reduce((a, r) => a + r.items_sold, 0);
  assert.strictEqual(sumTotal, 90000, 'total = 30.000 + 20.000 + 40.000 (sekali per transaksi)');
  assert.strictEqual(sumItems, 6);

  // Konsisten dengan ringkasan (sum tanpa join).
  const sumRes = await ownerGet(tokenA, ownerPath(businessA, `/reports/summary?${wide}`));
  assert.strictEqual(sumRes.body.summary.total, 90000);
  assert.strictEqual(sumRes.body.summary.voided_total, 5000);
});

test('Lintas-bisnis: perbandingan tiap bisnis Owner + isolasi tenant', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;

  const res = await ownerGet(tokenA, `/reports/businesses?${wide}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.items.length, 2, 'hanya bisnis milik owner A');
  const byId = Object.fromEntries(res.body.items.map((i) => [i.business_id, i]));

  assert.strictEqual(byId[businessA].total, 90000);
  assert.strictEqual(byId[businessA].transactions, 3);
  assert.strictEqual(byId[businessA].items_sold, 6);
  assert.strictEqual(byId[businessA].voided_total, 5000);
  assert.strictEqual(byId[businessA].refunded_total, 7000);
  assert.strictEqual(byId[businessA].active_outlets, 2);

  assert.strictEqual(byId[businessA2].total, 10000);
  assert.strictEqual(byId[businessA2].active_outlets, 1);

  assert.deepStrictEqual(res.body.totals, {
    transactions: 4,
    items_sold: 7,
    subtotal: 100000,
    discount_total: 0,
    tax_total: 0,
    total: 100000,
    voided_total: 5000,
    refunded_total: 7000,
    businesses: 2,
  });

  // Isolasi: owner B tidak melihat bisnis owner A.
  const resB = await ownerGet(tokenB, `/reports/businesses?${wide}`);
  assert.strictEqual(resB.body.items.length, 1);
  assert.strictEqual(resB.body.items[0].business_id, businessB);
  assert.strictEqual(resB.body.totals.total, 99000);
});

test('Ekspor xlsx perbandingan outlet (2 sheet, sanitasi, total rupiah)', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;
  const { res, wb } = await loadWorkbook(
    tokenA,
    ownerPath(businessA, `/reports/outlets/export?format=xlsx&${wide}`)
  );
  assert.match(
    res.headers.get('content-disposition') ?? '',
    /KASIR_NOVA_Perbandingan_Outlet_\d{4}-\d{2}-\d{2}_sampai_\d{4}-\d{2}-\d{2}\.xlsx/
  );
  assert.deepStrictEqual(wb.worksheets.map((s) => s.name), [
    'Ringkasan',
    'Perbandingan Outlet',
  ]);

  const ws = wb.getWorksheet('Perbandingan Outlet');
  const r1 = rowIndexByValue(ws, 2, 'Outlet BA1');
  assert.ok(r1 > 0);
  assert.strictEqual(ws.getCell(r1, 4).value, 2, 'transaksi OA1');
  assert.strictEqual(ws.getCell(r1, 5).value, 4, 'item OA1');
  assert.strictEqual(ws.getCell(r1, 9).value, 500, 'omzet OA1 dalam rupiah');
  assert.strictEqual(ws.getCell(r1, 10).value, 50, 'void OA1');

  const totalRow = rowIndexByValue(ws, 2, 'TOTAL');
  assert.ok(totalRow > 0);
  assert.strictEqual(ws.getCell(totalRow, 9).value, 900, 'total omzet = 90.000/100');

  // Nama outlet berbahaya dinetralkan menjadi teks (awalan apostrof).
  const injRow = rowIndexByValue(ws, 2, "'=cmd|/C calc!A0");
  assert.ok(injRow > 0, 'nama outlet berbahaya disanitasi');
});

test('Ekspor xlsx lintas-bisnis (2 sheet) + nama bisnis berbahaya disanitasi', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;
  const { res, wb } = await loadWorkbook(
    tokenA,
    `/reports/businesses/export?format=xlsx&${wide}`
  );
  assert.match(
    res.headers.get('content-disposition') ?? '',
    /KASIR_NOVA_Perbandingan_Bisnis_\d{4}-\d{2}-\d{2}_sampai_\d{4}-\d{2}-\d{2}\.xlsx/
  );
  assert.deepStrictEqual(wb.worksheets.map((s) => s.name), ['Ringkasan', 'Perbandingan Bisnis']);

  const ws = wb.getWorksheet('Perbandingan Bisnis');
  const aRow = rowIndexByValue(ws, 2, 'Bisnis Banding A');
  assert.ok(aRow > 0);
  assert.strictEqual(ws.getCell(aRow, 9).value, 900, 'omzet bisnis A dalam rupiah');
  assert.strictEqual(ws.getCell(aRow, 12).value, 2, 'outlet aktif bisnis A');

  const totalRow = rowIndexByValue(ws, 2, 'TOTAL');
  assert.strictEqual(ws.getCell(totalRow, 9).value, 1000, 'total lintas-bisnis = 100.000/100');

  const injRow = rowIndexByValue(ws, 2, "'=SUM(1+1)");
  assert.ok(injRow > 0, 'nama bisnis berbahaya disanitasi');
});

test('Akses & validasi: kasir 403, owner lain 404, format/rentang buruk 422, json', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;

  const asCashierCross = await ownerGet(cashierToken, `/reports/businesses?${wide}`);
  assert.strictEqual(asCashierCross.status, 403, 'kasir tidak boleh akses lintas-bisnis');

  const asCashierOutlets = await ownerGet(
    cashierToken,
    ownerPath(businessA, `/reports/outlets?${wide}`)
  );
  assert.strictEqual(asCashierOutlets.status, 403);

  const otherOwner = await ownerGet(tokenB, ownerPath(businessA, `/reports/outlets?${wide}`));
  assert.strictEqual(otherOwner.status, 404, 'owner lain = 404 (anti-IDOR)');

  const otherExport = await request.binary(
    `/api/owner${ownerPath(businessA, `/reports/outlets/export?${wide}`)}`,
    auth(tokenB)
  );
  assert.strictEqual(otherExport.status, 404);

  const badRange = await ownerGet(
    tokenA,
    ownerPath(businessA, '/reports/outlets?from=2026-10-12&to=2026-10-01')
  );
  assert.strictEqual(badRange.status, 422);

  const badFormat = await request.binary(
    `/api/owner${ownerPath(businessA, `/reports/outlets/export?format=pdf&${wide}`)}`,
    auth(tokenA)
  );
  assert.strictEqual(badFormat.status, 422);

  const json = await ownerGet(tokenA, `/reports/businesses/export?format=json&${wide}`);
  assert.strictEqual(json.status, 200);
  assert.strictEqual(json.body.items.length, 2);
  assert.strictEqual(json.body.totals.total, 100000);
});
