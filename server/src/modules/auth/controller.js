/**
 * Controller modul auth — tipis: meneruskan ke service & membentuk respons.
 * Semua error dilempar ke middleware error terpusat (next(err)).
 */
import * as authService from './service.js';

export const login = async (req, res, next) => {
  try {
    const { role, email, password } = req.body;
    const result = await authService.login({
      role,
      email,
      password,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const registerOwner = async (req, res, next) => {
  try {
    const { fullName, businessName, email, password, phone, planId } = req.body;
    const result = await authService.registerOwner({
      fullName,
      businessName,
      email,
      password,
      phone,
      planId,
      ip: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const registrationPlans = async (_req, res, next) => {
  try {
    const items = await authService.listRegistrationPlans();
    res.status(200).json({ items });
  } catch (err) {
    next(err);
  }
};

export const requestApproval = async (req, res, next) => {
  try {
    const result = await authService.requestOwnerApproval({
      state: req.body.registrationState,
      ip: req.ip,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const registrationStatus = async (req, res, next) => {
  try {
    const result = await authService.getOwnerRegistrationStatus({
      state: req.query.state,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const loginCashierWithPin = async (req, res, next) => {
  try {
    const result = await authService.loginCashierWithPin({
      cashierId: req.body.cashierId,
      pin: req.body.pin,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const listPinCashiers = async (req, res, next) => {
  try {
    const items = await authService.listPinCashiers({ outletId: req.query.outletId });
    res.status(200).json({ items });
  } catch (err) {
    next(err);
  }
};

export const refresh = async (req, res, next) => {
  try {
    const result = await authService.refresh({ refreshToken: req.body.refreshToken });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const logout = async (req, res, next) => {
  try {
    const result = await authService.logout({
      refreshToken: req.body.refreshToken,
      userId: req.user.id,
      role: req.user.role,
    });
    res.status(200).json({ message: 'Logout berhasil', revoked: result.revoked });
  } catch (err) {
    next(err);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, refreshToken } = req.body;
    const result = await authService.changePassword({
      role: req.user.role,
      userId: req.user.id,
      currentPassword,
      newPassword,
      refreshToken: refreshToken ?? null,
      ip: req.ip,
    });
    res.status(200).json({
      message: 'Sandi berhasil diubah. Sesi di perangkat lain telah diakhiri.',
      sessionsRevoked: result.sessionsRevoked,
    });
  } catch (err) {
    next(err);
  }
};

export const me = async (req, res, next) => {
  try {
    let context = null;
    if (req.user.role === 'cashier') {
      context = await authService.getCashierContext(req.user.id);
    }
    res.status(200).json({ user: req.user, context });
  } catch (err) {
    next(err);
  }
};
