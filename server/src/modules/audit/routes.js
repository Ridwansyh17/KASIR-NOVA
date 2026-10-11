/**
 * Route modul audit — pabrik router agar bisa dipasang di dua area:
 *   - Admin  : GET /api/platform/audit-logs   (semua bisnis, tanpa scope)
 *   - Owner  : GET /api/owner/businesses/:businessId/audit-logs (scoped tenant)
 *
 * Otorisasi peran ditegakkan oleh router induk; scope bisnis Owner
 * ditegakkan oleh `requireBusinessAccess` di sini (oleh karena itu
 * businessId diambil dari params, bukan query).
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { validate } from '../../middleware/validate.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { listAuditQuerySchema, auditBusinessParamSchema } from './schema.js';

/** @param {{ scoped?: boolean }} opts - scoped=true untuk area Owner */
export const createAuditRouter = ({ scoped = false } = {}) => {
  // mergeParams: params induk (mis. :businessId) tersedia di router anak.
  const router = Router({ mergeParams: true });

  if (scoped) {
    router.get(
      '/',
      ...validate({ params: auditBusinessParamSchema, query: listAuditQuerySchema }),
      requireBusinessAccess(),
      controller.list
    );
  } else {
    router.get('/', ...validate({ query: listAuditQuerySchema }), controller.list);
  }

  return router;
};

export default createAuditRouter;