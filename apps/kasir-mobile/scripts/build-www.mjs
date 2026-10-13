/**
 * Siapkan aset web untuk aplikasi Android (Capacitor).
 *
 * Menyalin `apps/kasir` ke `apps/kasir-mobile/www` dan menulis ulang `config.js`
 * dengan NOVA_API_BASE backend (argumen / env). `www` adalah `webDir` Capacitor.
 *
 * Pemakaian:
 *   node scripts/build-www.mjs                          # default produksi
 *   node scripts/build-www.mjs https://api.example.com   # backend lain
 *   NOVA_API_BASE=https://api.example.com node scripts/build-www.mjs
 */
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const repoRoot = join(projectRoot, '..', '..');

const src = join(repoRoot, 'apps', 'kasir');
const out = join(projectRoot, 'www');

const apiBase = (process.argv[2] ?? process.env.NOVA_API_BASE ?? 'https://kasir-nova.vercel.app')
  .trim()
  .replace(/\/+$/, '');

if (apiBase && !/^https?:\/\//i.test(apiBase)) {
  console.error(`ERROR: URL backend harus diawali http(s):// — dapat: ${apiBase}`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });

// config.js ditulis ulang dengan backend produksi (bukan rahasia).
writeFileSync(
  join(out, 'config.js'),
  `// Dibuat otomatis oleh scripts/build-www.mjs — jangan diedit.\n` +
    `window.NOVA_API_BASE = ${JSON.stringify(apiBase)};\n`
);

console.log(`✓ apps/kasir -> apps/kasir-mobile/www (NOVA_API_BASE=${apiBase})`);
