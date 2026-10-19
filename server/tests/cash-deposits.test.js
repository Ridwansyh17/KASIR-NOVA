/**
 * Tes integrasi modul Setoran Kas (migrasi 0011).
 *
 * Cakupan:
 *   - Kasir mencatat setoran untuk OUTLETNYA (outlet dari akun, bukan body).
 *   - Owner mencatat setoran untuk outlet mana pun di bisnisnya.
 *   - Daftar ter-scope tenant + filter (outlet, kasir, status, tanggal).
 *   - Koreksi lewat void (append-only); kasir hanya boleh void miliknya.
 *   - Validasi nominal, metode, tanggal masa depan.
 *   - Isolasi tenant: Owner lain mendapat 404; Kasir tidak boleh route Owner.
 *
 * Uang memakai satuan SEN (integer) seperti modul lain.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'CashDep123!';
const TZ = 'Asia/Jakarta';
const OWNER_EMAIL = 'uji-cashdep@nova.test';
const OWNER2_EMAIL = 'uji-cashdep-lain@nova.test';

let ownerId;
let ownerToken;
let owner2Id;
let owner2Token;
let biz;
let biz2;
let outletA;
let outletB;
let cashierId;
let cashierToken;

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ownerGet = (path, t = ownerToken) => request.get(`/api/owner${path}`, { headers: auth(t) });
const ownerPost = (path, data, t = ownerToken) =>
  request.post(`/api/owner${path}`, data, { headers: auth(t) });
const cashierGet = (path, t = cashierToken) =>
  request.get(`/api/cashier${path}`, { headers: auth(t) });
const cashierPost = (path, data, t = cashierToken) =>
  request.post(`/api/cashier${path}`, data, { headers: auth(t) });
const bp = (b, s) => `/businesses/${b}${s}`;

const today = async () => {
  const { rows } = await query(`SELECT (now() AT TIME ZONE $1::text)::date::text AS d`, [TZ]);
  return rows[0].d;
};

before(async () => {
  const emails = [OWNER_EMAIL, OWNER2_EMAIL];
  const leftover = (
    await query(`SELECT id FROM owners WHERE email = ANY($1::text[])`, [emails])
  ).rows.map((r) => r.id);
  if (leftover.length) {
    await query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [leftover]);
    await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [leftover]);
    await query(`DELETE FROM owners WHERE id = ANY($1::uuid[])`, [leftover]);
  }

  const hash = await hashPassword(PASSWORD);
  const o1 = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner CashDep', 'active') RETURNING id`,
    [OWNER_EMAIL, hash]
  );
  ownerId = o1.rows[0].id;
  ownerToken = signAccessToken({ userId: ownerId, role: 'owner' });

  const o2 = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner CashDep Lain', 'active') RETURNING id`,
    [OWNER2_EMAIL, hash]
  );
  owner2Id = o2.rows[0].id;
  owner2Token = signAccessToken({ userId: owner2Id, role: 'owner' });

  biz = (await ownerPost('/businesses', { name: 'Bisnis CashDep' })).body.business.id;
  outletA = (await ownerPost(bp(biz, '/outlets'), { name: 'Outlet CashDep A' })).body.outlet.id;

  // Bisnis kedua milik Owner yang sama (satu owner boleh banyak bisnis).
  // Paket default membatasi 1 outlet per bisnis, jadi outlet B ditaruh di sini.
  biz2 = (await ownerPost('/businesses', { name: 'Bisnis CashDep 2' })).body.business.id;
  outletB = (await ownerPost(bp(biz2, '/outlets'), { name: 'Outlet CashDep B' })).body.outlet.id;

  const ca = await ownerPost(bp(biz, '/cashiers'), {
    fullName: 'Kasir CashDep',
    email: 'uji-cashdep-kasir@nova.test',
    password: PASSWORD,
    outletId: outletA,
  });
  cashierId = ca.body.cashier.id;
  cashierToken = (
    await request.post('/api/auth/login', {
      role: 'cashier',
      email: 'uji-cashdep-kasir@nova.test',
      password: PASSWORD,
    })
  ).body.accessToken;
});

after(async () => {
  const ids = [ownerId, owner2Id, cashierId];
  await query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [ids]);
  await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [[ownerId, owner2Id]]);
  await query(`DELETE FROM owners WHERE id = ANY($1::uuid[])`, [[ownerId, owner2Id]]);
});

test('Setoran: kasir mencatat untuk outletnya; outlet dari body diabaikan', async () => {
  const d = await today();
  const created = await cashierPost('/cash-deposits', {
    amount: 125000,
    method: 'cash',
    note: 'Setoran pagi',
    date: d,
    // Upaya IDOR: outlet lain di body harus diabaikan (pakai scope akun).
    outletId: outletB,
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.deposit.outlet_id, outletA);
  assert.strictEqual(created.body.deposit.cashier_id, cashierId);
  assert.strictEqual(created.body.deposit.status, 'recorded');
  assert.strictEqual(Number(created.body.deposit.amount), 125000);
  assert.strictEqual(created.body.deposit.outlet_name, 'Outlet CashDep A');
});

test('Setoran: Owner wajib memilih outlet; bisa mencatat atas nama outlet', async () => {
  const d = await today();

  const missing = await ownerPost(bp(biz, '/cash-deposits'), { amount: 5000 });
  assert.strictEqual(missing.status, 422);

  const created = await ownerPost(bp(biz2, '/cash-deposits'), {
    outletId: outletB,
    amount: 200000,
    method: 'cash',
    note: 'Setoran outlet B',
    date: d,
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.deposit.outlet_id, outletB);
  assert.strictEqual(created.body.deposit.cashier_id, null);
});

test('Setoran: daftar Owner mencakup semua outlet + total recorded', async () => {
  const d = await today();
  const list = await ownerGet(bp(biz, `/cash-deposits?from=${d}&to=${d}`));
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.total, 1);
  assert.strictEqual(list.body.totals.recorded_total, 125000);
  assert.strictEqual(list.body.totals.voided_total, 0);
  assert.ok(list.body.items.every((x) => x.status === 'recorded'));
  assert.ok(list.body.items.every((x) => x.outlet_id === outletA));

  // Bisnis kedua berisi setoran outlet B (isolasi per bisnis).
  const listB = await ownerGet(bp(biz2, `/cash-deposits?outletId=${outletB}`));
  assert.strictEqual(listB.status, 200);
  assert.strictEqual(listB.body.total, 1);
  assert.strictEqual(listB.body.totals.recorded_total, 200000);
  assert.ok(listB.body.items.every((x) => x.outlet_id === outletB));
});

test('Setoran: daftar Kasir hanya outletnya (setoran Owner di outlet lain tidak terlihat)', async () => {
  const list = await cashierGet('/cash-deposits');
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.items.length >= 1);
  assert.ok(list.body.items.every((x) => x.outlet_id === outletA));
  assert.ok(!list.body.items.some((x) => x.outlet_id === outletB));
});

test('Setoran: validasi nominal, metode, dan tanggal masa depan', async () => {
  const badAmount = await cashierPost('/cash-deposits', { amount: 0, method: 'cash' });
  assert.strictEqual(badAmount.status, 422);

  const badMethod = await cashierPost('/cash-deposits', { amount: 1000, method: 'transfer' });
  assert.strictEqual(badMethod.status, 422);

  const future = await cashierPost('/cash-deposits', {
    amount: 1000,
    method: 'cash',
    date: '2999-12-31',
  });
  assert.strictEqual(future.status, 409);
});

test('Setoran: void append-only; kasir hanya boleh void miliknya', async () => {
  const d = await today();
  const own = (
    await cashierPost('/cash-deposits', { amount: 7000, method: 'cash', date: d })
  ).body.deposit;

  const voided = await cashierPost(`/cash-deposits/${own.id}/void`, { reason: 'Salah hitung' });
  assert.strictEqual(voided.status, 200);
  assert.strictEqual(voided.body.deposit.status, 'voided');

  const again = await cashierPost(`/cash-deposits/${own.id}/void`, { reason: 'Ulangi' });
  assert.strictEqual(again.status, 409);

  // Setoran milik Owner tidak boleh di-void kasir.
  const ownerDep = (
    await ownerPost(bp(biz, '/cash-deposits'), {
      outletId: outletA,
      amount: 9000,
      method: 'cash',
      date: d,
    })
  ).body.deposit;
  const forbidden = await cashierPost(`/cash-deposits/${ownerDep.id}/void`, { reason: 'Coba' });
  assert.strictEqual(forbidden.status, 403);

  // Baris tidak pernah dihapus.
  const { rows } = await query(`SELECT status FROM cash_deposits WHERE id = $1`, [own.id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'voided');

  // Owner boleh void setoran buatan siapa pun.
  const byOwner = await ownerPost(bp(biz, `/cash-deposits/${ownerDep.id}/void`), {
    reason: 'Koreksi owner',
  });
  assert.strictEqual(byOwner.status, 200);
  assert.strictEqual(byOwner.body.deposit.status, 'voided');
});

test('Setoran: isolasi tenant & peran', async () => {
  // Owner lain tidak boleh melihat bisnis ini (404, bukan 403).
  const other = await ownerGet(bp(biz, '/cash-deposits'), owner2Token);
  assert.strictEqual(other.status, 404);

  // Kasir tidak boleh memakai route Owner.
  const cashierOnOwnerRoute = await request.get(`/api/owner${bp(biz, '/cash-deposits')}`, {
    headers: auth(cashierToken),
  });
  assert.strictEqual(cashierOnOwnerRoute.status, 403);

  // Tanpa sesi -> 401.
  const anon = await request.get(`/api/cashier/cash-deposits`);
  assert.strictEqual(anon.status, 401);
});
