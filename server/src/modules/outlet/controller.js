/**
 * Controller modul outlet — tipis.
 */
import * as service from './service.js';

export const listOutlets = async (req, res, next) => {
  try {
    const items = await service.listOutlets(req.params.businessId);
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
};

export const createOutlet = async (req, res, next) => {
  try {
    const outlet = await service.createOutlet({
      businessId: req.params.businessId,
      data: req.body,
      actor: req.user,
      ip: req.ip,
    });
    res.status(201).json({ outlet });
  } catch (err) {
    next(err);
  }
};

export const getOutlet = async (req, res, next) => {
  try {
    const outlet = await service.getOutlet(req.params.businessId, req.params.outletId);
    res.json({ outlet });
  } catch (err) {
    next(err);
  }
};

export const updateOutlet = async (req, res, next) => {
  try {
    const outlet = await service.updateOutlet(
      req.params.businessId,
      req.params.outletId,
      req.body,
      req.user,
      req.ip
    );
    res.json({ outlet });
  } catch (err) {
    next(err);
  }
};

export const deleteOutlet = async (req, res, next) => {
  try {
    const outlet = await service.softDeleteOutlet(
      req.params.businessId,
      req.params.outletId,
      req.user,
      req.ip
    );
    res.json({ outlet });
  } catch (err) {
    next(err);
  }
};

export default { listOutlets, createOutlet, getOutlet, updateOutlet, deleteOutlet };