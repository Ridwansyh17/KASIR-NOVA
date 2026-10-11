/**
 * Route laporan — dipasang di bawah
 * `/businesses/:businessId/reports` (Owner) dan nama sama pada Admin
 * (baca saja lintas platform). Otorisasi + cakupan tenant via
 * `requireBusinessAccess`.
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import {
  reportBusinessParamSchema,
  reportQuerySchema,
  summaryQuerySchema,
  exportQuerySchema,
} from './schema.js';

export const reportRoutes = Router({ mergeParams: true });

reportRoutes.get(
  '/',
  ...validate({ params: reportBusinessParamSchema, query: reportQuerySchema }),
  requireBusinessAccess(),
  controller.grouped
);

reportRoutes.get(
  '/summary',
  ...validate({ params: reportBusinessParamSchema, query: summaryQuerySchema }),
  requireBusinessAccess(),
  controller.summary
);

reportRoutes.get(
  '/export',
  ...validate({ params: reportBusinessParamSchema, query: exportQuerySchema }),
  requireBusinessAccess(),
  controller.exportReport
);

export default reportRoutes;