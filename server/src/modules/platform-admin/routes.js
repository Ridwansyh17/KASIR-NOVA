/**
 * Modul platform-admin — seluruhnya WAJIB peran platform_admin.
 *
 *   GET    /api/platform/owners              daftar owner (cari/filter/paginasi)
 *   POST   /api/platform/owners              buat owner baru
 *   GET    /api/platform/owners/:id          detail owner
 *   PATCH  /api/platform/owners/:id          ubah data owner
 *   PATCH  /api/platform/owners/:id/status   suspend/aktivasi
 *   POST   /api/platform/owners/:id/password reset password
 *   DELETE /api/platform/owners/:id          soft delete
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

const router = Router();

// Gerbang tunggal: hanya Admin Platform.
router.use(requireAuth, requireRole('platform_admin'));

router.get('/owners', ...validate({ query: listOwnersQuerySchema }), controller.listOwners);
router.post('/owners', ...validate({ body: createOwnerSchema }), controller.createOwner);
router.get('/owners/:id', ...validate({ params: idParamSchema }), controller.getOwner);
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
