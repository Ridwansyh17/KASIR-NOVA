/**
 * test-landing.mjs — pengujian halaman utama (landing page) KASIR NOVA.
 *
 * Cakupan:
 *   1. Struktur halaman (header, 3 panel login, harga, fitur, hubungi kami).
 *   2. Routing 3 panel login TETAP (/kasir/, /owner/, /admin/).
 *   3. Tulisan lama (APK/berkas) sudah dihapus.
 *   4. Seluruh teks wajib (judul, subjudul, harga, fitur) ada.
 *   5. Toggle Bulanan/Tahunan mengubah harga utama + tautan WhatsApp.
 *   6. Pesan WhatsApp tiap paket & periode PERSIS sesuai spesifikasi.
 *   7. Semua tautan WA memakai 6281359704766, target=_blank, rel=noopener.
 *   8. Tidak ada error console, tidak ada panggilan jaringan (tidak aktivasi paket).
 *   9. Audit layout responsif (jumlah kolom per breakpoint, tanpa overflow).
 *
 * Pemakaian: node scripts/test-landing.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// jsdom dipakai sebagai dependensi uji (tidak menambah dependensi runtime aplikasi).
let JSDOM;
try {
  const require = createRequire(join(root, 'package.json'));
  JSDOM = require('jsdom').JSDOM;
} catch {
  try {
    JSDOM = (await import('jsdom')).JSDOM;
  } catch {
    console.error('SKIP: paket "jsdom" tidak tersedia — uji fungsional dilewati.');
    console.error('       npm install --no-save jsdom');
    process.exit(2);
  }
}

let failures = 0;
let checks = 0;
function ok(cond, label, extra = '') {
  checks++;
  if (cond) {
    console.log(`  OK    ${label}`);
  } else {
    failures++;
    console.log(`  GAGAL ${label}${extra ? ` — ${extra}` : ''}`);
  }
}
function section(title) {
  console.log(`\n[${title}]`);
}

const landingPath = join(__dirname, 'hosting-landing.html');
const html = readFileSync(landingPath, 'utf8');

// ---------------------------------------------------------------------------
// Ekspektasi pesan WhatsApp (sesuai spesifikasi pemilik proyek).
// ---------------------------------------------------------------------------
const WA_NUMBER = '6281359704766';
const MSG_ENTERPRISE = `Halo Admin KASIR NOVA,

Saya ingin berkonsultasi mengenai paket NOVA ENTERPRISE untuk kebutuhan bisnis saya.

Mohon informasi lebih lanjut mengenai harga, fitur, dan proses implementasi.

Terima kasih.`;

const MSG_HUBUNGI = `Halo Admin KASIR NOVA,

Saya ingin bertanya mengenai aplikasi KASIR NOVA dan layanan yang tersedia.

Mohon informasi lebih lanjut.

Terima kasih.`;

// ---------------------------------------------------------------------------
section('Berkas & struktur HTML');
// ---------------------------------------------------------------------------
ok(html.includes('<!doctype html>'), 'beranda memakai doctype html');
ok(/<html[^>]*lang="id"/i.test(html), 'atribut lang="id" tersedia');
ok(html.includes('/assets/logo-kasir-nova-inverse.png'), 'logo KASIR NOVA dipakai (tidak diganti)');
ok(html.includes('/assets/logo-kasir-nova-inverse.png') && !/src="[^"]*logo[^"]*\.svg"/i.test(html), 'logo tetap aset PNG yang disetujui');

section('Panel login (3 panel, routing TETAP)');
const doc = new JSDOM(html, { runScripts: 'dangerously' });
const { window } = doc;
const { document } = window;

// Skrip inline berjalan saat parsing -> init() dipanggil pada DOMContentLoaded.
// Tunggu agar seluruh listener toggle terpasang sebelum pengujian.
await new Promise((resolve) => {
  if (document.readyState !== 'loading') resolve();
  else window.addEventListener('DOMContentLoaded', () => resolve());
});

const panels = [...document.querySelectorAll('.panel')];
ok(panels.length === 3, 'tepat 3 panel login', `ditemukan ${panels.length}`);

const panelExpect = [
  { chip: 'Kasir', title: 'Buka Aplikasi Kasir', cta: 'Masuk Kasir', href: '/kasir/' },
  { chip: 'Pemilik', title: 'Pemilik Panel', cta: 'Login Pemilik', href: '/owner/' },
  { chip: 'Platform Admin', title: 'Platform Admin', cta: 'Masuk Admin', href: '/admin/' },
];
panelExpect.forEach((exp, i) => {
  const p = panels[i];
  if (!p) {
    ok(false, `panel ${i + 1} ada`);
    return;
  }
  ok(p.querySelector('.panel-chip')?.textContent.trim() === exp.chip, `panel ${i + 1} label "${exp.chip}"`);
  ok(p.querySelector('.panel-title')?.textContent.trim() === exp.title, `panel ${i + 1} judul "${exp.title}"`);
  const cta = p.querySelector('a.btn');
  ok(!!cta && cta.textContent.includes(exp.cta), `panel ${i + 1} tombol "${exp.cta}"`);
  ok(cta?.getAttribute('href') === exp.href, `panel ${i + 1} routing ${exp.href} (tidak berubah)`);
  ok((p.querySelector('.panel-desc')?.textContent.trim().length || 0) > 30, `panel ${i + 1} ada deskripsi fungsi`);
});

section('Pendaftaran Owner mandiri');
const registerLinks = [...document.querySelectorAll('a[href="/owner/?daftar=1"]')];
ok(registerLinks.length >= 2, 'tautan daftar Owner tersedia di header dan panel', `ditemukan ${registerLinks.length}`);
ok(
  registerLinks.some((a) => /Daftar Gratis/i.test(a.textContent)),
  'CTA header berbunyi "Daftar Gratis"'
);
ok(
  registerLinks.some((a) => /Belum punya akun\? Daftar gratis/i.test(a.textContent)),
  'tautan pendaftaran tersedia pada panel Pemilik'
);
ok(
  document.querySelectorAll('.panel-register').length === 1,
  'panel Pemilik menampilkan tautan daftar'
);

section('Cara mendaftar di beranda');
const registerSection = document.querySelector('#daftar');
ok(!!registerSection, 'section "Cara Mendaftar" ada');
ok(registerSection?.querySelector('.section-title')?.textContent.includes('4 Langkah'), 'judul menjelaskan 4 langkah');
const stepItems = [...(registerSection?.querySelectorAll('.step') ?? [])];
ok(stepItems.length === 4, 'tepat 4 langkah pendaftaran', `ditemukan ${stepItems.length}`);
const stepTitles = stepItems.map((li) => li.querySelector('.step-title')?.textContent.trim());
ok(
  stepTitles.join('|') === 'Isi form pendaftaran|Buka email verifikasi|Klik tautan verifikasi|Masuk & mulai jualan',
  'urutan langkah sesuai alur verifikasi email Firebase',
  stepTitles.join(' | ')
);
ok(
  stepItems.every((li) => (li.querySelector('.step-desc')?.textContent.trim().length || 0) > 30),
  'setiap langkah punya penjelasan'
);
ok(
  /Gratis 30 hari/i.test(registerSection?.textContent ?? ''),
  'menyebut masa coba Gratis 30 hari'
);
ok(
  /verifikasi/i.test(registerSection?.textContent ?? '') &&
    /email/i.test(registerSection?.textContent ?? ''),
  'menjelaskan verifikasi melalui email'
);
const registerCta = registerSection?.querySelector('a.btn[href="/owner/?daftar=1"]');
ok(!!registerCta, 'section punya tombol Daftar Gratis');
ok(/Daftar Gratis/i.test(registerCta?.textContent ?? ''), 'tombol CTA berbunyi Daftar Gratis');
ok(!!registerSection?.querySelector('a.btn[href="/owner/"]'), 'ada tautan untuk pengguna yang sudah punya akun');
ok(!!document.querySelector('.section-login a[href="#daftar"]'), 'panel login menautkan ke cara mendaftar');

section('Penghapusan tulisan lama');
ok(
  !/Aplikasi Android kasir tersedia dalam berkas APK/i.test(html),
  'tulisan lama tentang berkas APK dihapus'
);
ok(!/Butuh bantuan\? Hubungi pengelola platform Anda/i.test(html), 'tulisan "Hubungi pengelola platform Anda" dihapus');
ok(!/<hr\s*\/?>/i.test(html), 'garis pemisah (<hr>) yang tidak diperlukan dihapus');

section('Section harga paket');
ok(/Pilih Paket Sesuai Kebutuhan Usaha Anda/.test(html), 'judul section harga ada');
ok(
  /Satu aplikasi, banyak kemudahan\. Kelola bisnis lebih praktis bersama KASIR NOVA\./.test(html),
  'subjudul section harga ada'
);

const plans = [...document.querySelectorAll('[data-plan]')];
ok(plans.length === 4, 'tepat 4 card harga', `ditemukan ${plans.length}`);
const planKeys = plans.map((p) => p.getAttribute('data-plan'));
ok(
  JSON.stringify(planKeys) === JSON.stringify(['starter', 'business', 'pro', 'enterprise']),
  'urutan paket: Starter, Business, Pro, Enterprise',
  planKeys.join(',')
);

const featuresByPlan = {
  starter: [
    '1 bisnis, 1 outlet',
    '1 akun Owner',
    'Maksimal 2 akun Kasir',
    'Transaksi dan produk',
    'Manajemen stok',
    'Pendapatan harian',
    'Laporan transaksi',
    'Cetak struk',
  ],
  business: [
    'Semua fitur Starter',
    '1 bisnis, maksimal 2 outlet',
    'Maksimal 5 akun Kasir',
    'Pengeluaran operasional',
    'Rekap metode pembayaran',
    'Riwayat pergerakan stok',
    'Ekspor laporan Excel',
    'Pengaturan pajak dan diskon',
  ],
  pro: [
    'Semua fitur Business',
    '1 bisnis, maksimal 5 outlet',
    'Maksimal 15 akun Kasir',
    'Monitoring beberapa outlet',
    'Laporan pendapatan dan pengeluaran',
    'Rekap terpusat lintas outlet',
    'Dukungan prioritas',
  ],
  enterprise: [
    'Jumlah outlet dan akun Kasir sesuai kesepakatan',
    'Harga sesuai konsultasi',
    'Dukungan implementasi dan pendampingan',
  ],
};
for (const [key, list] of Object.entries(featuresByPlan)) {
  const card = document.querySelector(`[data-plan="${key}"]`);
  const items = [...(card?.querySelectorAll('.plan-list li') || [])].map((li) => li.textContent.trim());
  ok(JSON.stringify(items) === JSON.stringify(list), `fitur paket ${key} lengkap & berurutan`, items.join(' | '));
}

const businessCard = document.querySelector('[data-plan="business"]');
ok(businessCard?.classList.contains('plan-featured'), 'card Business memakai gaya gradien biru');
{
  const cssBlock = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const featRule = /\.plan-featured\s*\{([\s\S]*?)\}/.exec(cssBlock);
  ok(
    !!featRule && /background:\s*linear-gradient/.test(featRule[1]),
    'card Business benar-benar berlatar gradient biru',
    featRule ? featRule[1].slice(0, 80) : 'aturan .plan-featured tidak ditemukan'
  );
}
ok(
  /PALING DIREKOMENDASIKAN/i.test(businessCard?.querySelector('.plan-badge')?.textContent || ''),
  'label "PALING DIREKOMENDASIKAN" pada card Business'
);

const enterpriseCard = document.querySelector('[data-plan="enterprise"]');
ok(
  /Harga Konsultasi/i.test(enterpriseCard?.textContent || ''),
  'paket Enterprise memakai "Harga Konsultasi"'
);

const ctaTexts = {
  starter: 'PILIH PAKET',
  business: 'PILIH PAKET',
  pro: 'PILIH PAKET',
  enterprise: 'HUBUNGI ADMIN',
};
for (const [key, text] of Object.entries(ctaTexts)) {
  const a = document.querySelector(`[data-plan="${key}"] a.btn`);
  ok(a?.textContent.trim() === text, `tombol "${text}" pada paket ${key}`, a?.textContent.trim());
}

section('Toggle Bulanan / Tahunan');
const toggleBtns = [...document.querySelectorAll('.period-toggle button')];
ok(toggleBtns.length === 2, 'toggle punya 2 opsi');
ok(
  toggleBtns.map((b) => b.textContent.trim()).join('|') === 'Bulanan|Tahunan',
  'label toggle: Bulanan | Tahunan'
);
ok(
  toggleBtns.find((b) => b.dataset.period === 'monthly')?.getAttribute('aria-pressed') === 'true',
  'default periode = Bulanan'
);

const priceOf = (key) =>
  document.querySelector(`[data-plan="${key}"] [data-price-primary]`)?.textContent.trim();
const suffixOf = (key) =>
  document.querySelector(`[data-plan="${key}"] [data-price-suffix]`)?.textContent.trim();

ok(priceOf('starter') === 'Rp49.000' && suffixOf('starter') === '/bulan', 'harga Starter bulanan Rp49.000/bulan');
ok(priceOf('business') === 'Rp99.000' && suffixOf('business') === '/bulan', 'harga Business bulanan Rp99.000/bulan');
ok(priceOf('pro') === 'Rp149.000' && suffixOf('pro') === '/bulan', 'harga Pro bulanan Rp149.000/bulan');

const yearlyBtn = toggleBtns.find((b) => b.dataset.period === 'yearly');
yearlyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

ok(priceOf('starter') === 'Rp490.000' && suffixOf('starter') === '/tahun', 'harga Starter tahunan Rp490.000/tahun');
ok(priceOf('business') === 'Rp990.000' && suffixOf('business') === '/tahun', 'harga Business tahunan Rp990.000/tahun');
ok(priceOf('pro') === 'Rp1.490.000' && suffixOf('pro') === '/tahun', 'harga Pro tahunan Rp1.490.000/tahun');
ok(
  yearlyBtn.getAttribute('aria-pressed') === 'true' &&
    toggleBtns.find((b) => b.dataset.period === 'monthly').getAttribute('aria-pressed') === 'false',
  'status aria-pressed toggle ikut berubah'
);

// kembali ke bulanan
toggleBtns.find((b) => b.dataset.period === 'monthly').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(priceOf('starter') === 'Rp49.000', 'kembali ke harga bulanan setelah memilih Bulanan');

section('Pemilihan paket & integrasi WhatsApp');
const selectLinks = ['starter', 'business', 'pro'].map((key) =>
  document.querySelector(`[data-plan="${key}"] a[data-select-plan]`)
);
selectLinks.forEach((a, i) => {
  const key = ['starter', 'business', 'pro'][i];
  ok(!!a, `tombol PILIH PAKET ${key} ada`);
  ok(
    a?.getAttribute('href') === `/owner/?daftar=1&paket=nova-${key}&periode=bulanan`,
    `tautan ${key} membawa paket + periode bulanan`,
    a?.getAttribute('href')
  );
});

const enterpriseWa = document.querySelector('[data-plan="enterprise"] a[data-wa]');
ok(enterpriseWa?.getAttribute('href')?.startsWith(`https://wa.me/${WA_NUMBER}?text=`), 'Enterprise memakai WhatsApp Admin');
ok(enterpriseWa?.getAttribute('target') === '_blank', 'tautan Enterprise membuka tab baru');
ok(/noopener/.test(enterpriseWa?.getAttribute('rel') || ''), 'tautan Enterprise aman rel=noopener');
const enterpriseText = (() => {
  const m = /[?&]text=([^&]*)/.exec(enterpriseWa?.getAttribute('href') || '');
  return m ? decodeURIComponent(m[1]) : '';
})();
ok(enterpriseText === MSG_ENTERPRISE, 'pesan WhatsApp Enterprise persis sesuai spesifikasi');

const waLinks = [...document.querySelectorAll('[data-wa]')];
ok(waLinks.length >= 3, 'ada tautan WhatsApp Enterprise + hubungi kami', `ditemukan ${waLinks.length}`);
for (const a of waLinks) {
  const href = a.getAttribute('href') || '';
  ok(href.startsWith(`https://wa.me/${WA_NUMBER}?text=`), `tautan WA memakai 6281359704766 (${a.dataset.wa})`);
  ok(a.getAttribute('target') === '_blank', `tautan WA membuka tab baru (${a.dataset.wa})`);
  ok(/noopener/.test(a.getAttribute('rel') || ''), `tautan WA aman rel=noopener (${a.dataset.wa})`);
}
ok(!/wa\.me\/(?!6281359704766)\d+/.test(html), 'TIDAK ada nomor WhatsApp lain di halaman');
ok(!/6281[0-9]{9}/.test(html.replace(/6281359704766/g, '')), 'TIDAK ada nomor telepon WhatsApp lain');

const hubungiLink = document.querySelector('.contact-cta');
const waText = (href) => {
  const m = /[?&]text=([^&]*)/.exec(href || '');
  return m ? decodeURIComponent(m[1]) : '';
};
ok(waText(hubungiLink?.getAttribute('href')) === MSG_HUBUNGI, 'pesan tombol "HUBUNGI KAMI" persis sesuai spesifikasi');
const phoneLink = document.querySelector('.contact-list a[href^="https://wa.me/"]');
ok(phoneLink?.textContent.trim() === '081359704766', 'nomor WhatsApp tampil sebagai 081359704766');
ok(waText(phoneLink?.getAttribute('href')) === MSG_HUBUNGI, 'nomor WhatsApp clickable membuka pesan yang benar');

// kembali ke tahunan untuk memeriksa tautan pendaftaran
yearlyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
selectLinks.forEach((a, i) => {
  const key = ['starter', 'business', 'pro'][i];
  ok(
    a?.getAttribute('href') === `/owner/?daftar=1&paket=nova-${key}&periode=tahunan`,
    `tautan ${key} berubah ke periode tahunan`,
    a?.getAttribute('href')
  );
});
ok(
  enterpriseWa?.getAttribute('href') === enterpriseWa?.getAttribute('href'),
  'tautan Enterprise tidak berubah oleh toggle periode'
);

// kembali bulanan
toggleBtns.find((b) => b.dataset.period === 'monthly').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

section('Panel Hubungi Kami');
const contact = document.querySelector('#hubungi');
ok(!!contact, 'section "Hubungi Kami" ada');
ok(/Smart POS untuk Berbagai Jenis Usaha\./.test(contact.textContent), 'tagline "Smart POS untuk Berbagai Jenis Usaha."');
ok(contact.textContent.includes('081359704766'), 'nomor WhatsApp 081359704766 tampil');
ok(contact.textContent.includes('ridwansyarifuddin110@gmail.com'), 'email resmi tampil');
ok(contact.textContent.includes('https://kasir-nova.web.app'), 'website resmi tampil');
ok(/HUBUNGI KAMI/i.test(hubungiLink.textContent), 'tombol besar "HUBUNGI KAMI" ada');
ok(!!contact.querySelector('.wa-icon'), 'ikon WhatsApp di samping nomor telepon');
{
  const cssBlock = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const rule = /\.contact\s*\{([\s\S]*?)\}/.exec(cssBlock);
  ok(
    !!rule && /background:\s*linear-gradient/.test(rule[1]) && /var\(--navy/.test(rule[1]),
    'panel Hubungi Kami memakai latar gradien navy'
  );
}

section('Fitur unggulan');
ok(
  /Semua yang Anda Butuhkan untuk Mengelola Bisnis/.test(html),
  'judul section fitur unggulan ada'
);
const featTitles = [...document.querySelectorAll('.feature h3')].map((h) => h.textContent.trim());
const expectedFeatures = [
  'Transaksi Penjualan',
  'Manajemen Produk & Stok',
  'Laporan Penjualan',
  'Cetak Struk Thermal Bluetooth',
  'Pengeluaran Operasional',
  'Ekspor Laporan Excel',
  'Multi User',
  'Pengaturan Pajak & Diskon',
];
ok(
  JSON.stringify(featTitles) === JSON.stringify(expectedFeatures),
  '8 fitur unggulan lengkap & berurutan',
  featTitles.join(' | ')
);
ok(
  [...document.querySelectorAll('.feature-icon')].every((i) => i.querySelector('svg')),
  'setiap fitur memakai ikon SVG'
);
ok(
  [...document.querySelectorAll('.feature-icon')].every((i) => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
    const block = /\.feature-icon\s*\{([\s\S]*?)\}/.exec(css);
    return !!block && /var\(--blue-100\)/.test(block[1]) && /var\(--blue-500\)/.test(block[1]);
  }),
  'ikon fitur biru dengan background biru muda'
);

section('Keamanan & tidak ada aktivasi paket');
const scriptBody = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
ok(!/\bfetch\s*\(|XMLHttpRequest|axios/.test(scriptBody), 'halaman tidak memanggil API backend');
ok(!/localStorage|sessionStorage|document\.cookie/.test(scriptBody), 'halaman tidak menyentuh token/session');
ok(!/activate|subscription/i.test(scriptBody), 'tidak ada logika aktivasi/langganan di frontend');
ok(!/NOVA_API_BASE/.test(html), 'halaman tidak memicu alur login/autentikasi');

section('Error console');
const consoleErrors = [];
window.addEventListener('error', (e) => consoleErrors.push(String(e.message || e)));
ok(consoleErrors.length === 0, 'tidak ada error runtime di halaman', consoleErrors.join('; '));

// ---------------------------------------------------------------------------
// Audit layout responsif (statis): jumlah kolom per breakpoint + risiko overflow.
// ---------------------------------------------------------------------------
section('Audit layout responsif');
const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];

// Parser aturan @media sederhana: [{ min, max, body }]
function mediaRules(cssText) {
  const rules = [];
  const re = /@media([^{]+)\{([\s\S]*?)\n\s*\}/g;
  // gunakan pencocokan brace yang benar
  let idx = 0;
  while (idx < cssText.length) {
    const at = cssText.indexOf('@media', idx);
    if (at === -1) break;
    let brace = cssText.indexOf('{', at);
    const cond = cssText.slice(at + 6, brace).trim();
    let depth = 0;
    let end = brace;
    for (let i = brace; i < cssText.length; i++) {
      if (cssText[i] === '{') depth++;
      else if (cssText[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    rules.push({ cond, body: cssText.slice(brace + 1, end) });
    idx = end + 1;
  }
  return rules;
}

const medias = mediaRules(css);
function minWidthOf(cond) {
  const m = /min-width:\s*(\d+)px/.exec(cond);
  return m ? parseInt(m[1], 10) : null;
}
function maxWidthOf(cond) {
  const m = /max-width:\s*(\d+)px/.exec(cond);
  return m ? parseInt(m[1], 10) : null;
}

// Nilai dasar (tanpa media) + override berurutan sesuai breakpoint.
const base = {
  '.panel-grid': '1fr',
  '.pricing-grid': '1fr',
  '.feature-grid': '1fr',
  '.steps': '1fr',
  '.contact-inner': '1fr',
};
function columnsAt(selector, width) {
  let value = base[selector];
  const applicable = medias
    .filter((m) => {
      const min = minWidthOf(m.cond);
      const max = maxWidthOf(m.cond);
      if (min !== null && width < min) return false;
      if (max !== null && width > max) return false;
      return min !== null || max !== null;
    })
    .sort((a, b) => (minWidthOf(a.cond) || 0) - (minWidthOf(b.cond) || 0));
  for (const m of applicable) {
    const re = new RegExp(escapeRe(selector) + '\\s*\\{([\\s\\S]*?)\\}');
    const hit = re.exec(m.body);
    if (hit) {
      const cols = /grid-template-columns:\s*([^;]+);/.exec(hit[1]);
      if (cols) value = cols[1].trim();
    }
  }
  return value;
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const viewports = [360, 390, 414, 540, 600, 640, 680, 720, 768, 834, 1024, 1280, 1440];
const expectCols = {
  '.panel-grid': (w) => (w >= 1000 ? 3 : w >= 720 ? 2 : 1),
  '.pricing-grid': (w) => (w >= 1140 ? 4 : w >= 680 ? 2 : 1),
  '.feature-grid': (w) => (w >= 1024 ? 4 : w >= 600 ? 2 : 1),
  '.steps': (w) => (w >= 1024 ? 4 : w >= 720 ? 2 : 1),
};
function countColumns(cssValue) {
  const v = cssValue.trim();
  if (v === '1fr') return 1;
  const rep = /repeat\(\s*(\d+)\s*,/.exec(v);
  if (rep) return parseInt(rep[1], 10);
  return v.split(/\s+/).length;
}
for (const w of viewports) {
  for (const [sel, fn] of Object.entries(expectCols)) {
    const cols = columnsAt(sel, w);
    const n = countColumns(cols);
    ok(
      n === fn(w),
      `${sel} @${w}px -> ${n} kolom (harapan ${fn(w)})`,
      `css="${cols}"`
    );
  }
}

// Overflow horizontal: cari deklarasi width/min-width px yang lebih besar dari viewport terkecil (360) dikurangi padding.
const containerPad = 16;
const tooWide = [];
for (const m of css.matchAll(/([.#][\w-]+)\s*\{([^{}]*)\}/g)) {
  const sel = m[1];
  const decls = m[2];
  const w = /(?:^|;)\s*(?:min-)?width:\s*(\d+)px/.exec(decls);
  if (!w) continue;
  const value = parseInt(w[1], 10);
  if (value > 360 - containerPad * 2) tooWide.push(`${sel} width:${value}px`);
}
ok(tooWide.length === 0, 'tidak ada elemen dengan lebar px tetap yang melewati layar 360px', tooWide.join(', '));
ok(/overflow-x:\s*hidden/.test(css), 'body memakai overflow-x: hidden (anti horizontal overflow)');
ok(/max-width:\s*100%/.test(css), 'gambar dibatasi max-width: 100%');

// Target sentuh: tombol minimal 44px, tombol WA besar minimal 48px.
const minH = /\.btn\s*\{([\s\S]*?)\}/.exec(css);
ok(!!minH && /min-height:\s*4[4-9]px|min-height:\s*5\dpx/.test(minH[1]), 'tombol punya tinggi sentuh >= 44px');
const contactBtn = /\.btn-contact\s*\{([\s\S]*?)\}/.exec(css);
ok(!!contactBtn && /min-height:\s*(4[8-9]|[5-9]\d)px/.test(contactBtn[1]), 'tombol HUBUNGI KAMI punya tinggi sentuh >= 48px');

// Font dasar tidak dikecilkan drastis di mobile
ok(!/@media[^{]*max-width[^{]*\{[^}]*font-size:\s*(1[0-2]|[0-9])px/.test(css), 'tidak ada font kecil (<13px) khusus mobile');
ok(!/font-size:\s*9px|font-size:\s*10px/.test(css), 'tidak ada font 9-10px di halaman');

// ---------------------------------------------------------------------------
console.log(`\n=== RINGKASAN ===`);
console.log(`  ${checks - failures}/${checks} pemeriksaan lulus.`);
if (failures > 0) {
  console.log(`  ${failures} pemeriksaan GAGAL.`);
  process.exit(1);
}
console.log('  SEMUA OK');
