/**
 * Controller area kasir — tipis.
 *
 * Outlet/bisnis SELALU diturunkan dari akun kasir (`req.cashierScope`), bukan
 * dari parameter URL — mencegah IDOR lintas outlet.
 *
 * Fase 1/2: kasir dapat menambah/mengubah produk & menandai stok habis.
 * Fase 4 : kasir melihat laporan pendapatan harian outletnya.
 * Fase 5 : kasir mencatat pengeluaran outletnya.
 */
import { query } from '../../config/db.js';
import * as service from './service.js';
import * as productService from '../product/service.js';
import * as transactionService from '../transaction/service.js';
import * as reportService from '../report/service.js';
// ---------------------------------------------------------------- Produk ----
export const listProducts = async (req, res, next) => {
  try {
    res.json(await service.listOutletProducts({ cashierId: req.user.id, filters: req.query }));
  } catch (err) {
    next(err);
  }
};

export const listCategories = async (req, res, next) => {
  try {
    const businessId = req.cashierScope.business_id;
    const { rows } = await query(
      `SELECT c.id, c.name, c.created_at,
              (SELECT count(*) FROM products p
                WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count
         FROM product_categories c
        WHERE c.business_id = $1
        ORDER BY c.name ASC`,
      [businessId]
    );
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const includeCost = Boolean(scope.can_view_profit);
    const product = await productService.createProduct({
      businessId: scope.business_id,
      data: req.body,
      actor: req.user,
      ip: req.ip,
      includeCost,
      outletId: scope.outlet_id,
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const product = await productService.updateProduct(
      scope.business_id,
      req.params.productId,
      req.body,
      req.user,
      req.ip,
      { includeCost: Boolean(scope.can_view_profit) }
    );
    res.json({ product });
  } catch (err) {
    next(err);
  }
};

export const setStockStatus = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const result = await productService.setStockStatus(
      scope.business_id,
      req.params.productId,
      req.body,
      req.user,
      req.ip,
      { outletId: scope.outlet_id, includeCost: Boolean(scope.can_view_profit) }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const setStock = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const stock = await productService.setStock(
      scope.business_id,
      req.params.productId,
      scope.outlet_id,
      req.body.quantity,
      req.user,
      req.ip,
      { reason: req.body.reason ?? null }
    );
    res.json({ stock });
  } catch (err) {
    next(err);
  }
};

// ------------------------------------------------------------- Transaksi ----
export const createTransaction = async (req, res, next) => {
  try {
    const { transaction, idempotent } = await transactionService.createSale({
      cashierId: req.user.id,
      data: req.body,
      ip: req.ip,
    });
    res.status(idempotent ? 200 : 201).json({ transaction, idempotent });
  } catch (err) {
    next(err);
  }
};

export const listTransactions = async (req, res, next) => {
  try {
    res.json(
      await transactionService.listOutletTransactions({
        cashierId: req.user.id,
        filters: req.query,
      })
    );
  } catch (err) {
    next(err);
  }
};

export const getTransaction = async (req, res, next) => {
  try {
    res.json(
      await transactionService.getOutletTransaction(req.user.id, req.params.transactionId)
    );
  } catch (err) {
    next(err);
  }
};

// ------------------------------------------------- Laporan harian (Fase 4) --
/**
 * Laporan pendapatan harian outlet kasir. Bila kasir TIDAK berizin melihat
 * laba, field HPP & laba dihapus dari respons (penegakan di server).
 */
export const dailyReport = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const filters = { ...req.query };
    if (!filters.date && !filters.period && !filters.from && !filters.to) {
      filters.period = 'today';
    }
    const data = await reportService.financeSummary({
      businessId: scope.business_id,
      filters,
      outletId: scope.outlet_id,
    });
    const allowProfit = Boolean(scope.can_view_profit);
    if (!allowProfit) {
      delete data.hpp;
      delete data.gross_profit;
      delete data.net_profit;
      for (const outlet of data.outlets) {
        delete outlet.hpp;
        delete outlet.gross_profit;
        delete outlet.net_profit;
      }
    }
    res.json({ ...data, can_view_profit: allowProfit });
  } catch (err) {
    next(err);
  }
};

// --------------------------------------------- Grafik penjualan (Beranda) ---
/**
 * Seri omzet per hari untuk grafik "7 hari terakhir" di Beranda kasir.
 *
 * Memakai agregasi laporan yang sudah teruji (`groupedReport`) dengan sumber
 * data yang SAMA seperti laporan harian, sehingga angka Beranda tidak pernah
 * berbeda dari tab Laporan. Outlet diturunkan dari akun kasir (bukan URL).
 *
 * Hanya omzet & jumlah transaksi (tanpa HPP/laba), sehingga aman untuk kasir
 * yang tidak berizin melihat laba.
 */
export const dailySeries = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const requested = req.query.period ?? 'week';
    const period = requested === 'today' ? 'week' : requested;
    const range = await reportService.resolveFinanceRange(scope.timezone, { period });
    const rows = await reportService.groupedReport({
      businessId: scope.business_id,
      filters: {
        from: range.from,
        to: range.to,
        groupBy: 'day',
        outletId: scope.outlet_id,
      },
    });
    res.json({
      period: { from: range.from, to: range.to, preset: range.period },
      outlet: { id: scope.outlet_id, name: scope.outlet_name },
      points: rows.map((r) => ({
        date: r.period_start,
        transactions: r.transactions,
        total: r.total,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------- Laporan transaksi outlet kasir (17 Okt) --
/**
 * Kirim buffer .xlsx dengan header unduhan (nama berkas dibuat server).
 * Sama seperti `report/controller.js` — sengaja lokal agar kedua modul tidak
 * saling bergantung hanya untuk 3 baris header.
 */
const sendXlsx = (res, { buffer, filename }) => {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
};

/**
 * Siapkan filter dari query: rentang dihitung di SERVER memakai zona waktu
 * bisnis (bawaan "hari ini"), lalu `outletId` dipaksa dari akun kasir.
 * Kasir tidak dapat meminta outlet lain — tidak ada permukaan IDOR.
 */
const cashierReportFilters = async (scope, query = {}) => {
  const range = await reportService.resolveFinanceRange(scope.timezone, query);
  return { ...query, from: range.from, to: range.to };
};

/**
 * Laporan Transaksi untuk kasir: SATU BARIS PER TRANSAKSI pada outletnya
 * (keputusan pemilik B1) — cakupan semua kasir outlet (keputusan A5a).
 */
export const reportTransactions = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const filters = await cashierReportFilters(scope, req.query);
    res.json(
      await reportService.cashierTransactionReport({
        businessId: scope.business_id,
        outletId: scope.outlet_id,
        filters,
      })
    );
  } catch (err) {
    next(err);
  }
};

/** Unduh laporan transaksi kasir sebagai .xlsx (angka sama dengan layar). */
export const reportTransactionsExport = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const filters = await cashierReportFilters(scope, req.query);
    sendXlsx(
      res,
      await reportService.exportCashierTransactionReportXlsx({
        businessId: scope.business_id,
        outletId: scope.outlet_id,
        filters,
      })
    );
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------- Info -----
/** Info outlet/bisnis + izin kasir (dipakai UI untuk menyesuaikan tampilan). */
export const me = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    res.json({
      business: { id: scope.business_id, name: scope.business_name, timezone: scope.timezone },
      outlet: { id: scope.outlet_id, name: scope.outlet_name },
      permissions: { can_view_profit: Boolean(scope.can_view_profit) },
    });
  } catch (err) {
    next(err);
  }
};

export default {
  listProducts,
  listCategories,
  createProduct,
  updateProduct,
  setStockStatus,
  setStock,
  createTransaction,
  listTransactions,
  getTransaction,
  dailyReport,
  dailySeries,
  me,
};
