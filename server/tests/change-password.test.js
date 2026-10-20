/**
 * Tes integrasi "Ganti Sandi Sendiri" (Keputusan #5).
 *
 * Cakupan:
 *   - berlaku untuk ketiga peran (platform_admin, owner, kasir);
 *   - sandi lama WAJIB benar (salah -> 400, sandi tidak berubah);
 *   - validasi sandi baru (minimal 8 karakter, beda dari sandi lama) -> 422;
 *   - tanpa access token -> 401;
 *   - sesi lain dicabut, sesi perangkat yang dipakai tetap berlaku;
 *   - perubahan dicatat di audit_logs tanpa menyimpan sandi.
 *
 * Catatan: jumlah login sengaja dijaga di bawah batas `loginLimiter`
 * (10/IP/15 menit); verifikasi sandi lama/baru memakai `verifyPassword`
 * langsung ke DB bila tidak perlu menguji alur login.
 *
 * Semua data uji dibersihkan di akhir. Dijalankan: npm run test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword, verifyPassword } from '../src/utils/hash.js';

const PASSWORD = 'SandiLamaUji123!';
const NEW_PASSWORD = 'SandiBaruUji456!';

const ADMIN = { email: 'uji-gs-admin@nova.test', name: 'Admin Ganti Sandi' };
const OWNER = { email: 'uji-gs-owner@nova.test', name: 'Owner Ganti Sandi' };
const CASHIER = { email: 'uji-gs-kasir@nova.test', name: 'Kasir Ganti Sandi' };

let adminId, ownerId, businessId, outletId, cashierId;
let adminSession;

const login = (role, email, password) =>
  request.post('/api/auth/login', { role, email, password });

const change = (token, body) =>
  request.post('/api/auth/change-password', body, {
    headers: { Authorization: `Bearer ${token}` },
  });

const storedHash = async (table, email) => {
  const { rows } = await query(
    `SELECT password_hash FROM ${table} WHERE lower(email) = lower($1) LIMIT 1`,
    [email]
  );
  return rows[0]?.password_hash ?? null;
};

before(async () => {
  const passwordHash = await hashPassword(PASSWORD);

  adminId = (
    await query(
      `INSERT INTO platform_admins (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [ADMIN.email, passwordHash, ADMIN.name]
    )
  ).rows[0].id;

  ownerId = (
    await query(
      `INSERT INTO owners (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [OWNER.email, passwordHash, OWNER.name]
    )
  ).rows[0].id;

  businessId = (
    await query(
      `INSERT INTO businesses (owner_id, name) VALUES ($1, $2) RETURNING id`,
      [ownerId, 'Bisnis Ganti Sandi']
    )
  ).rows[0].id;

  outletId = (
    await query(
      `INSERT INTO outlets (business_id, name) VALUES ($1, $2) RETURNING id`,
      [businessId, 'Outlet Ganti Sandi']
    )
  ).rows[0].id;

  cashierId = (
    await query(
      `INSERT INTO cashiers (outlet_id, email, password_hash, full_name, status, created_by)
       VALUES ($1, $2, $3, $4, 'active', $5) RETURNING id`,
      [outletId, CASHIER.email, passwordHash, CASHIER.name, ownerId]
    )
  ).rows[0].id;

  // Satu sesi admin dipakai bersama oleh beberapa tes (hemat rate limit login).
  const session = await login('platform_admin', ADMIN.email, PASSWORD);
  assert.strictEqual(session.status, 200);
  adminSession = session.body;
});

after(async () => {
  const owners = [ownerId].filter(Boolean);
  const cashiers = [cashierId].filter(Boolean);

  await query(`DELETE FROM refresh_tokens WHERE user_id = $1 AND user_role = 'platform_admin'`, [
    adminId,
  ]);
  await query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[]) AND user_role = 'owner'`, [
    owners,
  ]);
  await query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[]) AND user_role = 'cashier'`, [
    cashiers,
  ]);
  await query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])`, [
    [adminId, ...owners, ...cashiers],
  ]);
  await query(`DELETE FROM cashiers WHERE id = ANY($1::uuid[])`, [cashiers]);
  await query(`DELETE FROM outlets WHERE id = $1`, [outletId]);
  await query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
  await query(`DELETE FROM owners WHERE id = ANY($1::uuid[])`, [owners]);
  await query(`DELETE FROM platform_admins WHERE id = $1`, [adminId]);
});

test('ganti sandi tanpa access token ditolak 401', async () => {
  const res = await request.post('/api/auth/change-password', {
    currentPassword: PASSWORD,
    newPassword: NEW_PASSWORD,
  });
  assert.strictEqual(res.status, 401);
});

test('sandi saat ini salah -> 400 dan sandi lama tetap berlaku', async () => {
  const res = await change(adminSession.accessToken, {
    currentPassword: 'SandiSalahSekali123!',
    newPassword: NEW_PASSWORD,
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error.message, /sandi saat ini salah/i);

  const hash = await storedHash('platform_admins', ADMIN.email);
  assert.ok(await verifyPassword(PASSWORD, hash), 'sandi lama tidak boleh berubah');
});

test('sandi baru kurang dari 8 karakter & sama dengan sandi lama -> 422', async () => {
  const short = await change(adminSession.accessToken, {
    currentPassword: PASSWORD,
    newPassword: 'pendek',
  });
  assert.strictEqual(short.status, 422);

  const same = await change(adminSession.accessToken, {
    currentPassword: PASSWORD,
    newPassword: PASSWORD,
  });
  assert.strictEqual(same.status, 422);

  const hash = await storedHash('platform_admins', ADMIN.email);
  assert.ok(await verifyPassword(PASSWORD, hash), 'sandi tidak boleh berubah saat validasi gagal');
});

test('admin platform berhasil ganti sandi; sandi lama tidak berlaku', async () => {
  const res = await change(adminSession.accessToken, {
    currentPassword: PASSWORD,
    newPassword: NEW_PASSWORD,
    refreshToken: adminSession.refreshToken,
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.sessionsRevoked >= 0);

  const oldLogin = await login('platform_admin', ADMIN.email, PASSWORD);
  assert.strictEqual(oldLogin.status, 401);

  const newLogin = await login('platform_admin', ADMIN.email, NEW_PASSWORD);
  assert.strictEqual(newLogin.status, 200);
});

test('owner berhasil ganti sandi', async () => {
  const session = await login('owner', OWNER.email, PASSWORD);
  assert.strictEqual(session.status, 200);

  const res = await change(session.body.accessToken, {
    currentPassword: PASSWORD,
    newPassword: NEW_PASSWORD,
    refreshToken: session.body.refreshToken,
  });
  assert.strictEqual(res.status, 200);

  const oldHash = await storedHash('owners', OWNER.email);
  assert.strictEqual(await verifyPassword(PASSWORD, oldHash), false, 'sandi lama harus tidak valid');
  const newLogin = await login('owner', OWNER.email, NEW_PASSWORD);
  assert.strictEqual(newLogin.status, 200);
});

test('kasir berhasil ganti sandi', async () => {
  const session = await login('cashier', CASHIER.email, PASSWORD);
  assert.strictEqual(session.status, 200);

  const res = await change(session.body.accessToken, {
    currentPassword: PASSWORD,
    newPassword: NEW_PASSWORD,
    refreshToken: session.body.refreshToken,
  });
  assert.strictEqual(res.status, 200);

  const oldHash = await storedHash('cashiers', CASHIER.email);
  assert.strictEqual(await verifyPassword(PASSWORD, oldHash), false, 'sandi lama harus tidak valid');
  const newLogin = await login('cashier', CASHIER.email, NEW_PASSWORD);
  assert.strictEqual(newLogin.status, 200);
});

test('sesi lain dicabut, sesi perangkat ini tetap dapat refresh', async () => {
  // Dua sesi owner: A (dipakai ganti sandi) dan B (perangkat lain).
  const sessionA = await login('owner', OWNER.email, NEW_PASSWORD);
  const sessionB = await login('owner', OWNER.email, NEW_PASSWORD);
  assert.strictEqual(sessionA.status, 200);
  assert.strictEqual(sessionB.status, 200);

  const res = await change(sessionA.body.accessToken, {
    currentPassword: NEW_PASSWORD,
    newPassword: PASSWORD,
    refreshToken: sessionA.body.refreshToken,
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.sessionsRevoked >= 1, 'minimal sesi B dicabut');

  const refreshB = await request.post('/api/auth/refresh', {
    refreshToken: sessionB.body.refreshToken,
  });
  assert.strictEqual(refreshB.status, 401, 'sesi B harus dicabut');

  const refreshA = await request.post('/api/auth/refresh', {
    refreshToken: sessionA.body.refreshToken,
  });
  assert.strictEqual(refreshA.status, 200, 'sesi perangkat ini tetap berlaku');

  // Kembalikan sandi owner ke NEW_PASSWORD agar data akhir konsisten.
  const restore = await change(refreshA.body.accessToken, {
    currentPassword: PASSWORD,
    newPassword: NEW_PASSWORD,
    refreshToken: refreshA.body.refreshToken,
  });
  assert.strictEqual(restore.status, 200);
});

test('audit log mencatat perubahan sandi tanpa data sensitif', async () => {
  const { rows } = await query(
    `SELECT action, entity_type, before, after
       FROM audit_logs
      WHERE actor_role = 'platform_admin' AND actor_id = $1 AND action = 'auth.change_password'
      ORDER BY created_at DESC
      LIMIT 1`,
    [adminId]
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].entity_type, 'platform_admin');
  assert.strictEqual(rows[0].before, null);
  assert.strictEqual(rows[0].after, null);
});
