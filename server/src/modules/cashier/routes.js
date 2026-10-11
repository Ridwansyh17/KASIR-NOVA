/**
 * Route kasir — dipasang di bawah `/api/owner/businesses/:businessId/cashiers`.
 *
 * `mergeParams: true` agar `:businessId` dari parent tersedia di sini.
 * Setiap route: validasi -> verifikasi kepemilikan bisnis (tenant) ->
 * controller. Otorisasi peran owner dijalankan oleh parent router.
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import {
  createCashierSchema,
  updateCashierSchema,
  cashierParamSchema,
  businessParamSchema,
  cashierStatusSchema,
  resetPasswordSchema,
  pinActionSchema,
} from './schema.js';

const router = Router({ mergeParams: true });

router.get(
  '/',
  ...validate({ params: businessParamSchema }),
  requireBusinessAccess(),
  controller.listCashiers
);

router.post(
  '/',
  ...validate({ params: businessParamSchema, body: createCashierSchema }),
  requireBusinessAccess(),
  controller.createCashier
);

router.get(
  '/:cashierId',
  ...validate({ params: cashierParamSchema }),
  requireBusinessAccess(),
  controller.getCashier
);

router.patch(
  '/:cashierId',
  ...validate({ params: cashierParamSchema, body: updateCashierSchema }),
  requireBusinessAccess(),
  controller.updateCashier
);

router.patch(
  '/:cashierId/status',
  ...validate({ params: cashierParamSchema, body: cashierStatusSchema }),
  requireBusinessAccess(),
  controller.setStatus
);

router.post(
  '/:cashierId/password',
  ...validate({ params: cashierParamSchema, body: resetPasswordSchema }),
  requireBusinessAccess(),
  controller.resetPassword
);

router.post(
  '/:cashierId/pin',
  ...validate({ params: cashierParamSchema, body: pinActionSchema }),
  requireBusinessAccess(),
  controller.setPin
);

router.delete(
  '/:cashierId/pin',
  ...validate({ params: cashierParamSchema }),
  requireBusinessAccess(),
  controller.removePin
);

router.post(
  '/:cashierId/pin/unlock',
  ...validate({ params: cashierParamSchema }),
  requireBusinessAccess(),
  controller.unlockPin
);

export default router;