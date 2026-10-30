/**
 * Skema validasi Approval Center (Admin Platform).
 */
import { z } from 'zod';

export const approvalIdParamSchema = z.object({
  id: z.string().uuid('ID pendaftaran tidak valid'),
});

export const listApprovalsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'history', 'all']).default('pending'),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const rejectApprovalSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Alasan penolakan minimal 5 karakter')
    .max(500, 'Alasan penolakan maksimal 500 karakter'),
});
