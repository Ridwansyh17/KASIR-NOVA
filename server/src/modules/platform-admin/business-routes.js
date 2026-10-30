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
import Joi from 'joi';
import {
  businessParamSchema,
  assignSubscriptionSchema,
  subscriptionStatusSchema,
  listBusinessesQuerySchema,
  invoiceParamSchema,
} from './business-schema.js';
import {
  transactionListQuerySchema,
  transactionParamSchema,
} from '../transaction/schema.js';
import { reportRoutes } from '../report/routes.js';

const router = Router({ mergeParams: true });

const invoiceListQuerySchema = Joi.object({
  status: Joi.string().valid('pending','paid','failed','canceled','expired').allow(null,''),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

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

// Daftar tagihan langganan bisnis (untuk panel Admin)
router.get(
  '/:businessId/invoices',
  ...validate({ params: businessParamSchema, query: invoiceListQuerySchema }),
  requireBusinessAccess(),
  controller.listInvoices
);

// Batal tagihan pending (untuk pengujian gateway)
router.post(
  '/:businessId/invoices/:invoiceId/cancel',
  ...validate({ params: invoiceParamSchema }),
  requireBusinessAccess(),
  controller.cancelInvoice
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

// Laporan penjualan lintas platform (baca saja, sesuai matriks hak akses).
router.use('/:businessId/reports', reportRoutes);

export default router;
