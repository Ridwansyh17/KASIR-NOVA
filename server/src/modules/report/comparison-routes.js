/**
 * Route laporan LINTAS-BISNIS (Fase 16) — khusus Owner.
 *
 * Dipasang di bawah `/api/owner/reports` (parent router Owner sudah menegakkan
 * `requireAuth` + `requireRole('owner')`). Cakupan tenant dijamin di service
 * dengan `WHERE bu.owner_id = $1`, sehingga Owner hanya melihat bisnisnya
 * sendiri (tanpa parameter `businessId` di URL).
 *
 *   GET /api/owner/reports/businesses          perbandingan tiap bisnis (JSON)
 *   GET /api/owner/reports/businesses/export   ekspor .xlsx (default) / json
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { validate } from '../../middleware/validate.js';
import {
  businessComparisonQuerySchema,
  businessComparisonExportQuerySchema,
} from './schema.js';

export const crossReportRoutes = Router();

crossReportRoutes.get(
  '/businesses',
  ...validate({ query: businessComparisonQuerySchema }),
  controller.businessComparison
);

crossReportRoutes.get(
  '/businesses/export',
  ...validate({ query: businessComparisonExportQuerySchema }),
  controller.businessComparisonExport
);

export default crossReportRoutes;
