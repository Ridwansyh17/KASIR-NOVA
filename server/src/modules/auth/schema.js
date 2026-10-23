/**
 * Skema validasi modul auth (Zod).
 *
 * CATATAN PERAN:
 * - 'platform_admin' & 'owner' aktif sejak Fase 1, 'cashier' sejak Fase 5
 *   (tabel `cashiers` dari migrasi 0005). Semua peran memakai mesin
 *   otorisasi yang sama (`USER_STORES` di auth/service.js).
 */
import { z } from 'zod';

export const loginSchema = z.object({
  role: z.enum(['platform_admin', 'owner', 'cashier'], {
    errorMap: () => ({
      message: 'Peran harus salah satu: platform_admin, owner, cashier',
    }),
  }),
  email: z.string().min(1, 'Email wajib diisi').email('Format email tidak valid').max(320),
  password: z
    .string()
    .min(8, 'Password minimal 8 karakter')
    .max(200, 'Password maksimal 200 karakter'),
});

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email wajib diisi')
  .email('Format email tidak valid')
  .max(320, 'Email terlalu panjang');

const password = z
  .string()
  .min(8, 'Password minimal 8 karakter')
  .max(200, 'Password maksimal 200 karakter');

const fullName = z
  .string()
  .trim()
  .min(2, 'Nama minimal 2 karakter')
  .max(120, 'Nama maksimal 120 karakter');

const phone = z
  .string()
  .trim()
  .max(30, 'Nomor telepon maksimal 30 karakter')
  .regex(/^[0-9+\-\s()]+$/, 'Nomor telepon tidak valid');

const normalizeWhatsapp = (value) => {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
};

const whatsappPhone = phone
  .min(9, 'Nomor WhatsApp wajib diisi')
  .transform(normalizeWhatsapp)
  .refine((value) => /^62\d{8,13}$/.test(value), 'Nomor WhatsApp tidak valid');

const businessName = z
  .string()
  .trim()
  .min(2, 'Nama bisnis minimal 2 karakter')
  .max(120, 'Nama bisnis maksimal 120 karakter');

// Pendaftaran Owner mandiri (publik). Akun dibuat BELUM terverifikasi; bisnis
// pertama baru dibuat setelah email terverifikasi Firebase (lihat service).
export const registerOwnerSchema = z.object({
  fullName,
  businessName,
  email,
  password,
  phone: whatsappPhone,
});

export const resendVerificationSchema = z.object({ email });

export const verifyEmailQuerySchema = z.object({
  token: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'Tautan verifikasi tidak valid'),
  // `format=json` untuk pengujian/otomasi; tanpa ini tautan email diarahkan
  // kembali ke panel Owner.
  format: z.enum(['json']).optional(),
});

// State halaman verifikasi Firebase (JWT bertanda tangan; bukan access token).
const firebaseVerificationState = z
  .string()
  .trim()
  .min(20, 'State verifikasi tidak valid')
  .max(4096, 'State verifikasi terlalu panjang');

export const firebaseVerificationStatusSchema = z.object({
  state: firebaseVerificationState,
});

export const verifyFirebaseOwnerSchema = z.object({
  state: firebaseVerificationState,
  // Opsional: bila frontend Firebase mengirim ID token, backend memverifikasinya
  // dengan Admin SDK. Tanpa ini backend tetap memeriksa getUser().emailVerified.
  idToken: z.string().trim().max(10000).optional(),
});

export const resendFirebaseVerificationSchema = z.object({
  state: firebaseVerificationState,
});

// Refresh token = 48 byte acak dalam hex (96 karakter).
export const refreshSchema = z.object({
  refreshToken: z
    .string()
    .regex(/^[a-f0-9]{96}$/, 'Format refresh token tidak valid'),
});

// Login PIN kasir (Fase 10b): kasir dipilih dari layar -> PIN 4 digit verifikasi.
export const cashierPinLoginSchema = z.object({
  cashierId: z.string().uuid('ID kasir tidak valid'),
  pin: z
    .string()
    .regex(/^\d{4}$/, 'PIN harus 4 digit angka'),
});

// Lookup kartu kasir untuk layar pemilih login PIN (publik, scoped outlet).
export const cashierPinLookupSchema = z.object({
  outletId: z.string().uuid('ID outlet tidak valid'),
});

// Ganti sandi sendiri (Keputusan #5): wajib verifikasi sandi lama; sandi baru
// tidak boleh sama persis. `refreshToken` opsional dipakai server untuk
// mempertahankan sesi perangkat ini saat mencabut sesi lain.
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, 'Sandi saat ini wajib diisi')
      .max(200, 'Sandi maksimal 200 karakter'),
    newPassword: z
      .string()
      .min(8, 'Sandi baru minimal 8 karakter')
      .max(200, 'Sandi maksimal 200 karakter'),
    refreshToken: z
      .string()
      .regex(/^[a-f0-9]{96}$/, 'Format refresh token tidak valid')
      .optional(),
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'Sandi baru harus berbeda dari sandi saat ini',
    path: ['newPassword'],
  });
