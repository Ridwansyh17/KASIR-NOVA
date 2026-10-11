/**
 * Skema validasi modul sesi.
 */
import { z } from 'zod';

export const sessionListQuerySchema = z.object({
  limit: z.coerce.number().int('Jumlah baris harus bilangan bulat').min(1).max(200).default(100),
});

export const cashierIdParamSchema = z.object({
  cashierId: z.string().uuid('ID kasir tidak valid'),
});

export const ownerSessionParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
  cashierId: z.string().uuid('ID kasir tidak valid'),
});