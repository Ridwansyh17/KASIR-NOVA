/**
 * Route transaksi (Owner) — dipasang di bawah
 * `/api/owner/businesses/:businessId/transactions`.
 *
 * Otorisasi peran owner + verifikasi kepemilikan bisnis (requireBusinessAccess).
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import {
  transactionListQuerySchema,
  transactionParamSchema,
  transactionBusinessParamSchema,
} from './schema.js';

export const transactionRoutes = Router({ mergeParams: true });

transactionRoutes.get(
  '/',
  ...validate({ params: transactionBusinessParamSchema, query: transactionListQuerySchema }),
  requireBusinessAccess(),
  controller.list
);

transactionRoutes.get(
  '/:transactionId',
  ...validate({ params: transactionParamSchema }),
  requireBusinessAccess(),
  controller.detail
);

transactionRoutes.post(
  '/:transactionId/void',
  ...validate({ params: transactionParamSchema }),
  requireBusinessAccess(),
  controller.voidTransaction
);

export default transactionRoutes;
