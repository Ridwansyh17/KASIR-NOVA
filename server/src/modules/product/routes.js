/**
 * Route produk & kategori — dipasang di bawah
 * `/api/owner/businesses/:businessId/{categories,products}`.
 *
 * `mergeParams: true` agar `:businessId` dari parent tersedia.
 * Otorisasi peran owner + verifikasi kepemilikan bisnis oleh parent router
 * (requireBusinessAccess) — setiap route juga memvalidasi body/query.
 */
import { Router } from 'express';
import * as controller from './controller.js';
import { requireBusinessAccess } from '../../middleware/tenant.js';
import { validate } from '../../middleware/validate.js';
import {
  categorySchema,
  categoryPatchSchema,
  createProductSchema,
  updateProductSchema,
  productParamSchema,
  categoryParamSchema,
  stockSchema,
  stockParamSchema,
  productListQuerySchema,
} from './schema.js';

export const categoryRoutes = Router({ mergeParams: true });

categoryRoutes.get(
  '/',
  ...validate({ params: categoryParamSchema.pick({ businessId: true }) }),
  requireBusinessAccess(),
  controller.listCategories
);
categoryRoutes.post(
  '/',
  ...validate({ params: categoryParamSchema.pick({ businessId: true }), body: categorySchema }),
  requireBusinessAccess(),
  controller.createCategory
);
categoryRoutes.patch(
  '/:categoryId',
  ...validate({ params: categoryParamSchema, body: categoryPatchSchema }),
  requireBusinessAccess(),
  controller.updateCategory
);
categoryRoutes.delete(
  '/:categoryId',
  ...validate({ params: categoryParamSchema }),
  requireBusinessAccess(),
  controller.deleteCategory
);

export const productRoutes = Router({ mergeParams: true });

productRoutes.get(
  '/',
  ...validate({ params: productParamSchema.pick({ businessId: true }), query: productListQuerySchema }),
  requireBusinessAccess(),
  controller.listProducts
);
productRoutes.post(
  '/',
  ...validate({ params: productParamSchema.pick({ businessId: true }), body: createProductSchema }),
  requireBusinessAccess(),
  controller.createProduct
);
productRoutes.get(
  '/:productId',
  ...validate({ params: productParamSchema }),
  requireBusinessAccess(),
  controller.getProduct
);
productRoutes.patch(
  '/:productId',
  ...validate({ params: productParamSchema, body: updateProductSchema }),
  requireBusinessAccess(),
  controller.updateProduct
);
productRoutes.delete(
  '/:productId',
  ...validate({ params: productParamSchema }),
  requireBusinessAccess(),
  controller.deleteProduct
);
productRoutes.patch(
  '/:productId/stocks/:outletId',
  ...validate({ params: stockParamSchema, body: stockSchema }),
  requireBusinessAccess(),
  controller.setStock
);