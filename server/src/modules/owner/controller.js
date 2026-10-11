/**
 * Controller modul owner (bisnis) — tipis.
 */
import * as service from './service.js';
import { getSubscriptionView } from '../subscription/service.js';

export const listBusinesses = async (req, res, next) => {
  try {
    const items = await service.listBusinesses(req.user.id);
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
};

export const createBusiness = async (req, res, next) => {
  try {
    const { name, businessType, currency, timezone } = req.body;
    const business = await service.createBusiness({
      ownerId: req.user.id,
      name,
      businessType,
      currency,
      timezone,
      actor: req.user,
      ip: req.ip,
    });
    res.status(201).json({ business });
  } catch (err) {
    next(err);
  }
};

// Detail: bisnis sudah diverifikasi & ditempel oleh middleware tenant.
export const getBusiness = (req, res) => {
  res.json({ business: req.business });
};

export const updateBusiness = async (req, res, next) => {
  try {
    const business = await service.updateBusiness(
      req.params.businessId,
      req.user.id,
      req.body,
      req.user,
      req.ip
    );
    res.json({ business });
  } catch (err) {
    next(err);
  }
};

export const setStatus = async (req, res, next) => {
  try {
    const business = await service.setBusinessStatus(
      req.params.businessId,
      req.user.id,
      req.body.status,
      req.user,
      req.ip
    );
    res.json({ business });
  } catch (err) {
    next(err);
  }
};

export const getSubscription = async (req, res, next) => {
  try {
    // Kepemilikan bisnis sudah diverifikasi middleware tenant.
    const view = await getSubscriptionView(req.params.businessId);
    res.json(view);
  } catch (err) {
    next(err);
  }
};
