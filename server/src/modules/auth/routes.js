/**
 * Modul auth — endpoint:
 *   POST /api/auth/login    login per peran (dibatasi rate limit)
 *   POST /api/auth/refresh  rotasi refresh token
 *   POST /api/auth/logout   cabut sesi (butuh access token)
 *   GET  /api/auth/me       info pengguna aktif (butuh access token)
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { validate } from '../../middleware/validate.js';
import { loginLimiter, pinLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { loginSchema, refreshSchema, cashierPinLoginSchema, cashierPinLookupSchema } from './schema.js';

const router = Router();

router.post('/login', loginLimiter, ...validate({ body: loginSchema }), controller.login);
router.post('/refresh', ...validate({ body: refreshSchema }), controller.refresh);
router.post('/logout', requireAuth, ...validate({ body: refreshSchema }), controller.logout);
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
