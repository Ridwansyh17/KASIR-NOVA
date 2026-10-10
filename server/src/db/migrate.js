/**
 * Runner migrasi SQL terlacak.
 *
 * - Menjalankan file di src/db/migrations/*.sql secara berurutan (nama file).
 * - Mencatat yang sudah dijalankan di tabel `schema_migrations`.
 * - Idempoten: migrasi yang sudah tercatat tidak dijalankan ulang.
 * - Skema SQL murni juga menggunakan IF NOT EXISTS sebagai pertahanan kedua.
 *
 * Jalankan: npm run db:migrate
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, withTransaction } from '../config/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

const ensureSchemaTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
};

const listApplied = async () => {
  const { rows } = await query('SELECT filename FROM schema_migrations ORDER BY filename');
  return new Set(rows.map((r) => r.filename));
};

const listFiles = async () => {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
};

const main = async () => {
  await ensureSchemaTable();
  const applied = await listApplied();
  const files = await listFiles();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log(`[migrate] Tidak ada migrasi baru (${files.length} sudah diterapkan).`);
    return;
  }

  console.log(`[migrate] ${pending.length} migrasi akan dijalankan: ${pending.join(', ')}`);

  for (const file of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    });
    console.log(`[migrate] OK  ${file}`);
  }

  console.log(`[migrate] Selesai. Total diterapkan: ${files.length}.`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrate] GAGAL:', err.message);
    process.exit(1);
  });
