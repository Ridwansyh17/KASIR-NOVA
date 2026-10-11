/**
 * Controller modul platform-admin — tipis, meneruskan ke service.
 */
import * as service from './service.js';

export const listOwners = async (req, res, next) => {
  try {
    const { search, status, page, limit } = req.query;
    res.json(await service.listOwners({ search, status, page, limit }));
  } catch (err) {
    next(err);
  }
};

export const getOwner = async (req, res, next) => {
  try {
    res.json({ owner: await service.getOwner(req.params.id) });
  } catch (err) {
    next(err);
  }
};

export const createOwner = async (req, res, next) => {
  try {
    const { email, password, fullName, phone } = req.body;
    const owner = await service.createOwner({
      email,
      password,
      fullName,
      phone,
      actor: req.user,
      ip: req.ip,
    });
    res.status(201).json({ owner });
  } catch (err) {
    next(err);
  }
};

export const updateOwner = async (req, res, next) => {
  try {
    const owner = await service.updateOwner(req.params.id, req.body, req.user, req.ip);
    res.json({ owner });
  } catch (err) {
    next(err);
  }
};

export const setStatus = async (req, res, next) => {
  try {
    const owner = await service.setOwnerStatus(
      req.params.id,
      req.body.status,
      req.user,
      req.ip
    );
    res.json({ owner });
  } catch (err) {
    next(err);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    await service.resetOwnerPassword(
      req.params.id,
      req.body.newPassword,
      req.user,
      req.ip
    );
    res.json({ message: 'Password owner berhasil direset' });
  } catch (err) {
    next(err);
  }
};

export const softDelete = async (req, res, next) => {
  try {
    await service.softDeleteOwner(req.params.id, req.user, req.ip);
    res.json({ message: 'Owner berhasil dihapus (nonaktif)' });
  } catch (err) {
    next(err);
  }
};
