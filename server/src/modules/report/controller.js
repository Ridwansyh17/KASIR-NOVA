/** Controller modul laporan (Fase 9 + Fase 15 ekspor Excel) — tipis. */
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
    const filters = req.query;
    const businessId = req.params.businessId;

    if (filters.format === 'xlsx') {
      const { buffer, filename } = await service.exportXlsx({ businessId, filters });
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
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

export default { grouped, summary, exportReport };