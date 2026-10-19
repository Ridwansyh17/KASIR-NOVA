/**
 * Skema validasi modul pengeluaran outlet (Fase 5).
 *
 * Nominal dalam SEN (integer). Kategori `inventory_purchase` (pembelian
 * persediaan dagang) DIKECUALIKAN dari laba bersih agar HPP tidak dihitung
 * dua kali.
 */
import { z } from 'zod';

export const EXPENSE_CATEGORIES = [
  'operational',
  'utilities',
  'supplies',
  'transport',
  'maintenance',
  'inventory_purchase',
  'other',
];

const PHOTO_PREFIXES = [
  'data:image/png;base64,',
  'data:image/jpeg;base64,',
  'data:image/jpg;base64,',
  'data:image/webp;base64,',
];

const isPhotoValue = (v) =>
  v === '' || PHOTO_PREFIXES.some((p) => v.startsWith(p)) || /^https?:\/\//i.test(v);

const dateStr = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus format YYYY-MM-DD');

export const createExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, {
    errorMap: () => ({ message: 'Kategori pengeluaran tidak dikenal' }),
  }),
  amount: z
    .number('Nominal harus angka')
    .int('Nominal harus bilangan bulat (sen)')
    .positive('Nominal harus lebih dari 0')
    .max(100_000_000_000, 'Nominal terlalu besar'),
  method: z
    .enum(['cash', 'transfer', 'qr', 'other'], {
      errorMap: () => ({ message: "Metode harus 'cash', 'transfer', 'qr', atau 'other'" }),
    })
    .default('cash'),
  note: z.string().trim().max(300, 'Keterangan maksimal 300 karakter').optional().nullable(),
  receiptUrl: z
    .string()
    .trim()
    .max(400_000, 'Bukti terlalu besar (maksimal ~300 KB setelah dikecilkan)')
    .refine(isPhotoValue, 'Bukti harus URL http(s) atau data URL gambar')
    .optional()
    .nullable(),
  date: dateStr.optional(),
  outletId: z.string().uuid('ID outlet tidak valid').optional(),
});

/** Owner wajib menyebut outlet; Kasir memakai outlet dari akunnya. */
export const createExpenseOwnerSchema = createExpenseSchema.extend({
  outletId: z.string().uuid('ID outlet tidak valid'),
});

export const voidExpenseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Alasan pembatalan minimal 3 karakter')
    .max(200, 'Alasan maksimal 200 karakter'),
});

export const expenseListQuerySchema = z.object({
  outletId: z.string().uuid('ID outlet tidak valid').optional(),
  cashierId: z.string().uuid('ID kasir tidak valid').optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  status: z.enum(['recorded', 'voided']).default('recorded'),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const expenseParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  expenseId: z.string().uuid('ID pengeluaran tidak valid'),
});

export const cashierExpenseParamSchema = z.object({
  expenseId: z.string().uuid('ID pengeluaran tidak valid'),
});

export default {
  EXPENSE_CATEGORIES,
  createExpenseSchema,
  createExpenseOwnerSchema,
  voidExpenseSchema,
  expenseListQuerySchema,
  expenseParamSchema,
  cashierExpenseParamSchema,
};
