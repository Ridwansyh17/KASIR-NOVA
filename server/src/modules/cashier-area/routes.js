/**
 * Route area kasir — prefix `/api/cashier`.
 *
 * Hanya peran `cashier`. Tidak ada parameter tenant di URL: outlet kasir
 * diturunkan dari akun, sehingga tidak ada permukaan IDOR.
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { z } from 'zod';

const router = Router();

const productListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get(
  '/products',
  requireAuth,
  requireRole('cashier'),
  ...validate({ query: productListQuerySchema }),
  controller.listProducts
);

export default router;