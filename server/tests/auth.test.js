/**
 * Tes integrasi modul auth (Fase 1).
 *
 * Membuat pengguna uji sementara di DB, lalu menguji:
 *   - login tiap peran (sukses & gagal)
 *   - anti-enumerasi akun (pesan error seragam)
 *   - validasi input (422)
 *   - akses /me dengan & tanpa token
 *   - rotasi refresh token (sekali pakai)
 *   - logout mencabut sesi
 *
 * Semua data uji dibersihkan di akhir. Dijalankan: npm run test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';

const PASSWORD = 'RahasiaUji123!';
const ADMIN = { role: 'platform_admin', email: 'uji-admin@nova.test', name: 'Admin Uji' };
const OWNER = { role: 'owner', email: 'uji-owner@nova.test', name: 'Owner Uji' };

let adminId;
let ownerId;
let adminSession;
let ownerSession;

before(async () => {
  const adminRes = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [ADMIN.email, await hashPassword(PASSWORD), ADMIN.name]
  );
  adminId = adminRes.rows[0].id;

  const ownerRes = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [OWNER.email, await hashPassword(PASSWORD), OWNER.name]
  );
  ownerId = ownerRes.rows[0].id;
});

after(async () => {
  await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [
    [adminId, ownerId],
  ]);
  await query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
  await query('DELETE FROM owners WHERE id = $1', [ownerId]);
});

// --- Login sukses ---------------------------------------------------------

test('login admin platform berhasil & mengembalikan token', async () => {
  const res = await request.post('/api/auth/login', {
    role: 'platform_admin',
    email: ADMIN.email,
    password: PASSWORD,
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.accessToken, 'harus ada accessToken');
  assert.match(res.body.refreshToken, /^[a-f0-9]{96}$/);
  assert.strictEqual(res.body.user.role, 'platform_admin');
  assert.strictEqual(res.body.user.email, ADMIN.email);
  assert.strictEqual(res.body.user.password_hash, undefined, 'jangan bocorkan hash');
  adminSession = res.body;
});

test('login owner berhasil', async () => {
  const res = await request.post('/api/auth/login', {
    role: 'owner',
    email: OWNER.email,
    password: PASSWORD,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.role, 'owner');
  assert.strictEqual(res.body.user.fullName, OWNER.name);
  ownerSession = res.body;
});

// --- Login gagal ----------------------------------------------------------

test('login dengan password salah ditolak (401)', async () => {
  const res = await request.post('/api/auth/login', {
    role: 'owner',
    email: OWNER.email,
    password: 'PasswordSalah1',
  });
  assert.strictEqual(res.status, 401);
});

test('login email tak terdaftar memakai pesan sama (anti-enumerasi)', async () => {
  const res = await request.post('/api/auth/login', {
    role: 'owner',
    email: 'tidak-ada@nova.test',
    password: PASSWORD,
  });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.message, 'Email atau password salah');
});

test('login peran kasir aktif sejak Fase 5: kredensial tak dikenal = 401', async () => {
  const res = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'kasir@nova.test',
    password: PASSWORD,
  });
  assert.strictEqual(res.status, 401);
});

test('login password < 8 karakter ditolak validasi (422)', async () => {
  const res = await request.post('/api/auth/login', {
    role: 'owner',
    email: OWNER.email,
    password: 'pendek',
  });
  assert.strictEqual(res.status, 422);
});

test('login peran tak dikenal ditolak validasi (422)', async () => {
  const res = await request.post('/api/auth/login', {
    role: 'superuser',
    email: OWNER.email,
    password: PASSWORD,
  });
  assert.strictEqual(res.status, 422);
});

test('login akun nonaktif ditolak (403)', async () => {
  await query("UPDATE owners SET status = 'suspended' WHERE id = $1", [ownerId]);
  const res = await request.post('/api/auth/login', {
    role: 'owner',
    email: OWNER.email,
    password: PASSWORD,
  });
  assert.strictEqual(res.status, 403);
  await query("UPDATE owners SET status = 'active' WHERE id = $1", [ownerId]);
});

// --- /me ------------------------------------------------------------------

test('GET /me owner mengembalikan peran owner', async () => {
  const res = await request.get('/api/auth/me', {
    headers: { Authorization: `Bearer ${ownerSession.accessToken}` },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.role, 'owner');
  assert.strictEqual(res.body.user.email, OWNER.email);
});

test('GET /me admin mengembalikan peran platform_admin', async () => {
  const res = await request.get('/api/auth/me', {
    headers: { Authorization: `Bearer ${adminSession.accessToken}` },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.role, 'platform_admin');
});

test('GET /me tanpa token ditolak (401)', async () => {
  const res = await request.get('/api/auth/me');
  assert.strictEqual(res.status, 401);
});

// --- Refresh rotation -----------------------------------------------------

test('refresh memutar token; token lama langsung tidak berlaku', async () => {
  const oldRefresh = ownerSession.refreshToken;

  const res = await request.post('/api/auth/refresh', { refreshToken: oldRefresh });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.notStrictEqual(res.body.refreshToken, oldRefresh, 'token harus berganti');

  // Token lama tidak bisa dipakai lagi (rotasi sekali pakai)
  const reuse = await request.post('/api/auth/refresh', { refreshToken: oldRefresh });
  assert.strictEqual(reuse.status, 401);

  ownerSession = res.body;
});

test('refresh dengan token tak dikenal ditolak (401)', async () => {
  const res = await request.post('/api/auth/refresh', { refreshToken: 'a'.repeat(96) });
  assert.strictEqual(res.status, 401);
});

// --- Logout ---------------------------------------------------------------

test('logout mencabut sesi; refresh setelah logout ditolak (401)', async () => {
  const toRevoke = ownerSession.refreshToken;

  const out = await request.post(
    '/api/auth/logout',
    { refreshToken: toRevoke },
    { headers: { Authorization: `Bearer ${ownerSession.accessToken}` } }
  );
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.body.revoked, true);

  const afterLogout = await request.post('/api/auth/refresh', { refreshToken: toRevoke });
  assert.strictEqual(afterLogout.status, 401);
});

test('logout tanpa access token ditolak (401)', async () => {
  const res = await request.post('/api/auth/logout', {
    refreshToken: ownerSession.refreshToken,
  });
  assert.strictEqual(res.status, 401);
});
