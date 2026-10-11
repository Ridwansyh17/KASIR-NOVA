/**
 * Inisialisasi aplikasi Express + middleware dasar.
 *
 * Urutan middleware penting:
 *   helmet  -> header keamanan
 *   cors    -> batasi origin
 *   json    -> parse body
 *   router  -> endpoint
 *   notFound -> 404 untuk route tak dikenal
 *   error   -> penangan error terpusat (paling akhir)
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import env from './config/env.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import healthRouter from './modules/health/routes.js';
import authRouter from './modules/auth/routes.js';
import platformAdminRouter from './modules/platform-admin/routes.js';
import ownerRouter from './modules/owner/routes.js';
import cashierAreaRouter from './modules/cashier-area/routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      // Izinkan request tanpa origin (curl, Postman, server-to-server)
      if (!origin || env.corsOrigin.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin tidak diizinkan: ${origin}`));
      }
    },
    credentials: true,
  })
);

// Batasi ukuran body untuk mitigasi DoS
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Trust proxy hanya di produksi (untuk IP di rate limiter)
if (env.isProduction) {
  app.set('trust proxy', 1);
}

// Route
app.get('/', (req, res) => {
  res.json({ name: 'KASIR NOVA API', version: '0.1.0', status: 'ok' });
});

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/platform', platformAdminRouter);
app.use('/api/owner', ownerRouter);
app.use('/api/cashier', cashierAreaRouter);

// Panel Admin Platform. Di dev disajikan statis oleh Express agar mudah diuji.
// Di produksi frontend disajikan Firebase Hosting (backend tidak melayani file).
if (!env.isProduction) {
  app.use('/admin', express.static(join(__dirname, '../../apps/admin')));
  app.use('/owner', express.static(join(__dirname, '../../apps/owner')));
  app.use('/kasir', express.static(join(__dirname, '../../apps/kasir')));
}

// 404 & error handler (harus setelah semua route)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
