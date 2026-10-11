/**
 * Route admin: bisnis lintas platform & langganan bisnis.
 * Dipasang di bawah `/api/platform/businesses` (parent router menjalankan
 * gerbang requireAuth + requireRole('platform_admin')).
 */
import { Router } from 'express';
import * as controller from './business-controller.js';
import * as txController from '../transaction/controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import {
  businessParamSchema,
  assignSubscriptionSchema,
  subscriptionStatusSchema,
  listBusinessesQuerySchema,
} from './business-schema.js';
import {
  transactionListQuerySchema,
  transactionParamSchema,
} from '../transaction/schema.js';

const router = Router({ mergeParams: true });

router.get('/', ...validate({ query: listBusinessesQuerySchema }), controller.listBusinesses);

router.get(
  '/:businessId',
  ...validate({ params: businessParamSchema }),
  requireBusinessAccess(),
  controller.getBusiness
);

router.get(
  '/:businessId/subscription',
  ...validate({ params: businessParamSchema }),
  requireBusinessAccess(),
  controller.getSubscription
);

router.post(
  '/:businessId/subscription',
  ...validate({ params: businessParamSchema, body: assignSubscriptionSchema }),
  requireBusinessAccess(),
  controller.assignSubscription
);

router.patch(
  '/:businessId/subscription/status',
  ...validate({ params: businessParamSchema, body: subscriptionStatusSchema }),
  requireBusinessAccess(),
  controller.setSubscriptionStatus
);

// Transaksi lintas platform (baca saja, sesuai matriks hak akses).
router.get(
  '/:businessId/transactions',
  ...validate({ params: businessParamSchema, query: transactionListQuerySchema }),
  requireBusinessAccess(),
  txController.list
);

router.get(
  '/:businessId/transactions/:transactionId',
  ...validate({ params: transactionParamSchema }),
  requireBusinessAccess(),
  txController.detail
);

export default router;