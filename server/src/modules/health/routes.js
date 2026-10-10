/**
 * Modul health check.
 *
 * Endpoint: GET /api/health
 * Memeriksa: status API + koneksi database.
 */
import { Router } from 'express';
import { query } from '../../config/db.js';

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
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: 'down',
        error: err.message,
      },
    });
  }
});

export default router;
