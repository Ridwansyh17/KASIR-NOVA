/**
 * Modul health check.
 *
 * Endpoint: GET /api/health
 * Memeriksa: status API + koneksi database.
 *
 * Handler dapat dibuat via `createHealthRouter({ query, logger })` agar dapat
 * diuji (dependency injection) — mis. mensimulasikan DB mati tanpa mengganggu
 * pool nyata. Ekspor default tetap sebuah Router siap pakai.
 */
import { Router } from 'express';
import { query as defaultQuery } from '../../config/db.js';

export const createHealthRouter = ({ query = defaultQuery, logger = console } = {}) => {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const { rows } = await query('SELECT 1 AS ok');
      const dbOk = rows.length === 1;

      res.status(dbOk ? 200 : 503).json({
        status: dbOk ? 'ok' : 'degraded',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        services: {
          database: dbOk ? 'up' : 'down',
        },
      });
    } catch (err) {
      // JANGAN bocorkan detail koneksi (host/port/user/DSN) ke klien publik.
      // Catat hanya kode/nama error di log server.
      logger.error('[health] pemeriksaan DB gagal:', err?.code || err?.name || 'error');
      res.status(503).json({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          database: 'down',
        },
      });
    }
  });

  return router;
};

export default createHealthRouter();
