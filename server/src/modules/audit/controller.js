/**
 * Controller modul audit — baca log (append-only).
 */
import * as service from './service.js';

export const list = async (req, res, next) => {
  try {
    // Scope Owner: businessId WAJIB dari URL (ditegakkan middleware tenant),
    // bukan dari query, agar Owner tidak bisa membaca bisnis lain.
    const businessId = req.params.businessId ?? req.query.businessId ?? null;
    const result = await service.listAuditLogs({
      businessId,
      actorRole: req.query.actorRole ?? null,
      action: req.query.action ?? null,
      entityType: req.query.entityType ?? null,
      from: req.query.from ?? null,
      to: req.query.to ?? null,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({
      items: result.items,
      total: result.total,
      limit: req.query.limit,
      offset: req.query.offset,
    });
  } catch (err) {
    next(err);
  }
};

export default { list };