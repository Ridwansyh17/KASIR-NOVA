/**
 * Middleware autentikasi & otorisasi berbasis peran.
 *
 *   requireAuth : verifikasi access token + pastikan akun masih ada & aktif.
 *   requireRole : batasi endpoint hanya untuk peran tertentu.
 *
 * Catatan keamanan: requireAuth memeriksa ULANG keberadaan & status akun di DB
 * pada setiap request. Artinya, menonaktifkan akun langsung mencabut sesi
 * aktifnya — access token yang belum kedaluwarsa pun tidak lagi berguna.
 */
import { verifyAccessToken } from '../utils/token.js';
import { UnauthorizedError, ForbiddenError } from './error.js';
import { getUserById } from '../modules/auth/service.js';

/**
 * Wajib autentikasi (Bearer access token).
 * Menempelkan objek `req.user` = { id, role, email, fullName }.
 */
export const requireAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedError('Token akses tidak ditemukan');
    }

    const payload = verifyAccessToken(token);

    const user = await getUserById(payload.role, payload.userId);
    if (!user) throw new UnauthorizedError('Sesi tidak valid');
    if (user.status !== 'active') {
      throw new UnauthorizedError('Akun Anda dinonaktifkan');
    }

    req.user = {
      id: user.id,
      role: payload.role,
      email: user.email,
      fullName: user.full_name,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Token akses kedaluwarsa'));
    }
    if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
      return next(new UnauthorizedError('Token akses tidak valid'));
    }
    next(err);
  }
};

/**
 * Batasi akses berdasarkan peran. Wajib dipasang SETELAH requireAuth.
 * @param {...string} roles - peran yang diizinkan
 */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Peran '${req.user.role}' tidak diizinkan mengakses endpoint ini`
        )
      );
    }
    next();
  };

export default { requireAuth, requireRole };
