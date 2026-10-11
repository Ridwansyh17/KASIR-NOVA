/**
 * Pembatasan laju (rate limit) untuk endpoint sensitif.
 *
 * Login dibatasi per-IP untuk menghambat serangan brute force.
 *
 * Catatan: memakai memory store bawaan express-rate-limit — cocok untuk
 * deployment single-instance (dev & awal produksi). Untuk multi-instance,
 * ganti dengan store terpusat (mis. Redis) agar hitungan lintas proses.
 */
import rateLimit from 'express-rate-limit';

/**
 * Limiter login: maksimum 10 percobaan per IP per 15 menit.
 * Respons 429 memakai format error yang sama dengan API lainnya.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message:
        'Terlalu banyak percobaan login dari IP ini. Coba lagi dalam 15 menit.',
    },
  },
});

export default { loginLimiter };
