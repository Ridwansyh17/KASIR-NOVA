/**
 * Skema validasi modul auth (Zod).
 *
 * CATATAN PERAN:
 * - 'platform_admin' & 'owner' aktif sejak Fase 1.
 * - 'cashier' sudah diterima di kontrak API (agar tiga area frontend final),
 *   tetapi tabel `cashiers` baru dibuat di Fase 5. Sampai saat itu service
 *   mengembalikan 404 dengan pesan yang jelas.
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
