/**
 * Tes integrasi pendaftaran Owner mandiri + verifikasi email Firebase.
 *
 * Firebase diganti adapter palsu (tanpa kredensial) agar alur HTTP + DB nyata
 * tetap diuji: pembuatan akun, pengiriman email, login terkunci, aktivasi,
 * bisnis/langganan, anti-duplikat, cooldown resend, dan proteksi Admin manual.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import request from './helpers/request.js';
import { query } from '../src/config/db.js';
import { hashPassword } from '../src/utils/hash.js';
import { signAccessToken } from '../src/utils/token.js';
import { __setFirebaseAdapterForTests } from '../src/utils/firebase.js';

const EMAIL = 'uji-selfreg-owner@nova.test';
const EMAIL_ID_TOKEN = 'uji-selfreg-token@nova.test';
const ADMIN_EMAIL = 'uji-selfreg-admin@nova.test';
const PASSWORD = 'RahasiaDaftar123!';
const BUSINESS = 'Toko Uji Mandiri';

let ownerId = null;
let tokenOwnerId = null;
let adminId = null;
let adminToken = null;
let verificationState = null;
let tokenVerificationState = null;

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

/** Adapter Firebase in-memory: meniru createUser/getUser/verifyIdToken/resend. */
const createFakeFirebase = () => {
  const users = new Map();
  const sent = [];
  let seq = 0;

  const findByEmail = (email) =>
    [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());

  const adapter = {
    isConfigured: () => true,
    async createUser({ email, displayName }) {
      if (findByEmail(email)) {
        const err = new Error('email exists');
        err.code = 'auth/email-already-exists';
        throw err;
      }
      const uid = `firebase-uid-${++seq}`;
      const user = { uid, email, displayName, emailVerified: false };
      users.set(uid, user);
      return { ...user };
    },
    async getUser(uid) {
      const user = users.get(uid);
      if (!user) {
        const err = new Error('not found');
        err.code = 'auth/user-not-found';
        throw err;
      }
      return { ...user };
    },
    async verifyIdToken(idToken) {
      if (!idToken?.startsWith('id-token:')) {
        const err = new Error('invalid token');
        err.code = 'auth/invalid-id-token';
        throw err;
      }
      const uid = idToken.slice('id-token:'.length);
      const user = users.get(uid);
      if (!user) {
        const err = new Error('not found');
        err.code = 'auth/user-not-found';
        throw err;
      }
      return { uid, email: user.email, emailVerified: user.emailVerified };
    },
    async deleteUser(uid) {
      users.delete(uid);
    },
    async sendVerificationEmail({ uid, continueUrl }) {
      if (!users.has(uid)) {
        const err = new Error('not found');
        err.code = 'auth/user-not-found';
        throw err;
      }
      sent.push({ uid, continueUrl });
    },
  };

  return { adapter, users, sent, findByEmail };
};

const fake = createFakeFirebase();

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
  __setFirebaseAdapterForTests(fake.adapter);

  const admin = await query(
    `INSERT INTO platform_admins (email, password_hash, full_name, status)
     VALUES ($1, $2, 'Admin Selfreg', 'active') RETURNING id`,
    [ADMIN_EMAIL, await hashPassword(PASSWORD)]
  );
  adminId = admin.rows[0].id;
  adminToken = signAccessToken({ userId: adminId, role: 'platform_admin' });
});

after(async () => {
  __setFirebaseAdapterForTests(null);
  await cleanupOwner(EMAIL);
  await cleanupOwner(EMAIL_ID_TOKEN);
  if (adminId) {
    await query('DELETE FROM audit_logs WHERE actor_id = $1', [adminId]);
    await query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
  }
});

test('register membuat akun pending Firebase + mengirim email verifikasi', async () => {
  const res = await request.post('/api/auth/register-owner', {
    fullName: 'Owner Mandiri',
    businessName: BUSINESS,
    email: EMAIL.toUpperCase(),
    phone: '0813-0000-1111',
    password: PASSWORD,
  });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.accessToken, undefined, 'tidak boleh langsung memberi sesi');
  assert.strictEqual(res.body.owner.email, EMAIL, 'email dinormalisasi huruf kecil');
  assert.strictEqual(res.body.emailSent, true);
  assert.strictEqual(res.body.verificationMethod, 'email');
  assert.ok(res.body.verificationState, 'state halaman verifikasi dikembalikan');
  assert.match(res.body.message, /mengirim tautan verifikasi/i);
  assert.strictEqual(fake.sent.length, 1, 'Firebase diminta mengirim 1 email');
  assert.match(fake.sent[0].continueUrl, /verify-email\?state=/);

  ownerId = res.body.owner.id;
  verificationState = res.body.verificationState;

  const { rows } = await query(
    `SELECT email_verified_at, email_verification_method, firebase_uid,
            firebase_verification_sent_at, pending_business_name, phone
       FROM owners WHERE id = $1`,
    [ownerId]
  );
  assert.strictEqual(rows[0].email_verified_at, null);
  assert.strictEqual(rows[0].email_verification_method, 'firebase');
  assert.ok(rows[0].firebase_uid);
  assert.ok(rows[0].firebase_verification_sent_at instanceof Date);
  assert.strictEqual(rows[0].pending_business_name, BUSINESS);
  assert.strictEqual(rows[0].phone, '6281300001111', 'nomor WA dinormalisasi');

  const biz = await query('SELECT id FROM businesses WHERE owner_id = $1', [ownerId]);
  assert.strictEqual(biz.rowCount, 0, 'bisnis baru dibuat setelah email terverifikasi');

  const audit = await query(
    `SELECT after FROM audit_logs
      WHERE entity_id = $1 AND action = 'owner.register'`,
    [ownerId]
  );
  assert.strictEqual(audit.rows[0].after.verification_method, 'firebase');
  assert.strictEqual(audit.rows[0].after.email_verified, false);
});

test('email duplikat ditolak 409 tanpa membuat akun ganda', async () => {
  const res = await request.post('/api/auth/register-owner', {
    fullName: 'Owner Lain',
    businessName: 'Toko Lain',
    email: EMAIL,
    phone: '081300001112',
    password: PASSWORD,
  });
  assert.strictEqual(res.status, 409);
  assert.match(res.body.error.message, /sudah terdaftar/i);
  const count = await query('SELECT count(*)::int AS n FROM owners WHERE email = $1', [EMAIL]);
  assert.strictEqual(count.rows[0].n, 1);
});

test('login sebelum verifikasi ditolak + memberi state email', async () => {
  const res = await request.post('/api/auth/login', {
    role: 'owner',
    email: EMAIL,
    password: PASSWORD,
  });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error?.details?.code, 'email_not_verified');
  assert.strictEqual(res.body.error?.details?.verificationMethod, 'email');
  assert.ok(res.body.error?.details?.verificationState);
  assert.strictEqual(res.body.accessToken, undefined);
});

test('status verifikasi: email tampil, belum terverifikasi', async () => {
  const res = await request.get(
    `/api/auth/firebase/verification-status?state=${encodeURIComponent(verificationState)}`
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.email, EMAIL);
  assert.strictEqual(res.body.verified, false);
  assert.strictEqual(res.body.canResend, true);
});

test('kirim ulang langsung ditolak cooldown, lalu berhasil setelah cooldown', async () => {
  const tooSoon = await request.post('/api/auth/firebase/resend-verification', {
    state: verificationState,
  });
  assert.strictEqual(tooSoon.status, 429);
  assert.ok(tooSoon.body.error?.details?.retryAfterSeconds > 0);

  await query(
    `UPDATE owners SET firebase_verification_sent_at = now() - interval '5 minutes' WHERE id = $1`,
    [ownerId]
  );
  const beforeCount = fake.sent.length;
  const ok = await request.post('/api/auth/firebase/resend-verification', {
    state: verificationState,
  });
  assert.strictEqual(ok.status, 202);
  assert.strictEqual(ok.body.sent, true);
  assert.strictEqual(fake.sent.length, beforeCount + 1);
});

test('Saya Sudah Verifikasi memakai state (status Firebase Admin ditolak dulu)', async () => {
  const res = await request.post('/api/auth/firebase/verify-owner', {
    state: verificationState,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.verified, false);
  assert.match(res.body.message, /belum diverifikasi/i);
});

test('klik tautan Firebase -> aktivasi, bisnis + langganan dibuat atomik', async () => {
  const user = fake.findByEmail(EMAIL);
  user.emailVerified = true;

  const res = await request.post('/api/auth/firebase/verify-owner', {
    state: verificationState,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.verified, true);
  assert.ok(res.body.businessId);

  const biz = await query(
    `SELECT id, owner_id, name, status FROM businesses WHERE id = $1`,
    [res.body.businessId]
  );
  assert.strictEqual(biz.rowCount, 1);
  assert.strictEqual(biz.rows[0].owner_id, ownerId);
  assert.strictEqual(biz.rows[0].name, BUSINESS);
  assert.strictEqual(biz.rows[0].status, 'active');

  const sub = await query(
    `SELECT s.status, s.auto_renew, s.expires_at, p.is_default
       FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.business_id = $1 AND s.status = 'active'`,
    [res.body.businessId]
  );
  assert.strictEqual(sub.rowCount, 1);
  assert.strictEqual(sub.rows[0].is_default, true);
  assert.strictEqual(sub.rows[0].auto_renew, false);
  assert.ok(new Date(sub.rows[0].expires_at) > new Date());

  const owner = await query(
    `SELECT email_verified_at, pending_business_name, firebase_verification_sent_at
       FROM owners WHERE id = $1`,
    [ownerId]
  );
  assert.ok(owner.rows[0].email_verified_at instanceof Date);
  assert.strictEqual(owner.rows[0].pending_business_name, null);
  assert.strictEqual(owner.rows[0].firebase_verification_sent_at, null);

  const audit = await query(
    `SELECT after FROM audit_logs
      WHERE entity_type = 'owner' AND entity_id = $1 AND action = 'owner.email_verified'`,
    [ownerId]
  );
  assert.strictEqual(audit.rowCount, 1);
  assert.strictEqual(audit.rows[0].after.method, 'firebase');
});

test('verifikasi ulang idempoten (tidak membuat bisnis kedua)', async () => {
  const beforeCount = await query('SELECT count(*)::int AS n FROM businesses WHERE owner_id = $1', [
    ownerId,
  ]);
  const res = await request.post('/api/auth/firebase/verify-owner', {
    state: verificationState,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.verified, true);
  const afterCount = await query('SELECT count(*)::int AS n FROM businesses WHERE owner_id = $1', [
    ownerId,
  ]);
  assert.strictEqual(afterCount.rows[0].n, beforeCount.rows[0].n);
});

test('login berhasil setelah email terverifikasi', async () => {
  const res = await request.post('/api/auth/login', {
    role: 'owner',
    email: EMAIL,
    password: PASSWORD,
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.strictEqual(res.body.user.role, 'owner');
  assert.strictEqual(res.body.user.email, EMAIL);

  const me = await request.get('/api/auth/me', auth(res.body.accessToken));
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.user.role, 'owner');
});

test('Admin tidak dapat memverifikasi manual Owner Firebase', async () => {
  const created = await query(
    `INSERT INTO owners
       (email, password_hash, full_name, status, email_verified_at,
        email_verification_method, firebase_uid, pending_business_name)
     VALUES ($1, $2, 'Owner Firebase Pending', 'active', NULL,
             'firebase', 'firebase-uid-admin-check', 'Toko Admin Check')
     RETURNING id`,
    ['uji-selfreg-admin-check@nova.test', await hashPassword(PASSWORD)]
  );
  const pendingId = created.rows[0].id;
  try {
    const res = await request.post(
      `/api/platform/owners/${pendingId}/verify`,
      {},
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.strictEqual(res.status, 409);
    assert.match(res.body.error.message, /Firebase/i);
  } finally {
    await cleanupOwner('uji-selfreg-admin-check@nova.test');
  }
});

test('aktivasi mendukung ID token yang diverifikasi Admin SDK', async () => {
  const registered = await request.post('/api/auth/register-owner', {
    fullName: 'Owner Token',
    businessName: 'Toko Token',
    email: EMAIL_ID_TOKEN,
    phone: '081300002222',
    password: PASSWORD,
  });
  assert.strictEqual(registered.status, 201);
  tokenOwnerId = registered.body.owner.id;
  tokenVerificationState = registered.body.verificationState;

  const user = fake.findByEmail(EMAIL_ID_TOKEN);
  user.emailVerified = true;

  const res = await request.post('/api/auth/firebase/verify-owner', {
    state: tokenVerificationState,
    idToken: `id-token:${user.uid}`,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.verified, true);

  const login = await request.post('/api/auth/login', {
    role: 'owner',
    email: EMAIL_ID_TOKEN,
    password: PASSWORD,
  });
  assert.strictEqual(login.status, 200);
});

test('ID token dengan uid berbeda ditolak 403', async () => {
  const registered = await request.post('/api/auth/register-owner', {
    fullName: 'Owner Mismatch',
    businessName: 'Toko Mismatch',
    email: 'uji-selfreg-mismatch@nova.test',
    phone: '081300003333',
    password: PASSWORD,
  });
  assert.strictEqual(registered.status, 201);
  try {
    const res = await request.post('/api/auth/firebase/verify-owner', {
      state: registered.body.verificationState,
      idToken: `id-token:${fake.findByEmail(EMAIL).uid}`,
    });
    assert.strictEqual(res.status, 403);
  } finally {
    await cleanupOwner('uji-selfreg-mismatch@nova.test');
  }
});

test('state verifikasi palsu ditolak 400', async () => {
  const res = await request.post('/api/auth/firebase/verify-owner', {
    state: 'state-palsu-yang-tidak-ditandatangani',
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error?.details?.code, 'invalid_verification_state');
});

test('endpoint Owner tanpa token tetap 401 (proteksi backend)', async () => {
  const res = await request.get('/api/auth/me');
  assert.strictEqual(res.status, 401);
});
