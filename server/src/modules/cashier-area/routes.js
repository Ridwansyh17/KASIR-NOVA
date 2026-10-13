/**
 * Route area kasir — prefix `/api/cashier`.
 *
 * Hanya peran `cashier`. Tidak ada parameter tenant di URL: outlet kasir
 * diturunkan dari akun (middleware `loadScope` mengisi `req.cashierScope`),
 * sehingga tidak ada permukaan IDOR.
 *
 * Fase 1/2 menambah kelola produk & status stok; Fase 4 laporan harian;
 * Fase 5 pengeluaran outlet; plus histori pergerakan stok.
 */
import { Router } from 'express';
import { z } from 'zod';
import * as controller from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { getCashierScope } from './service.js';
import {
  createSaleSchema,
  cashierTransactionListQuerySchema,
  cashierTransactionParamSchema,
} from '../transaction/schema.js';
import {
  createProductSchema,
  updateProductSchema,
  cashierProductParamSchema,
  stockSchema,
  stockStatusSchema,
  productListQuerySchema,
} from '../product/schema.js';
import { cashierExpenseRoutes } from '../expense/routes.js';
import { financeQuerySchema } from '../report/schema.js';
import { createInventoryRouter } from '../inventory/routes.js';

const router = Router();

/** Muat scope kasir (bisnis, outlet, izin) sekali per request. */
const loadCashierScope = async (req, _res, next) => {
  try {
    req.cashierScope = await getCashierScope(req.user.id);
    next();
  } catch (err) {
    next(err);
  }
};

/** Produk: daftar boleh punya limit lebih besar untuk kasir (katalog). */
const cashierProductQuerySchema = productListQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const cashierOnly = [requireAuth, requireRole('cashier'), loadCashierScope];

// ------------------------------------------------------------------ Info ---
router.get('/me', ...cashierOnly, controller.me);

// ---------------------------------------------------------------- Produk ---
router.get(
  '/products',
  ...cashierOnly,
  ...validate({ query: cashierProductQuerySchema }),
  controller.listProducts
);

router.get('/categories', ...cashierOnly, controller.listCategories);

router.post(
  '/products',
  ...cashierOnly,
  ...validate({ body: createProductSchema }),
  controller.createProduct
);

router.patch(
  '/products/:productId',
  ...cashierOnly,
  ...validate({ params: cashierProductParamSchema, body: updateProductSchema }),
  controller.updateProduct
);

// Fase 2: tandai habis / aktifkan kembali.
router.patch(
  '/products/:productId/stock-status',
  ...cashierOnly,
  ...validate({ params: cashierProductParamSchema, body: stockStatusSchema }),
  controller.setStockStatus
);

// Isi/koreksi stok outlet kasir sendiri (outlet dari akun).
router.patch(
  '/products/:productId/stock',
  ...cashierOnly,
  ...validate({ params: cashierProductParamSchema, body: stockSchema }),
  controller.setStock
);

// ------------------------------------------------------------- Transaksi ---
router.post(
  '/transactions',
  ...cashierOnly,
  ...validate({ body: createSaleSchema }),
  controller.createTransaction
);

router.get(
  '/transactions',
  ...cashierOnly,
  ...validate({ query: cashierTransactionListQuerySchema }),
  controller.listTransactions
);

router.get(
  '/transactions/:transactionId',
  ...cashierOnly,
  ...validate({ params: cashierTransactionParamSchema }),
  controller.getTransaction
);

// ------------------------------------------------- Pengeluaran (Fase 5) ---
// Didelegasikan ke modul expense (satu implementasi untuk Owner & Kasir);
// outlet tetap diturunkan dari `req.cashierScope`.
router.use('/expenses', ...cashierOnly, cashierExpenseRoutes);

// ------------------------------------------------- Laporan harian (Fase 4) -
router.get(
  '/reports/daily',
  ...cashierOnly,
  ...validate({ query: financeQuerySchema }),
  controller.dailyReport
);

// ------------------------------------------- Histori pergerakan stok (Fase 2)
router.use('/inventory-movements', ...cashierOnly, createInventoryRouter({ scoped: 'cashier' }));

export default router;
