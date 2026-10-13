/**
 * Verifikasi statis UI KASIR NOVA (tanpa browser).
 *
 * Menjalankan dari root repo:
 *   node scripts/verify-ui.mjs
 *
 * Pemeriksaan (integritas statis, bukan pengganti uji browser):
 *  1. Semua rujukan LOKAL di index.html (<script>, <link>) ada.
 *  2. Semua id yang dipakai JS ($('id') / getElementById) ada di HTML.
 *  3. Semua pemanggilan `api.<...>` di app.js punya definisinya di api.js.
 *  4. Ikon pada apps/kasir/site.webmanifest ada.
 *  5. Bila `dist/hosting` sudah dibangun: smoke HTTP tiap app + aset ikon.
 *     (Bangun dulu: `node scripts/build-hosting.mjs`.)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const root = process.cwd();
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  GAGAL: ${msg}`);
};

const APPS = [
  { name: 'admin', manifest: false },
  { name: 'owner', manifest: false },
  { name: 'kasir', manifest: true },
];

// ----------------------------------------------------------------- Statis ----
for (const app of APPS) {
  const dir = join(root, 'apps', app.name);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  console.log(`\n[${app.name}]`);

  // (1) Rujukan lokal di HTML.
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const v = m[1];
    if (/^(https?:|data:|#|mailto:)/i.test(v)) continue;
    refs.add(v.replace(/^\.\//, ''));
  }
  for (const r of refs) {
    if (!existsSync(resolve(dir, r))) fail(`rujukan tidak ada di HTML: ${r}`);
  }
  console.log(`  rujukan lokal dicek: ${refs.size}`);

  // (2) id JS -> HTML.
  const js = readFileSync(join(dir, 'src/app.js'), 'utf8');
  const jsIds = new Set();
  for (const m of js.matchAll(/\$\('([^']+)'\)/g)) jsIds.add(m[1]);
  for (const m of js.matchAll(/getElementById\('([^']+)'\)/g)) jsIds.add(m[1]);
  const htmlIds = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) htmlIds.add(m[1]);
  const DYNAMIC = new Set(['print-page-size']); // dibuat sendiri oleh app.js
  const missingIds = [...jsIds].filter((id) => !htmlIds.has(id) && !DYNAMIC.has(id));
  if (missingIds.length) fail(`id JS tidak ada di HTML: ${missingIds.join(', ')}`);
  console.log(`  id JS->HTML dicek: ${jsIds.size}`);

  // Pemanggilan api.* -> definisi di api.js
  const apiSrc = readFileSync(join(dir, 'src', 'api.js'), 'utf8');
  const keys = new Set();
  for (const m of js.matchAll(/\bapi\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\(/g)) keys.add(m[2]);
  for (const m of js.matchAll(/\bapi\.([A-Za-z0-9_]+)\(/g)) keys.add(m[1]);
  const missingApi = [...keys].filter((k) => !new RegExp(`\\b${k}\\s*[:(]`).test(apiSrc));
  if (missingApi.length) fail(`method api tidak ada di api.js: ${missingApi.join(', ')}`);
  console.log(`  pemanggilan api dicek: ${keys.size}`);

  // Ikon manifest
  if (app.manifest) {
    const mf = JSON.parse(readFileSync(join(dir, 'site.webmanifest'), 'utf8'));
    for (const icon of mf.icons ?? []) {
      if (!existsSync(resolve(dir, icon.src))) fail(`ikon manifest tidak ada: ${icon.src}`);
    }
    console.log(`  ikon manifest dicek: ${(mf.icons ?? []).length}`);
  }
}

// -------------------------------------------------- Bundel hosting (opsional)
const hosting = join(process.cwd(), 'dist', 'hosting');
let hasHosting = false;
try {
  hasHosting = (await stat(hosting)).isDirectory();
} catch {
  hasHosting = false;
}

if (!hasHosting) {
  console.log('\n[hosting] DILEWATI (dist/hosting belum ada — jalankan scripts/build-hosting.mjs)');
} else {
  console.log('\n[hosting]');
  const TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpeg': 'image/jpeg',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
  };
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const full = join(hosting, p);
      const data = await readFile(full);
      res.writeHead(200, { 'Content-Type': TYPES[extname(full)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404).end('404');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const CHECKS = [
    ['/kasir/', 'html'],
    ['/kasir/assets/icon-192.png', 'png'],
    ['/kasir/assets/icon-512.png', 'png'],
    ['/kasir/assets/icon-maskable-512.png', 'png'],
    ['/kasir/site.webmanifest', 'json'],
    ['/kasir/src/app.js', 'js'],
    ['/owner/', 'html'],
    ['/owner/assets/favicon-32.png', 'png'],
    ['/owner/src/app.js', 'js'],
    ['/admin/', 'html'],
    ['/admin/assets/favicon-32.png', 'png'],
    ['/admin/src/app.js', 'js'],
  ];
  for (const [path, kind] of CHECKS) {
    const res = await fetch(base + path);
    const buf = Buffer.from(await res.arrayBuffer());
    let ok = res.status === 200;
    if (ok && kind === 'png') ok = buf.subarray(0, 4).equals(PNG_SIG);
    if (ok && kind === 'json') {
      try {
        ok = !!JSON.parse(buf.toString('utf8'));
      } catch {
        ok = false;
      }
    }
    if (!ok) failures++;
    console.log(`  ${ok ? 'OK  ' : 'GAGAL'} ${res.status} ${path} (${buf.length} byte)`);
  }
  server.close();
}

console.log(`\n${failures === 0 ? 'SEMUA OK' : `ADA ${failures} KEGAGALAN`}`);
process.exit(failures === 0 ? 0 : 1);
