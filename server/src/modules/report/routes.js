/**
 * Route laporan — dipasang di bawah
 * `/businesses/:businessId/reports` (Owner) dan nama sama pada Admin
 * (baca saja lintas platform). Otorisasi + cakupan tenant via
 * `requireBusinessAccess`.
 *
 * Fase 16 menambah perbandingan OUTLET (satu bisnis) di `/outlets`.
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import {
  reportBusinessParamSchema,
  reportQuerySchema,
  summaryQuerySchema,
  transactionReportQuerySchema,
  transactionReportExportQuerySchema,
  exportQuerySchema,
  outletComparisonQuerySchema,
  outletComparisonExportQuerySchema,
  financeQuerySchema,
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

// Laporan Transaksi siap-cetak (17 Okt 2026) — baris per ITEM.
reportRoutes.get(
  '/transactions',
  ...validate({ params: reportBusinessParamSchema, query: transactionReportQuerySchema }),
  requireBusinessAccess(),
  controller.transactionReport
);

// Ekspor Excel laporan yang SAMA (baris per item) — 17 Okt 2026.
reportRoutes.get(
  '/transactions/export',
  ...validate({ params: reportBusinessParamSchema, query: transactionReportExportQuerySchema }),
  requireBusinessAccess(),
  controller.transactionReportExport
);

reportRoutes.get(
  '/outlets',
  ...validate({ params: reportBusinessParamSchema, query: outletComparisonQuerySchema }),
  requireBusinessAccess(),
  controller.outletComparison
);

reportRoutes.get(
  '/outlets/export',
  ...validate({ params: reportBusinessParamSchema, query: outletComparisonExportQuerySchema }),
  requireBusinessAccess(),
  controller.outletComparisonExport
);

reportRoutes.get(
  '/export',
  ...validate({ params: reportBusinessParamSchema, query: exportQuerySchema }),
  requireBusinessAccess(),
  controller.exportReport
);

// Fase 4/6: ringkasan keuangan & ekspor laporan keuangan.
reportRoutes.get(
  '/finance',
  ...validate({ params: reportBusinessParamSchema, query: financeQuerySchema }),
  requireBusinessAccess(),
  controller.finance
);

reportRoutes.get(
  '/finance/export',
  ...validate({ params: reportBusinessParamSchema, query: financeQuerySchema }),
  requireBusinessAccess(),
  controller.financeExport
);

export default reportRoutes;