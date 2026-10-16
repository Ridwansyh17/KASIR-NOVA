/**
 * Siapkan aset statis untuk Firebase Hosting.
 *
 * Menyalin apps/{admin,owner,kasir} ke dist/hosting/<app>, menulis halaman
 * beranda root (index.html) + halaman 404, lalu menulis ulang config.js dengan
 * NOVA_API_BASE backend (dari argumen / env). Setelah ini:
 * `firebase deploy --only hosting`.
 *
 * Pemakaian:
 *   node scripts/build-hosting.mjs                              # backend produksi (default)
 *   node scripts/build-hosting.mjs https://api.example.com      # backend lain (URL absolut)
 *   node scripts/build-hosting.mjs --same-origin                # base kosong (origin harus melayani /api/**)
 *   NOVA_API_BASE=https://api.example.com node scripts/build-hosting.mjs
 *
 * PENTING (regresi 17 Okt 2026): `firebase.json` TIDAK memuat rewrite `/api/**`
 * (butuh paket Blaze). Karena itu Firebase Hosting TIDAK melayani `/api/**`,
 * sehingga base KOSONG membuat seluruh frontend web menembak
 * `https://kasir-nova.web.app/api/**` -> **404 "Page Not Found"** (gejala: panel
 * Admin/Owner terbuka tetapi login & data gagal). Default script ini karena itu
 * adalah URL backend produksi; same-origin harus DIMINTA secara eksplisit.
 * Lihat docs/20-deploy-firebase-hosting.md & docs/24-vercel-serverless.md.
 */
import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const apps = ['admin', 'owner', 'kasir'];

// Backend produksi (Vercel). Lihat catatan di header: JANGAN jadikan '' default.
const DEFAULT_API_BASE = 'https://kasir-nova.vercel.app';

const rawBase = (process.argv[2] ?? process.env.NOVA_API_BASE ?? DEFAULT_API_BASE).trim();
const sameOrigin = /^(--same-origin|same-origin|-)$/i.test(rawBase);
const apiBase = sameOrigin ? '' : rawBase;

if (apiBase && !/^https?:\/\//i.test(apiBase)) {
  console.error(`ERROR: URL backend harus diawali http(s):// — dapat: ${apiBase}`);
  process.exit(1);
}

const normalizedBase = apiBase.replace(/\/+$/, '');
const outDir = join(root, 'dist', 'hosting');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const app of apps) {
  const src = join(root, 'apps', app);
  if (!existsSync(src)) {
    console.error(`ERROR: apps/${app} tidak ditemukan`);
    process.exit(1);
  }
  const dest = join(outDir, app);
  cpSync(src, dest, { recursive: true });

  // Suntikkan konfigurasi runtime produksi (menimpa config.js hasil salinan).
  writeFileSync(
    join(dest, 'config.js'),
    `// Dibuat otomatis oleh scripts/build-hosting.mjs — JANGAN edit manual.\n` +
      `// NOVA_API_BASE backend produksi (bukan rahasia).\n` +
      `window.NOVA_API_BASE = '${normalizedBase}';\n`
  );

  console.log(`✓ apps/${app} -> dist/hosting/${app}`);
}

// ---------------------------------------------------------- Beranda + 404 + aset
// Beranda root dan halaman 404 memakai path absolut /assets/**, jadi aset brand
// disalin sekali ke dist/hosting/assets (bukan bergantung pada folder salah satu app).
const brandAssets = ['logo-kasir-nova.png', 'apple-touch-icon.png', 'favicon-32.png'];
const assetDir = join(outDir, 'assets');
mkdirSync(assetDir, { recursive: true });
for (const name of brandAssets) {
  const src = join(root, 'apps', 'kasir', 'assets', name);
  if (!existsSync(src)) {
    console.error(`ERROR: apps/kasir/assets/${name} tidak ditemukan (dibutuhkan beranda/404)`);
    process.exit(1);
  }
  cpSync(src, join(assetDir, name));
}
console.log(`✓ aset brand -> dist/hosting/assets (${brandAssets.join(', ')})`);

const templates = [
  ['hosting-landing.html', 'index.html', 'beranda'],
  ['hosting-404.html', '404.html', 'halaman 404'],
];
for (const [tpl, out, label] of templates) {
  const src = join(__dirname, tpl);
  if (!existsSync(src)) {
    console.error(`ERROR: scripts/${tpl} tidak ditemukan (dibutuhkan untuk ${out})`);
    process.exit(1);
  }
  writeFileSync(join(outDir, out), readFileSync(src));
  console.log(`✓ ${tpl} -> dist/hosting/${out} (${label})`);
}

console.log(`\nNOVA_API_BASE = ${normalizedBase || "(kosong = same-origin; origin harus melayani /api/**)"}`);
if (!normalizedBase) {
  console.warn(
    'PERINGATAN: base kosong. Di Firebase Hosting, /api/** -> 404 "Page Not Found".\n' +
      '           Pakai default (tanpa argumen) atau URL backend absolut untuk Hosting.'
  );
}
console.log('Siap: firebase deploy --only hosting');
