/**
 * Tes integrasi pendaftaran Owner + Approval Center.
 *
 * Alur final: daftar tanpa pembayaran -> minta approval via state -> Admin
 * menyetujui/menolak -> trial 30 hari dimulai saat persetujuan. Tidak ada
 * Firebase/email verifikasi pada alur ini.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';

const PASSWORD = 'RahasiaDaftar123!';
const EMAIL_A = 'uji-approval-a@nova.test';
const EMAIL_B = 'uji-approval-b@nova.test';
const EMAIL_C = 'uji-approval-c@nova.test';
const ADMIN_EMAIL = 'uji-approval-admin@nova.test';

let planId;
let adminId;
let adminToken;
let ownerAId;
let ownerBId;
let stateA;
let stateB;
let registrationAId;
let registrationBId;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const DAY_MS = 24 * 60 * 60 * 1000;

const register = (email, businessName, extra = {}) =>
  request.post('/api/auth/register-owner', {
    fullName: `Owner ${businessName}`,
    businessName,
    email,
    phone: '0813-0000-2222',
    password: PASSWORD,
    planId,
    ...extra,
  });

const cleanupOwner = async (email) => {
  const owners = await query('SELECT id FROM owners WHERE email = $1', [email]);
  const ids = owners.rows.map((r) => r.id);
  if (!ids.length) return;
  await query('DELETE FROM refresh_tokens WHERE user_role = $1 AND user_id = ANY($2::uuid[])', [
    'owner',
    ids,
  ]);
  await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
  await query('DELETE FROM owners WHERE id = ANY($1::uuid[])', [ids]);
};

before(async () => {
  await cleanupOwner(EMAIL_A);
  await cleanupOwner(EMAIL_B);
  await cleanupOwner(EMAIL_C);

  const plan = await query(
    `SELECT id FROM subscription_plans
      WHERE is_active = true
      ORDER BY is_default DESC, name ASC
      LIMIT 1`
  );
  assert.ok(plan.rows[0], 'butuh minimal satu subscription_plans aktif (jalankan seed/migrasi)');
  planId = plan.rows[0].id;

  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Admin Approval', 'active') RETURNING id`,
    [ADMIN_EMAIL, await hashPassword(PASSWORD)]
  );
  adminId = admin.rows[0].id;
  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });
});

after(async () => {
  await cleanupOwner(EMAIL_A);
  await cleanupOwner(EMAIL_B);
  await cleanupOwner(EMAIL_C);
  if (adminId) {
    await query('DELETE FROM audit_logs WHERE actor_id = $1', [adminId]);
    await query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
  }
});

test('paket publik pendaftaran aktif tanpa memuat data pembayaran', async () => {
  const res = await request.get('/api/auth/registration-plans');
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.items));
  const plan = res.body.items.find((p) => p.id === planId);
  assert.ok(plan, 'paket pilihan tersedia');
  assert.strictEqual(plan.price, undefined, 'harga tidak ditampilkan saat pendaftaran');
  assert.strictEqual(plan.invoice, undefined);
});

test('pendaftaran membuat akun draft + nomor registrasi tanpa bisnis/langganan', async () => {
  const res = await register(EMAIL_A.toUpperCase(), 'Toko Approval A');
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.accessToken, undefined, 'tidak boleh langsung memberi sesi');
  assert.strictEqual(res.body.owner.email, EMAIL_A);
  assert.strictEqual(res.body.registration.status, 'draft');
  assert.match(res.body.registration.registration_number, /^REG-\d{8}-[A-F0-9]{8}$/);
  assert.strictEqual(res.body.registration.plan.name !== undefined, true);
  assert.ok(res.body.registrationState);

  ownerAId = res.body.owner.id;
  stateA = res.body.registrationState;
  registrationAId = res.body.registration.id;

  const owner = await query(
    `SELECT email_verified_at, phone FROM owners WHERE id = $1`,
    [ownerAId]
  );
  assert.strictEqual(owner.rows[0].email_verified_at, null);
  assert.strictEqual(owner.rows[0].phone, '6281300002222');

  const biz = await query('SELECT id FROM businesses WHERE owner_id = $1', [ownerAId]);
  assert.strictEqual(biz.rowCount, 0, 'bisnis belum dibuat sebelum approval');

  const pending = await request.get('/api/platform/approvals', auth(adminToken));
  assert.strictEqual(pending.status, 200);
  assert.ok(
    pending.body.items.every((item) => item.id !== registrationAId),
    'draft belum terlihat Admin sebelum minta approval'
  );
});

test('email duplikat ditolak 409 tanpa data ganda', async () => {
  const res = await register(EMAIL_A, 'Toko Duplikat');
  assert.strictEqual(res.status, 409);
  const rows = await query('SELECT count(*)::int AS n FROM owners WHERE email = $1', [EMAIL_A]);
  assert.strictEqual(rows.rows[0].n, 1);
});

test('login sebelum approval ditolak dengan kode pending_approval + state', async () => {
  const res = await request.post('/api/auth/login', {
    role: 'owner',
    email: EMAIL_A,
    password: PASSWORD,
  });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.details.code, 'pending_approval');
  assert.ok(res.body.error.details.registrationState);
  assert.strictEqual(res.body.error.details.registration.status, 'draft');
});

test('minta approval idempoten dan draft berubah menjadi pending', async () => {
  const first = await request.post('/api/auth/request-approval', {
    registrationState: stateA,
  });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.registration.status, 'pending');
  assert.strictEqual(first.body.alreadyRequested, false);
  assert.match(first.body.whatsappUrl, /^https:\/\/wa\.me\/\d+\?text=/);
  const text = decodeURIComponent(first.body.whatsappUrl.split('?text=')[1]);
  assert.match(text, /Nama Owner: Owner Toko Approval A/);
  assert.match(text, /Nama Bisnis: Toko Approval A/);
  assert.match(text, /Nomor Registrasi: REG-/);
  assert.match(text, /Paket Pilihan: /);

  const second = await request.post('/api/auth/request-approval', {
    registrationState: stateA,
  });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.registration.id, registrationAId, 'tidak ada data ganda');
  assert.strictEqual(second.body.alreadyRequested, true);
  assert.strictEqual(second.body.registration.request_count, 2);
});

test('Approval Center menampilkan pending lalu Admin menyetujui + trial 30 hari', async () => {
  const list = await request.get(
    `/api/platform/approvals?status=pending&search=${encodeURIComponent('Approval A')}`,
    auth(adminToken)
  );
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.items.some((item) => item.id === registrationAId));
  assert.ok(list.body.pending >= 1);

  const approve = await request.post(
    `/api/platform/approvals/${registrationAId}/approve`,
    {},
    auth(adminToken)
  );
  assert.strictEqual(approve.status, 200);
  assert.strictEqual(approve.body.registration.status, 'approved');
  assert.ok(approve.body.business.id);

  const again = await request.post(
    `/api/platform/approvals/${registrationAId}/approve`,
    {},
    auth(adminToken)
  );
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.alreadyApproved, true);

  const owner = await query(`SELECT email_verified_at FROM owners WHERE id = $1`, [ownerAId]);
  assert.ok(owner.rows[0].email_verified_at instanceof Date);

  const sub = await query(
    `SELECT s.plan_id, s.status, s.started_at, s.expires_at
       FROM subscriptions s
       JOIN businesses b ON b.id = s.business_id
      WHERE b.owner_id = $1
      ORDER BY s.created_at DESC LIMIT 1`,
    [ownerAId]
  );
  assert.strictEqual(sub.rows[0].plan_id, planId);
  assert.strictEqual(sub.rows[0].status, 'active');
  const spread = new Date(sub.rows[0].expires_at) - new Date(sub.rows[0].started_at);
  assert.ok(Math.abs(spread - 30 * DAY_MS) < 5000, 'trial tepat 30 hari dari approval');

  const login = await request.post('/api/auth/login', {
    role: 'owner',
    email: EMAIL_A,
    password: PASSWORD,
  });
  assert.strictEqual(login.status, 200);
  assert.ok(login.body.accessToken);
});

test('Admin menolak dengan alasan; Owner tidak bisa login dan tidak bisa disetujui', async () => {
  const reg = await register(EMAIL_B, 'Toko Approval B');
  assert.strictEqual(reg.status, 201);
  ownerBId = reg.body.owner.id;
  stateB = reg.body.registrationState;
  registrationBId = reg.body.registration.id;

  await request.post('/api/auth/request-approval', { registrationState: stateB });

  const reason = 'Data usaha tidak lengkap';
  const reject = await request.post(
    `/api/platform/approvals/${registrationBId}/reject`,
    { reason },
    auth(adminToken)
  );
  assert.strictEqual(reject.status, 200);
  assert.strictEqual(reject.body.registration.status, 'rejected');
  assert.strictEqual(reject.body.registration.rejection_reason, reason);

  const login = await request.post('/api/auth/login', {
    role: 'owner',
    email: EMAIL_B,
    password: PASSWORD,
  });
  assert.strictEqual(login.status, 403);
  assert.strictEqual(login.body.error.details.code, 'registration_rejected');
  assert.strictEqual(login.body.error.details.reason, reason);

  const approve = await request.post(
    `/api/platform/approvals/${registrationBId}/approve`,
    {},
    auth(adminToken)
  );
  assert.strictEqual(approve.status, 409);

  const biz = await query('SELECT id FROM businesses WHERE owner_id = $1', [ownerBId]);
  assert.strictEqual(biz.rowCount, 0, 'penolakan tidak membuat bisnis');
});

test('tanpa state valid, permintaan approval ditolak', async () => {
  const res = await request.post('/api/auth/request-approval', {
    registrationState: 'state-palsu-yang-tidak-ditandatangani-server',
  });
  assert.strictEqual(res.status, 400);
});
