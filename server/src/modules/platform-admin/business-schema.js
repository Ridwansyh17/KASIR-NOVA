/**
 * Skema validasi untuk pengelolaan bisnis & langganan oleh Admin Platform.
 */
import { z } from 'zod';

export const businessParamSchema = z.object({
  businessId: z.string().uuid('ID bisnis tidak valid'),
});

export const assignSubscriptionSchema = z.object({
  planId: z.string().uuid('ID paket tidak valid'),
});

export const subscriptionStatusSchema = z.object({
  status: z.enum(['active', 'past_due', 'expired'], {
    errorMap: () => ({ message: "Status harus 'active', 'past_due', atau 'expired'" }),
  }),
});

export const listBusinessesQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});