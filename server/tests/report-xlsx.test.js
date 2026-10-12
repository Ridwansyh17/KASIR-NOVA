/**
 * Tes integrasi Fase 15 — Ekspor Rekapan Transaksi ke Excel (.xlsx).
 *
 * Kriteria:
 *   - Endpoint `/reports/export?format=xlsx` menghasilkan berkas XLSX valid
 *     dengan 4 sheet (Ringkasan, Detail Transaksi, Rekap Harian, Rekap
 *     Metode Pembayaran) dan nama file yang jelas.
 *   - Hanya transaksi NYATA difilter; omzet transaksi selesai konsisten dengan
 *     dashboard (`/reports/summary`).
 *   - Filter (status, metode, status pembayaran, pencarian, rentang tanggal)
 *     bekerja pada ekspor; isolasi tenant dan peran tetap ditegakkan.
 *   - Proteksi formula injection pada nilai teks.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import ExcelJS from 'exceljs';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'XlsxUji123!';
const TZ = 'Asia/Jakarta';

let ownerAId, ownerBId;
let tokenA, tokenB, cashierToken;
let businessA, businessB;
let outletA1, outletB1;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const ownerPath = (businessId, tail = '') => `/businesses/${businessId}${tail}`;
const ownerGet = (token, path) => request.get(`/api/owner${path}`, auth(token));
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));
const reports = (biz, q = '') => ownerPath(biz, `/reports${q}`);

const todayTz = async () => {
  const { rows } = await query(
    `SELECT to_char((now() AT TIME ZONE $1::text)::date, 'YYYY-MM-DD') AS d`,
    [TZ]
  );
  return rows[0].d;
};

/** Sisipkan transaksi + (opsional) pembayaran secara langsung ke DB. */
const insertTx = async ({
  businessId,
  outletId,
  invoiceNo,
  status = 'completed',
  subtotal,
  taxTotal = 0,
  total,
  method = 'cash',
  payStatus = 'paid',
  note = null,
}) => {
  const { rows } = await query(
    `INSERT INTO transactions
       (business_id, outlet_id, invoice_no, status, subtotal, discount_type,
        discount_value, discount_total, tax_rate, tax_inclusive, tax_total,
        total, paid_amount, change_amount, note)
     VALUES ($1,$2,$3,$4,$5,NULL,NULL,0,0,FALSE,$6,$7,$7,0,$8)
     RETURNING id`,
    [businessId, outletId, invoiceNo, status, subtotal, taxTotal, total, note]
  );
  const txnId = rows[0].id;
  if (method) {
    await query(
      `INSERT INTO payments (transaction_id, method, amount, status)
       VALUES ($1,$2,$3,$4)`,
      [txnId, method, total, payStatus]
    );
  }
  return txnId;
};

/** Ambil nilai kolom B dari baris yang labelnya (kolom A) cocok. */
const cellByLabel = (ws, label) => {
  for (let r = 1; r <= ws.rowCount; r += 1) {
    if (ws.getCell(r, 1).value === label) return ws.getCell(r, 2).value;
  }
  return undefined;
};

const loadWorkbook = async (token, path) => {
  const res = await request.binary(`/api/owner${path}`, auth(token));
  assert.strictEqual(res.status, 200, `ekspor xlsx harus 200: ${path}`);
  assert.ok(res.buffer.length > 1000, 'buffer xlsx tidak boleh kosong');
  assert.match(
    res.headers.get('content-type') ?? '',
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
  );
  assert.match(
    res.headers.get('content-disposition') ?? '',
    /KASIR_NOVA_Rekapan_Transaksi_\d{4}-\d{2}-\d{2}_sampai_\d{4}-\d{2}-\d{2}\.xlsx/
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.buffer);
  return { res, wb };
};

before(async () => {
  // Bersihkan sisa run sebelumnya (aman diulang/idempoten).
  const cls = ['uji-xlsx-a@nova.test', 'uji-xlsx-b@nova.test'];
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
  const cashiers = (
    await query(`SELECT id FROM cashiers WHERE email = 'uji-xlsx-k@nova.test'`)
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

  ownerAId = await insOwner('uji-xlsx-a@nova.test', 'Owner Xlsx A');
  ownerBId = await insOwner('uji-xlsx-b@nova.test', 'Owner Xlsx B');
  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });

  // Bisnis A: jenis usaha "Restoran", outlet pajak 10%, satu kasir.
  businessA = (
    await ownerPost(tokenA, '/businesses', { name: 'Bisnis Xlsx A', businessType: 'Restoran' })
  ).body.business.id;
  outletA1 = (
    await ownerPost(tokenA, ownerPath(businessA, '/outlets'), { name: 'Outlet XA1', taxRate: 10 })
  ).body.outlet.id;
  await ownerPost(tokenA, ownerPath(businessA, '/cashiers'), {
    fullName: 'Kasir Xlsx A',
    email: 'uji-xlsx-k@nova.test',
    password: PASSWORD,
    outletId: outletA1,
  });
  const login = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'uji-xlsx-k@nova.test',
    password: PASSWORD,
  });
  cashierToken = login.body.accessToken;

  // Bisnis B: tanpa transaksi (untuk uji ekspor kosong) — sekaligus isolasi tenant.
  businessB = (await ownerPost(tokenB, '/businesses', { name: 'Bisnis Xlsx B' })).body.business.id;
  outletB1 = (await ownerPost(tokenB, ownerPath(businessB, '/outlets'), { name: 'Outlet XB1' }))
    .body.outlet.id;

  // Data bisnis A (semua dibuat hari ini, zona Asia/Jakarta):
  //   3 selesai (tunai/QR/kartu) + 1 void + 1 refund + 1 selesai dgn catatan berbahaya.
  await insertTx({ businessId: businessA, outletId: outletA1, invoiceNo: 'LAP-X-0001', subtotal: 10000, taxTotal: 1000, total: 11000, method: 'cash', payStatus: 'paid' });
  await insertTx({ businessId: businessA, outletId: outletA1, invoiceNo: 'LAP-X-0002', subtotal: 12000, total: 12000, method: 'qr', payStatus: 'paid' });
  await insertTx({ businessId: businessA, outletId: outletA1, invoiceNo: 'LAP-X-0003', subtotal: 13000, total: 13000, method: 'card', payStatus: 'paid' });
  await insertTx({ businessId: businessA, outletId: outletA1, invoiceNo: 'LAP-X-0004', status: 'voided', subtotal: 14000, total: 14000, method: 'cash', payStatus: 'paid', note: 'Dibatalkan pelanggan' });
  await insertTx({ businessId: businessA, outletId: outletA1, invoiceNo: 'LAP-X-0005', status: 'refunded', subtotal: 15000, total: 15000, method: 'wallet', payStatus: 'refunded' });
  await insertTx({ businessId: businessA, outletId: outletA1, invoiceNo: 'LAP-X-0006', subtotal: 6000, total: 6000, method: 'cash', payStatus: 'paid', note: '=cmd|/C calc!A0' });

  assert.strictEqual(login.status, 200, 'login kasir harus berhasil');
});

after(async () => {
  const ids = [ownerAId, ownerBId];
  await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [ids]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
});

test('Ekspor xlsx: 4 sheet + ringkasan konsisten dengan dashboard', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;

  // Ringkasan API = sumber "total pendapatan" di Excel.
  const sumRes = await ownerGet(tokenA, reports(businessA, `/summary?${wide}`));
  assert.strictEqual(sumRes.status, 200);
  const apiTotal = sumRes.body.summary.total; // dalam SEN

  const { wb } = await loadWorkbook(tokenA, reports(businessA, `/export?format=xlsx&${wide}`));

  const names = wb.worksheets.map((s) => s.name);
  assert.deepStrictEqual(names, [
    'Ringkasan',
    'Detail Transaksi',
    'Rekap Harian',
    'Rekap Metode Pembayaran',
  ]);

  const ring = wb.getWorksheet('Ringkasan');
  assert.strictEqual(cellByLabel(ring, 'Nama Bisnis'), 'Bisnis Xlsx A');
  assert.strictEqual(cellByLabel(ring, 'Jenis Usaha'), 'Restoran');
  assert.strictEqual(cellByLabel(ring, 'Jumlah transaksi tercatat'), 6);
  assert.strictEqual(cellByLabel(ring, 'Transaksi selesai'), 4);
  assert.strictEqual(cellByLabel(ring, 'Transaksi dibatalkan (void)'), 1);
  assert.strictEqual(cellByLabel(ring, 'Transaksi refund'), 1);
  // Total pendapatan = total transaksi selesai = konsisten dgn summary API.
  assert.strictEqual(
    cellByLabel(ring, 'Total pendapatan (transaksi selesai)') * 100,
    apiTotal,
    'total Excel harus sama dengan dashboard'
  );
  // Pemisahan pembayaran (hanya transaksi selesai): 4 lunas, pending/gagal = 0.
  assert.strictEqual(cellByLabel(ring, 'Pembayaran lunas'), 4);
  assert.strictEqual(cellByLabel(ring, 'Total pembayaran lunas'), 420);
  assert.strictEqual(cellByLabel(ring, 'Pembayaran pending'), 0);
  assert.strictEqual(cellByLabel(ring, 'Pembayaran gagal'), 0);

  // Detail: 6 baris data.
  const det = wb.getWorksheet('Detail Transaksi');
  assert.strictEqual(det.rowCount - 1, 6, 'detail harus berisi 6 transaksi');

  // Rekap harian: 1 hari (hari ini) dan omzet hanya transaksi selesai.
  const daily = wb.getWorksheet('Rekap Harian');
  assert.strictEqual(daily.rowCount - 1, 1);
  const dr = daily.getRow(2);
  assert.strictEqual(dr.getCell(2).value, 6, 'jumlah transaksi harian = 6');
  assert.strictEqual(dr.getCell(3).value, apiTotal / 100, 'omzet harian = total selesai');
  assert.strictEqual(dr.getCell(4).value, 140, 'void harian');
  assert.strictEqual(dr.getCell(5).value, 150, 'refund harian');

  // Rekap metode: tunai & QR & kartu masuk, total omzetnya sesuai.
  const met = wb.getWorksheet('Rekap Metode Pembayaran');
  const methodRows = {};
  for (let r = 2; r <= met.rowCount; r += 1) {
    methodRows[met.getCell(r, 1).value] = { count: met.getCell(r, 2).value, omzet: met.getCell(r, 3).value };
  }
  assert.strictEqual(methodRows['Tunai'].count, 3); // 0001, 0004 (void), 0006
  assert.strictEqual(methodRows['Tunai'].omzet, 170);
  assert.strictEqual(methodRows['QRIS'].omzet, 120);
  assert.strictEqual(methodRows['Kartu'].omzet, 130);
  // Refund via wallet: tercatat 1 tapi tidak masuk omzet (bukan selesai).
  assert.strictEqual(methodRows['E-Wallet'].count, 1);
  assert.strictEqual(methodRows['E-Wallet'].omzet, 0);
});

test('Filter ekspor: status voided / metode QR / status pembayaran / pencarian', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;

  const byStatus = await loadWorkbook(tokenA, reports(businessA, `/export?format=xlsx&${wide}&status=voided`));
  assert.strictEqual(byStatus.wb.getWorksheet('Detail Transaksi').rowCount - 1, 1);

  const byQr = await loadWorkbook(tokenA, reports(businessA, `/export?format=xlsx&${wide}&paymentMethod=qr`));
  const qrDet = byQr.wb.getWorksheet('Detail Transaksi');
  assert.strictEqual(qrDet.rowCount - 1, 1);
  assert.strictEqual(qrDet.getRow(2).getCell(2).value, 'LAP-X-0002');

  const byPayStatus = await loadWorkbook(tokenA, reports(businessA, `/export?format=xlsx&${wide}&paymentStatus=refunded`));
  assert.strictEqual(byPayStatus.wb.getWorksheet('Detail Transaksi').rowCount - 1, 1);

  const nonePending = await loadWorkbook(tokenA, reports(businessA, `/export?format=xlsx&${wide}&paymentStatus=pending`));
  // Tidak ada data pending -> detail kosong tapi berkas tetap valid.
  assert.strictEqual(nonePending.wb.getWorksheet('Detail Transaksi').rowCount - 1, 0);

  const bySearch = await loadWorkbook(tokenA, reports(businessA, `/export?format=xlsx&${wide}&search=LAP-X-0003`));
  const det = bySearch.wb.getWorksheet('Detail Transaksi');
  assert.strictEqual(det.rowCount - 1, 1);
  assert.strictEqual(det.getRow(2).getCell(2).value, 'LAP-X-0003');
});

test('Tabel agregat & ekspor memakai filter yang sama (total konsisten)', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;

  const sumRes = await ownerGet(tokenA, reports(businessA, `/summary?${wide}&status=completed`));
  assert.strictEqual(sumRes.status, 200);
  const apiTotal = sumRes.body.summary.total;

  const { wb } = await loadWorkbook(
    tokenA,
    reports(businessA, `/export?format=xlsx&${wide}&status=completed`)
  );
  const ring = wb.getWorksheet('Ringkasan');
  assert.strictEqual(cellByLabel(ring, 'Jumlah transaksi tercatat'), 4);
  assert.strictEqual(cellByLabel(ring, 'Total pendapatan (transaksi selesai)') * 100, apiTotal);
});

test('Ekspor tanpa transaksi: berkas valid dengan 0 baris', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;
  const { wb } = await loadWorkbook(tokenB, reports(businessB, `/export?format=xlsx&${wide}`));
  const ring = wb.getWorksheet('Ringkasan');
  assert.strictEqual(cellByLabel(ring, 'Jumlah transaksi tercatat'), 0);
  assert.strictEqual(wb.getWorksheet('Detail Transaksi').rowCount - 1, 0);
  assert.strictEqual(wb.getWorksheet('Rekap Harian').rowCount - 1, 0);
});

test('Proteksi formula injection pada nilai teks', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;
  const { wb } = await loadWorkbook(tokenA, reports(businessA, `/export?format=xlsx&${wide}`));
  const det = wb.getWorksheet('Detail Transaksi');
  // Cari baris LAP-X-0006 pada kolom invoice (kolom 2) lalu cek catatan (kolom 16).
  let note = null;
  const col = det.getColumn(2);
  for (let r = 2; r <= det.rowCount; r += 1) {
    if (col.values[r] === 'LAP-X-0006') {
      note = det.getCell(r, 16).value;
      break;
    }
  }
  assert.ok(note !== null, 'catatan LAP-X-0006 harus ada');
  assert.strictEqual(typeof note, 'string', 'nilai harus berupa teks, bukan formula');
  assert.match(note, /^'=cmd/, 'nilai berbahaya harus dinetralkan dengan apostrof');
});

test('Akses: kasir ditolak, owner lain = 404 (anti-IDOR)', async () => {
  const today = await todayTz();
  const wide = `from=2000-01-01&to=${today}`;

  const asCashier = await request.binary(
    `/api/owner${reports(businessA, `/export?format=xlsx&${wide}`)}`,
    auth(cashierToken)
  );
  assert.strictEqual(asCashier.status, 403, 'kasir tidak boleh ekspor laporan owner');

  const asOtherOwner = await request.binary(
    `/api/owner${reports(businessA, `/export?format=xlsx&${wide}`)}`,
    auth(tokenB)
  );
  assert.strictEqual(asOtherOwner.status, 404, 'owner lain tidak boleh melihat bisnis asing');
});

test('Validasi: format tak dikenal & rentang tanggal terbalik = 422; CSV masih berfungsi', async () => {
  const today = await todayTz();

  const badFormat = await request.binary(
    `/api/owner${reports(businessA, '/export?format=docx')}`,
    auth(tokenA)
  );
  assert.strictEqual(badFormat.status, 422);

  const badRange = await request.binary(
    `/api/owner${reports(businessA, '/export?format=xlsx&from=2026-10-12&to=2026-10-01')}`,
    auth(tokenA)
  );
  assert.strictEqual(badRange.status, 422);

  const csv = await ownerGet(tokenA, reports(businessA, `/export?format=csv&from=${today}&to=${today}`));
  assert.strictEqual(csv.status, 200);
  assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(String(csv.body), /^invoice_no,status,outlet_name,/, 'CSV tetap berformat lama');
});