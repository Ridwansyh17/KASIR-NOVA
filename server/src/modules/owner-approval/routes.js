/**
 * Route Approval Center. Dipasang di bawah `/api/platform/approvals`
 * (parent router sudah menjalankan requireAuth + requireRole platform_admin).
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { validate } from '../../middleware/validate.js';
import {
  approvalIdParamSchema,
  listApprovalsQuerySchema,
  rejectApprovalSchema,
} from './schema.js';

const router = Router();

router.get('/', ...validate({ query: listApprovalsQuerySchema }), controller.list);
router.post(
  '/:id/approve',
  ...validate({ params: approvalIdParamSchema }),
  controller.approve
);
router.post(
  '/:id/reject',
  ...validate({ params: approvalIdParamSchema, body: rejectApprovalSchema }),
  controller.reject
);

export default router;
