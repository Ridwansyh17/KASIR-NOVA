/**
 * Route modul inventori — pabrik router agar bisa dipasang di dua area:
 *   - Owner  : GET /api/owner/businesses/:businessId/inventory-movements
 *   - Kasir  : GET /api/cashier/inventory-movements (outlet dari akun kasir)
 *
 * Otorisasi peran ditegakkan router induk; scope bisnis Owner oleh
 * `requireBusinessAccess`, scope kasir oleh middleware tenant kasir.
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { validate } from '../../middleware/validate.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { movementListQuerySchema, movementBusinessParamSchema } from './schema.js';

/** @param {{ scoped?: 'business'|'cashier' }} opts */
export const createInventoryRouter = ({ scoped } = {}) => {
  const router = Router({ mergeParams: true });

  if (scoped === 'cashier') {
    router.get(
      '/',
      ...validate({ query: movementListQuerySchema }),
      controller.listScopedMovements
    );
    return router;
  }

  router.get(
    '/',
    ...validate({ params: movementBusinessParamSchema, query: movementListQuerySchema }),
    requireBusinessAccess(),
    controller.listMovements
  );
  return router;
};

export default createInventoryRouter;
