/**
 * Generate & verifikasi JWT (access + refresh) per peran.
 *
 * - Access token: umur pendek, membawa role + userId.
 * - Refresh token: random bytes (bukan JWT), disimpan sebagai hash di DB.
 *   Mengapa? Refresh token yang di-hash di server berarti DB bocor tidak
 *   langsung memberi penyerang sesi yang valid.
 */
import { randomBytes, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

/**
 * Buat access token JWT.
 * @param {{ userId: string, role: string }} payload
 */
export const signAccessToken = ({ userId, role }) =>
  jwt.sign({ sub: userId, role }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn,
  });

/**
 * Verifikasi access token. Lempar error bila invalid/expired.
 */
export const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, env.jwt.accessSecret);
  return { userId: decoded.sub, role: decoded.role };
};

/**
 * Buat refresh token acak (48 byte hex = 96 char).
 * @returns {string} token plain (hanya dikirim ke klien sekali)
 */
export const generateRefreshToken = () => randomBytes(48).toString('hex');

/**
 * Hash refresh token untuk disimpan di DB.
 */
export const hashRefreshToken = (token) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Ubah durasi string (mis. '7d', '12h', '30m', '45s') menjadi milidetik.
 * Dipakai untuk menghitung `expires_at` refresh token di DB.
 * Default 7 hari bila format tidak dikenali.
 */
export const durationToMs = (duration) => {
  const match = /^(\d+)\s*([smhd])$/.exec(String(duration).trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return Number(match[1]) * unit;
};

/** Umur refresh token (milidetik) sesuai konfigurasi env. */
export const refreshTokenExpiryMs = () => durationToMs(env.jwt.refreshExpiresIn);

const EMAIL_VERIFY_PURPOSE = 'firebase_email_verification';

/**
 * Tanda tangan state halaman verifikasi email (bukan access token).
 * State membawa id Owner, ditandatangani, dan kedaluwarsa; tidak memberi sesi
 * dashboard. Aktifasi tetap menunggu `emailVerified` dari Firebase Admin SDK.
 */
export const signEmailVerificationState = (ownerId) =>
  jwt.sign(
    { sub: ownerId, purpose: EMAIL_VERIFY_PURPOSE },
    env.jwt.accessSecret,
    { expiresIn: '30d' }
  );

/** Verifikasi state halaman email; lempar error bila tidak valid/kedaluwarsa. */
export const verifyEmailVerificationState = (state) => {
  const decoded = jwt.verify(state, env.jwt.accessSecret);
  if (decoded.purpose !== EMAIL_VERIFY_PURPOSE || !decoded.sub) {
    const err = new Error('State verifikasi email tidak valid');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return { ownerId: String(decoded.sub) };
};

export default {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  durationToMs,
  refreshTokenExpiryMs,
  signEmailVerificationState,
  verifyEmailVerificationState,
};
