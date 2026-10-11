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
import {
  createSaleSchema,
  cashierTransactionListQuerySchema,
  cashierTransactionParamSchema,
} from '../transaction/schema.js';

const router = Router();

const productListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const cashierOnly = [requireAuth, requireRole('cashier')];

router.get(
  '/products',
  ...cashierOnly,
  ...validate({ query: productListQuerySchema }),
  controller.listProducts
);

// Transaksi penjualan (area kasir).
router.post(
  '/transactions',
  ...cashierOnly,
  ...validate({ body: createSaleSchema }),
  controller.createTransaction
);

router.get(
  '/transactions',
  ...cashierOnly,
  ...validate({ query: cashierTransactionListQuerySchema }),
  controller.listTransactions
);

router.get(
  '/transactions/:transactionId',
  ...cashierOnly,
  ...validate({ params: cashierTransactionParamSchema }),
  controller.getTransaction
);

export default router;
