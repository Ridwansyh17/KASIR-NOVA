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

// ----------------------------------- Regresi Bug 1 (login) & Bug 2 (produk) ---
// Dua bug yang diminta diperbaiki:
//   Bug 1 - Persistent Login: aplikasi dibuka ulang -> dipaksa login walau
//           refresh token masih valid (akarnya: boot hanya memeriksa access
//           token di sessionStorage yang selalu kosong).
//   Bug 2 - Tombol "Simpan Produk" tidak terjangkau pada layar pendek karena
//           kartu modal tidak punya batas tinggi/scroll.
console.log('\n[regresi bug login & produk]');
const BUG_APPS = [
  { app: 'kasir', submitId: 'mprod-submit', formId: 'mprod-form' },
  { app: 'owner', submitId: 'product-submit', formId: 'product-form' },
];
for (const { app, submitId, formId } of BUG_APPS) {
  const html = readFileSync(join(root, 'apps', app, 'index.html'), 'utf8');
  const js = readFileSync(join(root, 'apps', app, 'src', 'app.js'), 'utf8');
  const apiSrc = readFileSync(join(root, 'apps', app, 'src', 'api.js'), 'utf8');
  const css = readFileSync(join(root, 'apps', app, 'styles', 'styles.css'), 'utf8');

  // (1) Tombol Simpan Produk ada, berlabel jelas, di dalam form produk.
  const btn = new RegExp(`<button[^>]*id="${submitId}"[^>]*>([^<]*)</button>`).exec(html);
  if (!btn) {
    fail(`[${app}] tombol simpan produk #${submitId} tidak ditemukan`);
  } else if (!/Simpan\s+Produk/i.test(btn[1])) {
    fail(`[${app}] label #${submitId} bukan "Simpan Produk" (dapat: "${btn[1].trim()}")`);
  }
  const formPos = html.indexOf(`id="${formId}"`);
  const btnPos = html.indexOf(`id="${submitId}"`);
  if (formPos === -1 || btnPos === -1 || btnPos < formPos) {
    fail(`[${app}] tombol #${submitId} bukan bagian dari form #${formId}`);
  }

  // Bug 2: modal harus dibatasi tinggi, bisa digulir, dan aksi sticky.
  if (!/\.modal-card\s*\{[^}]*max-height\s*:/s.test(css)) {
    fail(`[${app}] .modal-card tanpa max-height -> tombol simpan bisa keluar viewport`);
  }
  if (!/\.modal-card\s*\{[^}]*overflow-y\s*:\s*auto/s.test(css)) {
    fail(`[${app}] .modal-card tanpa overflow-y:auto`);
  }
  if (!/\.modal-actions\s*\{[^}]*position\s*:\s*sticky/s.test(css)) {
    fail(`[${app}] .modal-actions tidak sticky`);
  }

  // Bug 1: boot harus memakai restoreSession() + hasSession.
  if (!/export const restoreSession/.test(apiSrc)) fail(`[${app}] api.js tanpa restoreSession`);
  if (!/get hasSession\(\)/.test(apiSrc)) fail(`[${app}] api.js tanpa tokenStore.hasSession`);
  if (!/\brestoreSession\b/.test(js)) fail(`[${app}] app.js tidak memakai restoreSession()`);
  if (!/tokenStore\.hasSession/.test(js)) fail(`[${app}] app.js tidak memakai tokenStore.hasSession`);
  if (/if\s*\(\s*tokenStore\.access\s*\)/.test(js)) {
    fail(`[${app}] app.js masih bergantung hanya pada tokenStore.access`);
  }
}
console.log('  pemeriksaan regresi bug login & produk selesai');

// ------------------------------------------------- FASE 1: token desain V2 ----
// Mengunci identitas visual V2 (tema terang + topbar navy) agar tidak
// tergelincir kembali ke token tema gelap lama.
console.log('\n[token desain V2 (FASE 1)]');
const V2_TOKENS = [
  '--navy-700',
  '--navy-800',
  '--blue-500',
  '--blue-600',
  '--sidebar',
  '--overlay',
  '--shadow-sm',
  '--shadow-lg',
  '--input-bg',
  '--primary-tint',
];
const LEGACY_LITERALS = [
  ['#060e22', 'latar gelap lama'],
  ['#0c1a34', 'kartu gelap lama'],
  ['#0f1f3d', 'kartu-2 gelap lama'],
  ['#14284c', 'kartu-3 gelap lama'],
  ['#00b4ff', 'aksen cyan lama'],
  ['#e9f1ff', 'teks terang lama'],
  ['#8fa2c4', 'teks redup lama'],
  ['#1d3160', 'garis gelap lama'],
  ['#008fd4', 'aksen biru lama'],
];
for (const app of APPS) {
  const css = readFileSync(join(root, 'apps', app.name, 'styles', 'styles.css'), 'utf8');
  const missing = V2_TOKENS.filter((t) => !new RegExp(`${t.replace(/[-]/g, '\\-')}\\s*:`).test(css));
  if (missing.length) fail(`[${app.name}] token V2 hilang: ${missing.join(', ')}`);
  for (const [lit, label] of LEGACY_LITERALS) {
    if (css.toLowerCase().includes(lit.toLowerCase())) {
      fail(`[${app.name}] warna ${label} (${lit}) masih ada`);
    }
  }
  if (!/\.topbar\s*\{[^}]*linear-gradient\(180deg,\s*var\(--sidebar\)/s.test(css)) {
    fail(`[${app.name}] .topbar belum memakai latar navy V2`);
  }
  if (!/\bbody\s*\{[^}]*background:\s*var\(--bg\)/s.test(css)) {
    fail(`[${app.name}] body belum memakai latar terang var(--bg)`);
  }
  if (!/\.auth\s*\{[^}]*linear-gradient\(180deg,\s*var\(--navy-800\)/s.test(css)) {
    fail(`[${app.name}] layar login belum memakai latar navy V2`);
  }
}
console.log(`  token dicek: ${V2_TOKENS.length} token + ${LEGACY_LITERALS.length} warna lama per aplikasi`);

// ------------------------------------------- Smart Product Image (FASE 2) ----
// Memastikan salinan modul bersama tidak menyimpang, modul dimuat sebelum
// app.js, dan kelas CSS pendukungnya ada.
console.log('\n[Smart Product Image (FASE 2)]');
const canonicalShared = readFileSync(join(root, 'shared', 'product-image.js'), 'utf8');
for (const app of ['owner', 'kasir']) {
  const rel = `apps/${app}/src/product-image.js`;
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    fail(`${rel} tidak ada (jalankan: node scripts/sync-shared.mjs)`);
  } else if (readFileSync(abs, 'utf8') !== canonicalShared) {
    fail(`${rel} menyimpang dari shared/product-image.js (jalankan: node scripts/sync-shared.mjs)`);
  } else {
    console.log(`  salinan bersama OK: ${rel}`);
  }

  const html = readFileSync(join(root, 'apps', app, 'index.html'), 'utf8');
  const atShared = html.indexOf('src="./src/product-image.js"');
  const atApp = html.indexOf('src="./src/app.js"');
  if (atShared < 0) fail(`apps/${app}/index.html tidak memuat ./src/product-image.js`);
  else if (atApp >= 0 && atShared > atApp) {
    fail(`apps/${app}/index.html: product-image.js harus dimuat sebelum app.js`);
  }

  const css = readFileSync(join(root, 'apps', app, 'styles', 'styles.css'), 'utf8');
  for (const cls of ['.product-main', '.product-thumb', '.photo-auto']) {
    if (!css.includes(cls)) fail(`apps/${app}/styles/styles.css: kelas ${cls} tidak ada`);
  }
}
if (!readFileSync(join(root, 'apps', 'kasir', 'styles', 'styles.css'), 'utf8').includes('.pos-photo')) {
  fail('apps/kasir/styles/styles.css: kelas .pos-photo tidak ada');
}

// --------------------------------- Smart Receipt Preview (FASE 3) -----------
// Mengunci alur: pratinjau (BELUM DIBAYAR) TIDAK pernah LUNAS, cetak hanya
// setelah konfirmasi server, cetak ulang dari snapshot, dan gagal cetak tidak
// membatalkan transaksi.
console.log('\n[Smart Receipt Preview (FASE 3)]');
const kHtml = readFileSync(join(root, 'apps', 'kasir', 'index.html'), 'utf8');
const kJs = readFileSync(join(root, 'apps', 'kasir', 'src', 'app.js'), 'utf8');
const kCss = readFileSync(join(root, 'apps', 'kasir', 'styles', 'styles.css'), 'utf8');
const flowPath = join(root, 'apps', 'kasir', 'src', 'sale-flow.js');
if (!existsSync(flowPath)) {
  fail('apps/kasir/src/sale-flow.js tidak ada (modul alur pratinjau struk)');
} else {
  const flow = readFileSync(flowPath, 'utf8');
  for (const needle of [
    'MODE_DRAFT',
    'MODE_FINAL',
    'validateSale',
    'createDraft',
    'buildSalePayload',
    'confirmDraft',
    'isPrintable',
    'isDraftState',
    'afterPrintFailure',
    'createSnapshot',
    'markReprint',
    'renderPrintHtml',
  ]) {
    if (!new RegExp(`\\b${needle}\\b`).test(flow)) fail(`sale-flow.js tanpa ${needle}`);
  }
  if (/from\s+['"]\.\//.test(flow)) {
    fail('sale-flow.js mengimpor modul relatif (harus murni agar bisa diuji lewat data: URL)');
  }
}

for (const id of [
  'receipt-headline',
  'receipt-note',
  'receipt-print-error',
  'receipt-pay-row',
  'receipt-pay-btn',
  'receipt-cancel-btn',
  'receipt-done-btn',
]) {
  if (!kHtml.includes(`id="${id}"`)) fail(`apps/kasir/index.html tanpa #${id}`);
}
for (const imp of ['sale-flow.js', 'receipt.js', 'escpos.js']) {
  if (!new RegExp(`from\\s+['"]\\./${imp.replace('.', '\\.')}['"]`).test(kJs)) {
    fail(`apps/kasir/src/app.js tidak mengimpor ./${imp}`);
  }
}
for (const cls of [
  '.receipt.draft',
  '.receipt-print-error',
  '#print-struk .struk-draft',
  '#print-struk .struk-reprint',
]) {
  if (!kCss.includes(cls)) fail(`apps/kasir/styles/styles.css: kelas ${cls} tidak ada`);
}
// Semua kelas struk harus tetap ter-scope ke #print-struk (tidak bocor ke layar).
if (/(^|\n)\.struk-(draft|reprint)\s*\{/.test(kCss)) {
  fail('aturan .struk-draft/.struk-reprint tidak boleh global (harus di bawah #print-struk)');
}
console.log('  alur pratinjau struk dicek');

// ------------------------------- Fitur 13 Okt 2026 (FASE 6) -----------------
// Mengunci agar fitur V0.3 (laporan keuangan/laba, ekspor Excel, pengeluaran,
// stok, pendapatan kasir) tidak hilang saat desain V2 & FASE 3 mengubah UI.
console.log('\n[fitur 13 Okt 2026 (FASE 6)]');

const readApp = (app, ...rel) => readFileSync(join(root, 'apps', app, ...rel), 'utf8');
const ownerHtml6 = readApp('owner', 'index.html');
const ownerJs6 = readApp('owner', 'src', 'app.js');
const ownerApi6 = readApp('owner', 'src', 'api.js');
const kasirHtml6 = readApp('kasir', 'index.html');
const kasirJs6 = readApp('kasir', 'src', 'app.js');
const kasirApi6 = readApp('kasir', 'src', 'api.js');
const reportRoutes6 = readFileSync(join(root, 'server', 'src', 'modules', 'report', 'routes.js'), 'utf8');
const cashierRoutes6 = readFileSync(join(root, 'server', 'src', 'modules', 'cashier-area', 'routes.js'), 'utf8');

const featureChecks = [
  // Owner — laporan keuangan & laba (Fase 4/6).
  [ownerHtml6, 'apps/owner/index.html', ['finance-section', 'fin-summary', 'fin-export-xlsx', 'fin-refresh-btn', 'fin-method-body', 'fin-expense-body', 'fin-outlet-body']],
  [ownerJs6, 'apps/owner/src/app.js', ['api.reports.finance(', 'api.reports.financeXlsx(']],
  [ownerApi6, 'apps/owner/src/api.js', ['finance:', 'financeXlsx:']],
  // Owner — ekspor Excel (rekap transaksi, per-outlet, lintas-bisnis).
  [ownerJs6, 'apps/owner/src/app.js', ['api.reports.downloadXlsx(', 'api.reports.outletsXlsx(', 'api.reports.businessesXlsx(', 'api.reports.outlets(']],
  [ownerApi6, 'apps/owner/src/api.js', ['downloadXlsx:', 'outletsXlsx:', 'businessesXlsx:']],
  // Owner — pengeluaran & pergerakan stok.
  [ownerHtml6, 'apps/owner/index.html', ['expense-section', 'exp-body', 'exp-new-btn']],
  [ownerJs6, 'apps/owner/src/app.js', ['api.expenses.list(', 'api.expenses.create(', 'api.inventoryMovements.list(']],
  [ownerApi6, 'apps/owner/src/api.js', ['expenses:', 'inventoryMovements:']],
  // Owner — perbandingan lintas-bisnis.
  [ownerHtml6, 'apps/owner/index.html', ['cross-section', 'cross-summary', 'cross-export-xlsx', 'cross-body']],
  // Kasir — pendapatan harian, pengeluaran, stok (tab/pane).
  [kasirHtml6, 'apps/kasir/index.html', ['data-pane="pendapatan"', 'data-pane="pengeluaran"', 'data-pane="stok"', 'data-pane="produk"']],
  [kasirJs6, 'apps/kasir/src/app.js', ['api.daily(', 'api.expenses(', 'api.createExpense(', 'api.voidExpense(', 'api.inventoryMovements(', 'api.setStock(', 'api.setStockStatus(']],
  [kasirApi6, 'apps/kasir/src/api.js', ['daily:', 'expenses:', 'createExpense:', 'voidExpense:', 'inventoryMovements:', 'setStock:', 'setStockStatus:']],
  // Server — endpoint laporan/ekspor/pengeluaran/stok tetap terdaftar.
  [reportRoutes6, 'server/src/modules/report/routes.js', ["'/summary'", "'/outlets'", "'/export'", "'/finance'", "'/finance/export'"]],
  [cashierRoutes6, 'server/src/modules/cashier-area/routes.js', ["'/reports/daily'", "'/expenses'", "'/inventory-movements'"]],
];
for (const [src, where, needles] of featureChecks) {
  for (const needle of needles) {
    if (!src.includes(needle)) fail(`${where} tanpa ${needle} (fitur 13 Okt 2026 hilang?)`);
  }
}
console.log(`  fitur dicek: ${featureChecks.reduce((n, c) => n + c[2].length, 0)} penanda pada ${featureChecks.length} berkas`);

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
    ['/kasir/src/product-image.js', 'js'],
    ['/owner/', 'html'],
    ['/owner/assets/favicon-32.png', 'png'],
    ['/owner/src/app.js', 'js'],
    ['/owner/src/product-image.js', 'js'],
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
