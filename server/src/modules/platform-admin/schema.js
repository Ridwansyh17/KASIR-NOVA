/**
 * Skema validasi modul platform-admin (Zod).
 */
import { z } from 'zod';

const email = z
  .string()
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

export const createOwnerSchema = z.object({
  email,
  password,
  fullName,
  phone: phone.optional(),
});

export const updateOwnerSchema = z
  .object({
    email: email.optional(),
    fullName: fullName.optional(),
    phone: phone.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Tidak ada field yang diubah',
  });

export const statusSchema = z.object({
  status: z.enum(['active', 'suspended'], {
    errorMap: () => ({ message: "Status harus 'active' atau 'suspended'" }),
  }),
});

export const resetPasswordSchema = z.object({
  newPassword: password,
});

export const listOwnersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({
  id: z.string().uuid('ID tidak valid'),
});
