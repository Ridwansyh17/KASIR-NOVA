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
