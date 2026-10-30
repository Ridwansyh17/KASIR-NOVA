/**
 * Controller admin: bisnis & langganan — tipis.
 */
import * as service from './business-service.js';

export const listBusinesses = async (req, res, next) => {
  try {
    const result = await service.listBusinesses(req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const getBusiness = async (req, res, next) => {
  try {
    const business = await service.getBusiness(req.params.businessId);
    res.json({ business });
  } catch (err) {
    next(err);
  }
};

export const getSubscription = async (req, res, next) => {
  try {
    const view = await service.viewSubscription(req.params.businessId);
    res.json(view);
  } catch (err) {
    next(err);
  }
};

export const assignSubscription = async (req, res, next) => {
  try {
    const result = await service.assignPlan(
      req.params.businessId,
      req.body.planId,
      req.user,
      req.ip,
      { billingPeriod: req.body.billingPeriod }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const setSubscriptionStatus = async (req, res, next) => {
  try {
    const result = await service.changeSubscriptionStatus(
      req.params.businessId,
      req.body.status,
      req.user,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export default {
  listBusinesses,
  getBusiness,
  getSubscription,
  assignSubscription,
  setSubscriptionStatus,
};
export const cancelInvoice = async (req, res, next) => {
  try {
    const { cancelInvoiceByAdmin } = await import('../subscription-invoice/service.js');
    const result = await cancelInvoiceByAdmin({
      invoiceId: req.params.invoiceId,
      actor: req.user,
      ip: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const listInvoices = async (req, res, next) => {
  try {
    const { listInvoices: list } = await import('../subscription-invoice/service.js');
    const result = await list(req.params.businessId, req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
};
