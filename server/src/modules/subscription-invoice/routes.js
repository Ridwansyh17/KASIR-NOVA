/**
 * Route tagihan langganan, dipasang di bawah
 * `/api/owner/businesses/:businessId/subscription`.
 *
 * `mergeParams: true` agar `:businessId` dari parent tersedia di sini.
 * Setiap route: validasi input -> verifikasi kepemilikan bisnis (anti-IDOR) ->
 * controller. Otorisasi peran `owner` sudah dijalankan parent router.
 *
 *   GET  /plans                 paket yang bisa dibeli + status gateway
 *   GET  /payment-methods       (bagian dari /plans — disediakan untuk kejelasan)
 *   GET  /invoices              riwayat tagihan
 *   POST /invoices              buat tagihan (VA/QRIS)
 *   GET  /invoices/:invoiceId   detail tagihan
 *   POST /invoices/:invoiceId/sync  cek status ke gateway (manual)
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import { invoiceSyncLimiter } from '../../middleware/rateLimit.js';
import {
  createInvoiceSchema,
  invoiceParamSchema,
  listInvoicesQuerySchema,
  subscriptionBusinessParamSchema,
} from './schema.js';

const router = Router({ mergeParams: true });

router.get(
  '/plans',
  ...validate({ params: subscriptionBusinessParamSchema }),
  requireBusinessAccess(),
  controller.getCheckoutOptions
);

router.get(
  '/invoices',
  ...validate({ params: subscriptionBusinessParamSchema, query: listInvoicesQuerySchema }),
  requireBusinessAccess(),
  controller.listInvoices
);

router.post(
  '/invoices',
  ...validate({ params: subscriptionBusinessParamSchema, body: createInvoiceSchema }),
  requireBusinessAccess(),
  controller.createInvoice
);

router.get(
  '/invoices/:invoiceId',
  ...validate({ params: invoiceParamSchema }),
  requireBusinessAccess(),
  controller.getInvoice
);

router.post(
  '/invoices/:invoiceId/sync',
  invoiceSyncLimiter,
  ...validate({ params: invoiceParamSchema }),
  requireBusinessAccess(),
  controller.syncInvoice
);

export default router;
