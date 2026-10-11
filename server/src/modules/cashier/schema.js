/**
 * Skema validasi modul kasir (dikelola Owner).
 *
 * Aturan domain:
 *   - email UNIQUE case-insensitive -> satu akun tidak bisa di dua outlet.
 *   - pin opsional 4-6 digit (login PIN akan dipakai saat area kasir tumbuh).
 */
import { z } from 'zod';

const fullName = z
  .string()
  .trim()
  .min(2, 'Nama lengkap minimal 2 karakter')
  .max(120, 'Nama lengkap maksimal 120 karakter');

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email tidak valid')
  .max(254, 'Email maksimal 254 karakter');

const password = z.string().min(8, 'Password minimal 8 karakter').max(72);

const pin = z
  .string()
  .trim()
  .regex(/^\d{4,6}$/, 'PIN harus 4–6 digit angka');

export const createCashierSchema = z.object({
  fullName,
  email,
  password,
  pin: pin.optional(),
  outletId: z.string().uuid('ID outlet tidak valid'),
});

export const updateCashierSchema = z
  .object({
    fullName: fullName.optional(),
    pin: pin.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Tidak ada field yang diubah',
  });

export const cashierParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  cashierId: z.string().uuid('ID kasir tidak valid'),
});

export const businessParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
});

export const cashierStatusSchema = z.object({
  status: z.enum(['active', 'suspended'], {
    errorMap: () => ({ message: "Status harus 'active' atau 'suspended'" }),
  }),
});

export const resetPasswordSchema = z.object({
  password,
});