/**
 * Controller modul auth — tipis: meneruskan ke service & membentuk respons.
 * Semua error dilempar ke middleware error terpusat (next(err)).
 */
import * as authService from './service.js';
import env from '../../config/env.js';

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
    const { fullName, businessName, email, password, phone } = req.body;
    const result = await authService.registerOwner({
      fullName,
      businessName,
      email,
      password,
      phone,
      ip: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

/**
 * Tautan verifikasi dari email membuka endpoint ini. Peramban diarahkan kembali
 * ke panel Owner dengan status; `?format=json` dipakai pengujian/otomasi.
 */
export const verifyEmail = async (req, res, next) => {
  const wantsJson = req.query.format === 'json';
  try {
    const result = await authService.verifyOwnerEmail({
      token: req.query.token,
      ip: req.ip,
    });
    if (wantsJson) return res.status(200).json(result);
    return res.redirect(302, `${env.app.ownerPanelUrl}/?verified=1`);
  } catch (err) {
    if (wantsJson) return next(err);
    const code = err?.statusCode === 400 ? 'invalid' : 'error';
    return res.redirect(302, `${env.app.ownerPanelUrl}/?verify=${code}`);
  }
};

export const resendVerification = async (req, res, next) => {
  try {
    const result = await authService.resendOwnerVerification({
      email: req.body.email,
      ip: req.ip,
    });
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
};

export const firebaseVerificationStatus = async (req, res, next) => {
  try {
    const result = await authService.getOwnerFirebaseVerificationStatus({
      state: req.query.state,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const verifyFirebaseOwner = async (req, res, next) => {
  try {
    const result = await authService.verifyOwnerFirebase({
      state: req.body.state,
      idToken: req.body.idToken,
      ip: req.ip,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const resendFirebaseVerification = async (req, res, next) => {
  try {
    const result = await authService.resendOwnerFirebaseVerification({
      state: req.body.state,
      ip: req.ip,
    });
    res.status(202).json(result);
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
