/**
 * Skema validasi modul transaksi penjualan (Fase 7).
 *
 * Nominal dalam SEN (integer). Klien TIDAK boleh mengirim harga/total yang
 * dipercaya — server menghitung ulang dari harga katalog & konfigurasi outlet.
 */
import { z } from 'zod';

const uuid = (label) => z.string().uuid(`ID ${label} tidak valid`);

const discountSchema = z
  .object({
    type: z.enum(['percent', 'amount'], {
      errorMap: () => ({ message: "Tipe diskon harus 'percent' atau 'amount'" }),
    }),
    value: z.number('Nilai diskon harus angka').nonnegative('Diskon tidak boleh negatif'),
  })
  .nullable()
  .optional();

export const createSaleSchema = z
  .object({
    items: z
      .array(
        z.object({
          productId: uuid('produk'),
          qty: z
            .number('Kuantitas harus angka')
            .int('Kuantitas harus bilangan bulat')
            .min(1, 'Kuantitas minimal 1')
            .max(1_000_000, 'Kuantitas terlalu besar'),
        })
      )
      .min(1, 'Keranjang tidak boleh kosong'),
    discount: discountSchema,
    payment: z.object({
      method: z.enum(['cash', 'card', 'qr', 'wallet'], {
        errorMap: () => ({ message: 'Metode pembayaran tidak dikenal' }),
      }),
      amount: z
        .number('Jumlah bayar harus angka')
        .int('Jumlah bayar harus bilangan bulat (sen)')
        .min(0, 'Jumlah bayar tidak boleh negatif'),
      reference: z.string().trim().max(120, 'Referensi maksimal 120 karakter').optional().nullable(),
    }),
    note: z.string().trim().max(255, 'Catatan maksimal 255 karakter').optional().nullable(),
    clientRef: uuid('clientRef').optional(),
  })
  .superRefine((data, ctx) => {
    const d = data.discount;
    if (d?.type === 'percent' && d.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discount', 'value'],
        message: 'Diskon persen maksimal 100',
      });
    }
    if (d?.type === 'amount' && !Number.isInteger(d.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discount', 'value'],
        message: 'Diskon nominal harus bilangan bulat (sen)',
      });
    }
  });

export const transactionListQuerySchema = z.object({
  outletId: uuid('outlet').optional(),
  cashierId: uuid('kasir').optional(),
  status: z.enum(['completed', 'voided', 'refunded']).optional(),
  dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD').optional(),
  dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const cashierTransactionListQuerySchema = z.object({
  status: z.enum(['completed', 'voided', 'refunded']).optional(),
  dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD').optional(),
  dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const transactionParamSchema = z.object({
  businessId: uuid('bisnis'),
  transactionId: uuid('transaksi'),
});

export const transactionBusinessParamSchema = z.object({
  businessId: uuid('bisnis'),
});

export const cashierTransactionParamSchema = z.object({
  transactionId: uuid('transaksi'),
});
