/**
 * Controller modul transaksi (sisi Owner/Admin) — tipis.
 */
import * as service from './service.js';

export const list = async (req, res, next) => {
  try {
    res.json(
      await service.listTransactions({
        businessId: req.params.businessId,
        filters: req.query,
      })
    );
  } catch (err) {
    next(err);
  }
};

export const detail = async (req, res, next) => {
  try {
    const transaction = await service.getTransaction(
      req.params.businessId,
      req.params.transactionId
    );
    res.json({ transaction });
  } catch (err) {
    next(err);
  }
};

export const voidTransaction = async (req, res, next) => {
  try {
    const transaction = await service.voidTransaction({
      businessId: req.params.businessId,
      transactionId: req.params.transactionId,
      actor: req.user,
      ip: req.ip,
    });
    res.json({ transaction });
  } catch (err) {
    next(err);
  }
};

export default { list, detail, voidTransaction };
