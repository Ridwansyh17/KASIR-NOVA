/**
 * Controller modul produk, kategori & stok — tipis.
 */
import * as service from './service.js';

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
    const result = await service.listProducts({
      businessId: req.params.businessId,
      filters: req.query,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const product = await service.createProduct({
      businessId: req.params.businessId,
      data: req.body,
      actor: req.user,
      ip: req.ip,
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
};

export const getProduct = async (req, res, next) => {
  try {
    const result = await service.getProduct(req.params.businessId, req.params.productId);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const product = await service.updateProduct(
      req.params.businessId,
      req.params.productId,
      req.body,
      req.user,
      req.ip
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
      req.ip
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
};