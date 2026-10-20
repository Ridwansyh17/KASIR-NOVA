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
