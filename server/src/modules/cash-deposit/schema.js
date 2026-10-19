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
export const CASH_DEPOSIT_STATUSES = ['draft', 'completed', 'recorded', 'voided'];

/** Kunci shift yang didukung server (batas waktu dihitung di zona bisnis). */
export const CASH_DEPOSIT_SHIFTS = ['full', 'pagi', 'sore', 'malam'];

/** Status yang dianggap SELESAI pada laporan. */
export const CASH_DEPOSIT_DONE_STATUSES = ['completed', 'recorded'];

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
  status: z
    .enum([...CASH_DEPOSIT_STATUSES, 'all'])
    .default('all'),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const cashierSettlementSchema = z.object({
  date: dateStr.optional(),
  shift: z
    .enum(CASH_DEPOSIT_SHIFTS, {
      errorMap: () => ({ message: 'Shift harus full, pagi, sore, atau malam' }),
    })
    .default('full'),
  actualCash: z
    .number('Uang tunai aktual harus angka')
    .int('Uang tunai aktual harus bilangan bulat (sen)')
    .min(0, 'Uang tunai aktual tidak boleh negatif')
    .max(100_000_000_000, 'Nominal terlalu besar')
    .optional(),
  note: z.string().trim().max(500, 'Catatan maksimal 500 karakter').optional().nullable(),
  recipientName: z
    .string()
    .trim()
    .max(120, 'Nama penerima maksimal 120 karakter')
    .optional()
    .nullable(),
  saveAs: z.enum(['draft', 'completed']).default('completed'),
});

/** Owner dapat membuat setoran atas nama outlet tertentu (wajib outletId). */
export const ownerSettlementSchema = cashierSettlementSchema.extend({
  outletId: z.string().uuid('ID outlet tidak valid'),
});

export const completeSettlementSchema = z.object({
  actualCash: z
    .number('Uang tunai aktual harus angka')
    .int('Uang tunai aktual harus bilangan bulat (sen)')
    .min(0, 'Uang tunai aktual tidak boleh negatif')
    .max(100_000_000_000, 'Nominal terlalu besar'),
  note: z.string().trim().max(500, 'Catatan maksimal 500 karakter').optional().nullable(),
  recipientName: z
    .string()
    .trim()
    .max(120, 'Nama penerima maksimal 120 karakter')
    .optional()
    .nullable(),
});

export const settlementPreviewQuerySchema = z.object({
  date: dateStr.optional(),
  shift: z.enum(CASH_DEPOSIT_SHIFTS).default('full'),
  outletId: z.string().uuid('ID outlet tidak valid').optional(),
});

export const cashDepositReportQuerySchema = z.object({
  outletId: z.string().uuid('ID outlet tidak valid').optional(),
  cashierId: z.string().uuid('ID kasir tidak valid').optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  group: z.enum(['day', 'week', 'month']).default('day'),
});

export const platformCashDepositQuerySchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid').optional(),
  outletId: z.string().uuid('ID outlet tidak valid').optional(),
  cashierId: z.string().uuid('ID kasir tidak valid').optional(),
  status: z.enum([...CASH_DEPOSIT_STATUSES, 'all']).default('all'),
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
  CASH_DEPOSIT_SHIFTS,
  CASH_DEPOSIT_DONE_STATUSES,
  createCashDepositSchema,
  createCashDepositOwnerSchema,
  voidCashDepositSchema,
  cashDepositListQuerySchema,
  cashierSettlementSchema,
  ownerSettlementSchema,
  completeSettlementSchema,
  settlementPreviewQuerySchema,
  cashDepositReportQuerySchema,
  platformCashDepositQuerySchema,
  cashDepositParamSchema,
  cashierCashDepositParamSchema,
};
