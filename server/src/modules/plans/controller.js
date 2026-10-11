/**
 * Controller paket langganan (admin) — tipis.
 */
import * as service from './service.js';

export const listPlans = async (_req, res, next) => {
  try {
    const items = await service.listPlans();
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
};

export const getPlan = async (req, res, next) => {
  try {
    const plan = await service.getPlan(req.params.id);
    res.json({ plan });
  } catch (err) {
    next(err);
  }
};

export const createPlan = async (req, res, next) => {
  try {
    const plan = await service.createPlan(req.body, req.user, req.ip);
    res.status(201).json({ plan });
  } catch (err) {
    next(err);
  }
};

export const updatePlan = async (req, res, next) => {
  try {
    const plan = await service.updatePlan(req.params.id, req.body, req.user, req.ip);
    res.json({ plan });
  } catch (err) {
    next(err);
  }
};

export default { listPlans, getPlan, createPlan, updatePlan };