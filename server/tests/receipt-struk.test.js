/**
 * Uji pembentuk struk thermal (Fase 16b).
 *
 * `apps/kasir/src/receipt.js` sengaja dibuat murni (tanpa DOM) agar dapat diuji
 * langsung di Node. Karena berkas itu ditulis sebagai ES module di dalam app
 * statis (tanpa package.json `type: module`), ia dimuat lewat data: URL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const receiptSrc = load('../../apps/kasir/src/receipt.js');
const receipt = await import(
  'data:text/javascript;base64,' + Buffer.from(receiptSrc).toString('base64')
);
const { buildStrukHtml, paymentStatusLabel, strukPageCss, escapeHtml, fmtIDR } = receipt;

const css = load('../../apps/kasir/styles/styles.css');

const CONTEXT = {
  business: { name: 'Demo Kasir NOVA' },
  outlet: { name: 'Outlet Utama', address: 'Jl. Melati No. 3', phone: '021-555' },
};

/** Transaksi dasar (nilai dalam SEN). */
const baseTx = (over = {}) => ({
  id: 'tx-1',
  invoice_no: 'INV-0001',
  created_at: '2026-10-13T04:30:00.000Z',
  status: 'completed',
  subtotal: 3100000,
  discount_total: 0,
  tax_total: 0,
  tax_rate: 0,
  total: 3100000,
  paid_amount: 3100000,
  change_amount: 0,
  items: [
    { product_name: 'Nasi Goreng', sku: 'NG1', unit_price: 3100000, qty: 1, line_total: 3100000 },
  ],
  payments: [{ method: 'cash', amount: 3100000, status: 'paid' }],
  ...over,
});

test('rupiah diformat dari sen (Rp 31.000)', () => {
  assert.equal(fmtIDR(3100000), 'Rp 31.000');
  assert.equal(fmtIDR(0), 'Rp 0');
});

test('tunai dengan kembalian: tampil Uang Diterima + Kembalian dan status LUNAS', () => {
  const html = buildStrukHtml({
    transaction: baseTx({
      paid_amount: 5000000,
      change_amount: 1900000,
      payments: [{ method: 'cash', amount: 5000000, status: 'paid' }],
    }),
    context: CONTEXT,
    cashier: 'Ridwan',
  });

  assert.match(html, /Demo Kasir NOVA/);
  assert.match(html, /Outlet Utama/);
  assert.match(html, /Jl\. Melati No\. 3/);
  assert.match(html, /Telp\. 021-555/);
  assert.match(html, /No\. Struk/);
  assert.match(html, /INV-0001/);
  assert.match(html, /ID Transaksi/);
  assert.match(html, /Kasir/);
  assert.match(html, /Ridwan/);
  assert.match(html, /Tunai/);
  assert.match(html, /LUNAS/);
  assert.match(html, /Uang Diterima/);
  assert.match(html, /Rp 50\.000/);
  assert.match(html, /Kembalian/);
  assert.match(html, /Rp 19\.000/);
  assert.match(html, /TOTAL/);
  assert.match(html, /Rp 31\.000/);
  assert.match(html, /Terima kasih atas kunjungan Anda/);
  assert.match(html, /KASIR NOVA/);
});

test('QRIS lunas: tanpa Uang Diterima / Kembalian (bukan tunai)', () => {
  const html = buildStrukHtml({
    transaction: baseTx({ payments: [{ method: 'qr', amount: 3100000, status: 'paid' }] }),
    context: CONTEXT,
  });

  assert.match(html, /QRIS/);
  assert.match(html, /LUNAS/);
  assert.doesNotMatch(html, /Uang Diterima/);
  assert.doesNotMatch(html, /Kembalian/);
});

test('belum lunas: status BELUM LUNAS, tanpa kembalian', () => {
  const html = buildStrukHtml({
    transaction: baseTx({ payments: [{ method: 'qr', amount: 3100000, status: 'pending' }] }),
    context: CONTEXT,
  });
  assert.match(html, /BELUM LUNAS/);
  assert.doesNotMatch(html, /Uang Diterima/);
  assert.doesNotMatch(html, /Kembalian/);
  assert.doesNotMatch(html, />LUNAS</);
});

test('status aktual: batal / refund / gagal tidak dinyatakan lunas', () => {
  assert.equal(paymentStatusLabel(baseTx({ status: 'voided' })), 'DIBATALKAN');
  assert.equal(paymentStatusLabel(baseTx({ status: 'refunded' })), 'DIKEMBALIKAN');
  assert.equal(
    paymentStatusLabel(baseTx({ payments: [{ method: 'qr', status: 'refunded' }] })),
    'DIKEMBALIKAN'
  );
  assert.equal(paymentStatusLabel(baseTx({ payments: [{ method: 'qr', status: 'failed' }] })), 'GAGAL');
  assert.equal(
    paymentStatusLabel(baseTx({ payments: [{ method: 'cash', status: 'pending' }] })),
    'BELUM LUNAS'
  );
  assert.equal(paymentStatusLabel(baseTx()), 'LUNAS');
});

test('belum lunas tidak menampilkan kembalian palsu', () => {
  const html = buildStrukHtml({
    transaction: baseTx({
      status: 'completed',
      paid_amount: 5000000,
      change_amount: 1900000,
      payments: [{ method: 'cash', amount: 5000000, status: 'pending' }],
    }),
    context: CONTEXT,
  });
  assert.match(html, /BELUM LUNAS/);
  assert.doesNotMatch(html, /Kembalian/);
  assert.doesNotMatch(html, /Uang Diterima/);
});

test('banyak item & nama panjang: nama di-escape dan harga terpisah', () => {
  const longName = 'Nasi Goreng Spesial <script>alert(1)</script> ' + 'X'.repeat(80);
  const html = buildStrukHtml({
    transaction: baseTx({
      items: [
        { product_name: longName, unit_price: 2500000, qty: 3, line_total: 7500000 },
        { product_name: 'Es Teh Manis', unit_price: 500000, qty: 1, line_total: 500000 },
      ],
      subtotal: 8000000,
      total: 8000000,
      paid_amount: 8000000,
      change_amount: 0,
    }),
    context: CONTEXT,
  });

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /3x/);
  assert.match(html, /@ Rp 25\.000/);
  assert.match(html, /Rp 75\.000/);
  assert.match(html, /Total Produk/);
  assert.match(html, /4 item/);
  // Nama dan total berada di elemen terpisah -> harga tidak menimpa nama.
  assert.match(html, /class="struk-item-name"/);
  assert.match(html, /class="struk-item-total"/);
});

test('diskon/pajak hanya tampil bila berlaku (tidak hardcode)', () => {
  const noTax = buildStrukHtml({ transaction: baseTx(), context: CONTEXT });
  assert.doesNotMatch(noTax, /Diskon/);
  assert.doesNotMatch(noTax, /Pajak/);

  const withTax = buildStrukHtml({
    transaction: baseTx({
      discount_total: 100000,
      tax_rate: 11,
      tax_total: 330000,
      total: 3330000,
    }),
    context: CONTEXT,
  });
  assert.match(withTax, /Diskon/);
  assert.match(withTax, /-Rp 1\.000/);
  assert.match(withTax, /Pajak \(11%\)/);
  assert.match(withTax, /Rp 3\.300/);
  assert.match(withTax, /TOTAL/);
});

test('nama kosong / data minim tidak menyebabkan error', () => {
  const html = buildStrukHtml({ transaction: {}, context: {} });
  assert.match(html, /KASIR NOVA/);
  assert.match(html, /TOTAL/);
  assert.match(html, /LUNAS/);
});

test('escapeHtml mengamankan teks & atribut', () => {
  assert.equal(escapeHtml(`<a href="x">&\'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('@page 58mm vs 80mm (konten 48mm/72mm)', () => {
  assert.equal(strukPageCss('58'), '@page { size: 58mm auto; margin: 5mm; }');
  assert.equal(strukPageCss('80'), '@page { size: 80mm auto; margin: 4mm; }');
  assert.match(strukPageCss('80'), /80mm auto/);
  assert.match(strukPageCss(undefined), /58mm auto/);
  assert.match(strukPageCss('xx'), /58mm auto/);
});

test('CSS cetak: hanya #print-struk yang tampil dan tidak memengaruhi layar', () => {
  const printBlock = css.slice(css.indexOf('@media print'), css.indexOf('@page'));
  assert.match(css, /@media print/);
  // Dashboard & UI lain disembunyikan saat mencetak.
  assert.ok(css.includes('body > *:not(#print-struk)'));
  assert.match(css, /@page\s*\{[\s\S]*?size: 58mm auto/);
  // Semua aturan struk di-scope ke #print-struk (tidak bocor ke layar lain).
  assert.match(css, /#print-struk \.struk-item-name \{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(css, /#print-struk \.struk-row\.total/);
  // Default @page untuk kertas 58mm.
  assert.match(css, /@page \{\s*size: 58mm auto;\s*margin: 5mm;\s*\}/);
  assert.ok(css.includes('@media print'));
});

// --- FASE 3: pratinjau (draft) & cetak ulang ---------------------------------

test('draft: selalu BELUM DIBAYAR, tidak pernah LUNAS', () => {
  assert.equal(paymentStatusLabel({ status: 'draft' }), 'BELUM DIBAYAR');
  const html = buildStrukHtml({
    transaction: baseTx({
      id: '',
      invoice_no: '(belum dicatat)',
      status: 'draft',
      payments: [{ method: 'cash', amount: 5000000, status: 'pending' }],
      paid_amount: 5000000,
      change_amount: 1900000,
    }),
    context: CONTEXT,
  });
  assert.match(html, /BELUM DIBAYAR/);
  assert.doesNotMatch(html, /LUNAS/);
  assert.match(html, /struk-draft/);
  assert.match(html, /Pratinjau/);
  // Pratinjau tunai memakai label "Rencana Bayar", bukan "Uang Diterima".
  assert.match(html, /Rencana Bayar/);
  assert.doesNotMatch(html, /Uang Diterima/);
});

test('draft non-tunai: tanpa baris uang diterima/kembalian', () => {
  const html = buildStrukHtml({
    transaction: baseTx({
      status: 'draft',
      payments: [{ method: 'qr', amount: 3100000, status: 'pending' }],
    }),
    context: CONTEXT,
  });
  assert.match(html, /BELUM DIBAYAR/);
  assert.doesNotMatch(html, /Uang Diterima/);
  assert.doesNotMatch(html, /Rencana Bayar/);
  assert.doesNotMatch(html, /Kembalian/);
});

test('CSS cetak: gaya pratinjau & cetak ulang hanya di dalam #print-struk', () => {
  assert.match(css, /#print-struk \.struk-draft \{/);
  assert.match(css, /#print-struk \.struk-reprint \{/);
  // Tidak boleh ada aturan global yang membocorkan ke layar.
  assert.doesNotMatch(css, /(^|\n)\.struk-draft\s*\{/);
  assert.doesNotMatch(css, /(^|\n)\.struk-reprint\s*\{/);
  // Penanda pratinjau pada panel layar (bukan cetak).
  assert.match(css, /\.receipt\.draft \{/);
});
