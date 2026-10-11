/**
 * Tes integrasi Fase 10b — PIN Login Kasir.
 *
 * Keputusan pemilik:
 *   - PIN 4 digit, opsional (password tetap ada); boleh sama antar kasir.
 *   - Alur: pilih kartu kasir (dari layar) -> verifikasi PIN.
 *   - Lockout: 5x salah -> kunci sementara 15 menit (429); 10x salah ->
 *     status 'locked' (403) hingga Owner membuka (endpoint unlock).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'PinKasirUji123!';
const OWNER_A_EMAIL = 'uji-pin-a@nova.test';
const OWNER_B_EMAIL = 'uji-pin-b@nova.test';

let ownerAId, ownerBId;
let tokenA, tokenB;
let businessA, outletA1, cashierA, cashierB;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));
const ownerDel = (token, path) => request.del(`/api/owner${path}`, auth(token));
const ownerPath = (biz, tail) => `/businesses/${biz}${tail}`;

const pinLogin = (cashierId, pin) =>
  request.post('/api/auth/cashier-pin', { cashierId, pin });

const emailLogin = (email, password) =>
  request.post('/api/auth/login', { role: 'cashier', email, password });

const cleanupOwner = async (email) => {
  const rows = (await query(`SELECT id FROM owners WHERE email = $1`, [email])).rows;
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
    'owner',
    ids,
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
};

// Refresh token kasir tidak punya FK ke cashiers -> bersihkan manual.
const cleanupCashiers = async () => {
  const cashierIds = [cashierA, cashierB].filter(Boolean);
  if (cashierIds.length) {
    await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
      'cashier',
      cashierIds,
    ]);
    await query('DELETE FROM cashiers WHERE id = ANY($1::uuid[])', [cashierIds]);
  }
};

before(async () => {
  await cleanupCashiers();
  await cleanupOwner(OWNER_A_EMAIL);
  await cleanupOwner(OWNER_B_EMAIL);

  // Owner A + bisnis A
  const ownerA = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner PIN A', 'active') RETURNING id`,
    [OWNER_A_EMAIL, await hashPassword(PASSWORD)]
  );
  ownerAId = ownerA.rows[0].id;
  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });

  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis PIN A' })).body.business.id;
  outletA1 = (await ownerPost(tokenA, ownerPath(businessA, '/outlets'), { name: 'Outlet PIN 1' }))
    .body.outlet.id;

  // Kasir A: dengan PIN 2468 (via API).
  cashierA = (
    await ownerPost(tokenA, ownerPath(businessA, '/cashiers'), {
      fullName: 'Kasir PIN',
      email: 'kpin-a@nova.test',
      password: PASSWORD,
      pin: '2468',
      outletId: outletA1,
    })
  ).body.cashier.id;

  // Kasir B: tanpa PIN. Plan default Gratis hanya 1 kasir, jadi dibuat
  // langsung ke DB (data setup; endpoint kuota tidak relevan di sini).
  const cashierBRow = await query(
    `INSERT INTO cashiers (outlet_id, email, password_hash, full_name, status, created_by)
     VALUES ($1, $2, $3, 'Kasir NoPIN', 'active', $4) RETURNING id`,
    [outletA1, 'kpin-b@nova.test', await hashPassword(PASSWORD), ownerAId]
  );
  cashierB = cashierBRow.rows[0].id;

  // Owner B + bisnis B (isolasi tenant)
  const ownerB = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner PIN B', 'active') RETURNING id`,
    [OWNER_B_EMAIL, await hashPassword(PASSWORD)]
  );
  ownerBId = ownerB.rows[0].id;
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });
  await ownerPost(tokenB, '/businesses', { name: 'Bisnis PIN B' });
});

after(async () => {
  await cleanupCashiers();
  await cleanupOwner(OWNER_A_EMAIL);
  await cleanupOwner(OWNER_B_EMAIL);
});

const resetPinState = async (cashierId) => {
  await query(
    `UPDATE cashiers SET pin_failed_attempts = 0, pin_locked_until = NULL, status = 'active'
      WHERE id = $1`,
    [cashierId]
  );
};

test('Layar pemilih PIN: kasir ber-PIN tampil, kasir tanpa PIN tidak', async () => {
  const list = await request.get(`/api/auth/cashiers?outletId=${outletA1}`);
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.items.some((i) => i.id === cashierA), 'kasir ber-PIN muncul');
  assert.ok(!list.body.items.some((i) => i.id === cashierB), 'kasir tanpa PIN tidak muncul');
  assert.ok(list.body.items.every((i) => !('email' in i)), 'respons hanya nama & id');
});

test('Lookup tanpa outletId ditolak (422)', async () => {
  const res = await request.get('/api/auth/cashiers');
  assert.strictEqual(res.status, 422);
});

test('Login PIN sukses: terbit sesi kasir + /me berjalan', async () => {
  const res = await pinLogin(cashierA, '2468');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.accessToken, 'access token diterbitkan');
  assert.strictEqual(res.body.user.role, 'cashier');
  assert.strictEqual(res.body.user.id, cashierA);

  const me = await request.get('/api/auth/me', auth(res.body.accessToken));
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.context.outlet.id, outletA1);
});

test('PIN salah: 5x percobaan -> kunci sementara 15 menit (429); PIN benar pun 429', async () => {
  await resetPinState(cashierA);
  for (let i = 1; i <= 4; i += 1) {
    const wrong = await pinLogin(cashierA, '9999');
    assert.strictEqual(wrong.status, 401, `percobaan salah #${i} -> 401`);
  }
  const fifth = await pinLogin(cashierA, '9999');
  assert.strictEqual(fifth.status, 429, 'percobaan salah ke-5 -> kunci sementara');
  assert.strictEqual(fifth.body.error.details.retryAfterSeconds, 900);

  const correctLocked = await pinLogin(cashierA, '2468');
  assert.strictEqual(correctLocked.status, 429, 'PIN benar pun ditolak selama kunci');
});

test('10x salah -> status locked (403); email/password ikut terblokir; unlock Owner memulihkan', async () => {
  // Simulasikan kunci 15 menit yang sudah berlalu, lalu lanjutkan kegagalan
  // sampai total 10 (di sini: counter langsung di-set 9, satu kegagalan lagi).
  await query(
    `UPDATE cashiers SET pin_failed_attempts = 9, pin_locked_until = NULL WHERE id = $1`,
    [cashierA]
  );
  const last = await pinLogin(cashierA, '0000');
  assert.strictEqual(last.status, 403, 'kegagalan ke-10 -> status locked');
  assert.match(last.body.error.message, /terkunci/i);

  const correct = await pinLogin(cashierA, '2468');
  assert.strictEqual(correct.status, 403, 'kasir locked tidak bisa login PIN');

  const email = await emailLogin('kpin-a@nova.test', PASSWORD);
  assert.strictEqual(email.status, 403, 'kasir locked tidak bisa login email/password');

  const unlock = await ownerPost(
    tokenA,
    ownerPath(businessA, `/cashiers/${cashierA}/pin/unlock`),
    {}
  );
  assert.strictEqual(unlock.status, 200);
  assert.strictEqual(unlock.body.cashier.status, 'active');

  const again = await pinLogin(cashierA, '2468');
  assert.strictEqual(again.status, 200, 'setelah unlock, PIN benar diterima');
});

test('Owner set/hapus PIN; kasir tanpa PIN ditolak seragam; format salah 422', async () => {
  // Kasir B baru dibuat tanpa PIN -> login PIN harus ditolak seragam (401).
  const before = await pinLogin(cashierB, '1234');
  assert.strictEqual(before.status, 401, 'kasir tanpa PIN ditolak seragam');

  // Owner pasang PIN.
  const set = await ownerPost(
    tokenA,
    ownerPath(businessA, `/cashiers/${cashierB}/pin`),
    { pin: '1234' }
  );
  assert.strictEqual(set.status, 200);
  const ok = await pinLogin(cashierB, '1234');
  assert.strictEqual(ok.status, 200, 'PIN baru langsung dipakai');

  // Hapus PIN -> kembali password-only.
  const removed = await ownerDel(tokenA, ownerPath(businessA, `/cashiers/${cashierB}/pin`));
  assert.strictEqual(removed.status, 200);
  const afterRemove = await pinLogin(cashierB, '1234');
  assert.strictEqual(afterRemove.status, 401, 'PIN terhapus -> ditolak lagi');

  // Format PIN bukan 4 digit -> 422.
  const bad = await pinLogin(cashierB, '12ab');
  assert.strictEqual(bad.status, 422);
  const badLen = await pinLogin(cashierB, '12345');
  assert.strictEqual(badLen.status, 422);
});

test('Isolasi tenant: Owner bisnis lain tidak bisa mengelola PIN kasir bisnis A (404)', async () => {
  const set = await ownerPost(tokenB, ownerPath(businessA, `/cashiers/${cashierA}/pin`), {
    pin: '1111',
  });
  assert.strictEqual(set.status, 404, 'set PIN lintas bisnis -> 404');

  const del = await ownerDel(tokenB, ownerPath(businessA, `/cashiers/${cashierA}/pin`));
  assert.strictEqual(del.status, 404, 'hapus PIN lintas bisnis -> 404');

  const unlock = await ownerPost(
    tokenB,
    ownerPath(businessA, `/cashiers/${cashierA}/pin/unlock`),
    {}
  );
  assert.strictEqual(unlock.status, 404, 'unlock lintas bisnis -> 404');
});