/**
 * Route paket langganan — dipasang di bawah `/api/platform/plans`.
 * Gerbang peran platform_admin dijalankan oleh parent router.
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { validate } from '../../middleware/validate.js';
import { createPlanSchema, updatePlanSchema, planParamSchema } from './schema.js';

const router = Router();

router.get('/', controller.listPlans);
router.post('/', ...validate({ body: createPlanSchema }), controller.createPlan);
router.get('/:id', ...validate({ params: planParamSchema }), controller.getPlan);
router.patch(
  '/:id',
  ...validate({ params: planParamSchema, body: updatePlanSchema }),
  controller.updatePlan
);

export default router;