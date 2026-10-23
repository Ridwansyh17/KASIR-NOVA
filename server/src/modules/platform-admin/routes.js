/**
 * Modul platform-admin — seluruhnya WAJIB peran platform_admin.
 *
 *   GET    /api/platform/owners              daftar owner (cari/filter/paginasi)
 *   POST   /api/platform/owners              buat owner baru
 *   GET    /api/platform/owners/:id          detail owner
 *   POST   /api/platform/owners/:id/verify   verifikasi manual akun pending lama (WhatsApp)
 *   PATCH  /api/platform/owners/:id          ubah data owner
 *   PATCH  /api/platform/owners/:id/status   suspend/aktivasi
 *   POST   /api/platform/owners/:id/password reset password
 *   DELETE /api/platform/owners/:id          soft delete
 *   GET    /api/platform/plans               daftar paket langganan
 *   POST   /api/platform/plans               buat paket langganan
 *   GET/PATCH /api/platform/plans/:id        detail/ubah paket langganan
 *   GET    /api/platform/businesses          daftar semua bisnis
 *   GET    /api/platform/businesses/:id      detail bisnis
 *   GET    /api/platform/businesses/:id/subscription       lihat langganan
 *   POST   /api/platform/businesses/:id/subscription       pasang paket
 *   PATCH  /api/platform/businesses/:id/subscription/status ubah status langganan
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  createOwnerSchema,
  updateOwnerSchema,
  statusSchema,
  resetPasswordSchema,
  listOwnersQuerySchema,
  idParamSchema,
} from './schema.js';
import plansRouter from '../plans/routes.js';
import businessRouter from './business-routes.js';
import { createAuditRouter } from '../audit/routes.js';
import { adminSessionRouter } from '../session/routes.js';
import * as cashDepositController from '../cash-deposit/controller.js';
import { platformCashDepositQuerySchema } from '../cash-deposit/schema.js';

const router = Router();

// Gerbang tunggal: hanya Admin Platform.
router.use(requireAuth, requireRole('platform_admin'));

router.use('/plans', plansRouter);
router.use('/businesses', businessRouter);
router.use('/audit-logs', createAuditRouter());
router.use('/sessions', adminSessionRouter);

// Monitoring setoran kasir lintas bisnis (read-only; kewenangan Platform Admin).
router.get(
  '/cash-settlements',
  ...validate({ query: platformCashDepositQuerySchema }),
  cashDepositController.platformList
);

router.get('/owners', ...validate({ query: listOwnersQuerySchema }), controller.listOwners);
router.post('/owners', ...validate({ body: createOwnerSchema }), controller.createOwner);
router.get('/owners/:id', ...validate({ params: idParamSchema }), controller.getOwner);
router.post(
  '/owners/:id/verify',
  ...validate({ params: idParamSchema }),
  controller.verifyOwner
);
router.patch(
  '/owners/:id',
  ...validate({ params: idParamSchema, body: updateOwnerSchema }),
  controller.updateOwner
);
router.patch(
  '/owners/:id/status',
  ...validate({ params: idParamSchema, body: statusSchema }),
  controller.setStatus
);
router.post(
  '/owners/:id/password',
  ...validate({ params: idParamSchema, body: resetPasswordSchema }),
  controller.resetPassword
);
router.delete('/owners/:id', ...validate({ params: idParamSchema }), controller.softDelete);

export default router;
