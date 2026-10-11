/**
 * Tes integrasi modul platform-admin (Fase 2).
 *
 * Membuat admin & owner uji sementara, lalu menguji CRUD owner, suspend,
 * reset password, soft delete, isolasi peran, dan pencatatan audit log.
 * Dijalankan: npm run test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'RahasiaUji123!';
const NEW_PASSWORD = 'PasswordBaru456!';
const ADMIN = { email: 'uji-padmin@nova.test', name: 'Admin Uji' };
const OWNER = { email: 'uji-owner-padmin@nova.test', name: 'Owner Uji' };
const CREATED = { email: 'owner-baru@nova.test', password: 'OwnerBaru123!', name: 'Owner Baru' };

let adminId;
let ownerId;
let createdOwnerId;
let createdOwnerSession;
let adminToken;
let ownerToken;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

const loginCreatedOwner = (password) =>
  request.post('/api/auth/login', { role: 'owner', email: CREATED.email, password });

before(async () => {
  const a = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [ADMIN.email, await hashPassword(PASSWORD), ADMIN.name]
  );
  adminId = a.rows[0].id;

  const o = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [OWNER.email, await hashPassword(PASSWORD), OWNER.name]
  );
  ownerId = o.rows[0].id;

  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });
  ownerToken = signAccessToken({ userId: ownerId, role: 'owner' });
});

after(async () => {
  const ownerIds = [ownerId, createdOwnerId].filter(Boolean);
  await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [ownerIds]);
  await query('DELETE FROM audit_logs WHERE actor_id = $1', [adminId]);
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ownerIds]);
  await query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
});

// --- Otorisasi ------------------------------------------------------------

test('GET owners tanpa token ditolak (401)', async () => {
  const res = await request.get('/api/platform/owners');
  assert.strictEqual(res.status, 401);
});

test('GET owners dengan token owner ditolak (403)', async () => {
  const res = await request.get('/api/platform/owners', auth(ownerToken));
  assert.strictEqual(res.status, 403);
});

test('Admin bisa melihat daftar owner (200)', async () => {
  const res = await request.get('/api/platform/owners', auth(adminToken));
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.items));
  assert.ok(res.body.total >= 1);
});

// --- Create ---------------------------------------------------------------

test('Admin bisa membuat owner baru (201)', async () => {
  const res = await request.post(
    '/api/platform/owners',
    {
      email: CREATED.email,
      password: CREATED.password,
      fullName: CREATED.name,
      phone: '+6281234567890',
    },
    auth(adminToken)
  );
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.owner.email, CREATED.email);
  assert.strictEqual(res.body.owner.status, 'active');
  assert.strictEqual(res.body.owner.password_hash, undefined, 'jangan bocorkan hash');
  createdOwnerId = res.body.owner.id;
});

test('Owner baru bisa login lewat modul auth (integrasi Fase 1↔2)', async () => {
  const res = await loginCreatedOwner(CREATED.password);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.role, 'owner');
  assert.ok(res.body.accessToken);
  createdOwnerSession = res.body;
});

test('Email duplikat (beda kapital) ditolak (409)', async () => {
  const res = await request.post(
    '/api/platform/owners',
    { email: CREATED.email.toUpperCase(), password: CREATED.password, fullName: 'Duplikat' },
    auth(adminToken)
  );
  assert.strictEqual(res.status, 409);
});

test('Validasi pembuatan owner gagal (422)', async () => {
  const badEmail = await request.post(
    '/api/platform/owners',
    { email: 'bukan-email', password: CREATED.password, fullName: 'Nama Panjang' },
    auth(adminToken)
  );
  assert.strictEqual(badEmail.status, 422);

  const shortPw = await request.post(
    '/api/platform/owners',
    { email: 'baru2@nova.test', password: 'pendek', fullName: 'Nama Panjang' },
    auth(adminToken)
  );
  assert.strictEqual(shortPw.status, 422);

  const shortName = await request.post(
    '/api/platform/owners',
    { email: 'baru3@nova.test', password: CREATED.password, fullName: 'X' },
    auth(adminToken)
  );
  assert.strictEqual(shortName.status, 422);
});

// --- Detail & update ------------------------------------------------------

test('Detail owner: tidak ditemukan (404) & id tidak valid (422)', async () => {
  const notFound = await request.get(
    '/api/platform/owners/00000000-0000-0000-0000-000000000000',
    auth(adminToken)
  );
  assert.strictEqual(notFound.status, 404);

  const badId = await request.get('/api/platform/owners/bukan-uuid', auth(adminToken));
  assert.strictEqual(badId.status, 422);
});

test('Admin bisa memperbarui data owner (200)', async () => {
  const res = await request.patch(
    `/api/platform/owners/${createdOwnerId}`,
    { fullName: 'Owner Baru Diubah', phone: '+62899000111' },
    auth(adminToken)
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.owner.full_name, 'Owner Baru Diubah');
  assert.strictEqual(res.body.owner.phone, '+62899000111');
});

test('Update tanpa field ditolak (422)', async () => {
  const res = await request.patch(`/api/platform/owners/${createdOwnerId}`, {}, auth(adminToken));
  assert.strictEqual(res.status, 422);
});

// --- Suspend / aktivasi ---------------------------------------------------

test('Suspend owner: sesi dicabut & login ditolak (403)', async () => {
  const res = await request.patch(
    `/api/platform/owners/${createdOwnerId}/status`,
    { status: 'suspended' },
    auth(adminToken)
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.owner.status, 'suspended');

  // Sesi lama langsung tidak berlaku
  const reuse = await request.post('/api/auth/refresh', {
    refreshToken: createdOwnerSession.refreshToken,
  });
  assert.strictEqual(reuse.status, 401, 'refresh token lama harus dicabut');

  const login = await loginCreatedOwner(CREATED.password);
  assert.strictEqual(login.status, 403);
});

test('Aktivasi kembali: login berhasil lagi (200)', async () => {
  const res = await request.patch(
    `/api/platform/owners/${createdOwnerId}/status`,
    { status: 'active' },
    auth(adminToken)
  );
  assert.strictEqual(res.status, 200);

  const login = await loginCreatedOwner(CREATED.password);
  assert.strictEqual(login.status, 200);
});

// --- Reset password -------------------------------------------------------

test('Reset password: password lama gagal, password baru berhasil', async () => {
  const reset = await request.post(
    `/api/platform/owners/${createdOwnerId}/password`,
    { newPassword: NEW_PASSWORD },
    auth(adminToken)
  );
  assert.strictEqual(reset.status, 200);

  const oldPw = await loginCreatedOwner(CREATED.password);
  assert.strictEqual(oldPw.status, 401, 'password lama harus gagal');

  const newPw = await loginCreatedOwner(NEW_PASSWORD);
  assert.strictEqual(newPw.status, 200, 'password baru harus berhasil');
});

// --- Soft delete ----------------------------------------------------------

test('Soft delete: hilang dari daftar, detail 404, login 403', async () => {
  const del = await request.del(`/api/platform/owners/${createdOwnerId}`, auth(adminToken));
  assert.strictEqual(del.status, 200);

  const list = await request.get(
    `/api/platform/owners?search=${encodeURIComponent(CREATED.email)}`,
    auth(adminToken)
  );
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.total, 0, 'owner terhapus tidak boleh muncul');

  const detail = await request.get(`/api/platform/owners/${createdOwnerId}`, auth(adminToken));
  assert.strictEqual(detail.status, 404);

  const login = await loginCreatedOwner(NEW_PASSWORD);
  assert.strictEqual(login.status, 403);
});

// --- Audit log ------------------------------------------------------------

test('Audit log mencatat seluruh aksi admin terhadap owner', async () => {
  const { rows } = await query(
    `SELECT action FROM audit_logs WHERE actor_id = $1 ORDER BY created_at`,
    [adminId]
  );
  const actions = rows.map((r) => r.action);
  for (const expected of [
    'owner.create',
    'owner.update',
    'owner.status_change',
    'owner.reset_password',
    'owner.delete',
  ]) {
    assert.ok(actions.includes(expected), `audit harus memuat ${expected}`);
  }
});
