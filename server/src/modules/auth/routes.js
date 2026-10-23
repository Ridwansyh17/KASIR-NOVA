/**
 * Modul auth — endpoint:
 *   POST /api/auth/register-owner        pendaftaran Owner mandiri (publik)
 *   GET  /api/auth/firebase/verification-status  status halaman verifikasi
 *   POST /api/auth/firebase/verify-owner         cek & aktifkan via Firebase
 *   POST /api/auth/firebase/resend-verification  kirim ulang email Firebase
 *   GET  /api/auth/verify-email          verifikasi email (alur lama/manual)
 *   POST /api/auth/resend-verification   kirim ulang tautan (alur lama/manual)
 *   POST /api/auth/login    login per peran (dibatasi rate limit)
 *   POST /api/auth/refresh  rotasi refresh token
 *   POST /api/auth/logout   cabut sesi (butuh access token)
 *   POST /api/auth/change-password  ganti sandi sendiri (butuh access token)
 *   GET  /api/auth/me       info pengguna aktif (butuh access token)
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { validate } from '../../middleware/validate.js';
import {
  loginLimiter,
  pinLimiter,
  passwordLimiter,
  registerLimiter,
  resendVerificationLimiter,
  verificationStatusLimiter,
} from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  loginSchema,
  refreshSchema,
  cashierPinLoginSchema,
  cashierPinLookupSchema,
  changePasswordSchema,
  registerOwnerSchema,
  resendVerificationSchema,
  verifyEmailQuerySchema,
  firebaseVerificationStatusSchema,
  verifyFirebaseOwnerSchema,
  resendFirebaseVerificationSchema,
} from './schema.js';

const router = Router();

router.post(
  '/register-owner',
  registerLimiter,
  ...validate({ body: registerOwnerSchema }),
  controller.registerOwner
);
router.get(
  '/firebase/verification-status',
  verificationStatusLimiter,
  ...validate({ query: firebaseVerificationStatusSchema }),
  controller.firebaseVerificationStatus
);
router.post(
  '/firebase/verify-owner',
  verificationStatusLimiter,
  ...validate({ body: verifyFirebaseOwnerSchema }),
  controller.verifyFirebaseOwner
);
router.post(
  '/firebase/resend-verification',
  resendVerificationLimiter,
  ...validate({ body: resendFirebaseVerificationSchema }),
  controller.resendFirebaseVerification
);
router.get(
  '/verify-email',
  ...validate({ query: verifyEmailQuerySchema }),
  controller.verifyEmail
);
router.post(
  '/resend-verification',
  resendVerificationLimiter,
  ...validate({ body: resendVerificationSchema }),
  controller.resendVerification
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
