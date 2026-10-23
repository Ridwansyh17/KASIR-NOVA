/**
 * Integrasi Firebase Authentication untuk verifikasi email Owner.
 *
 * Prinsip keamanan:
 * - Password Owner TETAP dikelola backend KASIR NOVA (scrypt + JWT).
 * - Firebase hanya menjadi pemilik identitas email + status `emailVerified`.
 * - Email verifikasi dikirim oleh Firebase (tanpa SMTP/provider berbayar).
 * - Setiap ID token yang dibuat untuk proses pengiriman diverifikasi ulang
 *   dengan Firebase Admin SDK; frontend tidak pernah dipercaya soal status.
 * - Service account TIDAK disimpan di repo; hanya dari environment.
 *
 * Modul ini menyediakan adapter yang bisa diganti pada pengujian
 * (`__setFirebaseAdapterForTests`) sehingga tes tidak membutuhkan kredensial.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import env from '../config/env.js';
import { AppError, ConflictError } from '../middleware/error.js';

let adminApp = null;

const hasSplitCredentials = () =>
  Boolean(env.firebase.projectId && env.firebase.clientEmail && env.firebase.privateKey);

const hasServiceAccountJson = () => Boolean(env.firebase.serviceAccountJson);

const parseServiceAccount = () => {
  if (hasServiceAccountJson()) {
    try {
      return JSON.parse(env.firebase.serviceAccountJson);
    } catch {
      throw new AppError('Konfigurasi FIREBASE_SERVICE_ACCOUNT_JSON tidak valid.', 503);
    }
  }
  if (hasSplitCredentials()) {
    return {
      project_id: env.firebase.projectId,
      client_email: env.firebase.clientEmail,
      private_key: env.firebase.privateKey,
    };
  }
  return null;
};

/** Apakah konfigurasi server cukup untuk membuat & mengirim email Firebase. */
export const isFirebaseEmailConfigured = () =>
  Boolean(env.firebase.webApiKey && (hasServiceAccountJson() || hasSplitCredentials()));

const getAdminAuth = () => {
  if (!isFirebaseEmailConfigured()) {
    throw new AppError(
      'Verifikasi email belum dikonfigurasi di server. Hubungi Admin Platform.',
      503,
      { code: 'firebase_not_configured' }
    );
  }
  if (!adminApp) {
    const existing = getApps()[0];
    const serviceAccount = parseServiceAccount();
    adminApp = existing ?? initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id ?? env.firebase.projectId,
    });
  }
  return getAuth(adminApp);
};

const asFirebaseError = (err) => {
  if (err instanceof AppError) return err;
  const code = String(err?.code ?? '');
  if (code === 'auth/email-already-exists') {
    return new ConflictError('Email sudah terdaftar. Silakan masuk atau gunakan email lain.');
  }
  if (code === 'auth/user-not-found') {
    return new AppError('Akun Firebase tidak ditemukan.', 404, { code });
  }
  if (code === 'auth/invalid-id-token' || code === 'auth/id-token-expired' || code === 'auth/id-token-revoked') {
    return new AppError('Sesi verifikasi Firebase tidak valid atau kedaluwarsa.', 401, { code });
  }
  if (code === 'auth/quota-exceeded' || code === 'auth/too-many-requests') {
    return new AppError('Kuota pengiriman email Firebase tercapai. Coba lagi nanti.', 429, {
      code,
      retryAfterSeconds: 900,
    });
  }
  return new AppError('Layanan Firebase Authentication sedang tidak tersedia.', 503, {
    code: 'firebase_unavailable',
  });
};

const readJson = async (res) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

const identityToolkitUrl = (action) =>
  `https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(
    env.firebase.webApiKey
  )}`;

const realAdapter = {
  isConfigured: isFirebaseEmailConfigured,

  /** Buat user Firebase tanpa password (password tetap di backend KASIR NOVA). */
  async createUser({ email, displayName }) {
    try {
      const user = await getAdminAuth().createUser({
        email,
        displayName: displayName || undefined,
        emailVerified: false,
      });
      return { uid: user.uid, email: user.email, emailVerified: user.emailVerified };
    } catch (err) {
      throw asFirebaseError(err);
    }
  },

  async getUser(uid) {
    try {
      const user = await getAdminAuth().getUser(uid);
      return { uid: user.uid, email: user.email, emailVerified: user.emailVerified };
    } catch (err) {
      throw asFirebaseError(err);
    }
  },

  async verifyIdToken(idToken) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken, true);
      return { uid: decoded.uid, email: decoded.email ?? null, emailVerified: decoded.email_verified === true };
    } catch (err) {
      throw asFirebaseError(err);
    }
  },

  async deleteUser(uid) {
    try {
      await getAdminAuth().deleteUser(uid);
    } catch (err) {
      if (String(err?.code) === 'auth/user-not-found') return;
      throw asFirebaseError(err);
    }
  },

  /**
   * Minta Firebase mengirim tautan verifikasi.
   *
   * Backend membuat custom token -> menukarnya menjadi ID token lewat REST
   * Firebase -> MEMVERIFIKASI ID token dengan Admin SDK -> memanggil
   * `sendOobCode`. Tidak ada status `emailVerified` dari browser yang dipakai.
   */
  async sendVerificationEmail({ uid, continueUrl }) {
    if (!env.firebase.webApiKey) {
      throw new AppError('FIREBASE_WEB_API_KEY belum dikonfigurasi.', 503, {
        code: 'firebase_not_configured',
      });
    }

    const customToken = await getAdminAuth().createCustomToken(uid);
    let signInRes;
    try {
      signInRes = await fetch(identityToolkitUrl('signInWithCustomToken'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppError('Tidak dapat menghubungi Firebase untuk mengirim email.', 503, {
        code: 'firebase_unavailable',
      });
    }
    const signIn = await readJson(signInRes);
    if (!signInRes.ok || !signIn.idToken) {
      throw asFirebaseError({ code: signIn?.error?.message });
    }

    // Syarat eksplisit: ID token diverifikasi dengan Firebase Admin SDK.
    const decoded = await this.verifyIdToken(signIn.idToken);
    if (decoded.uid !== uid) {
      throw new AppError('Identitas Firebase tidak cocok.', 401, {
        code: 'firebase_identity_mismatch',
      });
    }

    let sendRes;
    try {
      sendRes = await fetch(identityToolkitUrl('sendOobCode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Firebase-Locale': 'id' },
        body: JSON.stringify({
          requestType: 'VERIFY_EMAIL',
          idToken: signIn.idToken,
          continueUrl,
          canHandleCodeInApp: false,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppError('Tidak dapat menghubungi Firebase untuk mengirim email.', 503, {
        code: 'firebase_unavailable',
      });
    }
    const send = await readJson(sendRes);
    if (!sendRes.ok) {
      throw asFirebaseError({ code: send?.error?.message });
    }
  },
};

let adapter = realAdapter;

/** Adapter aktif (selalu gunakan ini dari service agar bisa diuji). */
export const getFirebaseAdapter = () => adapter;

/** HANYA untuk pengujian: pasang adapter palsu / kembalikan ke asli. */
export const __setFirebaseAdapterForTests = (fake = null) => {
  adapter = fake ?? realAdapter;
};

export default realAdapter;
