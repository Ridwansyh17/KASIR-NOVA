/**
 * Route admin: bisnis lintas platform & langganan bisnis.
 * Dipasang di bawah `/api/platform/businesses` (parent router menjalankan
 * gerbang requireAuth + requireRole('platform_admin')).
 */
import { Router } from 'express';
import * as controller from './business-controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import {
  businessParamSchema,
  assignSubscriptionSchema,
  subscriptionStatusSchema,
  listBusinessesQuerySchema,
} from './business-schema.js';

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

export default router;