/**
 * Controller modul produk, kategori & stok — tipis.
 *
 * Visibilitas HPP ditegakkan di sini: `includeCost` dihitung dari izin
 * pengguna (Owner selalu; Kasir bila `can_view_profit`).
 */
import * as service from './service.js';
import { canViewProfit } from '../permission/service.js';

export const listCategories = async (req, res, next) => {
  try {
    const items = await service.listCategories(req.params.businessId);
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
};

export const createCategory = async (req, res, next) => {
  try {
    const category = await service.createCategory(req.params.businessId, req.body, req.user, req.ip);
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
};

export const updateCategory = async (req, res, next) => {
  try {
    const category = await service.updateCategory(
      req.params.businessId,
      req.params.categoryId,
      req.body,
      req.user,
      req.ip
    );
    res.json({ category });
  } catch (err) {
    next(err);
  }
};

export const deleteCategory = async (req, res, next) => {
  try {
    const result = await service.deleteCategory(
      req.params.businessId,
      req.params.categoryId,
      req.user,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const listProducts = async (req, res, next) => {
  try {
    const includeCost = await canViewProfit(req.user);
    const result = await service.listProducts({
      businessId: req.params.businessId,
      filters: req.query,
      includeCost,
    });
    res.json({ ...result, can_view_profit: includeCost });
  } catch (err) {
    next(err);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const includeCost = await canViewProfit(req.user);
    const product = await service.createProduct({
      businessId: req.params.businessId,
      data: req.body,
      actor: req.user,
      ip: req.ip,
      includeCost,
      outletId: req.body.outletId ?? null,
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
};

export const getProduct = async (req, res, next) => {
  try {
    const includeCost = await canViewProfit(req.user);
    const result = await service.getProduct(req.params.businessId, req.params.productId, {
      includeCost,
    });
    res.json({ ...result, can_view_profit: includeCost });
  } catch (err) {
    next(err);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const includeCost = await canViewProfit(req.user);
    const product = await service.updateProduct(
      req.params.businessId,
      req.params.productId,
      req.body,
      req.user,
      req.ip,
      { includeCost }
    );
    res.json({ product });
  } catch (err) {
    next(err);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const result = await service.softDeleteProduct(
      req.params.businessId,
      req.params.productId,
      req.user,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const setStock = async (req, res, next) => {
  try {
    const result = await service.setStock(
      req.params.businessId,
      req.params.productId,
      req.params.outletId,
      req.body.quantity,
      req.user,
      req.ip,
      { reason: req.body.reason ?? null }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

/** Tandai habis manual / aktifkan kembali (Fase 2). */
export const setStockStatus = async (req, res, next) => {
  try {
    const includeCost = await canViewProfit(req.user);
    const result = await service.setStockStatus(
      req.params.businessId,
      req.params.productId,
      req.body,
      req.user,
      req.ip,
      { includeCost }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export default {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listProducts,
  createProduct,
  getProduct,
  updateProduct,
  deleteProduct,
  setStock,
  setStockStatus,
};
