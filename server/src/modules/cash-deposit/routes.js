/**
 * Route modul setoran kas (Deposit) — dua area:
 *   - Owner : /api/owner/businesses/:businessId/cash-deposits
 *   - Kasir : /api/cashier/cash-deposits  (outlet dari akun, bukan dari URL/query)
 *
 * Otorisasi peran ditegakkan router induk; scope bisnis Owner oleh
 * `requireBusinessAccess`.
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
  cashDepositParamSchema,
  cashierCashDepositParamSchema,
} from './schema.js';

const businessParam = z.object({ businessId: z.string().uuid('ID bisnis tidak valid') });

// --------------------------------------------------------------- Owner -----
export const cashDepositRoutes = Router({ mergeParams: true });

cashDepositRoutes.get(
  '/',
  ...validate({ params: businessParam, query: cashDepositListQuerySchema }),
  requireBusinessAccess(),
  controller.list
);

cashDepositRoutes.post(
  '/',
  ...validate({ params: businessParam, body: createCashDepositOwnerSchema }),
  requireBusinessAccess(),
  controller.create
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

cashierCashDepositRoutes.post(
  '/',
  ...validate({ body: createCashDepositSchema }),
  controller.createScoped
);

cashierCashDepositRoutes.post(
  '/:depositId/void',
  ...validate({ params: cashierCashDepositParamSchema, body: voidCashDepositSchema }),
  controller.voidScoped
);

export default cashDepositRoutes;
