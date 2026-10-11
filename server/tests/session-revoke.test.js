/**
 * Tes integrasi Fase 11 — Manajemen Sesi (pencabutan paksa kasir).
 *
 * - Admin  : daftar kasir + jumlah sesi; paksa logout kasir mana pun.
 * - Owner  : daftar sesi kasirnya; paksa logout kasirnya (404 utk bisnis lain).
 * - Efek   : refresh token lama ditolak /refresh (401) — berlaku di server.
 *   Access token JWT (15 mnt) tetap hidup sampai kedaluwarsa (tanpa blacklist).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'SesiUji123!';
const ADMIN_EMAIL = 'uji-sesi-admin@nova.test';
const OWNER_A_EMAIL = 'uji-sesi-a@nova.test';
const OWNER_B_EMAIL = 'uji-sesi-b@nova.test';

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const ownerPost = (token, path, body) => request.post(`/api/owner${path}`, body, auth(token));

let adminId, ownerAId, ownerBId;
let adminToken, tokenA, tokenB;
let businessA, cashierA;
let refresh1, refresh2, access1;

const cleanup = async () => {
  for (const email of [OWNER_A_EMAIL, OWNER_B_EMAIL]) {
    const rows = (await query(`SELECT id FROM owners WHERE email = $1`, [email])).rows;
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', ['owner', ids]);
      await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
      await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
    }
  }
  const adm = (await query(`SELECT id FROM platform_admins WHERE email = $1`, [ADMIN_EMAIL])).rows;
  if (adm.length) {
    await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [adm.map((r) => r.id)]);
    await query('DELETE FROM platform_admins WHERE id = ANY($1::uuid[])', [adm.map((r) => r.id)]);
  }
};

before(async () => {
  await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
    'cashier',
    [cashierA ?? '00000000-0000-0000-0000-000000000000'],
  ]);
  await cleanup();

  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Admin Sesi', 'active') RETURNING id`,
    [ADMIN_EMAIL, await hashPassword(PASSWORD)]
  );
  adminId = admin.rows[0].id;
  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });

  const a = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner Sesi A', 'active') RETURNING id`,
    [OWNER_A_EMAIL, await hashPassword(PASSWORD)]
  );
  ownerAId = a.rows[0].id;
  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });

  const b = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Owner Sesi B', 'active') RETURNING id`,
    [OWNER_B_EMAIL, await hashPassword(PASSWORD)]
  );
  ownerBId = b.rows[0].id;
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });
  await ownerPost(tokenB, '/businesses', { name: 'Bisnis Sesi B' });

  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis Sesi A' })).body.business.id;
  const outletA = (await ownerPost(tokenA, `/businesses/${businessA}/outlets`, { name: 'Outlet Sesi 1' }))
    .body.outlet.id;
  cashierA = (
    await ownerPost(tokenA, `/businesses/${businessA}/cashiers`, {
      fullName: 'Kasir Sesi',
      email: 'k-sesi@nova.test',
      password: PASSWORD,
      outletId: outletA,
    })
  ).body.cashier.id;
  await ownerPost(tokenA, `/businesses/${businessA}/cashiers/${cashierA}/pin`, { pin: '2468' });

  // Dua sesi kasir: email/password + PIN.
  const emailLogin = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'k-sesi@nova.test',
    password: PASSWORD,
  });
  refresh1 = emailLogin.body.refreshToken;
  access1 = emailLogin.body.accessToken;

  const pinLogin = await request.post('/api/auth/cashier-pin', { cashierId: cashierA, pin: '2468' });
  refresh2 = pinLogin.body.refreshToken;
});

after(async () => {
  if (cashierA) {
    await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', ['cashier', [cashierA]]);
  }
  await cleanup();
});

test('Admin melihat daftar kasir dengan jumlah sesi aktif', async () => {
  const res = await request.get('/api/platform/sessions', auth(adminToken));
  assert.strictEqual(res.status, 200);
  const row = res.body.items.find((i) => i.id === cashierA);
  assert.ok(row, 'kasir muncul di daftar');
  assert.strictEqual(row.business_name, 'Bisnis Sesi A');
  assert.ok(row.active_count >= 2, `active_count >= 2, dapat ${row.active_count}`);
});

test('Owner melihat sesi kasirnya (terbaru dahulu, ada metadata)', async () => {
  const res = await request.get(
    `/api/owner/businesses/${businessA}/cashiers/${cashierA}/sessions`,
    auth(tokenA)
  );
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.items.length >= 2);
  assert.ok(res.body.items[0].created_at >= res.body.items[1].created_at, 'terurut terbaru dahulu');
  assert.ok(res.body.items.every((s) => s.revoked_at === null), 'belum ada yang dicabut');
  assert.ok(res.body.items.some((s) => s.user_agent !== null || s.ip !== null), 'ada metadata ip/ua');
});

test('Owner paksa logout: refresh token lama ditolak + audit tercatat', async () => {
  const revoke = await request.post(
    `/api/owner/businesses/${businessA}/cashiers/${cashierA}/sessions/revoke`,
    {},
    auth(tokenA)
  );
  assert.strictEqual(revoke.status, 200);
  assert.ok(revoke.body.revoked >= 2, `revoked >= 2, dapat ${revoke.body.revoked}`);

  // Token lama tidak lagi bisa refresh.
  const badRefresh = await request.post('/api/auth/refresh', { refreshToken: refresh1 });
  assert.strictEqual(badRefresh.status, 401, 'refresh token lama ditolak setelah revoke');

  // Access token JWT masih hidup sampai kedaluwarsa (tanpa blacklist).
  const me = await request.get('/api/auth/me', auth(access1));
  assert.strictEqual(me.status, 200);

  // Jejak audit tercatat dengan business_id yang benar.
  const audit = await query(
    `SELECT 1 FROM audit_logs
      WHERE action = 'session.revoke_all' AND business_id = $1 AND entity_id = $2
      LIMIT 1`,
    [businessA, cashierA]
  );
  assert.ok(audit.rows.length === 1, 'audit session.revoke_all tercatat');

  // Login baru tetap diperbolehkan (bukan blokir akun).
  const fresh = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'k-sesi@nova.test',
    password: PASSWORD,
  });
  assert.strictEqual(fresh.status, 200, 'log in baru tetap bisa setelah revoke');
});

test('Owner bisnis lain tidak bisa buka sesi kasir bisnis A (404)', async () => {
  const list = await request.get(
    `/api/owner/businesses/${businessA}/cashiers/${cashierA}/sessions`,
    auth(tokenB)
  );
  assert.strictEqual(list.status, 404);

  const revoke = await request.post(
    `/api/owner/businesses/${businessA}/cashiers/${cashierA}/sessions/revoke`,
    {},
    auth(tokenB)
  );
  assert.strictEqual(revoke.status, 404);
});

test('Admin paksa logout kasir mana pun + kasir tidak ada -> 404', async () => {
  const emailLogin = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'k-sesi@nova.test',
    password: PASSWORD,
  });
  const before = await request.get('/api/platform/sessions', auth(adminToken));
  const activeBefore = before.body.items.find((i) => i.id === cashierA).active_count;
  assert.ok(activeBefore >= 1);

  const revoke = await request.post(
    `/api/platform/sessions/${cashierA}/revoke`,
    {},
    auth(adminToken)
  );
  assert.strictEqual(revoke.status, 200);
  assert.ok(revoke.body.revoked >= 1);

  const notFound = await request.post(
    '/api/platform/sessions/00000000-0000-0000-0000-000000000000/revoke',
    {},
    auth(adminToken)
  );
  assert.strictEqual(notFound.status, 404);
});

test('Kasir tidak bisa akses manajemen sesi (403)', async () => {
  const cashierToken = signAccessToken({ userId: cashierA, role: 'cashier' });
  const adminList = await request.get('/api/platform/sessions', auth(cashierToken));
  assert.strictEqual(adminList.status, 403);

  const ownerList = await request.get(
    `/api/owner/businesses/${businessA}/cashiers/${cashierA}/sessions`,
    auth(cashierToken)
  );
  assert.strictEqual(ownerList.status, 403);
});