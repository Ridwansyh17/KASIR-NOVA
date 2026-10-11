/**
 * Controller modul kasir — tipis.
 */
import * as service from './service.js';

export const listCashiers = async (req, res, next) => {
  try {
    const items = await service.listCashiers(req.params.businessId);
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
};

export const createCashier = async (req, res, next) => {
  try {
    const cashier = await service.createCashier({
      businessId: req.params.businessId,
      data: req.body,
      actor: req.user,
      ip: req.ip,
    });
    res.status(201).json({ cashier });
  } catch (err) {
    next(err);
  }
};

export const getCashier = async (req, res, next) => {
  try {
    const cashier = await service.getCashier(req.params.businessId, req.params.cashierId);
    res.json({ cashier });
  } catch (err) {
    next(err);
  }
};

export const updateCashier = async (req, res, next) => {
  try {
    const cashier = await service.updateCashier(
      req.params.businessId,
      req.params.cashierId,
      req.body,
      req.user,
      req.ip
    );
    res.json({ cashier });
  } catch (err) {
    next(err);
  }
};

export const setStatus = async (req, res, next) => {
  try {
    const cashier = await service.setCashierStatus(
      req.params.businessId,
      req.params.cashierId,
      req.body.status,
      req.user,
      req.ip
    );
    res.json({ cashier });
  } catch (err) {
    next(err);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const result = await service.resetCashierPassword(
      req.params.businessId,
      req.params.cashierId,
      req.body.password,
      req.user,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export default { listCashiers, createCashier, getCashier, updateCashier, setStatus, resetPassword };