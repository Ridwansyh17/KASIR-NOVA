/**
 * Tes integrasi Fase 4 — Outlet & Batas Langganan.
 *
 * Kriteria selesai:
 *   - Membuat outlet melebihi batas plan DITOLAK server (uji kuota).
 *   - Status langganan satu bisnis TIDAK mempengaruhi bisnis lain.
 *   - Bisnis baru otomatis dapat langganan plan default "Gratis" (OPSI A).
 *   - Admin mengelola paket & langganan; tenant isolation tetap (404).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'RahasiaUji123!';

let adminId, ownerAId, ownerBId;
let tokenA, tokenB, adminToken;

let businessA; // milik owner A
let businessB; // milik owner B

let outlet1; // outlet pertama milik A
let planProId;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

const owner = (token, path, opts) => request.get(`/api/owner${path}`, { ...opts, headers: { ...(auth(token).headers) } });
const ownerPost = (token, path, body) =>
  request.post(`/api/owner${path}`, body, auth(token));
const ownerPatch = (token, path, body) =>
  request.patch(`/api/owner${path}`, body, auth(token));
const ownerDel = (token, path) => request.del(`/api/owner${path}`, auth(token));

const adminPost = (path, body) => request.post(`/api/platform${path}`, body, auth(adminToken));
const adminPatch = (path, body) => request.patch(`/api/platform${path}`, body, auth(adminToken));
const adminGet = (path) => request.get(`/api/platform${path}`, auth(adminToken));

before(async () => {
  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ('uji-fase4-admin@nova.test', $1, 'Admin Fase4', 'active') RETURNING id`,
    [await hashPassword(PASSWORD)]
  );
  adminId = admin.rows[0].id;

  const a = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ('uji-fase4-a@nova.test', $1, 'Owner A4', 'active') RETURNING id`,
    [await hashPassword(PASSWORD)]
  );
  ownerAId = a.rows[0].id;

  const b = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ('uji-fase4-b@nova.test', $1, 'Owner B4', 'active') RETURNING id`,
    [await hashPassword(PASSWORD)]
  );
  ownerBId = b.rows[0].id;

  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });
  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });

  // Buat dua bisnis (masing-masing otomatis dapat langganan Gratis).
  const ra = await ownerPost(tokenA, '/businesses', { name: 'Bisnis Fase4 A' });
  businessA = ra.body.business.id;
  const rb = await ownerPost(tokenB, '/businesses', { name: 'Bisnis Fase4 B' });
  businessB = rb.body.business.id;
});

after(async () => {
  // Urutan penting: hapus data tenant dulu (cascade subscriptions -> melepas
  // FK ke plan uji), baru hapus plan uji 'Pro'.
  await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [
    [ownerAId, ownerBId],
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
    [ownerAId, ownerBId, adminId],
  ]);
  await query("DELETE FROM audit_logs WHERE action LIKE 'plan.%'");
  // businesses cascade -> subscriptions & outlets
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [[ownerAId, ownerBId]]);
  if (planProId) await query(`DELETE FROM subscription_plans WHERE id = $1`, [planProId]);
  await query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
});

const outlets = (businessId) => `/businesses/${businessId}/outlets`;

// ------------------------------------------------------------- Otorisasi ----
test('Tanpa token: outlet & langganan ditolak (401)', async () => {
  const a = await request.get(`/api/owner${outlets(businessA)}`);
  assert.strictEqual(a.status, 401);
  const b = await request.get(`/api/owner/businesses/${businessA}/subscription`);
  assert.strictEqual(b.status, 401);
});

test('Token admin: outlet owner ditolak (403)', async () => {
  const res = await request.get(`/api/owner${outlets(businessA)}`, auth(adminToken));
  assert.strictEqual(res.status, 403);
});

// ------------------------------------------- Langganan default (keputusan A)
test('Bisnis baru otomatis mendapat langganan plan default Gratis', async () => {
  const res = await owner(tokenA, `/businesses/${businessA}/subscription`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.plan.name, 'Gratis');
  assert.strictEqual(res.body.plan.max_outlets, 1);
  assert.strictEqual(res.body.plan.is_default, true);
  assert.strictEqual(res.body.subscription.status, 'active');
  assert.ok(res.body.subscription.expires_at, 'harus punya tanggal kedaluwarsa');
});

// -------------------------------------------------------------- Kuota -------
test('Owner A membuat outlet pertama (201, default tax 0)', async () => {
  const res = await ownerPost(tokenA, outlets(businessA), {
    name: 'Outlet A Pusat',
    address: 'Jl. Merdeka 1',
    phone: '08123',
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.outlet.business_id, businessA);
  assert.strictEqual(res.body.outlet.status, 'active');
  assert.strictEqual(Number(res.body.outlet.tax_rate), 0);
  outlet1 = res.body.outlet.id;
});

test('Outlet kedua DITOLAK karena paket Gratis max=1 (409)', async () => {
  const res = await ownerPost(tokenA, outlets(businessA), { name: 'Outlet A Cabang' });
  assert.strictEqual(res.status, 409);
  assert.match(res.body.error.message, /Batas jumlah outlet/);
});

test('Daftar outlet owner A hanya 1', async () => {
  const res = await owner(tokenA, outlets(businessA));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.total, 1);
});

// ---------------------------------------------- Isolasi tenant (anti-IDOR) --
test('Owner A TIDAK bisa melihat/membuat outlet bisnis Owner B (404)', async () => {
  const list = await owner(tokenA, outlets(businessB));
  assert.strictEqual(list.status, 404);

  const create = await ownerPost(tokenA, outlets(businessB), { name: 'Bajak B' });
  assert.strictEqual(create.status, 404);

  const detail = await owner(tokenA, `${outlets(businessB)}/${outlet1}`);
  assert.strictEqual(detail.status, 404, 'outlet milik tenant lain tersembunyi');

  const update = await ownerPatch(tokenA, `${outlets(businessB)}/${outlet1}`, { name: 'XYZ' });
  assert.strictEqual(update.status, 404);

  const del = await ownerDel(tokenA, `${outlets(businessB)}/${outlet1}`);
  assert.strictEqual(del.status, 404);
});

// ------------------------------------------------------------- CRUD outlet --
test('Detail & ubah outlet milik sendiri (200)', async () => {
  const detail = await owner(tokenA, `${outlets(businessA)}/${outlet1}`);
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.body.outlet.name, 'Outlet A Pusat');

  const upd = await ownerPatch(tokenA, `${outlets(businessA)}/${outlet1}`, {
    address: 'Jl. Baru 9',
    taxRate: 5.5,
  });
  assert.strictEqual(upd.status, 200);
  assert.strictEqual(Number(upd.body.outlet.tax_rate), 5.5);
  assert.strictEqual(upd.body.outlet.address, 'Jl. Baru 9');
});

test('Hapus outlet membebaskan kuota; outlet bisa dibuat lagi (201)', async () => {
  const del = await ownerDel(tokenA, `${outlets(businessA)}/${outlet1}`);
  assert.strictEqual(del.status, 200);

  const create = await ownerPost(tokenA, outlets(businessA), { name: 'Outlet A Reborn' });
  assert.strictEqual(create.status, 201, 'kuota 1/1 sudah bebas setelah hapus');
  outlet1 = create.body.outlet.id;
});

// --------------------------------------------- Admin: paket & langganan ----
test('Admin melihat paket default Gratis', async () => {
  const res = await adminGet('/plans');
  assert.strictEqual(res.status, 200);
  const gratis = res.body.items.find((p) => p.name === 'Gratis');
  assert.ok(gratis, 'paket Gratis harus ada');
  assert.strictEqual(gratis.is_default, true);
  assert.strictEqual(gratis.max_outlets, 1);
});

test('Admin membuat paket Pro (201) lalu nama duplikat ditolak (409)', async () => {
  const create = await adminPost('/plans', {
    name: 'Pro',
    maxOutlets: 2,
    maxCashiers: 3,
    price: 150000,
    durationDays: 30,
  });
  assert.strictEqual(create.status, 201);
  planProId = create.body.plan.id;
  assert.strictEqual(create.body.plan.max_outlets, 2);

  const dup = await adminPost('/plans', { name: 'Pro' });
  assert.strictEqual(dup.status, 409);
});

test('Admin mengubah paket Pro (200)', async () => {
  const res = await adminPatch(`/plans/${planProId}`, { price: 200000 });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(Number(res.body.plan.price), 200000);
});

test('Hanya boleh satu paket default; paket default terakhir tidak bisa dinonaktifkan (409)', async () => {
  const secondDefault = await adminPost('/plans', { name: 'Bukan Default', isDefault: true });
  assert.strictEqual(secondDefault.status, 409);

  const gratis = (await adminGet('/plans')).body.items.find((p) => p.name === 'Gratis');
  const offDefault = await adminPatch(`/plans/${gratis.id}`, { isDefault: false });
  assert.strictEqual(offDefault.status, 409);
});

test('Admin memasang paket Pro ke bisnis A; owner melihatnya (200)', async () => {
  const assign = await adminPost(`/businesses/${businessA}/subscription`, {
    planId: planProId,
  });
  assert.strictEqual(assign.status, 200);

  const view = await owner(tokenA, `/businesses/${businessA}/subscription`);
  assert.strictEqual(view.body.plan.name, 'Pro');
  assert.strictEqual(view.body.plan.max_outlets, 2);
  assert.strictEqual(view.body.subscription.status, 'active');
});

test('Dengan paket Pro (max 2) owner A bisa membuat outlet kedua, ketiga ditolak (409)', async () => {
  const second = await ownerPost(tokenA, outlets(businessA), { name: 'Outlet A Cabang' });
  assert.strictEqual(second.status, 201);

  const third = await ownerPost(tokenA, outlets(businessA), { name: 'Outlet A Cabang 2' });
  assert.strictEqual(third.status, 409);
  assert.match(third.body.error.message, /Batas jumlah outlet/);
});

// ----------------------------------- Isolasi status langganan antar bisnis --
test('Langganan A kedaluwarsa TIDAK mempengaruhi bisnis B', async () => {
  // Status langganan A -> expired
  const expireA = await adminPatch(`/businesses/${businessA}/subscription/status`, {
    status: 'expired',
  });
  assert.strictEqual(expireA.status, 200);

  // A diblokir (langganan tidak aktif)
  const tryA = await ownerPost(tokenA, outlets(businessA), { name: 'Outlet A Lebih' });
  assert.strictEqual(tryA.status, 409);
  assert.match(tryA.body.error.message, /tidak aktif|kedaluwarsa/);

  // B tetap bisa membuat outlet pertamanya (201)
  const tryB = await ownerPost(tokenB, outlets(businessB), { name: 'Outlet B 1' });
  assert.strictEqual(tryB.status, 201);
});

test('Aktivasi kembali langganan A: outlet diblokir oleh KUOTA (bukan langganan)', async () => {
  const reactivate = await adminPatch(`/businesses/${businessA}/subscription/status`, {
    status: 'active',
  });
  assert.strictEqual(reactivate.status, 200);

  // Kuota Pro sudah penuh (2/2) -> tolak karena kuota, membuktikan langganan aktif lagi.
  const tryA = await ownerPost(tokenA, outlets(businessA), { name: 'Outlet A Lagi' });
  assert.strictEqual(tryA.status, 409);
  assert.match(tryA.body.error.message, /Batas jumlah outlet/);
});

// ------------------------------------------------ Admin: daftar bisnis -----
test('Admin melihat semua bisnis + cari by email owner', async () => {
  const res = await adminGet('/businesses');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.total, 2);
  assert.ok(res.body.items.some((b) => b.id === businessA));
  assert.ok(res.body.items.some((b) => b.id === businessB));

  const search = await adminGet('/businesses?search=uji-fase4-b');
  assert.strictEqual(search.body.total, 1);
  assert.strictEqual(search.body.items[0].id, businessB);
  assert.strictEqual(search.body.items[0].owner_email, 'uji-fase4-b@nova.test');
});

// -------------------------------------------------------------- Validasi ----
test('Validasi outlet & langganan (422)', async () => {
  const empty = await ownerPost(tokenA, outlets(businessA), { name: '' });
  assert.strictEqual(empty.status, 422);

  const badId = await owner(tokenA, '/businesses/bukan-uuid/outlets');
  assert.strictEqual(badId.status, 422);

  const badStatus = await adminPatch(`/businesses/${businessA}/subscription/status`, {
    status: 'aneh',
  });
  assert.strictEqual(badStatus.status, 422);
});

// ---------------------------------------------------------------- Audit -----
test('Audit log mencatat aksi outlet, langganan, dan paket', async () => {
  const { rows } = await query(
    `SELECT DISTINCT action FROM audit_logs
      WHERE actor_id = ANY($1::uuid[])`,
    [[ownerAId, adminId]]
  );
  const actions = rows.map((r) => r.action);
  for (const expected of [
    'outlet.create',
    'outlet.delete',
    'outlet.update',
    'subscription.assign',
    'subscription.status_change',
    'plan.create',
    'plan.update',
  ]) {
    assert.ok(actions.includes(expected), `audit harus memuat ${expected}`);
  }
});