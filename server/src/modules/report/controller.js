/** Controller modul laporan (Fase 9 + Fase 15 ekspor Excel + Fase 16 perbandingan) — tipis. */
import * as service from './service.js';

/** Kirim buffer .xlsx dengan header unduhan (nama berkas dari server). */
const sendXlsx = (res, { buffer, filename }) => {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
};

export const grouped = async (req, res, next) => {
  try {
    res.json(
      await service.groupedReport({ businessId: req.params.businessId, filters: req.query })
    );
  } catch (err) {
    next(err);
  }
};

export const summary = async (req, res, next) => {
  try {
    res.json(await service.summary({ businessId: req.params.businessId, filters: req.query }));
  } catch (err) {
    next(err);
  }
};

/** Laporan Transaksi siap-cetak (baris per item) — 17 Okt 2026. */
export const transactionReport = async (req, res, next) => {
  try {
    res.json(
      await service.transactionReport({ businessId: req.params.businessId, filters: req.query })
    );
  } catch (err) {
    next(err);
  }
};

/** Ekspor Excel laporan yang sama (satu baris per item) — 17 Okt 2026. */
export const transactionReportExport = async (req, res, next) => {
  try {
    sendXlsx(
      res,
      await service.exportTransactionReportXlsx({
        businessId: req.params.businessId,
        filters: req.query,
      })
    );
  } catch (err) {
    next(err);
  }
};

export const exportReport = async (req, res, next) => {
  try {
    const filters = req.query;
    const businessId = req.params.businessId;

    if (filters.format === 'xlsx') {
      sendXlsx(res, await service.exportXlsx({ businessId, filters }));
      return;
    }

    const rows = await service.exportRows({ businessId, filters });
    if (filters.format === 'json') {
      res.json({ items: rows });
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="transaksi-${businessId}.csv"`
    );
    res.send(service.toCsv(rows));
  } catch (err) {
    next(err);
  }
};

// ------------------------------------------------ Fase 16: perbandingan ---

/** Perbandingan outlet dalam satu bisnis (JSON). */
export const outletComparison = async (req, res, next) => {
  try {
    res.json(
      await service.outletComparison({ businessId: req.params.businessId, filters: req.query })
    );
  } catch (err) {
    next(err);
  }
};

/** Ekspor perbandingan outlet (xlsx default; json data mentah). */
export const outletComparisonExport = async (req, res, next) => {
  try {
    const filters = req.query;
    const businessId = req.params.businessId;
    if (filters.format === 'json') {
      res.json(await service.outletComparison({ businessId, filters }));
      return;
    }
    sendXlsx(res, await service.exportOutletComparisonXlsx({ businessId, filters }));
  } catch (err) {
    next(err);
  }
};

/** Perbandingan lintas-bisnis milik Owner (JSON). */
export const businessComparison = async (req, res, next) => {
  try {
    res.json(await service.businessComparison({ ownerId: req.user.id, filters: req.query }));
  } catch (err) {
    next(err);
  }
};

/** Ekspor perbandingan lintas-bisnis (xlsx default; json data mentah). */
export const businessComparisonExport = async (req, res, next) => {
  try {
    const filters = req.query;
    if (filters.format === 'json') {
      res.json(await service.businessComparison({ ownerId: req.user.id, filters }));
      return;
    }
    sendXlsx(res, await service.exportBusinessComparisonXlsx({ ownerId: req.user.id, filters }));
  } catch (err) {
    next(err);
  }
};

// ------------------------------------------- Fase 4/6: laporan keuangan ---

/** Ringkasan keuangan (pendapatan, HPP, pengeluaran, laba) — Fase 4 & 6. */
export const finance = async (req, res, next) => {
  try {
    res.json(
      await service.financeSummary({ businessId: req.params.businessId, filters: req.query })
    );
  } catch (err) {
    next(err);
  }
};

/** Ekspor laporan keuangan ke .xlsx. */
export const financeExport = async (req, res, next) => {
  try {
    sendXlsx(
      res,
      await service.exportFinanceXlsx({ businessId: req.params.businessId, filters: req.query })
    );
  } catch (err) {
    next(err);
  }
};

export default {
  grouped,
  summary,
  transactionReport,
  transactionReportExport,
  exportReport,
  outletComparison,
  outletComparisonExport,
  businessComparison,
  businessComparisonExport,
  finance,
  financeExport,
};