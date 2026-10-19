/**
 * Verifikasi koneksi database + status migrasi — READ-ONLY.
 *
 * Pengganti `scripts/verify-db.ps1` yang ramah Termux. Tidak pernah menulis
 * ke database: hanya `SELECT` dan membaca daftar file migrasi dari disk.
 *
 * Pemakaian (dari root repo):
 *   node scripts/verify-db.mjs
 */
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

dotenv.config({ path: join(ROOT, 'server', '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[verify] DATABASE_URL tidak ditemukan (server/.env).');
  process.exit(1);
}

let url;
try {
  url = new URL(databaseUrl);
} catch {
  console.error('[verify] DATABASE_URL tidak valid.');
  process.exit(1);
}

const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
const hostKind = url.hostname.includes('localhost') || url.hostname === '127.0.0.1'
  ? 'LOKAL'
  : 'REMOTE';

// Hanya tampilkan klasifikasi host — JANGAN cetak kredensial.
console.log(`[verify] target: ${dbName} @ ${hostKind} (${url.hostname}:${url.port || 5432})`);

const dir = join(ROOT, 'server', 'src', 'db', 'migrations');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5000,
});

let failed = false;
try {
  const ping = await pool.query('SELECT current_database() AS db, current_user AS usr');
  console.log(`[verify] koneksi OK — db=${ping.rows[0].db} user=${ping.rows[0].usr}`);

  const t = await pool.query(
    `SELECT to_regclass('public.schema_migrations') AS sm`
  );
  if (!t.rows[0].sm) {
    console.log('[verify] tabel schema_migrations BELUM ADA (belum pernah migrasi).');
    failed = true;
  } else {
    const { rows } = await pool.query(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    );
    const applied = new Set(rows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));
    const orphan = [...applied].filter((f) => !files.includes(f));

    console.log(`[verify] migrasi di disk: ${files.length}, terpasang: ${applied.size}`);
    if (pending.length) {
      console.log(`[verify] BELUM DITERAPKAN: ${pending.join(', ')}`);
      failed = true;
    } else {
      console.log('[verify] semua file migrasi sudah terpasang.');
    }
    if (orphan.length) {
      console.log(`[verify] PERINGATAN: terpasang tanpa file di disk: ${orphan.join(', ')}`);
    }
  }
} catch (err) {
  console.error(`[verify] GAGAL koneksi: ${err.message}`);
  failed = true;
} finally {
  await pool.end();
}

process.exit(failed ? 1 : 0);
