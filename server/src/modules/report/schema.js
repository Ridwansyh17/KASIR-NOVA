/**
 * Skema validasi modul laporan (Fase 9).
 *
 * Filter `from`/`to` berupa tanggal `YYYY-MM-DD` (interpretasi zona waktu
 * bisnis); bila kosong, default = awal bulan kalender berjalan s.d. hari ini.
 */
import { z } from 'zod';

const uuid = (label) => z.string().uuid(`ID ${label} tidak valid`);
const dateOnly = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD');

const rangeRefine = (q, ctx) => {
  if (q.from && q.to && q.to < q.from) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: 'Tanggal akhir tidak boleh sebelum tanggal awal',
    });
  }
};

export const reportBusinessParamSchema = z.object({
  businessId: uuid('bisnis'),
});

export const reportQuerySchema = z
  .object({
    groupBy: z
      .enum(['day', 'week', 'month', 'year'], {
        errorMap: () => ({ message: "groupBy harus 'day' | 'week' | 'month' | 'year'" }),
      })
      .default('day'),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    outletId: uuid('outlet').optional(),
    cashierId: uuid('kasir').optional(),
  })
  .superRefine(rangeRefine);

export const summaryQuerySchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    outletId: uuid('outlet').optional(),
    cashierId: uuid('kasir').optional(),
  })
  .superRefine(rangeRefine);

export const exportQuerySchema = z
  .object({
    format: z
      .enum(['csv', 'json'], {
        errorMap: () => ({ message: "format harus 'csv' atau 'json'" }),
      })
      .default('csv'),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    outletId: uuid('outlet').optional(),
    cashierId: uuid('kasir').optional(),
  })
  .superRefine(rangeRefine);