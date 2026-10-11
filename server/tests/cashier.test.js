/**
 * Tes integrasi Fase 5 — Manajemen Kasir.
 *
 * Kriteria selesai:
 *   - Upaya mendaftarkan SATU email ke 2 outlet GAGAL (email UNIQUE
 *     case-insensitive) — uji inti.
 *   - Kasir hanya bisa login lewat peran cashier dan tidak bisa mengakses
 *     endpoint owner (403).
 *   - Kuota `max_cashiers` plan ditegakkan (409 bila penuh).
 *   - Isolasi tenant: kasir/outlet bisnis lain = 404.
 *   - Suspend mencabut semua sesi; reset password menonaktifkan password lama.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'KasirUji123!';

let adminId, ownerAId, ownerBId;
let tokenA, tokenB, adminToken;

let businessA, businessB;
let outletA1, outletA2, outletB1;
let cashierC1, cashierC2, cashierC3; // ids kasir milik bisnis A
let cashierB1; // kasir milik bisnis B (untuk uji isolasi)
let planProId;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

const ownerGet = (token, path) => request.get(`/api/owner${path}`, auth(token));
const ownerPost = (token, path, body) =>
  request.post(`/api/owner${path}`, body, auth(token));
const ownerPatch = (token, path, body) =>
  request.patch(`/api/owner${path}`, body, auth(token));

const adminPost = (path, body) => request.post(`/api/platform${path}`, body, auth(adminToken));

before(async () => {
  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ('uji-fase5-admin@nova.test', $1, 'Admin F5', 'active') RETURNING id`,
    [await hashPassword(PASSWORD)]
  );
  adminId = admin.rows[0].id;

  const a = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ('uji-fase5-a@nova.test', $1, 'Owner A5', 'active') RETURNING id`,
    [await hashPassword(PASSWORD)]
  );
  ownerAId = a.rows[0].id;

  const b = await query(
    `INSERT INTO owners (email, password_hash, full_name, status)
     VALUES ('uji-fase5-b@nova.test', $1, 'Owner B5', 'active') RETURNING id`,
    [await hashPassword(PASSWORD)]
  );
  ownerBId = b.rows[0].id;

  tokenA = signAccessToken({ userId: ownerAId, role: 'owner' });
  tokenB = signAccessToken({ userId: ownerBId, role: 'owner' });
  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });

  // Bisnis + outlet (plan default Gratis: 1 outlet, 1 kasir).
  businessA = (await ownerPost(tokenA, '/businesses', { name: 'Bisnis Kasir A' })).body.business.id;
  businessB = (await ownerPost(tokenB, '/businesses', { name: 'Bisnis Kasir B' })).body.business.id;

  outletA1 = (
    await ownerPost(tokenA, `/businesses/${businessA}/outlets`, { name: 'Outlet A1' })
  ).body.outlet.id;
  outletB1 = (
    await ownerPost(tokenB, `/businesses/${businessB}/outlets`, { name: 'Outlet B1' })
  ).body.outlet.id;
});

after(async () => {
  await query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [
    [ownerAId, ownerBId, adminId, cashierC1, cashierC2, cashierC3, cashierB1].filter(Boolean),
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [
    [ownerAId, ownerBId, adminId],
  ]);
  await query("DELETE FROM audit_logs WHERE action LIKE 'plan.%'");
  // businesses cascade -> outlets -> cashiers; owners delete
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [[ownerAId, ownerBId]]);
  if (planProId) await query(`DELETE FROM subscription_plans WHERE id = $1`, [planProId]);
  await query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
});

const cashiers = (businessId) => `/businesses/${businessId}/cashiers`;

// ------------------------------------------------------------- Otorisasi ----
test('Tanpa token: daftar/buat kasir ditolak (401)', async () => {
  assert.strictEqual((await request.get(`/api/owner${cashiers(businessA)}`)).status, 401);
  assert.strictEqual(
    (await request.post(`/api/owner${cashiers(businessA)}`, {})).status,
    401
  );
});

test('Token admin: kasir owner ditolak (403)', async () => {
  const res = await request.get(`/api/owner${cashiers(businessA)}`, auth(adminToken));
  assert.strictEqual(res.status, 403);
});

// ------------------------------------------------------ Kuota Gratis (1/1) --
test('Owner A membuat kasir pertama (201)', async () => {
  const res = await ownerPost(tokenA, cashiers(businessA), {
    fullName: 'Kasir C1',
    email: 'c1@nova.test',
    password: PASSWORD,
    pin: '1234',
    outletId: outletA1,
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.cashier.outlet_id, outletA1);
  assert.strictEqual(res.body.cashier.status, 'active');
  assert.strictEqual(res.body.cashier.created_by, ownerAId);
  cashierC1 = res.body.cashier.id;
});

test('Kasir kedua DITOLAK karena paket Gratis max=1 (409)', async () => {
  const res = await ownerPost(tokenA, cashiers(businessA), {
    fullName: 'Kasir C2',
    email: 'c2@nova.test',
    password: PASSWORD,
    outletId: outletA1,
  });
  assert.strictEqual(res.status, 409);
  assert.match(res.body.error.message, /Batas jumlah kasir/);
});

// --------------------------------------------------------- Login kasir ------
test('Kasir login via peran cashier (200) + /me memuat konteks outlet', async () => {
  const login = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'c1@nova.test',
    password: PASSWORD,
  });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.body.user.role, 'cashier');

  const me = await request.get('/api/auth/me', auth(login.body.accessToken));
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.user.role, 'cashier');
  assert.strictEqual(me.body.context.outlet.id, outletA1);
  assert.strictEqual(me.body.context.business.id, businessA);
});

test('Kasir TIDAK bisa mengakses endpoint owner (403)', async () => {
  const login = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'c1@nova.test',
    password: PASSWORD,
  });
  const res = await request.get('/api/owner/businesses', auth(login.body.accessToken));
  assert.strictEqual(res.status, 403);
});

// -------------------------------------------------- Isolasi tenant (404) ----
test('Owner A tidak bisa list/buat kasir bisnis Owner B (404)', async () => {
  const list = await ownerGet(tokenA, cashiers(businessB));
  assert.strictEqual(list.status, 404);

  const create = await ownerPost(tokenA, cashiers(businessB), {
    fullName: 'Bajak B',
    email: 'bajak@nova.test',
    password: PASSWORD,
    outletId: outletB1,
  });
  assert.strictEqual(create.status, 404);
});

test('Owner A tidak bisa membuat kasir dengan outlet milik bisnis lain (404)', async () => {
  const res = await ownerPost(tokenA, cashiers(businessA), {
    fullName: 'Bajak Outlet B',
    email: 'bajak2@nova.test',
    password: PASSWORD,
    outletId: outletB1, // milik bisnis B
  });
  assert.strictEqual(res.status, 404);
});

test('Kasir bisnis B tidak terlihat/dapat diubah oleh Owner A (404)', async () => {
  // Owner B membuat kasirnya sendiri (kuota B masih 1/1 untuk bisnis B).
  const created = await ownerPost(tokenB, cashiers(businessB), {
    fullName: 'Kasir B1',
    email: 'b1@nova.test',
    password: PASSWORD,
    outletId: outletB1,
  });
  assert.strictEqual(created.status, 201);
  cashierB1 = created.body.cashier.id;

  // Owner A: lihat lewat jalur bisnis B (tenant 404)
  const viaB = await ownerGet(
    tokenA,
    `${cashiers(businessB)}/${cashierB1}`
  );
  assert.strictEqual(viaB.status, 404);

  // Owner A: lihat lewat jalur bisnis A, id kasir B (bukan milik A -> 404)
  const viaA = await ownerGet(tokenA, `${cashiers(businessA)}/${cashierB1}`);
  assert.strictEqual(viaA.status, 404);

  const upd = await ownerPatch(tokenA, `${cashiers(businessA)}/${cashierB1}`, {
    fullName: 'Hack',
  });
  assert.strictEqual(upd.status, 404);

  const status = await ownerPatch(tokenA, `${cashiers(businessA)}/${cashierB1}/status`, {
    status: 'suspended',
  });
  assert.strictEqual(status.status, 404);

  const reset = await ownerPost(
    tokenA,
    `${cashiers(businessA)}/${cashierB1}/password`,
    { password: 'BaruBanget123!' }
  );
  assert.strictEqual(reset.status, 404);
});

// ------------------------------------------------ Upgrade plan -> kuota 3 ---
test('Admin memasang paket Pro (max outlet 2, kasir 3) ke bisnis A', async () => {
  const plan = await adminPost('/plans', {
    name: 'Pro5',
    maxOutlets: 2,
    maxCashiers: 3,
    price: 200000,
    durationDays: 30,
  });
  assert.strictEqual(plan.status, 201);
  planProId = plan.body.plan.id;

  const assign = await adminPost(`/businesses/${businessA}/subscription`, {
    planId: planProId,
  });
  assert.strictEqual(assign.status, 200);

  // Outlet kedua untuk bisnis A (kuota outlet kini 2).
  const outlet = await ownerPost(tokenA, `/businesses/${businessA}/outlets`, {
    name: 'Outlet A2',
  });
  assert.strictEqual(outlet.status, 201);
  outletA2 = outlet.body.outlet.id;
});

test('Dengan paket Pro: kasir kedua dibuat (201), email duplikat DITOLAK (409)', async () => {
  const second = await ownerPost(tokenA, cashiers(businessA), {
    fullName: 'Kasir C2',
    email: 'c2@nova.test',
    password: PASSWORD,
    outletId: outletA2,
  });
  assert.strictEqual(second.status, 201);
  cashierC2 = second.body.cashier.id;

  // UJI INTI: email c1@nova.test sudah dipakai — beda kapital tetap ditolak.
  const dup = await ownerPost(tokenA, cashiers(businessA), {
    fullName: 'Kasir Duplikat',
    email: 'C1@NOVA.test',
    password: PASSWORD,
    outletId: outletA2,
  });
  assert.strictEqual(dup.status, 409);
  assert.match(dup.body.error.message, /Email sudah digunakan/);
});

test('Kasir ketiga dibuat (201) lalu kuota penuh DITOLAK (409)', async () => {
  const third = await ownerPost(tokenA, cashiers(businessA), {
    fullName: 'Kasir C3',
    email: 'c3@nova.test',
    password: PASSWORD,
    outletId: outletA2,
  });
  assert.strictEqual(third.status, 201);
  cashierC3 = third.body.cashier.id;

  const fourth = await ownerPost(tokenA, cashiers(businessA), {
    fullName: 'Kasir C4',
    email: 'c4@nova.test',
    password: PASSWORD,
    outletId: outletA1,
  });
  assert.strictEqual(fourth.status, 409);
  assert.match(fourth.body.error.message, /Batas jumlah kasir/);
});

test('Daftar kasir bisnis A = 3 (list ikut nama outlet)', async () => {
  const res = await ownerGet(tokenA, cashiers(businessA));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.total, 3);
  const c1 = res.body.items.find((c) => c.id === cashierC1);
  assert.strictEqual(c1.outlet_name, 'Outlet A1');
});

// ----------------------------------------------------- Update & status ------
test('Owner A mengubah nama kasir (200)', async () => {
  const res = await ownerPatch(tokenA, `${cashiers(businessA)}/${cashierC1}`, {
    fullName: 'Kasir C1 Baru',
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.cashier.full_name, 'Kasir C1 Baru');
});

test('Suspend kasir: login ditolak (403) & access token lama dicabut (401)', async () => {
  // Terbitkan token SEBELUM suspend untuk membuktikan requireAuth memeriksa
  // ulang status akun pada setiap request.
  const before = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'c1@nova.test',
    password: PASSWORD,
  });
  assert.strictEqual(before.status, 200);
  const tokenBefore = before.body.accessToken;

  const suspend = await ownerPatch(tokenA, `${cashiers(businessA)}/${cashierC1}/status`, {
    status: 'suspended',
  });
  assert.strictEqual(suspend.status, 200);

  const login = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'c1@nova.test',
    password: PASSWORD,
  });
  assert.strictEqual(login.status, 403);

  const me = await request.get('/api/auth/me', auth(tokenBefore));
  assert.strictEqual(me.status, 401, 'token lama tidak berlaku setelah suspend');
});

test('Aktivasi kembali kasir: login berhasil lagi (200)', async () => {
  const activate = await ownerPatch(tokenA, `${cashiers(businessA)}/${cashierC1}/status`, {
    status: 'active',
  });
  assert.strictEqual(activate.status, 200);

  const login = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'c1@nova.test',
    password: PASSWORD,
  });
  assert.strictEqual(login.status, 200);
});

test('Reset password: password lama gagal (401), baru berhasil (200)', async () => {
  const newPassword = 'RahasiaBaru987!';
  const reset = await ownerPost(tokenA, `${cashiers(businessA)}/${cashierC1}/password`, {
    password: newPassword,
  });
  assert.strictEqual(reset.status, 200);

  const oldLogin = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'c1@nova.test',
    password: PASSWORD,
  });
  assert.strictEqual(oldLogin.status, 401);

  const newLogin = await request.post('/api/auth/login', {
    role: 'cashier',
    email: 'c1@nova.test',
    password: newPassword,
  });
  assert.strictEqual(newLogin.status, 200);
});

// -------------------------------------------------------------- Validasi ----
test('Validasi kasir (422)', async () => {
  const badEmail = await ownerPost(tokenA, cashiers(businessA), {
    fullName: 'X',
    email: 'bukan-email',
    password: PASSWORD,
    outletId: outletA1,
  });
  assert.strictEqual(badEmail.status, 422);

  const shortPw = await ownerPost(tokenA, cashiers(businessA), {
    fullName: 'Kasir Validasi',
    email: 'validasi@nova.test',
    password: '123',
    outletId: outletA1,
  });
  assert.strictEqual(shortPw.status, 422);

  const badPin = await ownerPost(tokenA, cashiers(businessA), {
    fullName: 'Kasir Validasi',
    email: 'validasi2@nova.test',
    password: PASSWORD,
    pin: '12',
    outletId: outletA1,
  });
  assert.strictEqual(badPin.status, 422);

  const badStatus = await ownerPatch(
    tokenA,
    `${cashiers(businessA)}/${cashierC1}/status`,
    { status: 'aneh' }
  );
  assert.strictEqual(badStatus.status, 422);
});

// ---------------------------------------------------------------- Audit -----
test('Audit log mencatat aksi kasir', async () => {
  const { rows } = await query(
    `SELECT DISTINCT action FROM audit_logs WHERE actor_id = $1`,
    [ownerAId]
  );
  const actions = rows.map((r) => r.action);
  for (const expected of [
    'cashier.create',
    'cashier.update',
    'cashier.status_change',
    'cashier.password_reset',
  ]) {
    assert.ok(actions.includes(expected), `audit harus memuat ${expected}`);
  }
});