/**
 * QA lokal — versi Node lintas platform (Termux/Linux/Windows).
 *
 * Pengganti `scripts/qa-local.ps1` agar bisa dijalankan dari HP. Menjalankan
 * matriks verifikasi yang sama (tanpa deployment, tanpa menyentuh produksi),
 * lalu menampilkan ringkasan LULUS/GAGAL per tahap.
 *
 * Pemakaian (dari root repo):
 *   node scripts/qa-local.mjs
 *   node scripts/qa-local.mjs --with-e2e   # ikut E2E online
 *
 * Tahap E2E lokal (PowerShell) DILEWATI di lingkungan non-Windows; tersedia
 * `npm run e2e:online` sebagai alternatif Node.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SERVER = join(ROOT, 'server');

dotenv.config({ path: join(SERVER, '.env') });

const withE2E = process.argv.includes('--with-e2e');
const rows = [];

const run = (cmd, argv, cwd = ROOT) => {
  console.log(`\n$ (cwd=${cwd === ROOT ? '.' : cwd}) ${cmd} ${argv.join(' ')}`);
  const res = spawnSync(cmd, argv, { cwd, stdio: 'inherit', shell: false });
  if (res.error) {
    console.error(`[qa] gagal menjalankan ${cmd}: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
};

const step = (name, cmd, argv, cwd) => {
  const code = run(cmd, argv, cwd);
  rows.push({ name, code });
  console.log(`--- ${name}: ${code === 0 ? 'LULUS' : `GAGAL (${code})`}`);
  return code;
};

// ---------------------------------------------------------------- Preflight -
if (!process.env.DATABASE_URL) {
  console.error('[qa] DATABASE_URL tidak ditemukan (server/.env). Salin server/.env.example.');
  process.exit(1);
}
{
  const url = new URL(process.env.DATABASE_URL);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  console.log(`[qa] target DB: ${dbName} @ ${url.hostname}:${url.port || 5432}`);
  const isLocal = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  const ready = isLocal
    ? spawnSync('node', ['scripts/pg-local.mjs', 'status'], { cwd: ROOT, stdio: 'ignore' })
    : null;
  if (isLocal && ready?.status !== 0) {
    console.log('[qa] PostgreSQL lokal belum siap — mencoba `npm run db:start`…');
    const start = spawnSync('node', ['scripts/pg-local.mjs', 'start'], { cwd: ROOT, stdio: 'inherit' });
    if (start.status !== 0) {
      console.error('[qa] PostgreSQL lokal tidak bisa dijalankan. Lihat `npm run db:status`.');
      process.exit(1);
    }
  }
}

console.log('\n=== 1/8 Salinan berkas bersama ===');
step('1/8 Salinan berkas bersama', 'node', ['scripts/sync-shared.mjs', '--check']);

console.log('\n=== 2/8 Uji backend ===');
run('node', ['scripts/clean-test-fixtures.mjs'], SERVER);
{
  const code = run('node', ['--test', 'tests/**/*.test.js'], SERVER);
  rows.push({ name: '2/8 Uji backend', code });
  console.log(`--- 2/8 Uji backend: ${code === 0 ? 'LULUS' : `GAGAL (${code})`}`);
}

console.log('\n=== 3/8 Verifikasi UI statis + landing ===');
const b = run('node', ['scripts/build-hosting.mjs']);
const v = run('node', ['scripts/verify-ui.mjs']);
const l = run('node', ['scripts/test-landing.mjs']);
{
  const code = Math.max(b, v, l);
  rows.push({ name: '3/8 Verifikasi UI statis + landing', code });
  console.log(`--- 3/8 Verifikasi UI statis + landing: ${code === 0 ? 'LULUS' : `GAGAL (${code})`}`);
}

console.log('\n=== 4/8 Sesi & pemulihan login ===');
step('4/8 Sesi & pemulihan login', 'node', ['--test', 'scripts/test-auth-restore.mjs']);

console.log('\n=== 5/8 Smart Product Image ===');
step('5/8 Smart Product Image', 'node', ['--test', 'scripts/test-product-image.mjs']);

console.log('\n=== 6/8 Kode QR QRIS (modul bersama) ===');
step('6/8 Kode QR QRIS', 'node', ['--test', 'scripts/test-qr-code.mjs']);

console.log('\n=== 7/8 Tata letak cetak laporan (Chrome headless) ===');
const chromeCandidates = [
  process.env.NOVA_CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const chrome = chromeCandidates.find((p) => existsSync(p));
if (chrome) {
  const code = run('node', ['scripts/print-report-check.mjs']);
  rows.push({ name: '7/8 Tata letak cetak laporan', code });
  console.log(`--- 7/8 Tata letak cetak laporan: ${code === 0 ? 'LULUS' : `GAGAL (${code})`}`);
} else {
  console.log('DILEWATI: Chrome tidak ditemukan (set NOVA_CHROME untuk mengaktifkan).');
  rows.push({ name: '7/8 Tata letak cetak laporan (DILEWATI)', code: 0 });
}

console.log('\n=== 8/8 E2E ===');
if (withE2E) {
  step('8/8 E2E online', 'node', ['scripts/e2e-online.mjs']);
} else {
  console.log('DILEWATI (pakai --with-e2e untuk menjalankan E2E online).');
}

console.log('\n================ RINGKASAN ================');
let failed = 0;
for (const r of rows) {
  if (r.code !== 0) failed++;
  console.log(`  [${r.code === 0 ? 'LULUS' : 'GAGAL'}] ${r.name}`);
}
if (failed === 0) {
  console.log('\nSEMUA TAHAP LULUS');
  process.exit(0);
}
console.log(`\n${failed} TAHAP GAGAL`);
process.exit(1);
