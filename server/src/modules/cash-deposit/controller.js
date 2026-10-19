/**
 * Controller modul setoran kasir — tipis.
 *
 * Area Kasir TIDAK menerima `outletId` dari klien: outlet diambil dari scope
 * akun (`req.cashierScope`) sehingga tidak ada permukaan IDOR. Area Owner
 * memakai `:businessId` yang sudah diverifikasi middleware tenant.
 */
import * as service from './service.js';
import { buildSettlementWorkbook } from './xlsx.js';

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

// ------------------------------------------------------- Owner settlement ---

export const preview = async (req, res, next) => {
  try {
    res.json(
      await service.previewSettlement({
        businessId: req.params.businessId,
        outletId: req.body.outletId ?? req.query.outletId,
        date: req.body.date ?? req.query.date,
        shift: req.body.shift ?? req.query.shift ?? 'full',
        actor: req.user,
      })
    );
  } catch (err) {
    next(err);
  }
};

export const createSettlement = async (req, res, next) => {
  try {
    const { deposit, outlet_name } = await service.createSettlement({
      businessId: req.params.businessId,
      outletId: req.body.outletId,
      data: req.body,
      actor: req.user,
      ip: req.ip,
      saveAs: req.body.saveAs,
    });
    res.status(201).json({ deposit: { ...deposit, outlet_name } });
  } catch (err) {
    next(err);
  }
};

export const detail = async (req, res, next) => {
  try {
    res.json(
      await service.getCashDepositDetail({
        businessId: req.params.businessId,
        depositId: req.params.depositId,
      })
    );
  } catch (err) {
    next(err);
  }
};

export const complete = async (req, res, next) => {
  try {
    const deposit = await service.completeSettlement({
      businessId: req.params.businessId,
      depositId: req.params.depositId,
      data: req.body,
      actor: req.user,
      ip: req.ip,
    });
    res.json({ deposit });
  } catch (err) {
    next(err);
  }
};

export const removeDraft = async (req, res, next) => {
  try {
    res.json(
      await service.deleteDraft({
        businessId: req.params.businessId,
        depositId: req.params.depositId,
        actor: req.user,
        ip: req.ip,
      })
    );
  } catch (err) {
    next(err);
  }
};

export const report = async (req, res, next) => {
  try {
    res.json(
      await service.settlementReport({
        businessId: req.params.businessId,
        filters: req.query,
      })
    );
  } catch (err) {
    next(err);
  }
};

export const exportXlsx = async (req, res, next) => {
  try {
    const { rows, business } = await service.exportSettlementRows({
      businessId: req.params.businessId,
      filters: req.query,
    });
    const buffer = await buildSettlementWorkbook({
      rows,
      business,
      filters: req.query,
    });
    const from = req.query.from ?? 'awal';
    const to = req.query.to ?? 'akhir';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="KASIR_NOVA_Laporan_Setoran_${from}_sampai_${to}.xlsx"`
    );
    res.send(Buffer.from(buffer));
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

export const previewScoped = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const body = { ...req.body, ...req.query };
    res.json(
      await service.previewSettlement({
        businessId: scope.business_id,
        outletId: scope.outlet_id,
        date: body.date,
        shift: body.shift ?? 'full',
        actor: req.user,
      })
    );
  } catch (err) {
    next(err);
  }
};

export const createSettlementScoped = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const { deposit, outlet_name } = await service.createSettlement({
      businessId: scope.business_id,
      outletId: scope.outlet_id,
      data: req.body,
      actor: req.user,
      ip: req.ip,
      saveAs: req.body.saveAs,
    });
    res.status(201).json({ deposit: { ...deposit, outlet_name } });
  } catch (err) {
    next(err);
  }
};

export const detailScoped = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    res.json(
      await service.getCashDepositDetail({
        businessId: scope.business_id,
        depositId: req.params.depositId,
        restrictToOutletId: scope.outlet_id,
      })
    );
  } catch (err) {
    next(err);
  }
};

export const completeScoped = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    const deposit = await service.completeSettlement({
      businessId: scope.business_id,
      depositId: req.params.depositId,
      data: req.body,
      actor: req.user,
      ip: req.ip,
      restrictToCashierId: req.user.id,
      restrictToOutletId: scope.outlet_id,
    });
    res.json({ deposit });
  } catch (err) {
    next(err);
  }
};

export const removeDraftScoped = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    res.json(
      await service.deleteDraft({
        businessId: scope.business_id,
        depositId: req.params.depositId,
        actor: req.user,
        ip: req.ip,
        restrictToCashierId: req.user.id,
        restrictToOutletId: scope.outlet_id,
      })
    );
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
      { restrictToCashierId: req.user.id, restrictToOutletId: scope.outlet_id }
    );
    res.json({ deposit });
  } catch (err) {
    next(err);
  }
};

// ------------------------------------------------------- Platform Admin ----

export const platformList = async (req, res, next) => {
  try {
    res.json(await service.listPlatformSettlements({ filters: req.query }));
  } catch (err) {
    next(err);
  }
};

export default {
  list,
  create,
  voidDeposit,
  preview,
  createSettlement,
  detail,
  complete,
  removeDraft,
  report,
  exportXlsx,
  listScoped,
  createScoped,
  previewScoped,
  createSettlementScoped,
  detailScoped,
  completeScoped,
  removeDraftScoped,
  voidScoped,
  platformList,
};
