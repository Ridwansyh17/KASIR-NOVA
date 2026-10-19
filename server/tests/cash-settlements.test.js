/**
 * Tes integrasi Setoran Kasir berbasis periode (migrasi 0012).
 *
 * Fokus:
 *   - Perhitungan tunai/QRIS, pengeluaran kas & non-tunai.
 *   - Setoran tunai wajib, kekurangan kas (tidak negatif), selisih.
 *   - Setoran sesuai/kurang/lebih + kewajiban alasan selisih.
 *   - Pencegahan setoran duplikat & transaksi dihitung dua kali.
 *   - Void melepaskan transaksi agar bisa dikoreksi (snapshot tetap).
 *   - Isolasi outlet & tenant; laporan rekap; ekspor Excel; monitoring admin.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'Settle123!';
const TZ = 'Asia/Jakarta';
const OWNER_EMAIL = 'uji-settle@nova.test';
const OWNER2_EMAIL = 'uji-settle-lain@nova.test';
const ADMIN_EMAIL = 'uji-settle-admin@nova.test';

let ownerId;
let ownerToken;
let owner2Id;
let owner2Token;
let adminId;
let adminToken;
let biz;
let biz2;
let biz3;
let biz4;
let outletA;
let outletB;
let outletC;
let outletD;
let cashierId;
let cashierToken;

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ownerGet = (path, t = ownerToken) => request.get(`/api/owner${path}`, { headers: auth(t) });
const ownerPost = (path, data, t = ownerToken) =>
  request.post(`/api/owner${path}`, data, { headers: auth(t) });
const ownerDel = (path, t = ownerToken) => request.del(`/api/owner${path}`, { headers: auth(t) });
const cashierGet = (path) => request.get(`/api/cashier${path}`, { headers: auth(cashierToken) });
const cashierPost = (path, data) =>
  request.post(`/api/cashier${path}`, data, { headers: auth(cashierToken) });
const cashierPatch = (path, data) =>
  request.patch(`/api/cashier${path}`, data, { headers: auth(cashierToken) });
const bp = (b, s) => `/businesses/${b}${s}`;

let invoiceSeq = 0;
const addTx = async ({
  businessId = biz,
  outletId,
  method,
  amount,
  paid = amount,
  change = paid - amount,
  cashier = cashierId,
}) => {
  invoiceSeq += 1;
  const t = await query(
    `INSERT INTO transactions
       (business_id, outlet_id, cashier_id, invoice_no, status, total, paid_amount, change_amount)
     VALUES ($1,$2,$3,$4,'completed',$5,$6,$7) RETURNING id`,
    [businessId, outletId, cashier, `SETTLE-${Date.now()}-${invoiceSeq}`, amount, paid, change]
  );
  await query(
    `INSERT INTO payments (transaction_id, method, amount, status)
     VALUES ($1,$2,$3,'paid')`,
    [t.rows[0].id, method, paid]
  );
  return t.rows[0].id;
};

const addExpense = async ({ businessId = biz, outletId, method, amount, category = 'other' }) => {
  const spentOn = await today();
  const { rows } = await query(
    `INSERT INTO expenses
       (business_id, outlet_id, category, amount, method, status, spent_on,
        created_by_role, created_by_id)
     VALUES ($1,$2,$3,$4,$5,'recorded',$6,'owner',$7) RETURNING id`,
    [businessId, outletId, category, amount, method, spentOn, ownerId]
  );
  return rows[0].id;
};

const today = async () => {
  const { rows } = await query(`SELECT (now() AT TIME ZONE $1::text)::date::text AS d`, [TZ]);
  return rows[0].d;
};

const daysAgo = async (n) => {
  const { rows } = await query(
    `SELECT ((now() AT TIME ZONE $1::text)::date - $2::int)::text AS d`,
    [TZ, n]
  );
  return rows[0].d;
};

// Lepaskan baris penghubung lebih dulu (FK RESTRICT) agar bisnis bisa dihapus.
const cleanupBusinesses = async (bizIds) => {
  if (!bizIds.length) return;
  const ids = [bizIds];
  await query(
    `DELETE FROM cash_deposit_transactions
      WHERE deposit_id IN (SELECT id FROM cash_deposits WHERE business_id = ANY($1::uuid[]))`,
    ids
  );
  await query(
    `DELETE FROM cash_deposit_expenses
      WHERE deposit_id IN (SELECT id FROM cash_deposits WHERE business_id = ANY($1::uuid[]))`,
    ids
  );
  await query(`DELETE FROM cash_deposits WHERE business_id = ANY($1::uuid[])`, ids);
  await query(
    `DELETE FROM payments
      WHERE transaction_id IN (SELECT id FROM transactions WHERE business_id = ANY($1::uuid[]))`,
    ids
  );
  await query(`DELETE FROM transactions WHERE business_id = ANY($1::uuid[])`, ids);
  await query(`DELETE FROM expenses WHERE business_id = ANY($1::uuid[])`, ids);
};

before(async () => {
  const emails = [OWNER_EMAIL, OWNER2_EMAIL, ADMIN_EMAIL];
  const leftoverOwners = (
    await query(`SELECT id FROM owners WHERE email = ANY($1::text[])`, [[OWNER_EMAIL, OWNER2_EMAIL]])
  ).rows.map((r) => r.id);
  if (leftoverOwners.length) {
    const leftoverBiz = (
      await query(`SELECT id FROM businesses WHERE owner_id = ANY($1::uuid[])`, [leftoverOwners])
    ).rows.map((r) => r.id);
    await cleanupBusinesses(leftoverBiz);
    await query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [leftoverOwners]);
    await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [leftoverOwners]);
    await query(`DELETE FROM owners WHERE id = ANY($1::uuid[])`, [leftoverOwners]);
  }
  await query(`DELETE FROM platform_admins WHERE email = $1`, [ADMIN_EMAIL]);

  const hash = await hashPassword(PASSWORD);

  const o1 = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1,$2,'Owner Settle','active') RETURNING id`,
    [OWNER_EMAIL, hash]
  );
  ownerId = o1.rows[0].id;
  ownerToken = signAccessToken({ userId: ownerId, role: 'owner' });

  const o2 = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1,$2,'Owner Settle Lain','active') RETURNING id`,
    [OWNER2_EMAIL, hash]
  );
  owner2Id = o2.rows[0].id;
  owner2Token = signAccessToken({ userId: owner2Id, role: 'owner' });

  const a = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1,$2,'Admin Settle','active') RETURNING id`,
    [ADMIN_EMAIL, hash]
  );
  adminId = a.rows[0].id;
  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });

  biz = (await ownerPost('/businesses', { name: 'Bisnis Settle' })).body.business.id;
  outletA = (await ownerPost(bp(biz, '/outlets'), { name: 'Outlet Settle A' })).body.outlet.id;

  biz2 = (await ownerPost('/businesses', { name: 'Bisnis Settle 2' })).body.business.id;
  outletB = (await ownerPost(bp(biz2, '/outlets'), { name: 'Outlet Settle B' })).body.outlet.id;
  // Paket default membatasi 1 outlet per bisnis -> outlet kosong di bisnis
  // terpisah.
  biz3 = (await ownerPost('/businesses', { name: 'Bisnis Settle 3' })).body.business.id;
  outletC = (await ownerPost(bp(biz3, '/outlets'), { name: 'Outlet Settle C' })).body.outlet.id;
  // Bisnis khusus uji omzet tunai dengan kembalian.
  biz4 = (await ownerPost('/businesses', { name: 'Bisnis Settle 4' })).body.business.id;
  outletD = (await ownerPost(bp(biz4, '/outlets'), { name: 'Outlet Settle D' })).body.outlet.id;

  const ca = await ownerPost(bp(biz, '/cashiers'), {
    fullName: 'Kasir Settle',
    email: 'uji-settle-kasir@nova.test',
    password: PASSWORD,
    outletId: outletA,
  });
  cashierId = ca.body.cashier.id;
  cashierToken = (
    await request.post('/api/auth/login', {
      role: 'cashier',
      email: 'uji-settle-kasir@nova.test',
      password: PASSWORD,
    })
  ).body.accessToken;
});

after(async () => {
  const ownerIds = [ownerId, owner2Id];
  const bizIds = [biz, biz2, biz3, biz4].filter(Boolean);
  await cleanupBusinesses(bizIds);
  await query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [ownerIds]);
  await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [ownerIds]);
  await query(`DELETE FROM platform_admins WHERE id = $1`, [adminId]);
  await query(`DELETE FROM owners WHERE id = ANY($1::uuid[])`, [ownerIds]);
});

test('Setoran: pratinjau menghitung tunai, QRIS, pengeluaran kas & non-tunai', async () => {
  const day = await today();
  await addTx({ outletId: outletA, method: 'cash', amount: 85_000_000 }); // Rp850.000
  await addTx({ outletId: outletA, method: 'qr', amount: 45_000_000 }); // Rp450.000
  await addExpense({ outletId: outletA, method: 'cash', amount: 5_000_000 }); // Rp50.000
  await addExpense({ outletId: outletA, method: 'transfer', amount: 2_000_000 }); // non-tunai

  const res = await cashierGet(`/cash-deposits/settlement/preview?date=${day}&shift=full`);
  assert.strictEqual(res.status, 200);
  const t = res.body.totals;
  assert.strictEqual(t.cash_revenue, 85_000_000);
  assert.strictEqual(t.qris_revenue, 45_000_000);
  assert.strictEqual(t.total_revenue, 130_000_000);
  assert.strictEqual(t.cash_expense, 5_000_000);
  assert.strictEqual(t.noncash_expense, 2_000_000);
  assert.strictEqual(t.total_expense, 7_000_000);
  assert.strictEqual(t.required_cash, 80_000_000);
  assert.strictEqual(t.shortfall, 0);
  assert.strictEqual(res.body.overlap, null);
});

test('Setoran: simpan SELESAI sesuai (selisih 0) + nomor unik', async () => {
  const day = await today();
  const created = await cashierPost('/cash-deposits/settlement', {
    date: day,
    shift: 'full',
    actualCash: 80_000_000,
    note: 'Setoran sesuai',
  });
  assert.strictEqual(created.status, 201);
  const dep = created.body.deposit;
  assert.strictEqual(dep.status, 'completed');
  assert.strictEqual(Number(dep.required_cash), 80_000_000);
  assert.strictEqual(Number(dep.actual_cash), 80_000_000);
  assert.strictEqual(Number(dep.difference), 0);
  assert.match(dep.settlement_no, /^STR-\d{8}-\d{3}$/);
  assert.strictEqual(dep.shift_label, 'Sehari (00:00 - 24:00)');
});

test('Setoran: periode tumpang tindih & transaksi dihitung dua kali ditolak', async () => {
  const day = await today();
  const dupe = await cashierPost('/cash-deposits/settlement', {
    date: day,
    shift: 'full',
    actualCash: 80_000_000,
    note: 'Setoran sesuai',
  });
  assert.strictEqual(dupe.status, 409);
});

test('Setoran: selisih wajib beralasan', async () => {
  const day = await today();
  const dep = (
    await cashierGet('/cash-deposits?status=completed&limit=1')
  ).body.items[0];
  // Void dulu agar transaksi bisa dipakai lagi untuk koreksi.
  const voided = await ownerPost(bp(biz, `/cash-deposits/${dep.id}/void`), {
    reason: 'Koreksi uji',
  });
  assert.strictEqual(voided.status, 200);

  const noNote = await cashierPost('/cash-deposits/settlement', {
    date: day,
    shift: 'full',
    actualCash: 79_000_000,
  });
  assert.strictEqual(noNote.status, 422);

  const withNote = await cashierPost('/cash-deposits/settlement', {
    date: day,
    shift: 'full',
    actualCash: 79_000_000,
    note: 'Kurang Rp10.000 untuk parkir',
  });
  assert.strictEqual(withNote.status, 201);
  assert.strictEqual(Number(withNote.body.deposit.difference), -1_000_000);
  assert.strictEqual(Number(withNote.body.deposit.shortfall), 0);
});

test('Setoran: setelah void, snapshot lama tetap tersimpan (cetak ulang)', async () => {
  const list = await cashierGet('/cash-deposits?status=voided&limit=1');
  const voided = list.body.items[0];
  const detail = await cashierGet(`/cash-deposits/${voided.id}`);
  assert.strictEqual(detail.status, 200);
  assert.ok(detail.body.deposit.snapshot);
  assert.strictEqual(detail.body.deposit.status, 'voided');
  // Relasi snapshot transaksi tetap ada (kini non-aktif) untuk reprint.
  assert.ok(detail.body.transactions.length >= 2);
});

test('Setoran: pengeluaran kas melebihi pendapatan tunai -> kekurangan kas, wajib 0', async () => {
  const day = await today();
  await addTx({ businessId: biz2, outletId: outletB, method: 'cash', amount: 3_000_000, cashier: null });
  await addExpense({ businessId: biz2, outletId: outletB, method: 'cash', amount: 9_000_000 });

  const preview = await request.get(
    `/api/owner${bp(biz2, `/cash-deposits/settlement/preview?outletId=${outletB}&date=${day}&shift=full`)}`,
    { headers: auth(ownerToken) }
  );
  assert.strictEqual(preview.status, 200);
  assert.strictEqual(preview.body.totals.required_cash, 0);
  assert.strictEqual(preview.body.totals.shortfall, 6_000_000);

  const created = await ownerPost(bp(biz2, '/cash-deposits/settlement'), {
    outletId: outletB,
    date: day,
    shift: 'full',
    actualCash: 0,
    note: 'Kas kekurangan, tidak ada setoran tunai',
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(Number(created.body.deposit.amount), 0);
  assert.strictEqual(Number(created.body.deposit.shortfall), 6_000_000);
  assert.strictEqual(Number(created.body.deposit.difference), 0);
});

test('Setoran: tanpa transaksi sama sekali -> semua nol, aktual 0 sah', async () => {
  const day = await today();
  const created = await ownerPost(bp(biz3, '/cash-deposits/settlement'), {
    outletId: outletC,
    date: day,
    shift: 'full',
    actualCash: 0,
    note: 'Tidak ada transaksi',
  });
  assert.strictEqual(created.status, 201);
  const dep = created.body.deposit;
  assert.strictEqual(Number(dep.total_revenue), 0);
  assert.strictEqual(Number(dep.required_cash), 0);
  assert.strictEqual(Number(dep.difference), 0);
});

test('Setoran: omzet tunai memakai total bersih, bukan uang diterima (kembalian)', async () => {
  const day = await today();
  // Total Rp40.000 (4.000.000 sen) dibayar Rp100.000 (10.000.000 sen):
  // kas wajib harus Rp40.000, BUKAN Rp100.000.
  await addTx({
    businessId: biz4,
    outletId: outletD,
    method: 'cash',
    amount: 4_000_000,
    paid: 10_000_000,
    cashier: null,
  });

  const preview = await request.get(
    `/api/owner${bp(biz4, `/cash-deposits/settlement/preview?outletId=${outletD}&date=${day}&shift=full`)}`,
    { headers: auth(ownerToken) }
  );
  assert.strictEqual(preview.status, 200);
  assert.strictEqual(preview.body.totals.cash_revenue, 4_000_000);
  assert.strictEqual(preview.body.totals.total_revenue, 4_000_000);
  assert.strictEqual(preview.body.totals.required_cash, 4_000_000);

  const created = await ownerPost(bp(biz4, '/cash-deposits/settlement'), {
    outletId: outletD,
    date: day,
    shift: 'full',
    actualCash: 4_000_000,
    note: 'Sesuai omzet bersih',
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(Number(created.body.deposit.cash_revenue), 4_000_000);
  assert.strictEqual(Number(created.body.deposit.required_cash), 4_000_000);
});

test('Setoran: draft lalu diselesaikan', async () => {
  const day = await daysAgo(3);
  const draft = await cashierPost('/cash-deposits/settlement', {
    date: day,
    shift: 'pagi',
    saveAs: 'draft',
    note: 'Draft pagi',
  });
  assert.strictEqual(draft.status, 201);
  assert.strictEqual(draft.body.deposit.status, 'draft');
  assert.strictEqual(draft.body.deposit.actual_cash, null);

  const complete = await cashierPatch(`/cash-deposits/${draft.body.deposit.id}/complete`, {
    actualCash: 0,
    note: 'Setoran pagi kosong',
  });
  assert.strictEqual(complete.status, 200);
  assert.strictEqual(complete.body.deposit.status, 'completed');
  assert.strictEqual(Number(complete.body.deposit.actual_cash), 0);
});

test('Setoran: kasir hanya melihat setoran outletnya; owner lain 404', async () => {
  const list = await cashierGet('/cash-deposits?status=all');
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.items.every((d) => d.outlet_id === outletA));

  const other = await request.get(`/api/owner${bp(biz, '/cash-deposits')}`, {
    headers: auth(owner2Token),
  });
  assert.strictEqual(other.status, 404);
});

test('Setoran: rekap laporan per hari', async () => {
  const res = await ownerGet(bp(biz, '/cash-deposits/report?group=day'));
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.groups));
  assert.ok(res.body.totals.total_revenue >= 130_000_000);

  const weekly = await ownerGet(bp(biz, '/cash-deposits/report?group=week'));
  assert.strictEqual(weekly.status, 200);
  assert.strictEqual(weekly.body.group, 'week');
});

test('Setoran: ekspor Excel .xlsx', async () => {
  const res = await request.binary(`/api/owner${bp(biz, '/cash-deposits/export')}`, {
    headers: auth(ownerToken),
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.buffer.length > 500);
  assert.strictEqual(res.buffer.subarray(0, 2).toString('latin1'), 'PK');
});

test('Setoran: monitoring Platform Admin lintas bisnis', async () => {
  const res = await request.get('/api/platform/cash-settlements?limit=50', {
    headers: auth(adminToken),
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.total >= 2);
  assert.ok(res.body.items.some((d) => d.business_name === 'Bisnis Settle'));
});
