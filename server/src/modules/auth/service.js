/**
 * Layanan autentikasi & sesi.
 *
 * Menangani pencarian pengguna per peran, verifikasi password, penerbitan
 * token, rotasi refresh token, dan pencabutan sesi.
 *
 * Arsitektur peran: `USER_STORES` memetakan peran -> tabel pengguna. Fase 1
 * mengaktifkan platform_admin & owner; Fase 5 menambahkan 'cashier'
 * (tabel `cashiers`) tanpa mengubah alur di sini.
 */
import { randomBytes, createHash } from 'node:crypto';
import env from '../../config/env.js';
import { query, withTransaction } from '../../config/db.js';
import { hashPassword, verifyPassword, verifyPin } from '../../utils/hash.js';
import { isMailConfigured, sendOwnerVerificationEmail } from '../../utils/mailer.js';
import { createBusinessInTransaction } from '../owner/service.js';
import { writeAudit } from '../audit/service.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryMs,
  signEmailVerificationState,
  verifyEmailVerificationState,
} from '../../utils/token.js';
import { getFirebaseAdapter } from '../../utils/firebase.js';
import { AppError, UnauthorizedError, ForbiddenError } from '../../middleware/error.js';

/**
 * Peta peran -> tabel pengguna yang didukung.
 * Nilai `table` adalah konstanta hardcode (bukan input pengguna), sehingga
 * aman diinterpolasi ke SQL.
 */
const USER_STORES = {
  platform_admin: { table: 'platform_admins', label: 'Admin Platform' },
  owner: { table: 'owners', label: 'Owner' },
  cashier: { table: 'cashiers', label: 'Kasir' }, // diaktifkan di Fase 5
};

export const SUPPORTED_ROLES = Object.keys(USER_STORES);

/** Apakah peran didukung modul auth saat ini. */
export const isRoleSupported = (role) => SUPPORTED_ROLES.includes(role);

// Hash dummy (format scrypt valid) agar verifikasi tetap berjalan saat email
// tidak ditemukan -> waktu respons seragam, mencegah enumerasi akun.
const DUMMY_HASH = `scrypt:32768:8:1:${'00'.repeat(32)}:${'00'.repeat(64)}`;

/**
 * Ambil pengguna (tanpa password) berdasarkan peran & id.
 * @returns {Promise<{id:string,email:string,full_name:string,status:string}|null>}
 */
export const getUserById = async (role, id) => {
  const store = USER_STORES[role];
  if (!store) return null;
  const verifiedColumn = role === 'owner' ? ', email_verified_at' : '';
  const { rows } = await query(
    `SELECT id, email, full_name, status${verifiedColumn} FROM ${store.table} WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
};

/** Ambil pengguna termasuk password_hash (khusus login). */
const findUserWithSecret = async (role, email) => {
  const store = USER_STORES[role];
  if (!store) return null;
  // Hanya tabel owners yang memiliki status verifikasi + data pendaftaran.
  const verifiedColumn =
    role === 'owner'
      ? ', email_verified_at, phone, pending_business_name, firebase_uid, email_verification_method'
      : '';
  const { rows } = await query(
    `SELECT id, email, password_hash, full_name, status${verifiedColumn}
       FROM ${store.table}
      WHERE lower(email) = lower($1)
      LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
};

const hashVerificationToken = (token) => createHash('sha256').update(token).digest('hex');
const newVerificationToken = () => randomBytes(32).toString('hex');
const verificationUrl = (token) =>
  `${env.app.publicUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

/** Normalisasi nomor Indonesia ke format WhatsApp (62… tanpa tanda +). */
const normalizeWhatsapp = (phone) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
};

/** Tautan chat ke Admin Platform untuk pengajuan verifikasi akun. */
const adminWhatsappUrl = ({ id, fullName, email, businessName }) => {
  const lines = [
    'Halo Admin KASIR NOVA,',
    '',
    `Saya ${fullName} ingin memverifikasi akun Owner.`,
    `Email: ${email}`,
    businessName ? `Bisnis: ${businessName}` : null,
    id ? `ID pendaftaran: ${id}` : null,
    '',
    'Mohon dibantu mengaktifkan bisnis dan masa coba Gratis 30 hari. Terima kasih.',
  ].filter((line) => line !== null);
  return `https://wa.me/${env.app.supportWhatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
};

/** Pastikan email siap dipakai sebelum mengirim tautan (khusus alur email). */
const ensureRegistrationOpen = () => {
  if (env.isProduction && !isMailConfigured()) {
    throw new AppError('Pendaftaran belum dibuka (email belum dikonfigurasi).', 503);
  }
};

/**
 * Konteks kasir untuk `/me`: outlet + bisnis yang ditetapkan.
 * Dipakai panel Kasir dan penegakan tenant di sisi klien (server tetap
 * memverifikasi kepemilikan pada setiap operasi penting).
 */
export const getCashierContext = async (cashierId) => {
  const { rows } = await query(
    `SELECT o.id AS outlet_id, o.name AS outlet_name,
            o.address AS outlet_address, o.phone AS outlet_phone,
            o.tax_rate, o.tax_inclusive,
            b.id AS business_id, b.name AS business_name, b.currency
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
       JOIN businesses b ON b.id = o.business_id
      WHERE c.id = $1`,
    [cashierId]
  );
  if (!rows[0]) return null;
  return {
    outlet: {
      id: rows[0].outlet_id,
      name: rows[0].outlet_name,
      address: rows[0].outlet_address,
      phone: rows[0].outlet_phone,
      tax_rate: Number(rows[0].tax_rate),
      tax_inclusive: rows[0].tax_inclusive,
    },
    business: { id: rows[0].business_id, name: rows[0].business_name, currency: rows[0].currency },
  };
};

/**
 * Terbitkan pasangan token baru & simpan HASH refresh ke DB.
 * Bila `client` diberikan, query ikut dalam transaksi pemanggil.
 */
const issueTokens = async ({ role, userId, ip, userAgent, client }) => {
  const accessToken = signAccessToken({ userId, role });
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + refreshTokenExpiryMs());

  const sql = `INSERT INTO refresh_tokens (user_role, user_id, token_hash, expires_at, ip, user_agent)
               VALUES ($1, $2, $3, $4, $5, $6)`;
  const params = [role, userId, tokenHash, expiresAt, ip ?? null, userAgent ?? null];

  if (client) await client.query(sql, params);
  else await query(sql, params);

  return { accessToken, refreshToken };
};

/**
 * Login per peran.
 * @throws {AppError} 404 peran belum aktif, 401 kredensial salah, 403 akun nonaktif
 */
export const login = async ({ role, email, password, ip, userAgent }) => {
  if (!isRoleSupported(role)) {
    throw new AppError(`Login peran '${role}' belum tersedia pada fase ini`, 404);
  }

  const user = await findUserWithSecret(role, email);

  // Selalu verifikasi (pakai hash dummy bila user tak ada) agar waktu respons
  // seragam terhadap keberadaan akun.
  const stored = user?.password_hash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(password, stored);

  if (!user || !passwordOk) {
    throw new UnauthorizedError('Email atau password salah');
  }
  if (user.status !== 'active') {
    throw new AppError('Akun Anda dinonaktifkan. Hubungi administrator.', 403);
  }
  // Owner pendaftaran mandiri baru wajib lolos verifikasi email. Sebelum
  // menolak, cek status terbaru ke Firebase Admin SDK (bukan klaim frontend):
  // bila pemilik sudah mengklik tautan, aktivasi langsung diselesaikan.
  if (role === 'owner' && !user.email_verified_at) {
    if (user.firebase_uid) {
      const firebase = getFirebaseAdapter();
      const firebaseUser = await firebase.getUser(user.firebase_uid);
      if (firebaseUser.emailVerified) {
        const activated = await activateOwnerFromFirebase({
          ownerId: user.id,
          ip,
          source: 'login',
        });
        user.email_verified_at = new Date();
        if (!activated.verified) throw new AppError('Verifikasi email gagal diproses.', 409);
      }
    }

    if (!user.email_verified_at && user.firebase_uid) {
      throw new AppError(
        'Akun menunggu verifikasi email. Buka tautan verifikasi yang dikirim Firebase.',
        403,
        {
          code: 'email_not_verified',
          verificationMethod: 'email',
          email: user.email,
          verificationState: signEmailVerificationState(user.id),
        }
      );
    }

    if (!user.email_verified_at) {
      // Akun pending lama (alur WhatsApp) tetap dapat diselesaikan Admin.
      throw new AppError(
        'Akun menunggu verifikasi Admin. Hubungi Admin melalui WhatsApp agar bisnis Anda diaktifkan.',
        403,
        {
          code: 'account_not_verified',
          verificationMethod: 'whatsapp',
          whatsappUrl: adminWhatsappUrl({
            id: user.id,
            fullName: user.full_name,
            email: user.email,
            businessName: user.pending_business_name,
          }),
        }
      );
    }
  }

  const { accessToken, refreshToken } = await issueTokens({
    role,
    userId: user.id,
    ip,
    userAgent,
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, fullName: user.full_name, role },
  };
};

/**
 * URL halaman verifikasi email (continueUrl Firebase). State ditandatangani
 * dan TIDAK memberi sesi dashboard; ia hanya mengidentifikasi pendaftaran.
 */
const verificationPageUrl = (state) => {
  const configured = /^https?:\/\//i.test(env.firebase.verificationContinueUrl)
    ? env.firebase.verificationContinueUrl
    : `${env.app.ownerPanelUrl}/verify-email`;
  const url = new URL(configured);
  url.searchParams.set('state', state);
  return url.toString();
};

class VerificationStateError extends AppError {
  constructor() {
    super('Tautan verifikasi tidak valid atau sudah kedaluwarsa.', 400, {
      code: 'invalid_verification_state',
    });
  }
}

const ownerIdFromState = (state) => {
  try {
    return verifyEmailVerificationState(state).ownerId;
  } catch {
    throw new VerificationStateError();
  }
};

const findOwnerForVerification = async (ownerId) => {
  const { rows } = await query(
    `SELECT id, email, full_name, email_verified_at, pending_business_name,
            firebase_uid, firebase_verification_sent_at,
            email_verification_method
       FROM owners
      WHERE id = $1 AND deleted_at IS NULL`,
    [ownerId]
  );
  return rows[0] ?? null;
};

/**
 * Aktifkan Owner setelah Firebase menyatakan emailVerified = true.
 * Atomik: update status + buat bisnis + langganan Gratis + audit.
 * Idempoten: pemanggilan kedua tidak membuat bisnis duplikat.
 */
const activateOwnerFromFirebase = async ({ ownerId, ip, source = 'verification' }) => {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, email, full_name, email_verified_at, pending_business_name,
              firebase_uid, email_verification_method
         FROM owners
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [ownerId]
    );
    const owner = rows[0];
    if (!owner) throw new AppError('Pendaftaran Owner tidak ditemukan.', 404);
    if (owner.email_verified_at) {
      return {
        verified: true,
        alreadyVerified: true,
        email: owner.email,
        businessId: null,
      };
    }
    if (!owner.firebase_uid) {
      throw new AppError('Akun ini bukan pendaftaran Firebase.', 409, {
        code: 'not_firebase_registration',
      });
    }

    let business = null;
    if (owner.pending_business_name) {
      const existing = await client.query(
        `SELECT id FROM businesses WHERE owner_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [owner.id]
      );
      business = existing.rows[0]
        ? { id: existing.rows[0].id }
        : await createBusinessInTransaction(client, {
            ownerId: owner.id,
            name: owner.pending_business_name,
            actor: { role: 'owner', id: owner.id },
            ip,
          });
    }

    await client.query(
      `UPDATE owners
          SET email_verified_at = now(),
              pending_business_name = NULL,
              firebase_verification_sent_at = NULL,
              email_verification_token_hash = NULL,
              email_verification_expires_at = NULL
        WHERE id = $1`,
      [owner.id]
    );

    await writeAudit({
      client,
      actorRole: 'owner',
      actorId: owner.id,
      businessId: business?.id ?? null,
      action: 'owner.email_verified',
      entityType: 'owner',
      entityId: owner.id,
      after: {
        email: owner.email,
        method: 'firebase',
        source,
        business_id: business?.id ?? null,
      },
      ip,
    });

    return {
      verified: true,
      alreadyVerified: false,
      email: owner.email,
      businessId: business?.id ?? null,
    };
  });
};

/**
 * Pendaftaran Owner mandiri — verifikasi email via Firebase Authentication.
 *
 * Password tetap di-hash di PostgreSQL (scrypt). Firebase hanya diberi email
 * untuk mengirim tautan verifikasi; tidak ada password yang dikirim ke Firebase
 * dan tidak ada akun ganda di PostgreSQL.
 */
export const registerOwner = async ({
  fullName,
  businessName,
  email,
  password,
  phone,
  ip,
}) => {
  const firebase = getFirebaseAdapter();
  if (!firebase.isConfigured()) {
    throw new AppError(
      'Pendaftaran belum dibuka (Firebase Authentication belum dikonfigurasi).',
      503,
      { code: 'firebase_not_configured' }
    );
  }

  const passwordHash = await hashPassword(password);
  const whatsapp = normalizeWhatsapp(phone);

  let firebaseUser;
  try {
    firebaseUser = await firebase.createUser({ email, displayName: fullName });
  } catch (err) {
    if (err?.code === 'auth/email-already-exists') {
      throw new AppError('Email sudah terdaftar. Silakan masuk atau gunakan email lain.', 409, {
        fields: [{ path: 'email', message: 'Email sudah terdaftar' }],
      });
    }
    throw err;
  }

  let owner;
  try {
    owner = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO owners
           (email, password_hash, full_name, phone, status, created_by,
            email_verified_at, email_verification_method, firebase_uid,
            pending_business_name)
         VALUES ($1, $2, $3, $4, 'active', NULL, NULL, 'firebase', $5, $6)
         RETURNING id, email, full_name`,
        [email, passwordHash, fullName, whatsapp, firebaseUser.uid, businessName]
      );
      const created = rows[0];
      await writeAudit({
        client,
        actorRole: 'owner',
        actorId: created.id,
        action: 'owner.register',
        entityType: 'owner',
        entityId: created.id,
        after: {
          email: created.email,
          full_name: created.full_name,
          phone: whatsapp,
          business_name: businessName,
          email_verified: false,
          verification_method: 'firebase',
        },
        ip,
      });
      return created;
    });
  } catch (err) {
    // Jangan meninggalkan user Firebase yatim bila DB menolak pendaftaran.
    await firebase.deleteUser(firebaseUser.uid).catch((cleanupErr) => {
      console.error('[auth] gagal membersihkan user Firebase:', cleanupErr?.message ?? 'unknown');
    });
    if (err?.code === '23505') {
      throw new AppError('Email sudah terdaftar. Silakan masuk atau gunakan email lain.', 409, {
        fields: [{ path: 'email', message: 'Email sudah terdaftar' }],
      });
    }
    throw err;
  }

  const verificationState = signEmailVerificationState(owner.id);
  let emailSent = false;
  try {
    await firebase.sendVerificationEmail({
      uid: firebaseUser.uid,
      continueUrl: verificationPageUrl(verificationState),
    });
    await query(
      `UPDATE owners SET firebase_verification_sent_at = now() WHERE id = $1`,
      [owner.id]
    );
    emailSent = true;
  } catch (err) {
    // Pendaftaran tetap tersimpan agar tidak membuat akun ganda saat pengguna
    // mengulang form; pengguna bisa memakai tombol "Kirim ulang email".
    console.error('[auth] gagal mengirim email verifikasi Firebase:', err?.message ?? 'unknown');
  }

  return {
    owner: { id: owner.id, email: owner.email, fullName: owner.full_name },
    email: owner.email,
    emailSent,
    verificationMethod: 'email',
    verificationState,
    message: emailSent
      ? 'Pendaftaran berhasil. Kami telah mengirim tautan verifikasi ke email Anda.'
      : 'Pendaftaran berhasil, tetapi email verifikasi belum terkirim. Gunakan tombol Kirim ulang email.',
  };
};

/** Status pendaftaran Firebase berdasarkan state (tanpa mengubah data). */
export const getOwnerFirebaseVerificationStatus = async ({ state }) => {
  const owner = await findOwnerForVerification(ownerIdFromState(state));
  if (!owner) throw new AppError('Pendaftaran Owner tidak ditemukan.', 404);

  const cooldownMs = env.firebase.resendCooldownSeconds * 1000;
  const sentAt = owner.firebase_verification_sent_at
    ? new Date(owner.firebase_verification_sent_at).getTime()
    : 0;
  const retryAfterSeconds =
    sentAt && Date.now() - sentAt < cooldownMs
      ? Math.max(1, Math.ceil((cooldownMs - (Date.now() - sentAt)) / 1000))
      : 0;

  return {
    email: owner.email,
    verified: Boolean(owner.email_verified_at),
    verificationMethod: owner.email_verification_method,
    canResend: !owner.email_verified_at && Boolean(owner.firebase_uid),
    retryAfterSeconds,
  };
};

/**
 * "Saya sudah verifikasi": backend memeriksa status terbaru ke Firebase Admin
 * SDK. Bila `idToken` tersedia, token diverifikasi lebih dulu dan uid harus
 * sama. Status dari browser tidak pernah dipercaya.
 */
export const verifyOwnerFirebase = async ({ state, idToken, ip }) => {
  const owner = await findOwnerForVerification(ownerIdFromState(state));
  if (!owner) throw new AppError('Pendaftaran Owner tidak ditemukan.', 404);
  if (owner.email_verified_at) {
    return {
      verified: true,
      alreadyVerified: true,
      email: owner.email,
      message: 'Email sudah terverifikasi. Silakan masuk ke panel Owner.',
    };
  }
  if (!owner.firebase_uid || owner.email_verification_method !== 'firebase') {
    throw new AppError('Akun ini bukan pendaftaran Firebase.', 409, {
      code: 'not_firebase_registration',
    });
  }

  const firebase = getFirebaseAdapter();
  if (idToken) {
    const decoded = await firebase.verifyIdToken(idToken);
    if (decoded.uid !== owner.firebase_uid) {
      throw new AppError('Identitas Firebase tidak cocok dengan pendaftaran.', 403, {
        code: 'firebase_identity_mismatch',
      });
    }
    if (decoded.email && decoded.email.toLowerCase() !== owner.email.toLowerCase()) {
      throw new AppError('Email Firebase tidak cocok dengan pendaftaran.', 409, {
        code: 'firebase_email_mismatch',
      });
    }
  }

  const firebaseUser = await firebase.getUser(owner.firebase_uid);
  if (firebaseUser.email && firebaseUser.email.toLowerCase() !== owner.email.toLowerCase()) {
    throw new AppError('Email Firebase tidak cocok dengan pendaftaran.', 409, {
      code: 'firebase_email_mismatch',
    });
  }
  if (!firebaseUser.emailVerified) {
    return {
      verified: false,
      email: owner.email,
      message: 'Email belum diverifikasi. Buka tautan di email Anda lalu coba lagi.',
    };
  }

  const result = await activateOwnerFromFirebase({ ownerId: owner.id, ip, source: 'verification' });
  return {
    ...result,
    message: 'Email berhasil diverifikasi. Silakan masuk ke panel Owner.',
  };
};

/** Kirim ulang email verifikasi Firebase dengan batas cooldown per akun. */
export const resendOwnerFirebaseVerification = async ({ state, ip }) => {
  const owner = await findOwnerForVerification(ownerIdFromState(state));
  if (!owner) throw new AppError('Pendaftaran Owner tidak ditemukan.', 404);
  if (owner.email_verified_at) {
    return { sent: false, verified: true, message: 'Email sudah terverifikasi.' };
  }
  if (!owner.firebase_uid || owner.email_verification_method !== 'firebase') {
    throw new AppError('Akun ini bukan pendaftaran Firebase.', 409, {
      code: 'not_firebase_registration',
    });
  }

  const firebase = getFirebaseAdapter();
  const firebaseUser = await firebase.getUser(owner.firebase_uid);
  if (firebaseUser.emailVerified) {
    const result = await activateOwnerFromFirebase({ ownerId: owner.id, ip, source: 'resend' });
    return { sent: false, ...result, message: 'Email sudah terverifikasi. Silakan masuk.' };
  }

  const cooldownMs = env.firebase.resendCooldownSeconds * 1000;
  const sentAt = owner.firebase_verification_sent_at
    ? new Date(owner.firebase_verification_sent_at).getTime()
    : 0;
  if (sentAt && Date.now() - sentAt < cooldownMs) {
    const retryAfterSeconds = Math.max(1, Math.ceil((cooldownMs - (Date.now() - sentAt)) / 1000));
    throw new AppError('Tunggu sebentar sebelum meminta email verifikasi lagi.', 429, {
      retryAfterSeconds,
    });
  }

  await firebase.sendVerificationEmail({
    uid: owner.firebase_uid,
    continueUrl: verificationPageUrl(state),
  });
  await query(
    `UPDATE owners SET firebase_verification_sent_at = now() WHERE id = $1`,
    [owner.id]
  );
  await writeAudit({
    actorRole: 'owner',
    actorId: owner.id,
    action: 'owner.email_verification_resent',
    entityType: 'owner',
    entityId: owner.id,
    after: { method: 'firebase' },
    ip,
  });

  return {
    sent: true,
    verified: false,
    message: 'Email verifikasi baru telah dikirim. Periksa kotak masuk dan folder spam.',
  };
};

/**
 * Verifikasi email dari tautan. Atomik: tandai terverifikasi + buat bisnis
 * pertama + langganan Gratis + audit dalam satu transaksi.
 */
export const verifyOwnerEmail = async ({ token, ip }) => {
  const tokenHash = hashVerificationToken(token);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, email, full_name, email_verified_at,
              email_verification_expires_at, pending_business_name
         FROM owners
        WHERE email_verification_token_hash = $1
          AND email_verification_method = 'manual'
          AND deleted_at IS NULL
        FOR UPDATE`,
      [tokenHash]
    );
    const owner = rows[0];
    if (!owner) {
      throw new AppError('Tautan verifikasi tidak valid atau sudah dipakai.', 400);
    }
    if (!owner.email_verification_expires_at || new Date(owner.email_verification_expires_at) < new Date()) {
      throw new AppError('Tautan verifikasi sudah kedaluwarsa. Minta tautan baru.', 400);
    }

    await client.query(
      `UPDATE owners
          SET email_verified_at = now(),
              email_verification_token_hash = NULL,
              email_verification_expires_at = NULL,
              pending_business_name = NULL
        WHERE id = $1`,
      [owner.id]
    );

    let business = null;
    if (owner.pending_business_name) {
      business = await createBusinessInTransaction(client, {
        ownerId: owner.id,
        name: owner.pending_business_name,
        actor: { role: 'owner', id: owner.id },
        ip,
      });
    }

    await writeAudit({
      client,
      actorRole: 'owner',
      actorId: owner.id,
      businessId: business?.id ?? null,
      action: 'owner.email_verified',
      entityType: 'owner',
      entityId: owner.id,
      after: { email: owner.email, business_name: owner.pending_business_name },
      ip,
    });

    return {
      verified: true,
      email: owner.email,
      businessId: business?.id ?? null,
      message: 'Email berhasil diverifikasi. Silakan masuk ke panel Owner.',
    };
  });
};

/**
 * Kirim ulang tautan verifikasi. Respons selalu generik agar tidak menjadi
 * alat enumerasi email. Token lama diganti (tautan lama tidak berlaku).
 */
export const resendOwnerVerification = async ({ email, ip }) => {
  ensureRegistrationOpen();

  const token = newVerificationToken();
  const tokenHash = hashVerificationToken(token);
  const expiresAt = new Date(
    Date.now() + env.app.emailVerificationTtlHours * 60 * 60 * 1000
  );

  const owner = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, email, full_name, email_verified_at
         FROM owners
        WHERE lower(email) = lower($1)
          AND email_verification_method = 'manual'
          AND deleted_at IS NULL
        FOR UPDATE`,
      [email]
    );
    const found = rows[0];
    if (!found || found.email_verified_at) return null;

    await client.query(
      `UPDATE owners
          SET email_verification_token_hash = $1,
              email_verification_expires_at = $2
        WHERE id = $3`,
      [tokenHash, expiresAt, found.id]
    );
    return found;
  });

  const generic = {
    message:
      'Jika email terdaftar dan belum diverifikasi, tautan verifikasi baru telah dikirim.',
  };
  if (!owner) return generic;

  let mail = null;
  try {
    mail = await sendOwnerVerificationEmail({
      to: owner.email,
      fullName: owner.full_name,
      verifyUrl: verificationUrl(token),
      expiresHours: env.app.emailVerificationTtlHours,
    });
  } catch (err) {
    // Jangan bocorkan keberadaan akun lewat status HTTP; kegagalan sudah
    // dicatat oleh modul mailer.
    console.error('[auth] gagal mengirim ulang verifikasi:', err?.message ?? 'unknown');
    return generic;
  }

  if (!env.isProduction && mail?.delivered === false) {
    return { ...generic, devVerificationUrl: verificationUrl(token) };
  }
  return generic;
};

/**
 * Login PIN kasir (Fase 10b).
 *
 * Aturan (keputusan pemilik):
 *   - PIN 4 digit, opsional; salah -> 401 seragam (anti-enumerasi).
 *   - Lockout di server, atomik per percobaan: 5x salah -> kunci sementara
 *     15 menit (429 + retryAfterSeconds); 10x salah -> status 'locked'
 *     (403, hanya Owner yang membuka via endpoint unlock).
 *   - Kasir yang `pin_hash`-nya NULL (belum diberi PIN) tidak bisa lewat PIN.
 */
export const loginCashierWithPin = async ({ cashierId, pin, ip, userAgent }) => {
  const { rows } = await query(
    `SELECT c.id, c.email, c.full_name, c.status, c.pin_hash,
            c.pin_locked_until, c.pin_failed_attempts,
            o.id AS outlet_id, o.status AS outlet_status,
            b.status AS business_status
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
       JOIN businesses b ON b.id = o.business_id
      WHERE c.id = $1 AND o.deleted_at IS NULL AND b.deleted_at IS NULL`,
    [cashierId]
  );
  const cashier = rows[0];

  // Pesan seragam agar tidak ter-enumerasi keberadaan akun.
  if (!cashier || !cashier.pin_hash) {
    throw new UnauthorizedError('Kasir atau PIN tidak valid');
  }
  if (cashier.status === 'locked') {
    throw new AppError('Kasir terkunci. Mintalah Owner membuka kunci.', 403);
  }
  if (cashier.status !== 'active' || cashier.outlet_status !== 'active' || cashier.business_status !== 'active') {
    throw new AppError('Akun Anda dinonaktifkan. Hubungi administrator.', 403);
  }

  // Kunci sementara masih aktif -> 429 + berapa detik lagi tersedia.
  if (cashier.pin_locked_until && new Date(cashier.pin_locked_until) > new Date()) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((new Date(cashier.pin_locked_until) - new Date()) / 1000)
    );
    throw new AppError('Terlalu banyak percobaan PIN. Coba lagi nanti.', 429, {
      retryAfterSeconds,
    });
  }

  const pinOk = await verifyPin(pin, cashier.pin_hash);
  if (!pinOk) {
    // Kenaikan atomik + kunci sementara/status locked dalam SATU statement.
    const { rows: fail } = await query(
      `UPDATE cashiers
          SET pin_failed_attempts = pin_failed_attempts + 1,
              pin_locked_until = CASE
                WHEN pin_failed_attempts + 1 >= 10 THEN NULL
                WHEN pin_failed_attempts + 1 >= 5
                  THEN now() + interval '15 minutes'
                ELSE pin_locked_until
              END,
              status = CASE
                WHEN pin_failed_attempts + 1 >= 10 THEN 'locked'::account_status
                ELSE status
              END
        WHERE id = $1
        RETURNING pin_failed_attempts, pin_locked_until, status`,
      [cashierId]
    );
    const after = fail[0];
    if (after.status === 'locked') {
      throw new AppError('Kasir terkunci. Mintalah Owner membuka kunci.', 403);
    }
    if (after.pin_failed_attempts >= 5) {
      throw new AppError('Terlalu banyak percobaan PIN. Coba lagi nanti.', 429, {
        retryAfterSeconds: 900,
      });
    }
    throw new UnauthorizedError('Kasir atau PIN tidak valid');
  }

  // Sukses: reset penghitung lockout, lalu terbitkan sesi seperti login biasa.
  await query(
    `UPDATE cashiers SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1`,
    [cashierId]
  );
  const { accessToken, refreshToken } = await issueTokens({
    role: 'cashier',
    userId: cashier.id,
    ip,
    userAgent,
  });

  return {
    accessToken,
    refreshToken,
    user: { id: cashier.id, email: cashier.email, fullName: cashier.full_name, role: 'cashier' },
  };
};

/**
 * Kartu kasir untuk layar pemilih PIN (publik, scoped per outlet).
 * Hanya kasir AKTIF yang SUDAH punya PIN yang muncul — nama saja, tanpa
 * email/password. Outlet diidentifikasi via UUID (tidak dapat ditebak).
 */
export const listPinCashiers = async ({ outletId }) => {
  const { rows } = await query(
    `SELECT c.id, c.full_name
       FROM cashiers c
       JOIN outlets o ON o.id = c.outlet_id
       JOIN businesses b ON b.id = o.business_id
      WHERE c.outlet_id = $1
        AND o.deleted_at IS NULL AND b.deleted_at IS NULL
        AND c.status = 'active'
        AND c.pin_hash IS NOT NULL
      ORDER BY c.full_name ASC`,
    [outletId]
  );
  return rows;
};

/**
 * Rotasi refresh token (sekali pakai): cabut token lama, terbitkan pasangan
 * baru secara ATOMIK. Refresh token lama langsung tidak berlaku.
 */
export const refresh = async ({ refreshToken }) => {
  const tokenHash = hashRefreshToken(refreshToken);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_role, user_id, expires_at, revoked_at
         FROM refresh_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash]
    );

    const record = rows[0];
    if (!record) throw new UnauthorizedError('Refresh token tidak valid');
    if (record.revoked_at) throw new UnauthorizedError('Refresh token sudah dicabut');
    if (new Date(record.expires_at) <= new Date()) {
      throw new UnauthorizedError('Refresh token kedaluwarsa');
    }

    const store = USER_STORES[record.user_role];
    if (!store) throw new UnauthorizedError('Peran tidak dikenal');

    const verifiedColumn = record.user_role === 'owner' ? ', email_verified_at' : '';
    const { rows: userRows } = await client.query(
      `SELECT id, email, full_name, status${verifiedColumn}
         FROM ${store.table} WHERE id = $1`,
      [record.user_id]
    );
    const account = userRows[0];
    if (!account) throw new UnauthorizedError('Akun tidak ditemukan');
    if (account.status !== 'active') throw new UnauthorizedError('Akun Anda dinonaktifkan');
    if (record.user_role === 'owner' && !account.email_verified_at) {
      throw new ForbiddenError(
        'Akun menunggu verifikasi email. Buka tautan verifikasi Firebase.'
      );
    }

    // Rotasi atomik di dalam transaksi yang sama
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [
      record.id,
    ]);
    const { accessToken, refreshToken: newRefresh } = await issueTokens({
      role: record.user_role,
      userId: record.user_id,
      client,
    });

    return {
      accessToken,
      refreshToken: newRefresh,
      user: {
        id: account.id,
        email: account.email,
        fullName: account.full_name,
        role: record.user_role,
      },
    };
  });
};

/**
 * Logout: cabut satu refresh token (sesi tunggal). Idempoten — token yang tak
 * dikenal tetap dianggap sukses agar tidak membocorkan keberadaan token.
 */
export const logout = async ({ refreshToken, userId, role }) => {
  const tokenHash = hashRefreshToken(refreshToken);
  const { rowCount } = await query(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE token_hash = $1 AND user_id = $2 AND user_role = $3 AND revoked_at IS NULL`,
    [tokenHash, userId, role]
  );
  return { revoked: rowCount > 0 };
};

/**
 * Cabut SEMUA sesi aktif milik seorang pengguna.
 * Dipakai manajemen sesi (Fase 11) / pemaksaan logout oleh admin.
 */
export const revokeAllSessions = async (role, userId) => {
  const { rowCount } = await query(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE user_role = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [role, userId]
  );
  return rowCount;
};

/**
 * Ganti sandi sendiri (Keputusan #5).
 *
 * Aturan:
 *   - wajib verifikasi sandi lama (mencegah pengambilalihan sesi pasif);
 *   - setelah sukses, SEMUA refresh token pengguna dicabut KECUALI sesi
 *     perangkat yang dipakai mengganti (bila `refreshToken` dikirim), sehingga
 *     perangkat/peramban lain dipaksa login ulang;
 *   - perubahan + pencabutan + audit terjadi dalam SATU transaksi DB.
 *
 * @param {object} p
 * @param {'platform_admin'|'owner'|'cashier'} p.role
 * @param {string} p.userId
 * @param {string} p.currentPassword
 * @param {string} p.newPassword
 * @param {string|null} [p.refreshToken] sesi perangkat ini yang dipertahankan
 * @param {string|null} [p.ip]
 * @returns {Promise<{sessionsRevoked:number}>}
 */
export const changePassword = async ({
  role,
  userId,
  currentPassword,
  newPassword,
  refreshToken = null,
  ip = null,
}) => {
  const store = USER_STORES[role];
  if (!store) throw new AppError('Peran tidak didukung', 400);

  const { rows } = await query(
    `SELECT id, password_hash, status FROM ${store.table} WHERE id = $1`,
    [userId]
  );
  const account = rows[0];
  if (!account) throw new UnauthorizedError('Sesi tidak valid');
  if (account.status !== 'active') {
    throw new AppError('Akun Anda dinonaktifkan. Hubungi administrator.', 403);
  }

  const currentOk = await verifyPassword(currentPassword, account.password_hash);
  if (!currentOk) throw new AppError('Sandi saat ini salah', 400);
  if (currentPassword === newPassword) {
    throw new AppError('Sandi baru harus berbeda dari sandi saat ini', 422);
  }

  const newHash = await hashPassword(newPassword);
  const keepHash = refreshToken ? hashRefreshToken(refreshToken) : null;

  const sessionsRevoked = await withTransaction(async (client) => {
    await client.query(
      `UPDATE ${store.table} SET password_hash = $1 WHERE id = $2`,
      [newHash, userId]
    );

    const { rowCount } = await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = now()
        WHERE user_role = $1 AND user_id = $2 AND revoked_at IS NULL
          AND ($3::text IS NULL OR token_hash <> $3)`,
      [role, userId, keepHash]
    );

    await writeAudit({
      client,
      actorRole: role,
      actorId: userId,
      action: 'auth.change_password',
      entityType: role,
      entityId: userId,
      ip,
    });

    return rowCount;
  });

  return { sessionsRevoked };
};

export default {
  login,
  refresh,
  logout,
  getUserById,
  getCashierContext,
  isRoleSupported,
  revokeAllSessions,
  changePassword,
  registerOwner,
  getOwnerFirebaseVerificationStatus,
  verifyOwnerFirebase,
  resendOwnerFirebaseVerification,
  SUPPORTED_ROLES,
};
