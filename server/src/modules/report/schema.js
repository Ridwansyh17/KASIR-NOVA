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

/**
 * Laporan Transaksi siap-cetak (17 Okt 2026) — baris per ITEM.
 *
 * `limit` membatasi jumlah baris agar satu permintaan tidak menarik seluruh
 * riwayat; server menandai `truncated` bila hasil terpotong sehingga halaman
 * cetak dapat memberi peringatan dan menyarankan mempersempit rentang.
 */
export const transactionReportQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int('Jumlah baris harus bilangan bulat')
      .min(1, 'Jumlah baris minimal 1')
      .max(5000, 'Jumlah baris maksimal 5000')
      .default(1000),
    ...reportFilters,
  })
  .superRefine(rangeRefine);

/**
 * Ekspor Excel Laporan Transaksi (17 Okt 2026).
 *
 * Batas baris lebih tinggi daripada halaman cetak (bawaan **5000**, maksimum
 * **20000**) karena berkas Excel dipakai untuk pengolahan lanjutan. Bila hasil
 * masih terpotong, berkas memberi peringatan pada sheet `Ringkasan`
 * (`truncated`), dan halaman Owner menyarankan mempersempit rentang.
 */
export const transactionReportExportQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int('Jumlah baris harus bilangan bulat')
      .min(1, 'Jumlah baris minimal 1')
      .max(20000, 'Jumlah baris maksimal 20000')
      .default(5000),
    ...reportFilters,
  })
  .superRefine(rangeRefine);

// ---------------------------------------- Laporan transaksi KASIR (17 Okt) --
/**
 * Filter laporan transaksi untuk **kasir** (permintaan pemilik 17 Okt 2026 —
 * keputusan B1 satu baris per TRANSAKSI, B3 tab "Laporan" bawaan hari ini).
 *
 * PENTING (keamanan): `outletId` dan `cashierId` **sengaja tidak ada** di sini.
 * Outlet selalu diturunkan dari akun kasir (`req.cashierScope`) di controller,
 * jadi kasir tidak punya cara meminta outlet lain — tidak ada permukaan IDOR.
 *
 * Rentang mengikuti pola laporan keuangan kasir (`period`/`date`/`from`/`to`)
 * dan dihitung di **server** dengan zona waktu bisnis, sehingga "hari ini"
 * tidak bergantung zona waktu perangkat.
 */
const cashierReportFilters = {
  period: z
    .enum(['today', 'yesterday', 'week', 'month', 'custom'], {
      errorMap: () => ({ message: 'period tidak dikenal' }),
    })
    .optional(),
  date: dateOnly.optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  status: z.enum(['completed', 'voided', 'refunded']).optional(),
  search: z.string().trim().max(100, 'Pencarian maksimal 100 karakter').optional(),
};

export const cashierTransactionReportQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int('Jumlah baris harus bilangan bulat')
      .min(1, 'Jumlah baris minimal 1')
      .max(1000, 'Jumlah baris maksimal 1000')
      .default(200),
    ...cashierReportFilters,
  })
  .superRefine(rangeRefine);

/**
 * Ekspor Excel laporan transaksi kasir. Batas baris lebih tinggi (bawaan
 * **2000**, maksimum **20000**) karena berkas dipakai untuk pengolahan lanjutan;
 * bila masih terpotong, sheet `Ringkasan` memberi peringatan `truncated`.
 */
export const cashierTransactionReportExportQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int('Jumlah baris harus bilangan bulat')
      .min(1, 'Jumlah baris minimal 1')
      .max(20000, 'Jumlah baris maksimal 20000')
      .default(2000),
    ...cashierReportFilters,
  })
  .superRefine(rangeRefine);

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
