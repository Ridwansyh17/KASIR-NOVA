/**
 * Skema validasi modul tagihan langganan (payment gateway).
 *
 * Nominal TIDAK pernah dikirim klien: tagihan selalu dihitung server dari
 * `subscription_plans.price` (sen). Klien hanya memilih paket + kanal.
 */
import { z } from 'zod';

export const INVOICE_STATUSES = ['pending', 'paid', 'failed', 'expired', 'canceled'];

const uuid = (label) => z.string().uuid(`ID ${label} tidak valid`);

export const subscriptionBusinessParamSchema = z.object({
  businessId: uuid('bisnis'),
});

export const invoiceParamSchema = z.object({
  businessId: uuid('bisnis'),
  invoiceId: uuid('tagihan'),
});

export const createInvoiceSchema = z.object({
  planId: uuid('paket'),
  paymentMethod: z
    .string()
    .trim()
    .min(1, 'Metode pembayaran wajib diisi')
    .max(4, 'Kode metode pembayaran maksimal 4 karakter')
    .transform((v) => v.toUpperCase()),
});

export const listInvoicesQuerySchema = z.object({
  status: z
    .enum(INVOICE_STATUSES, {
      errorMap: () => ({ message: `Status harus salah satu dari: ${INVOICE_STATUSES.join(', ')}` }),
    })
    .optional(),
  page: z.coerce.number().int('Halaman harus bilangan bulat').min(1, 'Halaman minimal 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit harus bilangan bulat')
    .min(1, 'Limit minimal 1')
    .max(100, 'Limit maksimal 100')
    .default(20),
});

export default {
  INVOICE_STATUSES,
  subscriptionBusinessParamSchema,
  invoiceParamSchema,
  createInvoiceSchema,
  listInvoicesQuerySchema,
};
