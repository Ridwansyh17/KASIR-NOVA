/**
 * Siapkan aset statis untuk Firebase Hosting.
 *
 * Menyalin apps/{admin,owner,kasir} ke dist/hosting/<app> dan menulis ulang
 * config.js dengan NOVA_API_BASE backend (dari argumen / env), tanpa mengubah
 * berkas source di repo. Setelah ini: `firebase deploy --only hosting`.
 *
 * Pemakaian:
 *   node scripts/build-hosting.mjs                         # same-origin (rewrite /api/**)
 *   node scripts/build-hosting.mjs https://api.example.com # cross-origin (URL absolut)
 *   NOVA_API_BASE=https://api.example.com node scripts/build-hosting.mjs
 */
import { cpSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const apps = ['admin', 'owner', 'kasir'];
// Kosong => same-origin (pakai rewrite /api/** di Firebase Hosting). Diisi URL
// absolut => cross-origin langsung ke backend HTTPS.
const apiBase = (process.argv[2] ?? process.env.NOVA_API_BASE ?? '').trim();

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

console.log(`\nNOVA_API_BASE = ${normalizedBase || '(kosong / same-origin via rewrite /api/**)'}`);
console.log('Siap: firebase deploy --only hosting');
