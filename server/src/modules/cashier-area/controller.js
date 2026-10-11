/**
 * Controller area kasir — tipis.
 *
 * Outlet/bisnis SELALU diturunkan dari akun kasir (req.user.id), bukan dari
 * parameter URL — mencegah IDOR lintas outlet.
 */
import * as service from './service.js';
import * as transactionService from '../transaction/service.js';

export const listProducts = async (req, res, next) => {
  try {
    const result = await service.listOutletProducts({
      cashierId: req.user.id,
      filters: req.query,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

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
    const transaction = await transactionService.getOutletTransaction(
      req.user.id,
      req.params.transactionId
    );
    res.json({ transaction });
  } catch (err) {
    next(err);
  }
};

export default { listProducts, createTransaction, listTransactions, getTransaction };
