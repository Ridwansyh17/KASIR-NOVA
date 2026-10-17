/**
 * Pemeriksa TATA LETAK cetak "Laporan Transaksi" (Owner) — 17 Okt 2026.
 *
 * ## Kenapa ada skrip ini?
 *
 * Penomoran halaman dilakukan **manual** (lihat `apps/owner/src/report-print.js`),
 * jadi jumlah halaman cetak tidak lagi ditentukan oleh peramban. Skrip ini
 * membuktikan pada **Chrome asli** bahwa:
 *   1. setiap halaman yang direncanakan benar-benar **muat satu halaman A4**
 *      (tidak meluber, tidak menghasilkan halaman kosong), dan
 *   2. jumlah halaman PDF **sama** dengan jumlah halaman yang direncanakan
 *      (prasyarat nomor "Halaman i dari N").
 *
 * Pemakaian (dari root repo):
 *   node scripts/print-report-check.mjs                  # rangkaian pemeriksaan
 *   node scripts/print-report-check.mjs --rows=250       # satu jumlah baris
 *   node scripts/print-report-check.mjs --sweep          # cari kapasitas maksimum
 *
 * Prasyarat: Chrome terpasang (atur lewat env `NOVA_CHROME` bila bukan lokasi
 * bawaan). Skrip menulis berkas sementara HANYA di folder TEMP (%TEMP%), jadi
 * isi repo tidak berubah.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CSS_PATH = join(ROOT, 'apps', 'owner', 'styles', 'styles.css');
const LOGO_PATH = join(ROOT, 'apps', 'owner', 'assets', 'logo-kasir-nova.png');
const MODULE_PATH = join(ROOT, 'apps', 'owner', 'src', 'report-print.js');

const CHROME =
  process.env.NOVA_CHROME ||
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => {
    try {
      readFileSync(p);
      return true;
    } catch {
      return false;
    }
  });

if (!CHROME) {
  console.error('Chrome tidak ditemukan. Set env NOVA_CHROME ke path chrome.exe.');
  process.exit(2);
}

// --- modul panel dimuat lewat data: URL (pola sama dengan server/tests) -------
const source = readFileSync(MODULE_PATH, 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { renderPrintReport, PRINT_LAYOUT, PRINT_STATUS_LABELS, planPrintPages } = mod;

const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/[()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// --- format angka tiruan yang MIRIP panel Owner (hanya untuk tata letak) -----
const fmt = {
  escape: (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
  idr: (sen) => 'Rp ' + Math.round(Number(sen ?? 0) / 100).toLocaleString('id-ID'),
  periode: (from, to) => `1 \u2013 17 Oktober 2026 (${from} s.d. ${to})`,
  cetak: () => '17 Oktober 2026 17:05',
  tanggalJam: (date, time) => `${String(date).slice(8, 10)}/${String(date).slice(5, 7)}/${String(date).slice(0, 4)} ${String(time).slice(0, 5)}`,
  metode: (list) => (list ?? []).map((m) => ({ cash: 'Tunai', qr: 'QRIS' }[m] ?? m)).join(', ') || '\u2014',
  status: (key) => PRINT_STATUS_LABELS[key] ?? key,
};

// Nama produk sengaja beragam panjang (termasuk yang panjang) agar uji tata
// letak tidak hanya memakai kasus paling mudah.
const NAMES = [
  'Kopi Susu Gula Aren',
  'Es Teh Manis',
  'Nasi Goreng Spesial',
  'Roti Bakar Cokelat Keju',
  'Americano Dingin',
  'Mie Ayam Pangsit Spesial Komplit',
  'Air Mineral',
  'Pisang Goreng Keju Susu',
  'Kopi Tubruk',
  'Cappuccino Large',
];

const makeData = (count) => ({
  business: { id: 'b1', name: 'Kopi Rakyat', business_type: 'cafe', currency: 'IDR', timezone: 'Asia/Jakarta' },
  outlet: { id: 'o1', name: 'Outlet Utama Cikarang' },
  cashier: null,
  period: { from: '2026-10-01', to: '2026-10-17' },
  printed_at: '2026-10-17T10:05:00.000Z',
  summary: {
    status: 'completed',
    transactions: Math.ceil(count / 2),
    total: count * 1_500_000,
    avg_total: 3_000_000,
    voided_transactions: count ? 1 : 0,
    voided_total: count ? 50_000 : 0,
    refunded_transactions: 0,
    refunded_total: 0,
  },
  payment_methods: [
    { method: 'cash', label: 'Tunai', total: count * 900_000, transactions: Math.ceil(count / 3), percent: 60 },
    { method: 'qr', label: 'QRIS', total: count * 600_000, transactions: Math.floor(count / 4), percent: 40 },
  ],
  top_products: NAMES.slice(0, 5).map((name, i) => ({ product_name: name, qty: 12 - i, revenue: (12 - i) * 1_500_000 })),
  rows: Array.from({ length: count }, (_, i) => ({
    invoice_no: `INV-20261017-${String(i + 1).padStart(4, '0')}`,
    date: '2026-10-17',
    time: '09:15',
    product_name: NAMES[i % NAMES.length],
    sku: `SKU-${i + 1}`,
    qty: 1 + (i % 3),
    unit_price: 1_500_000,
    discount_amount: 0,
    line_total: 3_000_000,
    outlet_name: 'Outlet Utama Cikarang',
    cashier_name: 'Rina Wati',
    methods: ['cash'],
  })),
  truncated: false,
});

const page = (html) => `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<title>Cek cetak laporan</title>
<link rel="stylesheet" href="${fileUrl(CSS_PATH)}" />
</head><body>
<div id="print-report">${html.replace(/\.\/assets\/logo-kasir-nova\.png/g, fileUrl(LOGO_PATH))}</div>
</body></html>`;

/** Cetak HTML -> PDF dengan Chrome headless; kembalikan path PDF. */
const printPdf = (dir, html, name) => {
  const htmlPath = join(dir, `${name}.html`);
  const pdfPath = join(dir, `${name}.pdf`);
  writeFileSync(htmlPath, page(html), 'utf8');
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-sandbox',
      '--allow-file-access-from-files',
      '--virtual-time-budget=4000',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      fileUrl(htmlPath),
    ],
    { stdio: 'ignore' }
  );
  return pdfPath;
};

/** Hitung halaman PDF (objek `/Type /Page`) termasuk yang ada di objek terkompresi. */
const pdfPageCount = (pdfPath) => {
  const buf = readFileSync(pdfPath);
  const raw = buf.toString('latin1');
  let extra = '';
  // Kumpulkan isi stream terkompresi (ObjStm) DARI teks asli saja, lalu
  // inflate — jangan memodifikasi teks yang sedang dipindai.
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      extra += '\n' + inflateSync(buf.subarray(start, end)).toString('latin1');
    } catch {
      /* bukan stream terkompresi (mis. gambar) — abaikan */
    }
  }
  const text = raw + extra;
  const matches = text.match(/\/Type\s*\/Page(?![s])/g) ?? [];
  const box = (text.match(/\/MediaBox\s*\[([^\]]+)\]/) ?? [])[1] ?? '?';
  return { pages: matches.length, mediaBox: box.trim() };
};

const htmlFor = (count, layout) => renderPrintReport(makeData(count), fmt, layout);

const run = (label, count, layout) => {
  const dir = mkdtempSync(join(tmpdir(), 'nova-print-check-'));
  try {
    const html = htmlFor(count, layout);
    const pdf = printPdf(dir, html, label.replace(/[^a-z0-9]+/gi, '-'));
    const { pages, mediaBox } = pdfPageCount(pdf);
    const planned = planPrintPages(makeData(count).rows, layout).total;
    return { count, pages, planned, mediaBox, bytes: readFileSync(pdf).length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const argv = process.argv.slice(2);
const arg = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

// Tata letak yang dipakai: bawaan modul, atau diubah lewat --first/--next
// (dipakai saat mencari kapasitas yang aman).
const LAYOUT = {
  ...PRINT_LAYOUT,
  ...(arg('first') ? { rowsFirstPage: Number(arg('first')) } : {}),
  ...(arg('next') ? { rowsNextPage: Number(arg('next')) } : {}),
  ...(arg('tail') ? { tailRows: Number(arg('tail')) } : {}),
};

console.log(`Chrome : ${CHROME}`);
console.log(`Modul  : ${relative(ROOT, MODULE_PATH)}`);
console.log(
  `Kapasitas: halaman 1 = ${LAYOUT.rowsFirstPage} baris, lanjutan = ${LAYOUT.rowsNextPage} baris, blok bawah = ${LAYOUT.tailRows} baris\n`
);

if (argv.includes('--sweep')) {
  // Cari kapasitas maksimum yang MASIH muat satu halaman (halaman lanjutan).
  console.log('Kapasitas maksimum halaman LANJUTAN (satu halaman berisi N baris):');
  let lastOk = 0;
  for (const n of [20, 30, 38, 42, 46, 48, 50, 52, 54, 56, 60]) {
    const one = { rowsFirstPage: n, rowsNextPage: n, tailRows: 0 };
    const r = run(`sweep-${n}`, n, { ...one, rowsFirstPage: 9999 });
    const ok = r.pages === 1;
    if (ok) lastOk = n;
    console.log(
      `  ${String(n).padStart(3)} baris -> ${r.pages} halaman ${ok ? 'OK' : 'MELUBER'} (MediaBox ${r.mediaBox} pt)`
    );
  }
  console.log(`\nMaksimum muat satu halaman: ${lastOk} baris`);
} else {
  const single = arg('rows');
  const list = arg('counts');
  const cases = single
    ? [Number(single)]
    : list
      ? list.split(',').map(Number)
      : [0, 1, 10, 26, 27, 34, 35, 60, 61, 120, 200, 400];
  console.log(' baris | direncanakan | halaman PDF | hasil');
  console.log('-------+--------------+-------------+-------------------------------');
  let bad = 0;
  for (const n of cases) {
    const r = run(`rows-${n}`, n, LAYOUT);
    const ok = r.pages === r.planned;
    if (!ok) bad += 1;
    console.log(
      `  ${String(n).padStart(4)} | ${String(r.planned).padStart(12)} | ${String(r.pages).padStart(11)} | ${
        ok ? 'OK (isi muat, tanpa halaman kosong)' : 'TIDAK COCOK — periksa kapasitas'
      }`
    );
  }
  console.log(bad === 0 ? '\nSEMUA OK: jumlah halaman PDF = jumlah halaman yang direncanakan.' : `\n${bad} kasus TIDAK COCOK.`);
  process.exitCode = bad === 0 ? 0 : 1;
}
