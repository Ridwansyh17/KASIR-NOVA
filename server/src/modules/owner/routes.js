/**
 * Modul owner — seluruhnya WAJIB peran owner.
 *
 *   GET    /api/owner/businesses                  daftar bisnis milik owner
 *   POST   /api/owner/businesses                  buat bisnis baru
 *   GET    /api/owner/businesses/:businessId      detail (tenant-checked)
 *   PATCH  /api/owner/businesses/:businessId      ubah bisnis
 *   PATCH  /api/owner/businesses/:businessId/status  aktif/nonaktif
 *   GET    /api/owner/businesses/:businessId/subscription  lihat langganan
 *   ...    /api/owner/businesses/:businessId/outlets       kelola outlet
 *   ...    /api/owner/businesses/:businessId/cashiers      kelola kasir
 *
 * Middleware tenant memverifikasi kepemilikan business_id (anti-IDOR).
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import outletRoutes from '../outlet/routes.js';
import cashierRoutes from '../cashier/routes.js';
import { categoryRoutes, productRoutes } from '../product/routes.js';
import {
  createBusinessSchema,
  updateBusinessSchema,
  businessStatusSchema,
  businessParamSchema,
} from './schema.js';

const router = Router();

router.use(requireAuth, requireRole('owner'));

router.get('/businesses', controller.listBusinesses);
router.post(
  '/businesses',
  ...validate({ body: createBusinessSchema }),
  controller.createBusiness
);

router.get(
  '/businesses/:businessId',
  ...validate({ params: businessParamSchema }),
  requireBusinessAccess(),
  controller.getBusiness
);

router.patch(
  '/businesses/:businessId',
  ...validate({ params: businessParamSchema, body: updateBusinessSchema }),
  requireBusinessAccess(),
  controller.updateBusiness
);

router.patch(
  '/businesses/:businessId/status',
  ...validate({ params: businessParamSchema, body: businessStatusSchema }),
  requireBusinessAccess(),
  controller.setStatus
);

router.get(
  '/businesses/:businessId/subscription',
  ...validate({ params: businessParamSchema }),
  requireBusinessAccess(),
  controller.getSubscription
);

// Kelola outlet (sub-router dengan mergeParams agar :businessId tersedia).
router.use('/businesses/:businessId/outlets', outletRoutes);

// Kelola kasir (1 kasir = 1 outlet; kuota max_cashiers).
router.use('/businesses/:businessId/cashiers', cashierRoutes);

// Kelola produk & kategori (harga sen; stok per outlet).
router.use('/businesses/:businessId/categories', categoryRoutes);
router.use('/businesses/:businessId/products', productRoutes);

export default router;
