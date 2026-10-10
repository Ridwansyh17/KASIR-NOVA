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

export default { signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken };
