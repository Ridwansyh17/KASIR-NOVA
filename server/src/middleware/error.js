/**
 * Penanganan error terpusat.
 *
 * Semua error dilempar sebagai AppError agar response konsisten.
 * Error tidak dikenal tidak membocorkan stack trace ke klien di produksi.
 */
import env from '../config/env.js';

export class AppError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Tidak terautentikasi') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Anda tidak memiliki akses ke sumber daya ini') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Sumber daya tidak ditemukan') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Konflik data') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

/**
 * Middleware penangan error (wajib parameter ke-4: err).
 */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  const status = err.statusCode ?? 500;
  const isOperational = err.isOperational ?? false;

  // Log error server
  if (status >= 500) {
    console.error('[error]', {
      method: req.method,
      path: req.path,
      message: err.message,
      stack: err.stack,
    });
  }

  const body = {
    error: {
      message: err.message ?? 'Terjadi kesalahan pada server',
      ...(err.details ? { details: err.details } : {}),
    },
  };

  // Jangan bocorkan detail internal di produksi
  if (!isOperational && !env.isProduction) {
    body.error.stack = err.stack;
  }

  res.status(status).json(body);
};

export const notFoundHandler = (req, res) => {
  res.status(404).json({ error: { message: `Endpoint tidak ditemukan: ${req.method} ${req.path}` } });
};

export default { AppError, errorHandler, notFoundHandler };
