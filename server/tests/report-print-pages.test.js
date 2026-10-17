/**
 * Uji paginasi & nomor halaman cetak "Laporan Transaksi" (Owner) — 17 Okt 2026.
 *
 * `apps/owner/src/report-print.js` sengaja **murni** (hanya menyusun string
 * HTML, tanpa DOM) sehingga bisa diuji langsung di Node — pola yang sama dengan
 * `apps/kasir/src/receipt.js` (lihat `receipt-struk.test.js`). Karena berkas itu
 * ditulis sebagai ES module di dalam app statis (tanpa `package.json`
 * `type: module`), ia dimuat lewat data: URL.
 *
 * Yang diuji di sini (tata letak nyata pada Chrome ada di
 * `scripts/print-report-check.mjs`):
 *   - pembagian baris menjadi halaman: kapasitas halaman 1 berbeda dari halaman
 *     lanjutan, blok bawah hanya menempel bila masih ada ruang;
 *   - label nomor halaman "Halaman i dari N" ada di SETIAP halaman;
 *   - nomor baris (kolom NO) menerus antar halaman;
 *   - kop ringkas & judul "(lanjutan)" hanya pada halaman 2+;
 *   - nilai teks tetap di-escape; peringatan "dipotong" hanya di halaman 1;
 *   - regresi: label status (`STATUS_LABELS` lama yang tidak pernah ada).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const printSrc = load('../../apps/owner/src/report-print.js');
const print = await import('data:text/javascript;base64,' + Buffer.from(printSrc).toString('base64'));

const { PRINT_LAYOUT, PRINT_STATUS_LABELS, pageLabel, planPrintPages, renderPrintReport } = print;

/** Format angka tiruan — MIRIP panel Owner (hanya untuk tata letak/teks). */
const fmt = {
  escape: (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
  idr: (sen) => 'Rp ' + Math.round(Number(sen ?? 0) / 100).toLocaleString('id-ID'),
  periode: () => '1 \u2013 17 Oktober 2026',
  cetak: () => '17 Oktober 2026 17:05',
  tanggalJam: (date, time) => `${date} ${time}`,
  metode: (list) => (list ?? []).map((m) => ({ cash: 'Tunai' }[m] ?? m)).join(', ') || '\u2014',
  status: (key) => PRINT_STATUS_LABELS[key] ?? key,
};

const makeData = (count, over = {}) => ({
  business: { id: 'b1', name: 'Kopi Rakyat', timezone: 'Asia/Jakarta' },
  outlet: { id: 'o1', name: 'Outlet Utama' },
  cashier: null,
  period: { from: '2026-10-01', to: '2026-10-17' },
  printed_at: '2026-10-17T10:05:00.000Z',
  summary: {
    status: 'completed',
    transactions: count,
    total: count * 1_500_000,
    avg_total: 1_500_000,
    voided_transactions: 0,
    voided_total: 0,
    refunded_transactions: 0,
    refunded_total: 0,
  },
  payment_methods: [{ method: 'cash', label: 'Tunai', total: count * 1_500_000, percent: 100 }],
  top_products: [{ product_name: 'Kopi Susu', qty: count, revenue: count * 1_500_000 }],
  rows: Array.from({ length: count }, (_, i) => ({
    invoice_no: `INV-20261017-${String(i + 1).padStart(4, '0')}`,
    date: '2026-10-17',
    time: '09:15',
    product_name: 'Kopi Susu Gula Aren',
    sku: `SKU-${i + 1}`,
    qty: 1,
    unit_price: 1_500_000,
    discount_amount: 0,
    line_total: 1_500_000,
    outlet_name: 'Outlet Utama',
    cashier_name: 'Rina Wati',
    methods: ['cash'],
  })),
  truncated: false,
  ...over,
});

/** Pisahkan HTML menjadi daftar halaman (tanpa elemen pertama yang kosong). */
const pagesOf = (html) => html.split('<div class="pr-page">').slice(1);

// --------------------------------------------------------------- planPrintPages

test('Paginasi: halaman 1 lebih sedikit dari halaman lanjutan', () => {
  const rows = Array.from({ length: 47 }, (_, i) => ({ i }));
  const plan = planPrintPages(rows);

  assert.strictEqual(plan.sheets[0].kind, 'first');
  assert.strictEqual(plan.sheets[0].rows.length, PRINT_LAYOUT.rowsFirstPage);
  assert.strictEqual(plan.sheets[1].kind, 'next');
  assert.strictEqual(plan.sheets[1].rows.length, PRINT_LAYOUT.rowsNextPage);
  assert.ok(
    PRINT_LAYOUT.rowsFirstPage < PRINT_LAYOUT.rowsNextPage,
    'halaman 1 memuat kop + info + KPI sehingga kapasitasnya lebih kecil'
  );
});

test('Paginasi: blok bawah menempel pada halaman terakhir bila masih ada ruang', () => {
  // 16 baris: 16 + 5 (blok bawah) = 21 <= kapasitas halaman 1 -> satu halaman.
  const satu = planPrintPages(Array.from({ length: 16 }, (_, i) => ({ i })));
  assert.strictEqual(satu.total, 1);
  assert.strictEqual(satu.sheets[0].withTail, true);

  // 17 baris: 17 + 5 > 21 -> blok bawah pindah ke halaman sendiri (tidak terpotong).
  const dua = planPrintPages(Array.from({ length: 17 }, (_, i) => ({ i })));
  assert.strictEqual(dua.total, 2);
  assert.deepStrictEqual(
    dua.sheets.map((s) => s.rows.length),
    [17, 0]
  );
  assert.strictEqual(dua.sheets[1].withTail, true);
});

test('Paginasi: nomor baris menerus dan hanya halaman terakhir memuat blok bawah', () => {
  const plan = planPrintPages(Array.from({ length: 68 }, (_, i) => ({ i })));

  assert.strictEqual(plan.total, 3);
  assert.deepStrictEqual(
    plan.sheets.map((s) => s.page),
    [1, 2, 3]
  );
  assert.deepStrictEqual(
    plan.sheets.map((s) => s.startIndex),
    [0, 21, 47]
  );
  assert.deepStrictEqual(
    plan.sheets.map((s) => s.withTail),
    [false, false, true]
  );
  assert.deepStrictEqual(
    plan.sheets.map((s) => s.rows.length),
    [21, 26, 21]
  );
});

test('Paginasi: laporan kosong tetap satu halaman; kapasitas 0 tidak membuat perulangan tanpa akhir', () => {
  const kosong = planPrintPages([]);
  assert.strictEqual(kosong.total, 1);
  assert.deepStrictEqual(kosong.sheets[0].rows, []);
  assert.strictEqual(kosong.sheets[0].withTail, true);

  const nol = planPrintPages([{ i: 1 }, { i: 2 }, { i: 3 }], {
    rowsFirstPage: 0,
    rowsNextPage: 0,
    tailRows: 0,
  });
  assert.strictEqual(nol.total, 3, 'kapasitas 0 diperlakukan sebagai 1 baris/halaman');
});

test('Label nomor halaman', () => {
  assert.strictEqual(pageLabel(1, 3), 'Halaman 1 dari 3');
  assert.strictEqual(pageLabel(12, 12), 'Halaman 12 dari 12');
});

// ------------------------------------------------------------ renderPrintReport

test('Cetak: satu halaman untuk laporan kecil + nomor halaman di footer', () => {
  const html = renderPrintReport(makeData(3), fmt);
  const pages = pagesOf(html);

  assert.strictEqual(pages.length, 1);
  assert.match(html, /Halaman 1 dari 1/);
  assert.match(html, /Detail Transaksi/);
  assert.doesNotMatch(html, /lanjutan/);
  assert.doesNotMatch(html, /pr-cont/);
  assert.match(html, /Ringkasan Penjualan/);
  assert.match(html, /Produk Terlaris/);
  assert.match(html, /Catatan/);
  // Kop lengkap hanya sekali (tanpa kop ringkas).
  assert.strictEqual((html.match(/class="pr-head"/g) ?? []).length, 1);
});

test('Cetak: nomor halaman benar di SETIAP halaman dan nomor baris menerus', () => {
  const total = 400;
  const html = renderPrintReport(makeData(total), fmt);
  const pages = pagesOf(html);
  const plan = planPrintPages(makeData(total).rows);

  assert.strictEqual(pages.length, plan.total);
  assert.strictEqual(pages.length, 16, 'kapasitas terukur: 21 + 26 x n + blok bawah');

  pages.forEach((page, i) => {
    assert.match(page, new RegExp(`Halaman ${i + 1} dari ${pages.length}`), `halaman ${i + 1} memuat nomor halaman`);
  });

  // Kolom NO menerus 1..400 tanpa lompatan/duplikasi.
  const nomor = [...html.matchAll(/class="pr-num">(\d+)</g)].map((m) => Number(m[1]));
  assert.deepStrictEqual(nomor, Array.from({ length: total }, (_, i) => i + 1));

  // Kop ringkas + judul "(lanjutan)" hanya pada halaman 2 dan seterusnya.
  assert.strictEqual((html.match(/class="pr-cont"/g) ?? []).length, pages.length - 1);
  assert.strictEqual((html.match(/Detail Transaksi \(lanjutan\)/g) ?? []).length, pages.length - 1);

  // Blok bawah hanya sekali, di halaman terakhir.
  assert.strictEqual((html.match(/Ringkasan Penjualan/g) ?? []).length, 1);
  assert.match(pages[pages.length - 1], /Ringkasan Penjualan/);
  assert.doesNotMatch(pages[0], /Ringkasan Penjualan/);
});

test('Cetak: teks berbahaya di-escape dan peringatan hanya di halaman pertama', () => {
  const data = makeData(2, {
    truncated: true,
    rows: [
      {
        invoice_no: '<b>INV-1</b>',
        date: '2026-10-17',
        time: '09:15',
        product_name: 'Kopi "Spesial" <script>alert(1)</script>',
        qty: 1,
        unit_price: 1_500_000,
        discount_amount: 0,
        line_total: 1_500_000,
        outlet_name: 'Outlet & Co <b>',
        cashier_name: 'Rina',
        methods: ['cash'],
      },
    ],
  });
  const html = renderPrintReport(data, fmt);

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>INV-1<\/b>/);
  assert.match(html, /Kopi &quot;Spesial&quot; &lt;script&gt;/);
  assert.match(html, /Outlet &amp; Co &lt;b&gt;/);

  const pages = pagesOf(html);
  assert.strictEqual((html.match(/laporan dipotong/g) ?? []).length, 1);
  assert.match(pages[0], /laporan dipotong/);
});

test('Cetak: status selain completed memakai label (regresi STATUS_LABELS)', () => {
  assert.deepStrictEqual(Object.keys(PRINT_STATUS_LABELS).sort(), ['completed', 'refunded', 'voided']);

  const html = renderPrintReport(makeData(1, { summary: { ...makeData(1).summary, status: 'voided' } }), fmt);
  assert.match(html, /Status transaksi/);
  assert.match(html, /Dibatalkan/);
  assert.doesNotMatch(html, /undefined/);
});

test('Cetak: laporan tanpa transaksi tetap satu halaman dengan keterangan kosong', () => {
  const html = renderPrintReport(makeData(0), fmt);
  assert.strictEqual(pagesOf(html).length, 1);
  assert.match(html, /Belum ada transaksi pada rentang ini\./);
  assert.match(html, /Halaman 1 dari 1/);
});
