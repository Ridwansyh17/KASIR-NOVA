/**
 * Controller modul setoran kas — tipis.
 *
 * Area Kasir tidak menerima `outletId` dari klien: outlet diambil dari scope
 * akun kasir (`req.cashierScope`) sehingga tidak ada permukaan IDOR.
 */
import * as service from './service.js';

export const list = async (req, res, next) => {
  try {
    res.json(
      await service.listCashDeposits({ businessId: req.params.businessId, filters: req.query })
    );
  } catch (err) {
    next(err);
  }
};

export const create = async (req, res, next) => {
  try {
    const { deposit, outlet_name } = await service.createCashDeposit({
      businessId: req.params.businessId,
      outletId: req.body.outletId,
      data: req.body,
      actor: req.user,
      ip: req.ip,
    });
    res.status(201).json({ deposit: { ...deposit, outlet_name } });
  } catch (err) {
    next(err);
  }
};

export const voidDeposit = async (req, res, next) => {
  try {
    const deposit = await service.voidCashDeposit({
      businessId: req.params.businessId,
      depositId: req.params.depositId,
      reason: req.body.reason,
      actor: req.user,
      ip: req.ip,
    });
    res.json({ deposit });
  } catch (err) {
    next(err);
  }
};

// ------------------------------------------------------------ Area kasir ---

export const listScoped = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    res.json(
      await service.listCashDeposits({
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
    const { deposit, outlet_name } = await service.createCashDeposit({
      businessId: scope.business_id,
      outletId: scope.outlet_id,
      data: req.body,
      actor: req.user,
      ip: req.ip,
    });
    res.status(201).json({ deposit: { ...deposit, outlet_name } });
  } catch (err) {
    next(err);
  }
};

export const voidScoped = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const deposit = await service.voidCashDeposit(
      {
        businessId: scope.business_id,
        depositId: req.params.depositId,
        reason: req.body.reason,
        actor: req.user,
        ip: req.ip,
      },
      { restrictToCashierId: req.user.id }
    );
    res.json({ deposit });
  } catch (err) {
    next(err);
  }
};

export default { list, create, voidDeposit, listScoped, createScoped, voidScoped };
