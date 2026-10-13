/**
 * Skema validasi modul laporan (Fase 9 + Fase 15 ekspor Excel).
 *
 * Filter `from`/`to` berupa tanggal `YYYY-MM-DD` (interpretasi zona waktu
 * bisnis); bila kosong, default = awal bulan kalender berjalan s.d. hari ini.
 *
 * Filter tambahan (opsional, dipakai bersama oleh laporan agregat, ringkasan,
 * dan ekspor agar konsisten):
 *   - status        : status transaksi (completed/voided/refunded)
 *   - paymentMethod : metode pembayaran (cash/card/qr/wallet)
 *   - paymentStatus : status pembayaran (paid/pending/failed/refunded)
 *   - search        : cari nomor invoice / catatan transaksi
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

/** Filter yang berlaku untuk semua endpoint laporan. */
const reportFilters = {
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  outletId: uuid('outlet').optional(),
  cashierId: uuid('kasir').optional(),
  status: z.enum(['completed', 'voided', 'refunded']).optional(),
  paymentMethod: z.enum(['cash', 'card', 'qr', 'wallet']).optional(),
  paymentStatus: z.enum(['paid', 'pending', 'failed', 'refunded']).optional(),
  search: z.string().trim().max(100, 'Pencarian maksimal 100 karakter').optional(),
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
    ...reportFilters,
  })
  .superRefine(rangeRefine);

export const summaryQuerySchema = z.object({ ...reportFilters }).superRefine(rangeRefine);

export const exportQuerySchema = z
  .object({
    format: z
      .enum(['csv', 'json', 'xlsx'], {
        errorMap: () => ({ message: "format harus 'csv', 'json', atau 'xlsx'" }),
      })
      .default('csv'),
    ...reportFilters,
  })
  .superRefine(rangeRefine);

// --------------------------------------------------------------- Fase 16 ---
// Perbandingan outlet (satu bisnis) & lintas-bisnis (semua bisnis Owner).

/** Perbandingan outlet: filter sama dengan laporan per-bisnis. */
export const outletComparisonQuerySchema = z.object({ ...reportFilters }).superRefine(rangeRefine);

/** Filter lintas-bisnis: rentang, status, metode/status pembayaran, pencarian. */
const comparisonFilters = {
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  status: z.enum(['completed', 'voided', 'refunded']).optional(),
  paymentMethod: z.enum(['cash', 'card', 'qr', 'wallet']).optional(),
  paymentStatus: z.enum(['paid', 'pending', 'failed', 'refunded']).optional(),
  search: z.string().trim().max(100, 'Pencarian maksimal 100 karakter').optional(),
};

export const businessComparisonQuerySchema = z
  .object({ ...comparisonFilters })
  .superRefine(rangeRefine);

/** Ekspor perbandingan (default xlsx; json untuk data mentah). */
export const outletComparisonExportQuerySchema = z
  .object({
    format: z
      .enum(['xlsx', 'json'], {
        errorMap: () => ({ message: "format harus 'xlsx' atau 'json'" }),
      })
      .default('xlsx'),
    ...reportFilters,
  })
  .superRefine(rangeRefine);

export const businessComparisonExportQuerySchema = z
  .object({
    format: z
      .enum(['xlsx', 'json'], {
        errorMap: () => ({ message: "format harus 'xlsx' atau 'json'" }),
      })
      .default('xlsx'),
    ...comparisonFilters,
  })
  .superRefine(rangeRefine);

// ------------------------------------------------- Fase 4/6: keuangan ------
/**
 * Filter laporan keuangan/dashboard. `period` dihitung di server memakai zona
 * waktu bisnis sehingga hasil tidak bergantung zona waktu perangkat klien.
 * `date` (satu tanggal) menang atas `period`; `from`/`to` untuk rentang bebas.
 */
export const financeQuerySchema = z
  .object({
    period: z
      .enum(['today', 'yesterday', 'week', 'month', 'custom'], {
        errorMap: () => ({ message: 'period tidak dikenal' }),
      })
      .optional(),
    date: dateOnly.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    outletId: uuid('outlet').optional(),
  })
  .superRefine(rangeRefine);
