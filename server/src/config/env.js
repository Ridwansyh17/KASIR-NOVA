/**
 * Memuat & memvalidasi variabel lingkungan.
 * Fail-fast: server menolak start bila env wajib kosong.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const required = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];

const missing = required.filter((key) => !process.env[key] || process.env[key].startsWith('dev_') === false && !process.env[key]);

// Validasi: env wajib harus ada & JWT secret tidak boleh default
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL wajib diisi. Salin server/.env.example menjadi server/.env');
}
if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error('JWT_ACCESS_SECRET & JWT_REFRESH_SECRET wajib diisi');
}
if (process.env.JWT_ACCESS_SECRET.length < 16 || process.env.JWT_REFRESH_SECRET.length < 16) {
  throw new Error('JWT secret minimal 16 karakter');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === 'production',
};

export default env;
