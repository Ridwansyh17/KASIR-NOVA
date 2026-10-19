/**
 * Backup database KASIR NOVA — versi Node lintas platform (Termux/Linux/Windows).
 *
 * Pengganti `scripts/backup-db.ps1` agar bisa dijalankan dari HP (Termux) tanpa
 * PowerShell. Membaca `DATABASE_URL` dari `server/.env` (atau environment),
 * menjalankan `pg_dump` format custom (-Fc), lalu memverifikasi arsip dengan
 * `pg_restore --list`. Kredensial TIDAK pernah dicetak dan tidak diletakkan di
 * argumen proses (dikirim lewat environment anak).
 *
 * Pemakaian (dari root repo):
 *   node scripts/backup-db.mjs
 *   node scripts/backup-db.mjs --out-dir /sdcard/nova-backup
 *   node scripts/backup-db.mjs --plain
 *
 * Hasil default: <repo>/backups/<db>_<yyyyMMdd-HHmmss>.dump (di-.gitignore).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

dotenv.config({ path: join(ROOT, 'server', '.env') });

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const plain = args.includes('--plain');
const outDir = resolve(getArg('--out-dir') ?? join(ROOT, 'backups'));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[backup] DATABASE_URL tidak ditemukan (server/.env).');
  process.exit(1);
}

let url;
try {
  url = new URL(databaseUrl);
} catch {
  console.error('[backup] DATABASE_URL tidak valid.');
  process.exit(1);
}

const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
if (!dbName) {
  console.error('[backup] Nama database tidak ditemukan pada DATABASE_URL.');
  process.exit(1);
}

const bin = (name) => process.env[`NOVA_${name.toUpperCase()}`] ?? name;

/** Jalankan perintah dengan env koneksi; kembalikan exit code. */
const run = (cmd, argv, childEnv) => {
  const res = spawnSync(cmd, argv, {
    stdio: 'inherit',
    env: { ...process.env, ...childEnv },
  });
  if (res.error?.code === 'ENOENT') {
    console.error(`[backup] Perintah '${cmd}' tidak ditemukan. Pasang PostgreSQL client.`);
    return 127;
  }
  return res.status ?? 1;
};

// Koneksi dikirim via environment (tidak tampil di daftar proses).
const pgEnv = {
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username || ''),
  PGPASSWORD: decodeURIComponent(url.password || ''),
  PGDATABASE: dbName,
};

// Cek server hidup lebih dulu (read-only).
const ready = spawnSync(bin('pg_isready'), ['-h', pgEnv.PGHOST, '-p', pgEnv.PGPORT], {
  stdio: 'ignore',
});
if (ready.status !== 0) {
  console.error(`[backup] PostgreSQL tidak merespons di ${pgEnv.PGHOST}:${pgEnv.PGPORT}.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+$/, '')
  .replace('T', '-');
const outFile = join(outDir, `${dbName}_${stamp}.${plain ? 'sql' : 'dump'}`);

console.log(`[backup] pg_dump ${plain ? '(plain)' : '-Fc'} ${dbName} -> ${outFile}`);
const dumpArgs = plain
  ? ['--no-owner', '--no-privileges', '-f', outFile]
  : ['-Fc', '--no-owner', '--no-privileges', '-f', outFile];
const code = run(bin('pg_dump'), dumpArgs, pgEnv);
if (code !== 0) {
  console.error(`[backup] pg_dump gagal (exit ${code}).`);
  process.exit(code);
}
if (!existsSync(outFile) || statSync(outFile).size === 0) {
  console.error(`[backup] Berkas dump kosong/tidak dibuat: ${outFile}`);
  process.exit(1);
}

if (!plain) {
  console.log('[backup] verifikasi arsip (pg_restore --list)');
  const verify = spawnSync(bin('pg_restore'), ['--list', outFile], { stdio: 'ignore' });
  if (verify.status !== 0) {
    console.error('[backup] Arsip dump tidak valid (pg_restore --list gagal).');
    process.exit(1);
  }
  writeFileSync(`${outFile}.ok`, `verified ${new Date().toISOString()}`);
}

const sizeKb = Math.round((statSync(outFile).size / 1024) * 10) / 10;
console.log(`\nBACKUP SELESAI: ${outFile} (${sizeKb} KB)`);
