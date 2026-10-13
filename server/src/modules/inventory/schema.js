/**
 * Skema validasi modul inventori (histori pergerakan stok).
 */
import { z } from 'zod';

const dateStr = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus format YYYY-MM-DD');

export const movementListQuerySchema = z.object({
  outletId: z.string().uuid('ID outlet tidak valid').optional(),
  productId: z.string().uuid('ID produk tidak valid').optional(),
  type: z
    .enum(['initial', 'adjustment', 'sale', 'void', 'refund', 'mark_out', 'restore'])
    .optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const movementBusinessParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
});

export default { movementListQuerySchema, movementBusinessParamSchema };
