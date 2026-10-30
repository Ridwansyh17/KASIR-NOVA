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

/**
 * Limiter pendaftaran Owner mandiri: 5 akun / jam / IP.
 * Mencegah pembuatan akun massal.
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message:
        'Terlalu banyak pendaftaran dari IP ini. Coba lagi dalam 1 jam.',
    },
  },
});

/**
 * Limiter permintaan approval & cek status pendaftaran (publik): longgar agar
 * tombol "Minta Approve Admin" dan polling status tetap nyaman, tetapi cukup
 * membatasi penyalahgunaan state/endpoint.
 */
export const approvalRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message: 'Terlalu banyak permintaan pendaftaran. Coba lagi beberapa saat lagi.',
    },
  },
});

/**
 * Limiter login PIN kasir: backstop IP (max 20/15 mnt). Pelindung utama tetap
 * lockout per-kasir di server (5x salah -> 15 menit, 10x -> status locked).
 * Batas IP sengaja lebih longgar agar tidak memperlambat percobaan yang
 * sah saat beberapa kasir bergantian di perangkat yang sama.
 */
export const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message:
        'Terlalu banyak percobaan PIN dari IP ini. Coba lagi dalam 15 menit.',
    },
  },
});

/**
 * Limiter ganti sandi sendiri: backstop brute force terhadap sandi lama dari
 * sesi yang sudah terautentikasi. 10 percobaan / 15 menit per IP.
 */
export const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message:
        'Terlalu banyak percobaan ganti sandi dari IP ini. Coba lagi dalam 15 menit.',
    },
  },
});

/**
 * Limiter callback gateway pembayaran (publik, tanpa sesi).
 *
 * Duitku mengirim ulang callback maksimal 5x sampai menerima HTTP 200, jadi
 * batas dibuat longgar (120 permintaan / 5 menit per IP) — fungsi utamanya
 * hanya mencegah banjir permintaan ke endpoint publik, bukan menggantikan
 * verifikasi tanda tangan (HMAC) yang tetap wajib.
 */
export const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { message: 'Terlalu banyak permintaan callback dari IP ini.' },
  },
});

/**
 * Limiter cek status tagihan manual oleh Owner. Duitku membatasi hit rate
 * (bisa memblokir ~1 jam), jadi tombol "Cek status" dibatasi ketat:
 * 20 pemeriksaan / 5 menit per IP.
 */
export const invoiceSyncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message:
        'Terlalu banyak pemeriksaan status tagihan. Tunggu beberapa menit sebelum mencoba lagi.',
    },
  },
});

export default {
  loginLimiter,
  pinLimiter,
  passwordLimiter,
  approvalRequestLimiter,
  webhookLimiter,
  invoiceSyncLimiter,
};
