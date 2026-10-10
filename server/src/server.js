/**
 * Entry point server.
 *
 * Menampilkan status koneksi DB saat start, lalu bind port.
 * Graceful shutdown: tutup pool DB sebelum keluar.
 */
import app from './app.js';
import env from './config/env.js';
import { query } from './config/db.js';

const start = async () => {
  try {
    // Verifikasi koneksi DB sebelum menerima request
    const { rows } = await query('SELECT version() AS v');
    console.log(`[server] Database terhubung: ${rows[0].v.slice(0, 45)}...`);
  } catch (err) {
    console.error('[server] GAGAL terhubung ke database:', err.message);
    console.error('[server] Pastikan PostgreSQL berjalan: pg-server.cmd status');
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`[server] KASIR NOVA API berjalan di http://localhost:${env.port}`);
    console.log(`[server] Environment: ${env.nodeEnv}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} diterima, menutup server...`);
    server.close(async () => {
      const { pool } = await import('./config/db.js');
      await pool.end();
      console.log('[server] Pool DB ditutup. Selamat tinggal.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((err) => {
  console.error('[server] Fatal saat start:', err);
  process.exit(1);
});
