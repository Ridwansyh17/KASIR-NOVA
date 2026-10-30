/**
 * Modul auth — endpoint publik pendaftaran:
 *   GET  /api/auth/registration-plans     paket aktif untuk pendaftaran
 *   POST /api/auth/register-owner         pendaftaran Owner (tanpa pembayaran)
 *   POST /api/auth/request-approval       simpan permintaan approval (idempoten)
 *   GET  /api/auth/registration-status    status pendaftaran via state
 *   POST /api/auth/login                  login per peran (rate limited)
 *   POST /api/auth/refresh                rotasi refresh token
 *   POST /api/auth/logout                 cabut sesi (butuh access token)
 *   POST /api/auth/change-password        ganti sandi sendiri (butuh token)
 *   GET  /api/auth/me                     info pengguna aktif (butuh token)
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { validate } from '../../middleware/validate.js';
import {
  loginLimiter,
  pinLimiter,
  passwordLimiter,
  registerLimiter,
  approvalRequestLimiter,
} from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  loginSchema,
  refreshSchema,
  cashierPinLoginSchema,
  cashierPinLookupSchema,
  changePasswordSchema,
  registerOwnerSchema,
  requestApprovalSchema,
  registrationStatusSchema,
} from './schema.js';

const router = Router();

router.get('/registration-plans', controller.registrationPlans);
router.post(
  '/register-owner',
  registerLimiter,
  ...validate({ body: registerOwnerSchema }),
  controller.registerOwner
);
router.post(
  '/request-approval',
  approvalRequestLimiter,
  ...validate({ body: requestApprovalSchema }),
  controller.requestApproval
);
router.get(
  '/registration-status',
  approvalRequestLimiter,
  ...validate({ query: registrationStatusSchema }),
  controller.registrationStatus
);
router.post('/login', loginLimiter, ...validate({ body: loginSchema }), controller.login);
router.post('/refresh', ...validate({ body: refreshSchema }), controller.refresh);
router.post('/logout', requireAuth, ...validate({ body: refreshSchema }), controller.logout);
router.post(
  '/change-password',
  requireAuth,
  passwordLimiter,
  ...validate({ body: changePasswordSchema }),
  controller.changePassword
);
router.get('/me', requireAuth, controller.me);
router.get(
  '/cashiers',
  ...validate({ query: cashierPinLookupSchema }),
  controller.listPinCashiers
);
router.post(
  '/cashier-pin',
  pinLimiter,
  ...validate({ body: cashierPinLoginSchema }),
  controller.loginCashierWithPin
);

export default router;
