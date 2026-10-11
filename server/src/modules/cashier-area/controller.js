/**
 * Controller area kasir — tipis.
 */
import * as service from './service.js';

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

export default { listProducts };