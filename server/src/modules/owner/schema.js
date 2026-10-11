/**
 * Skema validasi modul owner (bisnis) — Zod.
 */
import { z } from 'zod';

const businessName = z
  .string()
  .trim()
  .min(2, 'Nama bisnis minimal 2 karakter')
  .max(120, 'Nama bisnis maksimal 120 karakter');

const businessType = z
  .string()
  .trim()
  .max(60, 'Jenis usaha maksimal 60 karakter');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Mata uang harus 3 huruf (mis. IDR)');

const timezone = z.string().trim().min(3).max(64, 'Zona waktu maksimal 64 karakter');

export const createBusinessSchema = z.object({
  name: businessName,
  businessType: businessType.optional(),
  currency: currency.optional(),
  timezone: timezone.optional(),
});

export const updateBusinessSchema = z
  .object({
    name: businessName.optional(),
    businessType: businessType.optional(),
    currency: currency.optional(),
    timezone: timezone.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Tidak ada field yang diubah',
  });

export const businessStatusSchema = z.object({
  status: z.enum(['active', 'suspended'], {
    errorMap: () => ({ message: "Status harus 'active' atau 'suspended'" }),
  }),
});

export const businessParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
});
