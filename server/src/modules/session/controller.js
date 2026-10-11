/**
 * Controller modul sesi.
 */
import * as service from './service.js';

export const listCashiers = async (req, res, next) => {
  try {
    const items = await service.listCashierSessions({ limit: req.query.limit });
    res.json({ items, total: items.length, limit: req.query.limit });
  } catch (err) {
    next(err);
  }
};

export const listByCashier = async (req, res, next) => {
  try {
    const items = await service.listSessionsByCashier({
      cashierId: req.params.cashierId,
      businessId: req.params.businessId,
      limit: req.query.limit,
    });
    res.json({ items, total: items.length, limit: req.query.limit });
  } catch (err) {
    next(err);
  }
};

export const revokeAdmin = async (req, res, next) => {
  try {
    const result = await service.revokeCashierByAdmin({
      cashierId: req.params.cashierId,
      actor: req.user,
      ip: req.ip,
    });
    res.json({ ...result, message: 'Semua sesi kasir dicabut' });
  } catch (err) {
    next(err);
  }
};

export const revokeOwner = async (req, res, next) => {
  try {
    const result = await service.revokeCashierByOwner({
      businessId: req.params.businessId,
      cashierId: req.params.cashierId,
      actor: req.user,
      ip: req.ip,
    });
    res.json({ ...result, message: 'Semua sesi kasir dicabut' });
  } catch (err) {
    next(err);
  }
};

export default { listCashiers, listByCashier, revokeAdmin, revokeOwner };