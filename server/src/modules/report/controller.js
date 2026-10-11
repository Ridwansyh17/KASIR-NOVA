/** Controller modul laporan (Fase 9) — tipis. */
import * as service from './service.js';

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

export const exportReport = async (req, res, next) => {
  try {
    const rows = await service.exportRows({
      businessId: req.params.businessId,
      filters: req.query,
    });
    if (req.query.format === 'json') {
      res.json({ items: rows });
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="transaksi-${req.params.businessId}.csv"`
    );
    res.send(service.toCsv(rows));
  } catch (err) {
    next(err);
  }
};

export default { grouped, summary, exportReport };