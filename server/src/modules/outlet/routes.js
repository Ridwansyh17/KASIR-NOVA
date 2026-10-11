/**
 * Route outlet — dipasang di bawah `/api/owner/businesses/:businessId/outlets`.
 *
 * `mergeParams: true` agar `:businessId` dari parent tersedia di sini.
 * Setiap route: validasi param -> verifikasi kepemilikan bisnis (tenant
 * middleware) -> controller. Otorisasi peran owner sudah dijalankan oleh
 * parent router.
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import {
  createOutletSchema,
  updateOutletSchema,
  outletParamSchema,
  businessParamSchema,
} from './schema.js';

const router = Router({ mergeParams: true });

router.get(
  '/',
  ...validate({ params: businessParamSchema }),
  requireBusinessAccess(),
  controller.listOutlets
);

router.post(
  '/',
  ...validate({ params: businessParamSchema, body: createOutletSchema }),
  requireBusinessAccess(),
  controller.createOutlet
);

router.get(
  '/:outletId',
  ...validate({ params: outletParamSchema }),
  requireBusinessAccess(),
  controller.getOutlet
);

router.patch(
  '/:outletId',
  ...validate({ params: outletParamSchema, body: updateOutletSchema }),
  requireBusinessAccess(),
  controller.updateOutlet
);

router.delete(
  '/:outletId',
  ...validate({ params: outletParamSchema }),
  requireBusinessAccess(),
  controller.deleteOutlet
);

export default router;