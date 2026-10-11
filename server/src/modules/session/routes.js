/**
 * Route modul sesi — dua subtree:
 *   - admin:  mounted di /api/platform/sessions
 *       GET  /               daftar kasir + jumlah sesi aktif
 *       POST /:cashierId/revoke   paksa logout semua sesi kasir
 *   - owner:  mounted di /api/owner/businesses/:businessId/cashiers/:cashierId/sessions
 *       GET  /               daftar sesi kasir milik bisnisnya
 *       POST /revoke         paksa logout semua sesi kasir miliknya
 *
 * Otorisasi peran ditegakkan router induk; scope bisnis Owner lewat
 * `requireBusinessAccess` (businessId dari URL).
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import { sessionListQuerySchema, cashierIdParamSchema, ownerSessionParamSchema } from './schema.js';

export const adminSessionRouter = (() => {
  const router = Router({ mergeParams: true });
  router.get('/', ...validate({ query: sessionListQuerySchema }), controller.listCashiers);
  router.post(
    '/:cashierId/revoke',
    ...validate({ params: cashierIdParamSchema }),
    controller.revokeAdmin
  );
  return router;
})();

export const ownerSessionRouter = (() => {
  const router = Router({ mergeParams: true });
  router.get(
    '/',
    ...validate({ params: ownerSessionParamSchema, query: sessionListQuerySchema }),
    requireBusinessAccess(),
    controller.listByCashier
  );
  router.post(
    '/revoke',
    ...validate({ params: ownerSessionParamSchema }),
    requireBusinessAccess(),
    controller.revokeOwner
  );
  return router;
})();

export default { adminSessionRouter, ownerSessionRouter };