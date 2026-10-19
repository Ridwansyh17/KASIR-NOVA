/**
 * Route modul setoran kasir — dua area:
 *   - Owner : /api/owner/businesses/:businessId/cash-deposits
 *   - Kasir : /api/cashier/cash-deposits  (outlet dari akun, bukan dari URL/query)
 *
 * Endpoint settlement (migrasi 0012) dipisah dari endpoint legacy agar kontrak
 * lama tetap kompatibel.
 */
import { Router } from 'express';
import { z } from 'zod';
import * as controller from './controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import {
  createCashDepositSchema,
  createCashDepositOwnerSchema,
  voidCashDepositSchema,
  cashDepositListQuerySchema,
  cashierSettlementSchema,
  ownerSettlementSchema,
  completeSettlementSchema,
  settlementPreviewQuerySchema,
  cashDepositReportQuerySchema,
  cashDepositParamSchema,
  cashierCashDepositParamSchema,
} from './schema.js';

const businessParam = z.object({ businessId: z.string().uuid('ID bisnis tidak valid') });

const ownerPreviewSchema = settlementPreviewQuerySchema.extend({
  outletId: z.string().uuid('ID outlet tidak valid'),
});

// --------------------------------------------------------------- Owner -----
export const cashDepositRoutes = Router({ mergeParams: true });

cashDepositRoutes.get(
  '/',
  ...validate({ params: businessParam, query: cashDepositListQuerySchema }),
  requireBusinessAccess(),
  controller.list
);

cashDepositRoutes.get(
  '/report',
  ...validate({ params: businessParam, query: cashDepositReportQuerySchema }),
  requireBusinessAccess(),
  controller.report
);

cashDepositRoutes.get(
  '/export',
  ...validate({ params: businessParam, query: cashDepositListQuerySchema }),
  requireBusinessAccess(),
  controller.exportXlsx
);

cashDepositRoutes.get(
  '/settlement/preview',
  ...validate({ params: businessParam, query: ownerPreviewSchema }),
  requireBusinessAccess(),
  controller.preview
);

cashDepositRoutes.post(
  '/settlement',
  ...validate({ params: businessParam, body: ownerSettlementSchema }),
  requireBusinessAccess(),
  controller.createSettlement
);

cashDepositRoutes.post(
  '/',
  ...validate({ params: businessParam, body: createCashDepositOwnerSchema }),
  requireBusinessAccess(),
  controller.create
);

cashDepositRoutes.get(
  '/:depositId',
  ...validate({ params: cashDepositParamSchema }),
  requireBusinessAccess(),
  controller.detail
);

cashDepositRoutes.patch(
  '/:depositId/complete',
  ...validate({ params: cashDepositParamSchema, body: completeSettlementSchema }),
  requireBusinessAccess(),
  controller.complete
);

cashDepositRoutes.delete(
  '/:depositId',
  ...validate({ params: cashDepositParamSchema }),
  requireBusinessAccess(),
  controller.removeDraft
);

cashDepositRoutes.post(
  '/:depositId/void',
  ...validate({ params: cashDepositParamSchema, body: voidCashDepositSchema }),
  requireBusinessAccess(),
  controller.voidDeposit
);

// -------------------------------------------------------------- Kasir ------
export const cashierCashDepositRoutes = Router();

cashierCashDepositRoutes.get(
  '/',
  ...validate({ query: cashDepositListQuerySchema }),
  controller.listScoped
);

cashierCashDepositRoutes.get(
  '/settlement/preview',
  ...validate({ query: settlementPreviewQuerySchema }),
  controller.previewScoped
);

cashierCashDepositRoutes.post(
  '/settlement',
  ...validate({ body: cashierSettlementSchema }),
  controller.createSettlementScoped
);

cashierCashDepositRoutes.post(
  '/',
  ...validate({ body: createCashDepositSchema }),
  controller.createScoped
);

cashierCashDepositRoutes.get(
  '/:depositId',
  ...validate({ params: cashierCashDepositParamSchema }),
  controller.detailScoped
);

cashierCashDepositRoutes.patch(
  '/:depositId/complete',
  ...validate({ params: cashierCashDepositParamSchema, body: completeSettlementSchema }),
  controller.completeScoped
);

cashierCashDepositRoutes.delete(
  '/:depositId',
  ...validate({ params: cashierCashDepositParamSchema }),
  controller.removeDraftScoped
);

cashierCashDepositRoutes.post(
  '/:depositId/void',
  ...validate({ params: cashierCashDepositParamSchema, body: voidCashDepositSchema }),
  controller.voidScoped
);

export default cashDepositRoutes;
