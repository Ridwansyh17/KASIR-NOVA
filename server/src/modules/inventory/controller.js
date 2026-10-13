/**
 * Controller modul inventori — tipis.
 */
import * as service from './service.js';

/** Pergerakan stok satu bisnis (Owner / Admin read-only). */
export const listMovements = async (req, res, next) => {
  try {
    res.json(
      await service.listMovements({ businessId: req.params.businessId, filters: req.query })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * Pergerakan stok AREA KASIR — bisnis & outlet diturunkan dari akun kasir
 * (`req.cashierScope`), bukan dari URL/query (anti-IDOR).
 */
export const listScopedMovements = async (req, res, next) => {
  try {
    const scope = req.cashierScope;
    res.json(
      await service.listMovements({
        businessId: scope.business_id,
        filters: { ...req.query, outletId: scope.outlet_id },
      })
    );
  } catch (err) {
    next(err);
  }
};

export default { listMovements, listScopedMovements };
