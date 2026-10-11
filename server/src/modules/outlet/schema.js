/**
 * Skema validasi modul outlet.
 */
import { z } from 'zod';

const outletName = z
  .string()
  .trim()
  .min(2, 'Nama outlet minimal 2 karakter')
  .max(120, 'Nama outlet maksimal 120 karakter');

const outletAddress = z.string().trim().max(255, 'Alamat maksimal 255 karakter');

const outletPhone = z.string().trim().max(30, 'Telepon maksimal 30 karakter');

const taxRate = z.coerce
  .number('Pajak harus angka')
  .min(0, 'Pajak minimal 0%')
  .max(100, 'Pajak maksimal 100%');

export const createOutletSchema = z.object({
  name: outletName,
  address: outletAddress.optional(),
  phone: outletPhone.optional(),
  taxRate: taxRate.optional(),
});

export const updateOutletSchema = z
  .object({
    name: outletName.optional(),
    address: outletAddress.optional(),
    phone: outletPhone.optional(),
    taxRate: taxRate.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Tidak ada field yang diubah',
  });

export const outletParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  outletId: z.string().uuid('ID outlet tidak valid'),
});

export const businessParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
});