/**
 * Tes integrasi modul owner + isolasi tenant (Fase 3).
 *
 * Fokus: owner dapat membuat >1 bisnis, hanya melihat bisnisnya sendiri, dan
 * TIDAK bisa mengakses/mengubah bisnis owner lain (uji negatif / anti-IDOR).
 * Dijalankan: npm run test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'RahasiaUji123!';

let adminId;
let ownerAId;
let ownerBId;
let tokenA;
let tokenB;
let adminToken;
let businessA1;
let businessA2;
let businessB;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

const createBusiness = (token, body) => request.post('/api/owner/businesses', body, auth(token));

before(async () => {
  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ('uji-owner-admin@nova.test', $1, 'Admin Uji', 'active') RETURNING id`,
    [await hashPassword(PASSWORD)]
  );
  adminId = admin.rows[0].id;

  const a = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ('uji-ownera@nova.test', $1, 'Owner A', 'active') RETURNING id`,
    [await hashPassword(PASSWORD)]
  );
  ownerAId = a.rows[0].id;

  const b = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ('uji-ownerb@nova.test', $1, 'Owner B', 'active') RETURNING id`,
    [await hashPassword(PASSWORD)]
  );
  ownerBId = b.rows[0].id;

  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });
  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });
});

after(async () => {
  await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [
    [ownerAId, ownerBId],
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
    [ownerAId, ownerBId],
  ]);
  // businesses ikut terhapus via ON DELETE CASCADE saat owners dihapus
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [[ownerAId, ownerBId]]);
  await query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
});

// --- Otorisasi ------------------------------------------------------------

test('Tanpa token: /api/owner/businesses ditolak (401)', async () => {
  const res = await request.get('/api/owner/businesses');
  assert.strictEqual(res.status, 401);
});

test('Token admin: /api/owner/businesses ditolak (403)', async () => {
  const res = await request.get('/api/owner/businesses', auth(adminToken));
  assert.strictEqual(res.status, 403);
});

// --- Buat & daftar --------------------------------------------------------

test('Owner A bisa membuat bisnis (default IDR / Asia/Jakarta)', async () => {
  const res = await createBusiness(tokenA, { name: 'Warung A Satu', businessType: 'F&B' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.business.currency, 'IDR');
  assert.strictEqual(res.body.business.timezone, 'Asia/Jakarta');
  assert.strictEqual(res.body.business.status, 'active');
  assert.strictEqual(res.body.business.owner_id, ownerAId);
  businessA1 = res.body.business.id;
});

test('Owner A bisa memiliki >= 2 bisnis', async () => {
  const res = await createBusiness(tokenA, { name: 'Toko A Dua', businessType: 'retail' });
  assert.strictEqual(res.status, 201);
  businessA2 = res.body.business.id;

  const list = await request.get('/api/owner/businesses', auth(tokenA));
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.total, 2, 'owner A harus punya 2 bisnis');
});

test('Owner B membuat bisnisnya sendiri', async () => {
  const res = await createBusiness(tokenB, { name: 'Bisnis B', businessType: 'jasa' });
  assert.strictEqual(res.status, 201);
  businessB = res.body.business.id;

  const list = await request.get('/api/owner/businesses', auth(tokenB));
  assert.strictEqual(list.body.total, 1);
});

test('Owner A melihat detail bisnisnya sendiri (200)', async () => {
  const res = await request.get(`/api/owner/businesses/${businessA1}`, auth(tokenA));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.business.id, businessA1);
});

// --- Uji negatif isolasi tenant (anti-IDOR) -------------------------------

test('Owner A TIDAK bisa melihat bisnis Owner B (404)', async () => {
  const res = await request.get(`/api/owner/businesses/${businessB}`, auth(tokenA));
  assert.strictEqual(res.status, 404, 'harus 404 agar keberadaan data tenant lain tidak bocor');
});

test('Owner A TIDAK bisa mengubah bisnis Owner B (404)', async () => {
  const res = await request.patch(
    `/api/owner/businesses/${businessB}`,
    { name: 'Dibajak' },
    auth(tokenA)
  );
  assert.strictEqual(res.status, 404);

  // Pastikan tidak berubah
  const check = await request.get(`/api/owner/businesses/${businessB}`, auth(tokenB));
  assert.strictEqual(check.body.business.name, 'Bisnis B');
});

test('Owner A TIDAK bisa mengubah status bisnis Owner B (404)', async () => {
  const res = await request.patch(
    `/api/owner/businesses/${businessB}/status`,
    { status: 'suspended' },
    auth(tokenA)
  );
  assert.strictEqual(res.status, 404);
});

// --- Validasi -------------------------------------------------------------

test('Validasi: nama kosong (422) & id bukan UUID (422)', async () => {
  const empty = await createBusiness(tokenA, { name: '' });
  assert.strictEqual(empty.status, 422);

  const badId = await request.get('/api/owner/businesses/bukan-uuid', auth(tokenA));
  assert.strictEqual(badId.status, 422);
});

// --- Update & status ------------------------------------------------------

test('Owner A bisa mengubah bisnisnya (200)', async () => {
  const res = await request.patch(
    `/api/owner/businesses/${businessA1}`,
    { name: 'Warung A Satu (baru)', businessType: 'kuliner' },
    auth(tokenA)
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.business.name, 'Warung A Satu (baru)');
});

test('Owner A bisa menonaktifkan & mengaktifkan bisnisnya (200)', async () => {
  const off = await request.patch(
    `/api/owner/businesses/${businessA1}/status`,
    { status: 'suspended' },
    auth(tokenA)
  );
  assert.strictEqual(off.status, 200);
  assert.strictEqual(off.body.business.status, 'suspended');

  const on = await request.patch(
    `/api/owner/businesses/${businessA1}/status`,
    { status: 'active' },
    auth(tokenA)
  );
  assert.strictEqual(on.body.business.status, 'active');
});

// --- Audit ----------------------------------------------------------------

test('Audit log mencatat aksi bisnis milik Owner A', async () => {
  const { rows } = await query(
    `SELECT action FROM audit_logs WHERE actor_id = $1`,
    [ownerAId]
  );
  const actions = rows.map((r) => r.action);
  for (const expected of ['business.create', 'business.update', 'business.status_change']) {
    assert.ok(actions.includes(expected), `audit harus memuat ${expected}`);
  }
});
