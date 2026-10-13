/**
 * Controller modul pengeluaran outlet — tipis.
 *
 * Area Kasir tidak menerima `outletId` dari klien: outlet diambil dari scope
 * akun kasir (`req.cashierScope`) sehingga tidak ada permukaan IDOR.
 */
import * as service from './service.js';

export const list = async (req, res, next) => {
  try {
    res.json(
      await service.listExpenses({ businessId: req.params.businessId, filters: req.query })
    );
  } catch (err) {
    next(err);
  }
};

export const create = async (req, res, next) => {
  try {
    const { expense, outlet_name } = await service.createExpense({
      businessId: req.params.businessId,
      outletId: req.body.outletId,
      data: req.body,
      actor: req.user,
      ip: req.ip,
    });
    res.status(201).json({ expense: { ...expense, outlet_name } });
  } catch (err) {
    next(err);
  }
};

export const voidExpense = async (req, res, next) => {
  try {
    const expense = await service.voidExpense({
      businessId: req.params.businessId,
      expenseId: req.params.expenseId,
      reason: req.body.reason,
      actor: req.user,
      ip: req.ip,
    });
    res.json({ expense });
  } catch (err) {
    next(err);
  }
};

// ------------------------------------------------------------ Area kasir ---

export const listScoped = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    res.json(
      await service.listExpenses({
        businessId: scope.business_id,
        filters: { ...req.query, outletId: scope.outlet_id },
      })
    );
  } catch (err) {
    next(err);
  }
};

export const createScoped = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const { expense, outlet_name } = await service.createExpense({
      businessId: scope.business_id,
      outletId: scope.outlet_id,
      data: req.body,
      actor: req.user,
      ip: req.ip,
    });
    res.status(201).json({ expense: { ...expense, outlet_name } });
  } catch (err) {
    next(err);
  }
};

export const voidScoped = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const expense = await service.voidExpense(
      {
        businessId: scope.business_id,
        expenseId: req.params.expenseId,
        reason: req.body.reason,
        actor: req.user,
        ip: req.ip,
      },
      { restrictToCashierId: req.user.id }
    );
    res.json({ expense });
  } catch (err) {
    next(err);
  }
};

export default { list, create, voidExpense, listScoped, createScoped, voidScoped };
