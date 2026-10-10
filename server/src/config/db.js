/**
 * Connection pool PostgreSQL tunggal (singleton).
 *
 * Pool kecil (max 10) disesuaikan dengan RAM bebas ~2 GB di mesin dev.
 * Setiap query WAJIB memakai parameter ($1, $2, ...) — tidak pernah
 * string interpolation untuk mencegah SQL injection.
 */
import pg from 'pg';
import env from './env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[db] error tak terduga pada client idle:', err.message);
});

/**
 * Jalankan query dengan parameter.
 * @param {string} text - SQL, gunakan $1, $2, ...
 * @param {Array} params - nilai parameter
 */
export const query = async (text, params) => {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 500) {
    console.warn(`[db] query lambat ${duration}ms: ${text.slice(0, 80)}`);
  }
  return result;
};

/**
 * Dapatkan client untuk transaction manual (BEGIN/COMMIT/ROLLBACK).
 * Wajib di-release di blok finally.
 */
export const getClient = async () => pool.connect();

/**
 * Helper: jalankan callback di dalam DB transaction.
 * COMMIT bila sukses, ROLLBACK bila error. Client otomatis di-release.
 *
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export const withTransaction = async (fn) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export default pool;
