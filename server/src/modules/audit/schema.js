/**
 * Skema validasi baca audit log (query string).
 *
 * `from`/`to` menerima tanggal (ISO) maupun datetime; di-coerce ke Date oleh
 * zod lalu dikirim sebagai parameter (PostgreSQL menerima Date langsung).
 */
import { z } from 'zod';

export const listAuditQuerySchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid').optional(),
  actorRole: z
    .enum(['platform_admin', 'owner', 'cashier'], {
      errorMap: () => ({ message: 'Peran tidak dikenal' }),
    })
    .optional(),
  action: z.string().trim().min(1).max(120).optional(),
  entityType: z.string().trim().min(1).max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int('Jumlah baris harus bilangan bulat').min(1).max(200).default(50),
  offset: z.coerce.number().int('Offset harus bilangan bulat').min(0).default(0),
});

/** Skema param untuk scope Owner (businessId dari URL, bukan query). */
export const auditBusinessParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
});