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
 *  6. Sintaks setiap berkas `apps/<panel>/src/*.js` lewat `node --check`
 *     (kunci regresi "panel blank putih", 17 Okt 2026).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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

// ------------------------------- Sintaks modul panel (regresi 17 Okt 2026) ---
// Kunci regresi: satu kurung kurawal berlebih di `apps/owner/src/app.js` membuat
// modul GAGAL dimuat -> panel Owner **blank putih** (login-view tetap `hidden`)
// walau semua rujukan aset & id tetap "OK" secara statis. Karena itu tiap berkas
// JS di `apps/*/src/` diperiksa dengan `node --check` (disalin ke `.mjs` agar
// memakai semantik modul seperti `<script type="module">`).
console.log('\n[sintaks modul panel]');
{
  const syntaxDir = mkdtempSync(join(tmpdir(), 'nova-syntax-'));
  let checked = 0;
  for (const app of APPS) {
    const srcDir = join(root, 'apps', app.name, 'src');
    for (const file of readdirSync(srcDir).filter((n) => n.endsWith('.js')).sort()) {
      const tmpFile = join(syntaxDir, `${app.name}-${file}.mjs`);
      writeFileSync(tmpFile, readFileSync(join(srcDir, file), 'utf8'));
      try {
        execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
        checked++;
      } catch (err) {
        const rel = `apps/${app.name}/src/${file}`;
        const detail = String(err.stderr ?? err.message)
          .split('\n')
          .map((l) => l.trim().replace(tmpFile, rel))
          .filter(Boolean)
          .slice(0, 2)
          .join(' ');
        fail(`sintaks ${rel} rusak -> panel bisa blank putih: ${detail}`);
      }
    }
  }
  console.log(`  ${checked} berkas JS panel lolos node --check`);
  rmSync(syntaxDir, { recursive: true, force: true });
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

// ------------------------------------------- Struk PDF Kasir (17 Okt 2026) --
// Alur baru (permintaan pemilik): setelah "Bayar" struk PDF langsung tersedia
// (TANPA menunggu printer thermal) dan bisa DIKIRIM / DISIMPAN / DICETAK.
console.log('\n[struk pdf kasir (17 Okt 2026)]');
for (const id of ['struk-share-btn', 'struk-save-btn', 'struk-print-btn', 'struk-pdf-note']) {
  if (!kHtml.includes(`id="${id}"`)) fail(`apps/kasir/index.html tanpa #${id}`);
}
for (const imp of ['receipt-pdf.js', 'struk-share.js']) {
  if (!new RegExp(`from\\s+['"]\\./${imp.replace('.', '\\.')}['"]`).test(kJs)) {
    fail(`apps/kasir/src/app.js tidak mengimpor ./${imp}`);
  }
}
for (const needle of ['buildStrukPdf(', 'buildStrukPdfBundle(', 'strukShare.sharePdf(', 'strukShare.savePdf(', 'strukShare.printPdf(']) {
  if (!kJs.includes(needle)) fail(`apps/kasir/src/app.js tanpa "${needle}"`);
}
for (const file of ['receipt-pdf.js', 'struk-share.js']) {
  const path = join(root, 'apps', 'kasir', 'src', file);
  if (!existsSync(path)) {
    fail(`apps/kasir/src/${file} tidak ada (struk PDF kasir hilang?)`);
    continue;
  }
  const src = readFileSync(path, 'utf8');
  if (/from\s+['"]\.\//.test(src)) {
    fail(`apps/kasir/src/${file} mengimpor modul relatif (harus murni agar bisa diuji lewat data: URL)`);
  }
}
// Plugin native (APK) untuk kirim/simpan/cetak struk PDF + pendaftarannya.
const receiptPluginPath = join(
  root, 'apps', 'kasir-mobile', 'android', 'app', 'src', 'main', 'java', 'id', 'kasirnova', 'kasir', 'NovaReceiptPlugin.java'
);
const mainActivityPath = join(
  root, 'apps', 'kasir-mobile', 'android', 'app', 'src', 'main', 'java', 'id', 'kasirnova', 'kasir', 'MainActivity.java'
);
if (!existsSync(receiptPluginPath)) {
  fail('plugin native NovaReceipt tidak ada (kirim/simpan/cetak struk PDF di APK)');
} else {
  const pluginSrc = readFileSync(receiptPluginPath, 'utf8');
  for (const needle of ['@CapacitorPlugin(name = "NovaReceipt")', 'public void share(', 'public void save(', 'public void print(']) {
    if (!pluginSrc.includes(needle)) fail(`NovaReceiptPlugin.java tanpa "${needle}"`);
  }
}
if (!existsSync(mainActivityPath) || !readFileSync(mainActivityPath, 'utf8').includes('registerPlugin(NovaReceiptPlugin.class)')) {
  fail('MainActivity.java belum mendaftarkan NovaReceiptPlugin');
}
if (!kCss.includes('#struk-pdf-note')) fail('apps/kasir/styles/styles.css tanpa #struk-pdf-note');
console.log('  tombol kirim/simpan/cetak + plugin native dicek');

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

// -------------------------------------- Desain Kasir Mobile V2 (FASE 12) -----
// Referensi: KASIR-NOVA-V3-REFERENSI-LENGKAP/05-KASIR-MOBILE; spesifikasi hasil
// ekstraksi ada di docs/30-desain-kasir-mobile-v2.md. Mengunci tata letak HP:
// bilah navigasi bawah 5 butir, Beranda (ringkasan + grafik), menu Lainnya,
// judul halaman, dan bilah atas terang untuk layar kecil.
console.log('\n[desain kasir mobile V2 (FASE 12)]');

const kasirCss12 = readApp('kasir', 'styles', 'styles.css');
const mobileShellChecks = [
  [
    kasirHtml6,
    'apps/kasir/index.html',
    [
      'id="bottom-nav"',
      'data-tab="beranda"',
      'data-tab="produk"',
      'data-tab="kasir"',
      'data-tab="pendapatan"',
      'data-tab="lainnya"',
      'data-pane="beranda"',
      'data-pane="lainnya"',
      'id="page-title"',
      'id="page-subtitle"',
      'id="brand-context"',
      'id="home-summary"',
      'id="home-chart"',
    ],
  ],
  [
    kasirJs6,
    'apps/kasir/src/app.js',
    ["const TABS = ['beranda'", 'PAGE_INFO', 'bottomNavKey', 'loadHome', 'renderHomeChart', 'api.dailySeries('],
  ],
  [kasirApi6, 'apps/kasir/src/api.js', ['dailySeries:']],
  [cashierRoutes6, 'server/src/modules/cashier-area/routes.js', ["'/reports/daily-series'"]],
  [
    kasirCss12,
    'apps/kasir/styles/styles.css',
    ['.bottom-nav {', '.bn-item {', '.bn-icon {', '.chart-bar {', '.menu-item {', 'max-width: 900px'],
  ],
];
let mobileShellMissing = 0;
for (const [src, label, needles] of mobileShellChecks) {
  for (const needle of needles) {
    if (!src.includes(needle)) {
      fail(`${label} tidak memuat "${needle}" (desain Kasir Mobile V2 hilang?)`);
      mobileShellMissing++;
    }
  }
}
if (mobileShellMissing === 0) {
  console.log('  bilah navigasi bawah, Beranda, menu Lainnya, dan CSS HP lengkap.');
}

// ---------------------------------- Laporan Transaksi Cetak (17 Okt 2026) ---------
// Owner 17 Okt 2026: laporan transaksi siap-cetak (baris PER ITEM) hanya di
// panel Owner; dicetak lewat halaman HTML -> PDF. Spesifikasi: docs/35.
console.log('\n[laporan transaksi cetak (17 Okt 2026)]');

const ownerCss17 = readApp('owner', 'styles', 'styles.css');
const printReportChecks = [
  [ownerHtml6, 'apps/owner/index.html', ['id="rep-print-btn"', 'id="print-report"']],
  [
    ownerJs6,
    'apps/owner/src/app.js',
    ['api.reports.transactions(', 'renderPrintReport', 'printTransactionReport', 'fmtCetakID'],
  ],
  [ownerApi6, 'apps/owner/src/api.js', ['transactions: (businessId, params']],
  [reportRoutes6, 'server/src/modules/report/routes.js', ["'/transactions'", 'transactionReport']],
  [
    ownerCss17,
    'apps/owner/styles/styles.css',
    ['#print-report {', '@media print {', 'body > *:not(#print-report)'],
  ],
];
let printMissing = 0;
for (const [src, label, needles] of printReportChecks) {
  for (const needle of needles) {
    if (!src.includes(needle)) {
      fail(`${label} tidak memuat "${needle}" (laporan transaksi cetak hilang?)`);
      printMissing++;
    }
  }
}
if (printMissing === 0) {
  console.log('  tombol cetak, halaman cetak, endpoint, dan CSS cetak lengkap.');
}

// --------------------- Nomor halaman cetak laporan (17 Okt 2026) -------------
// Permintaan pemilik (lanjutan): nomor "Halaman i dari N" pada cetak laporan
// yang lebih dari satu halaman A4. Paginasi eksplisit (kapasitas baris diukur
// dengan Chrome headless --print-to-pdf, lihat scripts/print-report-check.mjs).
console.log('\n[nomor halaman cetak laporan (17 Okt 2026)]');

const reportPrintSrc = readApp('owner', 'src', 'report-print.js');
const halamanChecks = [
  [
    reportPrintSrc,
    'apps/owner/src/report-print.js',
    [
      'export const PRINT_LAYOUT',
      'planPrintPages',
      'pageLabel',
      'renderPrintReport',
      'PRINT_STATUS_LABELS',
      'Halaman ${page} dari ${total}',
    ],
  ],
  [
    ownerJs6,
    'apps/owner/src/app.js',
    ['./report-print.js', 'renderPrintReport(data, {', 'PRINT_STATUS_LABELS'],
  ],
  [
    ownerCss17,
    'apps/owner/styles/styles.css',
    ['#print-report .pr-page + .pr-page', 'break-before: page', '#print-report .pr-cont'],
  ],
];
let halamanMissing = 0;
for (const [src, label, needles] of halamanChecks) {
  for (const needle of needles) {
    if (!src.includes(needle)) {
      fail(`${label} tidak memuat "${needle}" (nomor halaman cetak hilang?)`);
      halamanMissing++;
    }
  }
}
if (halamanMissing === 0) {
  console.log('  modul paginasi, pemisah halaman, dan nomor halaman lengkap.');
}

// Regresi: `STATUS_LABELS` tanpa awalan `PRINT_` pernah membuat cetak laporan
// dengan filter void/refund gagal (ReferenceError). Jangan sampai kembali.
const statusLabelsBare = ownerJs6.match(/(?<!PRINT_)STATUS_LABELS\s*\[/g) ?? [];
if (statusLabelsBare.length > 0) {
  fail(
    `apps/owner/src/app.js memakai STATUS_LABELS tanpa definisi (${statusLabelsBare.length} kali) — cetak laporan void/refund akan gagal.`
  );
} else {
  console.log('  label status cetak memakai PRINT_STATUS_LABELS (bukan STATUS_LABELS liar).');
}

// -------------------------- Ekspor Excel Laporan Transaksi (17 Okt 2026) -----
// Berkas .xlsx untuk laporan yang SAMA (satu baris per ITEM) — permintaan Owner.
console.log('\n[ekspor Excel laporan transaksi (17 Okt 2026)]');

const reportXlsx6 = readFileSync(join(root, 'server', 'src', 'modules', 'report', 'xlsx.js'), 'utf8');
const reportService6 = readFileSync(
  join(root, 'server', 'src', 'modules', 'report', 'service.js'),
  'utf8'
);
const excelExportChecks = [
  [ownerHtml6, 'apps/owner/index.html', ['id="rep-transactions-xlsx"']],
  [
    ownerJs6,
    'apps/owner/src/app.js',
    ['downloadTransactionReportExcel', 'api.reports.transactionsXlsx('],
  ],
  [
    ownerApi6,
    'apps/owner/src/api.js',
    ['transactionsXlsx: (businessId, params', '/reports/transactions/export'],
  ],
  [
    reportRoutes6,
    'server/src/modules/report/routes.js',
    ["'/transactions/export'", 'transactionReportExport'],
  ],
  [
    reportXlsx6,
    'server/src/modules/report/xlsx.js',
    ['buildTransactionReportWorkbook', "addWorksheet('Detail Transaksi'", "addWorksheet('Produk Terlaris'"],
  ],
  [reportService6, 'server/src/modules/report/service.js', ['exportTransactionReportXlsx']],
];
let excelExportMissing = 0;
for (const [src, label, needles] of excelExportChecks) {
  for (const needle of needles) {
    if (!src.includes(needle)) {
      fail(`${label} tidak memuat "${needle}" (ekspor Excel laporan transaksi hilang?)`);
      excelExportMissing++;
    }
  }
}
if (excelExportMissing === 0) {
  console.log('  tombol, API, endpoint, dan pembuat berkas Excel (.xlsx) lengkap.');
}

// ------------------------- Laporan Transaksi Kasir (17 Okt 2026) -------------
// Keputusan pemilik: B1 satu baris per TRANSAKSI, B2 ekspor Excel, B3 tab
// "Laporan Transaksi" dengan rentang bawaan HARI INI. Keputusan A5a: cakupan =
// SEMUA transaksi outlet kasir. Pengunci ini juga memastikan skema laporan
// kasir TIDAK punya `outletId`/`cashierId` (outlet wajib dari akun kasir).
console.log('\n[laporan transaksi kasir (17 Okt 2026)]');

const kHtmlLap = readFileSync(join(root, 'apps', 'kasir', 'index.html'), 'utf8');
const kJsLap = readFileSync(join(root, 'apps', 'kasir', 'src', 'app.js'), 'utf8');
const kApiLap = readFileSync(join(root, 'apps', 'kasir', 'src', 'api.js'), 'utf8');
const kShareLap = readFileSync(join(root, 'apps', 'kasir', 'src', 'struk-share.js'), 'utf8');
const kRoutesLap = readFileSync(
  join(root, 'server', 'src', 'modules', 'cashier-area', 'routes.js'),
  'utf8'
);
const kCtrlLap = readFileSync(
  join(root, 'server', 'src', 'modules', 'cashier-area', 'controller.js'),
  'utf8'
);
const kSvcLap = readFileSync(join(root, 'server', 'src', 'modules', 'report', 'service.js'), 'utf8');
const kSchemaLap = readFileSync(join(root, 'server', 'src', 'modules', 'report', 'schema.js'), 'utf8');

const kasirReportChecks = [
  [
    kHtmlLap,
    'apps/kasir/index.html',
    [
      'data-pane="laporan"',
      'data-tab="laporan"',
      'id="lap-summary"',
      'id="lap-body"',
      'id="lap-range"',
      'id="lap-status"',
      'id="lap-search"',
      'id="lap-export-btn"',
      'id="lap-note"',
    ],
  ],
  [
    kJsLap,
    'apps/kasir/src/app.js',
    [
      'api.transactionsReport(',
      'api.transactionsReportFile(',
      'strukShare.saveXlsx(',
      "laporan: ['Laporan Transaksi'",
      'TX_STATUS_LABELS',
      'loadReportTransactions',
    ],
  ],
  [
    kApiLap,
    'apps/kasir/src/api.js',
    ['/api/cashier/reports/transactions', '/api/cashier/reports/transactions/export'],
  ],
  [kShareLap, 'apps/kasir/src/struk-share.js', ['saveFile', 'saveXlsx', 'XLSX_MIME']],
  [
    kRoutesLap,
    'server/src/modules/cashier-area/routes.js',
    [
      "'/reports/transactions'",
      "'/reports/transactions/export'",
      'cashierTransactionReportQuerySchema',
      'cashierTransactionReportExportQuerySchema',
      'controller.reportTransactions',
      'controller.reportTransactionsExport',
    ],
  ],
  [
    kCtrlLap,
    'server/src/modules/cashier-area/controller.js',
    ['reportTransactionsExport', 'outletId: scope.outlet_id', 'resolveFinanceRange(scope.timezone'],
  ],
  [
    kSvcLap,
    'server/src/modules/report/service.js',
    ['export const cashierTransactionReport', 'export const exportCashierTransactionReportXlsx'],
  ],
  [
    kSchemaLap,
    'server/src/modules/report/schema.js',
    ['cashierTransactionReportQuerySchema', 'cashierTransactionReportExportQuerySchema'],
  ],
];
let kasirReportMissing = 0;
for (const [src, label, needles] of kasirReportChecks) {
  for (const needle of needles) {
    if (!src.includes(needle)) {
      fail(`${label} tidak memuat "${needle}" (laporan transaksi kasir hilang?)`);
      kasirReportMissing++;
    }
  }
}

// Negatif: blok skema kasir tidak boleh menerima outletId/cashierId dari klien.
const lapSchemaStart = kSchemaLap.indexOf('const cashierReportFilters');
const lapSchemaEnd = kSchemaLap.indexOf('Fase 4/6', lapSchemaStart);
const lapSchemaBlock =
  lapSchemaStart >= 0 ? kSchemaLap.slice(lapSchemaStart, lapSchemaEnd > lapSchemaStart ? lapSchemaEnd : undefined) : '';
if (!lapSchemaBlock) {
  fail('server/src/modules/report/schema.js tanpa blok cashierReportFilters');
} else if (/outletId|cashierId/.test(lapSchemaBlock)) {
  fail('skema laporan kasir memuat outletId/cashierId (outlet wajib dari akun kasir)');
}

if (kasirReportMissing === 0) {
  console.log('  pane, API, endpoint, ekspor .xlsx, dan pembatasan outlet dari akun: lengkap.');
}

// Regresi 17 Okt 2026 (ditemukan tes struk-share): `new root().Blob(...)` TIDAK
// sah — JS memparsingnya sebagai `new root()` sehingga jalur UNDUH berkas di web
// gagal ("root is not a constructor"). Konstruktor wajib diambil ke variabel.
if (/new\s+root\(\)\s*\.\s*(Blob|File|Uint8Array)\s*\(/.test(kShareLap)) {
  fail('apps/kasir/src/struk-share.js memakai `new root().X(...)` (jalur unduh berkas rusak)');
} else {
  console.log('  konstruktor Blob/File diambil lewat variabel (jalur unduh web aman).');
}

// --------------------- Pembayaran langganan (gateway, 17 Okt 2026) -----------
// Owner membayar langganan lewat API inti per kanal (VA/QRIS) Duitku SANDBOX.
// Kunci regresi di sini:
//   - nominal tagihan SELALU dari harga paket di server (klien tidak boleh
//     mengirim nominal),
//   - kredensial gateway tidak pernah bocor ke panel,
//   - tanda tangan callback tidak pernah disimpan,
//   - endpoint callback publik tetap memverifikasi tanda tangan.
console.log('\n[pembayaran langganan (gateway, 17 Okt 2026)]');

const readServer = (...parts) => readFileSync(join(root, 'server', ...parts), 'utf8');
const payDuitku = readServer('src', 'payments', 'duitku.js');
const payRegistry = readServer('src', 'payments', 'index.js');
const payService = readServer('src', 'modules', 'subscription-invoice', 'service.js');
const paySchema = readServer('src', 'modules', 'subscription-invoice', 'schema.js');
const payRoutes = readServer('src', 'modules', 'subscription-invoice', 'routes.js');
const payCallback = readServer('src', 'modules', 'subscription-invoice', 'callback-routes.js');
const payMigration = readServer('src', 'db', 'migrations', '0010_subscription_invoices.sql');
const payEnv = readServer('.env.example');
const appJs = readServer('src', 'app.js');
const ownerRoutes = readServer('src', 'modules', 'owner', 'routes.js');

const payChecks = [
  [
    ownerHtml6,
    'apps/owner/index.html',
    [
      'id="sub-pay-btn"',
      'id="sub-invoice-body"',
      'id="pay-modal"',
      'id="pay-channels"',
      'id="pay-number"',
      'id="pay-sync"',
    ],
  ],
  [
    ownerJs6,
    'apps/owner/src/app.js',
    [
      'loadSubscriptionInvoices',
      'api.createSubscriptionInvoice(',
      'api.syncSubscriptionInvoice(',
      'INVOICE_STATUS_TEXT',
      'handlePaymentReturn',
    ],
  ],
  [
    ownerApi6,
    'apps/owner/src/api.js',
    ['/subscription/plans', '/subscription/invoices', '/sync'],
  ],
  [
    payDuitku,
    'server/src/payments/duitku.js',
    [
      "createHmac('sha256'",
      'timingSafeEqual',
      '/v2/inquiry',
      '/transactionStatus',
      'signCallback',
      'verifyCallback',
      'stripSignature',
    ],
  ],
  [
    payRegistry,
    'server/src/payments/index.js',
    ['requireProvider', 'describePayments', 'setProviderForTests', 'allowProduction'],
  ],
  [
    payService,
    'server/src/modules/subscription-invoice/service.js',
    [
      'handleDuitkuCallback',
      'createInvoiceForPlan',
      'syncInvoiceStatus',
      'senToRupiah',
      'applyPaidInvoice',
      'make_interval(days =>',
      'subscription.invoice_paid',
    ],
  ],
  [payRoutes, 'server/src/modules/subscription-invoice/routes.js', ['requireBusinessAccess', 'invoiceSyncLimiter']],
  [
    payCallback,
    'server/src/modules/subscription-invoice/callback-routes.js',
    ["'/duitku/callback'", "'/duitku/return'", 'webhookLimiter', 'handleDuitkuCallback'],
  ],
  [
    payMigration,
    'server/src/db/migrations/0010_subscription_invoices.sql',
    ['subscription_invoices', 'order_id', 'provider_reference', 'callback_payload'],
  ],
  [
    payEnv,
    'server/.env.example',
    ['DUITKU_MERCHANT_CODE', 'PAYMENT_CALLBACK_URL', 'PAYMENT_CHANNELS'],
  ],
  [appJs, 'server/src/app.js', ["app.use('/api/payments'"]],
  [ownerRoutes, 'server/src/modules/owner/routes.js', ['subscription-invoice/routes.js']],
];
let payMissing = 0;
for (const [src, label, needles] of payChecks) {
  for (const needle of needles) {
    if (!src.includes(needle)) {
      fail(`${label} tidak memuat "${needle}" (pembayaran langganan hilang?)`);
      payMissing++;
    }
  }
}

// Negatif 1: nominal tagihan tidak boleh berasal dari klien.
if (/\bamount\b/.test(paySchema)) {
  fail('skema tagihan langganan menerima `amount` dari klien (nominal wajib dari server)');
  payMissing++;
}
if (!/plan\.price/.test(payService)) {
  fail('service tagihan langganan tidak memakai plan.price sebagai nominal');
  payMissing++;
}

// Negatif 2: rahasia gateway tidak boleh ada di panel (frontend).
const panelSrcs = [
  ['apps/owner/index.html', ownerHtml6],
  ['apps/owner/src/app.js', ownerJs6],
  ['apps/owner/src/api.js', ownerApi6],
];
for (const [label, src] of panelSrcs) {
  if (/DUITKU_API_KEY|MERCHANT_CODE|apiKey/.test(src)) {
    fail(`${label} memuat kredensial gateway (rahasia hanya di server)`);
    payMissing++;
  }
}

// Negatif 3: tanda tangan callback wajib dibuang sebelum disimpan.
if (!/stripSignature\(body\)/.test(payService)) {
  fail('service tagihan langganan menyimpan callback tanpa membuang tanda tangan');
  payMissing++;
}

// Negatif 4: endpoint callback publik tetap wajib memverifikasi tanda tangan.
if (/requireAuth/.test(payCallback)) {
  fail('rute callback gateway memakai requireAuth (gateway tidak punya JWT)');
  payMissing++;
}

if (payMissing === 0) {
  console.log('  panel, klien Duitku (HMAC), rute owner, callback publik, migrasi, dan env: lengkap.');
}

// ----------------------- Kode QR QRIS (17 Okt 2026) --------------------------
// Owner menampilkan QRIS dari `qrString` gateway sebagai GAMBAR QR. Encoder
// dipakai dari pustaka yang di-vendor apa adanya (MIT, Kazuhiko Arase) dan
// dibungkus modul bersama `shared/qr-code.js` (SVG data URL, tanpa canvas).
// Kunci regresi:
//   - salinan di panel tidak menyimpang dari sumber kanonik,
//   - berkas vendor utuh + lisensi aslinya tetap ada,
//   - skrip dimuat SEBELUM app.js (kalau tidak, QR tidak akan muncul),
//   - isi QR tidak pernah ditulis ke markup (hanya koordinat modul).
console.log('\n[kode QR QRIS (17 Okt 2026)]');

const qrCanonicalPath = join(root, 'shared', 'qr-code.js');
const qrVendorCanonicalPath = join(root, 'shared', 'vendor', 'qrcode-generator.js');
const qrCopies = [
  ['apps/owner/src/qr-code.js', qrCanonicalPath],
  ['apps/owner/src/vendor/qrcode-generator.js', qrVendorCanonicalPath],
];

let qrMissing = 0;
for (const [rel, canonicalPath] of qrCopies) {
  const abs = join(root, rel);
  if (!existsSync(canonicalPath)) {
    fail(`sumber kanonik tidak ada: ${canonicalPath}`);
    qrMissing++;
  } else if (!existsSync(abs)) {
    fail(`${rel} tidak ada (jalankan: node scripts/sync-shared.mjs)`);
    qrMissing++;
  } else if (readFileSync(abs, 'utf8') !== readFileSync(canonicalPath, 'utf8')) {
    fail(`${rel} menyimpang dari sumber kanonik (jalankan: node scripts/sync-shared.mjs)`);
    qrMissing++;
  } else {
    console.log(`  salinan bersama OK: ${rel}`);
  }
}

const qrModule = readFileSync(qrCanonicalPath, 'utf8');
const qrVendor = readFileSync(qrVendorCanonicalPath, 'utf8');
const syncShared = readFileSync(join(root, 'scripts', 'sync-shared.mjs'), 'utf8');

for (const [label, src, needles] of [
  [
    'shared/qr-code.js',
    qrModule,
    ['toDataUrl', 'toSvg', 'isAvailable', 'QUIET_ZONE_MODULES', 'data:image/svg+xml'],
  ],
  [
    'scripts/sync-shared.mjs',
    syncShared,
    ["'shared/qr-code.js'", 'qrcode-generator.js'],
  ],
  [
    'apps/owner/index.html',
    ownerHtml6,
    [
      'src="./src/vendor/qrcode-generator.js"',
      'src="./src/qr-code.js"',
      'id="pay-qr-img"',
      'id="pay-qr-wrap"',
    ],
  ],
  ['apps/owner/src/app.js', ownerJs6, ['window.NovaQr', 'showQrImage', '.toDataUrl(']],
  ['apps/owner/styles/styles.css', readApp('owner', 'styles', 'styles.css'), ['.pay-qr-img']],
]) {
  for (const needle of needles) {
    if (!src.includes(needle)) {
      fail(`${label} tidak memuat "${needle}" (kode QR QRIS hilang?)`);
      qrMissing++;
    }
  }
}

// Lisensi pustaka vendor wajib utuh (MIT, Kazuhiko Arase 2009).
for (const [label, needle] of [
  ['header hak cipta', 'Copyright (c) 2009 Kazuhiko Arase'],
  ['lisensi MIT', 'Licensed under the MIT license'],
]) {
  if (!qrVendor.includes(needle)) {
    fail(`shared/vendor/qrcode-generator.js: ${label} hilang dari berkas vendor`);
    qrMissing++;
  }
}

// Urutan <script>: modul QR harus dimuat sebelum app.js.
const atQr = ownerHtml6.indexOf('src="./src/qr-code.js"');
const atVendor = ownerHtml6.indexOf('src="./src/vendor/qrcode-generator.js"');
const atAppJs = ownerHtml6.indexOf('src="./src/app.js"');
if (atVendor < 0 || atQr < 0 || atAppJs < 0 || atVendor > atQr || atQr > atAppJs) {
  fail('apps/owner/index.html: vendor/qrcode-generator.js lalu qr-code.js harus dimuat sebelum app.js');
  qrMissing++;
}

// Negatif 1: SVG hanya berisi koordinat modul — tidak ada elemen teks/markup
// yang bisa memuat isi QR (anti-injeksi dari data gateway).
if (/<text|<foreignObject|textContent/.test(qrModule)) {
  fail('shared/qr-code.js memuat elemen teks/markup di SVG (isi QR bisa bocor ke markup)');
  qrMissing++;
}
if (!/image-rendering/.test(readApp('owner', 'styles', 'styles.css'))) {
  fail('apps/owner/styles/styles.css: .pay-qr-img tanpa image-rendering (modul bisa buram)');
  qrMissing++;
}

// Negatif 2: `qrString` tidak boleh dipasang mentah sebagai sumber gambar
// (string QRIS bukan berkas gambar — harus lewat encoder).
if (/\.src\s*=\s*[^;\n]*qr_string/i.test(ownerJs6)) {
  fail('apps/owner/src/app.js memasang qr_string mentah ke src gambar (harus lewat NovaQr.toDataUrl)');
  qrMissing++;
}

if (qrMissing === 0) {
  console.log('  vendor MIT utuh, modul bersama identik, dimuat sebelum app.js, isi QR tidak masuk markup: lengkap.');
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
    ['/kasir/src/product-image.js', 'js'],
    ['/owner/', 'html'],
    ['/owner/assets/favicon-32.png', 'png'],
    ['/owner/src/app.js', 'js'],
    ['/owner/src/product-image.js', 'js'],
    ['/owner/src/qr-code.js', 'js'],
    ['/owner/src/vendor/qrcode-generator.js', 'js'],
    ['/admin/', 'html'],
    ['/admin/assets/favicon-32.png', 'png'],
    ['/admin/src/app.js', 'js'],
    ['/', 'html'],
    ['/404.html', 'html'],
    ['/assets/logo-kasir-nova.png', 'png'],
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

  // --- Kunci regresi 17 Okt 2026: base API bundel Hosting WAJIB absolut.
  // Firebase Hosting tidak melayani /api/** (tanpa paket Blaze), jadi base
  // kosong membuat semua panel web menembak /api/** -> 404 "Page Not Found".
  for (const app of ['admin', 'owner', 'kasir']) {
    const res = await fetch(`${base}/${app}/config.js`);
    const txt = await res.text();
    const found = /window\.NOVA_API_BASE\s*=\s*'([^']*)'/.exec(txt);
    const value = found ? found[1] : '';
    const ok = res.status === 200 && /^https?:\/\/[^\s]+$/i.test(value);
    if (!ok) failures++;
    console.log(
      `  ${ok ? 'OK  ' : 'GAGAL'} ${res.status} /${app}/config.js NOVA_API_BASE='${value || '(kosong/tiada)'}' (wajib URL absolut untuk Hosting)`
    );
  }

  // --- Beranda root + halaman 404 harus menautkan ketiga panel.
  for (const path of ['/', '/404.html']) {
    const res = await fetch(base + path);
    const html = await res.text();
    const missing = ['/kasir/', '/owner/', '/admin/'].filter((href) => !html.includes(href));
    const ok = res.status === 200 && missing.length === 0;
    if (!ok) failures++;
    console.log(
      `  ${ok ? 'OK  ' : 'GAGAL'} ${res.status} ${path} menautkan ketiga panel${
        ok ? '' : ` (kurang: ${missing.join(', ') || 'status bukan 200'})`
      }`
    );
  }
  server.close();
}

console.log(`\n${failures === 0 ? 'SEMUA OK' : `ADA ${failures} KEGAGALAN`}`);
process.exit(failures === 0 ? 0 : 1);
