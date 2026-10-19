/**
 * Skema validasi modul setoran kas (Deposit) kasir ke Owner.
 *
 * Nominal dalam SEN (integer). Untuk saat ini metode yang sah hanyalah
 * `cash` (sesuai enum `cash_deposit_method` di migrasi 0011); metode lain
 * dapat ditambah di fase lanjut bersama migrasi baru.
 *
 * `deposited_on` (tanggal setoran) ditentukan di ZONA WAKTU BISNIS dan tidak
 * boleh melebihi hari ini — dipakai sebagai dasar laporan, bukan `created_at`.
 */
import { z } from 'zod';

export const CASH_DEPOSIT_METHODS = ['cash'];
export const CASH_DEPOSIT_STATUSES = ['recorded', 'voided'];

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

export const createCashDepositSchema = z.object({
  amount: z
    .number('Nominal harus angka')
    .int('Nominal harus bilangan bulat (sen)')
    .positive('Nominal harus lebih dari 0')
    .max(100_000_000_000, 'Nominal terlalu besar'),
  method: z
    .enum(CASH_DEPOSIT_METHODS, {
      errorMap: () => ({ message: "Metode setoran harus 'cash'" }),
    })
    .default('cash'),
  note: z.string().trim().max(300, 'Catatan maksimal 300 karakter').optional().nullable(),
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
export const createCashDepositOwnerSchema = createCashDepositSchema.extend({
  outletId: z.string().uuid('ID outlet tidak valid'),
});

export const voidCashDepositSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Alasan pembatalan minimal 3 karakter')
    .max(200, 'Alasan maksimal 200 karakter'),
});

export const cashDepositListQuerySchema = z.object({
  outletId: z.string().uuid('ID outlet tidak valid').optional(),
  cashierId: z.string().uuid('ID kasir tidak valid').optional(),
  status: z.enum(CASH_DEPOSIT_STATUSES).default('recorded'),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const cashDepositParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  depositId: z.string().uuid('ID setoran tidak valid'),
});

export const cashierCashDepositParamSchema = z.object({
  depositId: z.string().uuid('ID setoran tidak valid'),
});

export default {
  CASH_DEPOSIT_METHODS,
  CASH_DEPOSIT_STATUSES,
  createCashDepositSchema,
  createCashDepositOwnerSchema,
  voidCashDepositSchema,
  cashDepositListQuerySchema,
  cashDepositParamSchema,
  cashierCashDepositParamSchema,
};
