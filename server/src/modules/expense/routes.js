/**
 * Route modul pengeluaran outlet (Fase 5) — dua area:
 *   - Owner : /api/owner/businesses/:businessId/expenses
 *   - Kasir : /api/cashier/expenses  (outlet dari akun, bukan dari URL/query)
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
  createExpenseSchema,
  createExpenseOwnerSchema,
  voidExpenseSchema,
  expenseListQuerySchema,
  expenseParamSchema,
  cashierExpenseParamSchema,
} from './schema.js';

const businessParam = z.object({ businessId: z.string().uuid('ID bisnis tidak valid') });

// --------------------------------------------------------------- Owner -----
export const expenseRoutes = Router({ mergeParams: true });

expenseRoutes.get(
  '/',
  ...validate({ params: businessParam, query: expenseListQuerySchema }),
  requireBusinessAccess(),
  controller.list
);

expenseRoutes.post(
  '/',
  ...validate({ params: businessParam, body: createExpenseOwnerSchema }),
  requireBusinessAccess(),
  controller.create
);

expenseRoutes.post(
  '/:expenseId/void',
  ...validate({ params: expenseParamSchema, body: voidExpenseSchema }),
  requireBusinessAccess(),
  controller.voidExpense
);

// -------------------------------------------------------------- Kasir ------
export const cashierExpenseRoutes = Router();

cashierExpenseRoutes.get(
  '/',
  ...validate({ query: expenseListQuerySchema }),
  controller.listScoped
);

cashierExpenseRoutes.post(
  '/',
  ...validate({ body: createExpenseSchema }),
  controller.createScoped
);

cashierExpenseRoutes.post(
  '/:expenseId/void',
  ...validate({ params: cashierExpenseParamSchema, body: voidExpenseSchema }),
  controller.voidScoped
);

export default expenseRoutes;
