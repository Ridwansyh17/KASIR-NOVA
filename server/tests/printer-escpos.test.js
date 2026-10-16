/**
 * Uji encoder ESC/POS + layanan printer thermal (Fase 17: APK + cetak Bluetooth).
 *
 * `apps/kasir/src/escpos.js` dan `apps/kasir/src/printer.js` sengaja dibuat
 * murni (tanpa DOM) dan tanpa impor relatif, lalu dimuat lewat data: URL —
 * mengikuti pola `receipt-struk.test.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kasirSrc = join(here, '..', '..', 'apps', 'kasir', 'src');

// apps/kasir tidak punya package.json "type":"module" -> Node menganggap .js
// sebagai CommonJS. Muat isinya lewat data: URL agar dievaluasi sebagai ESM.
const loadEsm = (file) => {
  const source = readFileSync(join(kasirSrc, file), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
};

const escpos = await loadEsm('escpos.js');
const receipt = await loadEsm('receipt.js');

// Shim localStorage deterministik untuk menguji persistensi pengaturan.
const mem = new Map();
try {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      clear: () => mem.clear(),
    },
  });
} catch {
  /* abaikan bila tidak bisa menimpa */
}
const printer = await loadEsm('printer.js');

const decode = (bytes) => String.fromCharCode.apply(null, bytes);
const has = (bytes, text) => decode(bytes).includes(text);

const CONTEXT = {
  business: { name: 'Demo Kasir NOVA' },
  outlet: { name: 'Outlet Utama', address: 'Jl. Melati No. 3', phone: '021-555' },
};

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
  items: [{ product_name: 'Nasi Goreng', unit_price: 3100000, qty: 1, line_total: 3100000 }],
  payments: [{ method: 'cash', amount: 3100000, status: 'paid' }],
  ...over,
});

// --- escpos.js --------------------------------------------------------------

test('kolom mengikuti lebar kertas (58mm=32, 80mm=48)', () => {
  assert.equal(escpos.columnsFor('58'), 32);
  assert.equal(escpos.columnsFor(58), 32);
  assert.equal(escpos.columnsFor('80'), 48);
  assert.equal(escpos.columnsFor('xx'), 32);
});

test('buildStrukEscPos: byte ESC/POS valid (init + potong + teks)', () => {
  const bytes = escpos.buildStrukEscPos({
    transaction: baseTx(),
    context: CONTEXT,
    cashier: 'Ridwan',
    width: '58',
  });

  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [0x1b, 0x40]);
  assert.deepEqual(Array.from(bytes.slice(-3)), [0x1d, 0x56, 0x00]);
  assert.ok(has(bytes, 'Demo Kasir NOVA'));
  assert.ok(has(bytes, 'Outlet Utama'));
  assert.ok(has(bytes, 'INV-0001'));
  assert.ok(has(bytes, 'TOTAL'));
  assert.ok(has(bytes, 'LUNAS'));
  assert.ok(has(bytes, 'Tunai'));
  assert.ok(has(bytes, 'Terima kasih atas kunjungan Anda'));
});

test('tunai berkembalian: cetak Uang Diterima + Kembalian', () => {
  const bytes = escpos.buildStrukEscPos({
    transaction: baseTx({
      paid_amount: 5000000,
      change_amount: 1900000,
      payments: [{ method: 'cash', amount: 5000000, status: 'paid' }],
    }),
    context: CONTEXT,
  });
  assert.ok(has(bytes, 'Uang Diterima'));
  assert.ok(has(bytes, 'Rp 50.000'));
  assert.ok(has(bytes, 'Kembalian'));
  assert.ok(has(bytes, 'Rp 19.000'));
});

test('QRIS lunas: tanpa Uang Diterima / Kembalian', () => {
  const bytes = escpos.buildStrukEscPos({
    transaction: baseTx({ payments: [{ method: 'qr', amount: 3100000, status: 'paid' }] }),
    context: CONTEXT,
  });
  assert.ok(has(bytes, 'QRIS'));
  assert.ok(has(bytes, 'LUNAS'));
  assert.ok(!has(bytes, 'Uang Diterima'));
  assert.ok(!has(bytes, 'Kembalian'));
});

test('belum lunas: status BELUM LUNAS, tanpa kembalian', () => {
  const bytes = escpos.buildStrukEscPos({
    transaction: baseTx({
      paid_amount: 3100000,
      change_amount: 0,
      payments: [{ method: 'qr', amount: 3100000, status: 'pending' }],
    }),
    context: CONTEXT,
  });
  assert.ok(has(bytes, 'BELUM LUNAS'));
  assert.ok(!has(bytes, 'Uang Diterima'));
  assert.ok(!has(bytes, 'Kembalian'));
});

test('FASE 3 draft: BELUM DIBAYAR, rencana bayar, TIDAK pernah LUNAS', () => {
  const bytes = escpos.buildStrukEscPos({
    transaction: baseTx({
      status: 'draft',
      invoice_no: '(belum dicatat)',
      paid_amount: 5000000,
      change_amount: 1900000,
    }),
    context: CONTEXT,
  });
  assert.ok(has(bytes, 'BELUM DIBAYAR'));
  assert.ok(!has(bytes, 'LUNAS'));
  assert.ok(has(bytes, 'Rencana Bayar'));
  assert.ok(!has(bytes, 'Uang Diterima'));
});

test('cetak ulang: penanda CETAK ULANG hanya bila reprint=true', () => {
  const normal = escpos.buildStrukEscPos({ transaction: baseTx(), context: CONTEXT, reprint: false });
  assert.ok(!has(normal, 'CETAK ULANG'));
  const ulang = escpos.buildStrukEscPos({ transaction: baseTx(), context: CONTEXT, reprint: true });
  assert.ok(has(ulang, 'CETAK ULANG'));
  assert.ok(has(ulang, 'INV-0001'));
  assert.ok(has(ulang, 'LUNAS'));
});

test('total ditebalkan & tinggi ganda (ESC E 1 / GS ! 1)', () => {
  const bytes = escpos.buildStrukEscPos({ transaction: baseTx(), context: CONTEXT });
  assert.ok(decode(bytes).includes(String.fromCharCode(0x1b, 0x45, 0x01)));
  assert.ok(decode(bytes).includes(String.fromCharCode(0x1d, 0x21, 0x01)));
});

test('divider mengikuti jumlah kolom', () => {
  const b58 = escpos.buildStrukEscPos({ transaction: baseTx(), context: CONTEXT, width: '58' });
  const b80 = escpos.buildStrukEscPos({ transaction: baseTx(), context: CONTEXT, width: '80' });
  assert.ok(has(b58, '-'.repeat(32)));
  assert.ok(!has(b58, '-'.repeat(48)));
  assert.ok(has(b80, '-'.repeat(48)));
});

test('karakter non-ASCII diganti "?" agar tidak jadi sampah di printer', () => {
  const bytes = escpos.buildStrukEscPos({
    transaction: baseTx({
      items: [{ qty: 1, product_name: 'Kopi — Susu 🍵', unit_price: 100000, line_total: 100000 }],
    }),
    context: CONTEXT,
  });
  assert.ok(!bytes.some((b) => b > 126), 'semua byte harus <= 126 (ASCII)');
  assert.ok(has(bytes, '?'));
});

test('twoColumn: nilai kanan rata kanan pada lebar kolom', () => {
  const lines = escpos.twoColumn('A', 'Rp 1.000', 32);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 32);
  assert.ok(lines[0].endsWith('Rp 1.000'));

  const wrapped = escpos.twoColumn(
    'Nama Produk Yang Sangat Panjang Sekali Untuk Diuji Sekali',
    'Rp 1.000',
    32
  );
  assert.ok(wrapped.length > 1);
  for (const ln of wrapped) assert.ok(ln.length <= 32, `baris "${ln}" > 32`);
});

test('cetak tanpa perintah potong bila cut=false', () => {
  const bytes = escpos.buildStrukEscPos({ transaction: baseTx(), context: CONTEXT, cut: false });
  assert.notDeepEqual(Array.from(bytes.slice(-3)), [0x1d, 0x56, 0x00]);
});

test('buildTestEscPos: halaman uji jelas & tidak menyatakan status pembayaran', () => {
  const bytes = escpos.buildTestEscPos({ context: CONTEXT, width: '58' });
  assert.ok(has(bytes, 'UJI CETAK PRINTER'));
  assert.ok(!has(bytes, 'LUNAS'));
  assert.ok(!has(bytes, 'TOTAL'));
  assert.deepEqual(Array.from(bytes.slice(-3)), [0x1d, 0x56, 0x00]);
});

test('data minim tidak error', () => {
  const bytes = escpos.buildStrukEscPos({ transaction: {}, context: {} });
  assert.ok(bytes.length > 0);
  assert.ok(has(bytes, 'TOTAL'));
});

test('label status escpos konsisten dengan receipt', () => {
  const cases = [
    baseTx(),
    baseTx({ status: 'draft' }),
    baseTx({ status: 'voided' }),
    baseTx({ status: 'refunded' }),
    baseTx({ payments: [{ method: 'qr', status: 'refunded' }] }),
    baseTx({ payments: [{ method: 'qr', status: 'failed' }] }),
    baseTx({ payments: [{ method: 'cash', status: 'pending' }] }),
  ];
  for (const t of cases) {
    assert.equal(escpos.paymentStatusLabel(t), receipt.paymentStatusLabel(t));
  }
  // Pratinjau TIDAK PERNAH dilaporkan sebagai LUNAS oleh kedua modul.
  assert.equal(escpos.paymentStatusLabel(baseTx({ status: 'draft' })), 'BELUM DIBAYAR');
  assert.equal(receipt.paymentStatusLabel(baseTx({ status: 'draft' })), 'BELUM DIBAYAR');
});

// --- printer.js -------------------------------------------------------------

test('printer: di web (non-native) fitur dinonaktifkan & default pengaturan', async () => {
  delete globalThis.Capacitor;
  assert.equal(printer.isNative(), false);
  assert.deepEqual(printer.getSettings(), { width: '58', autoPrint: false });
  const avail = await printer.checkAvailability();
  assert.equal(avail.native, false);
});

test('printer: printBytes/listBonded melempar PrinterError saat bukan native', async () => {
  delete globalThis.Capacitor;
  await assert.rejects(
    () => printer.printBytes(new Uint8Array([1])),
    (e) => e instanceof printer.PrinterError && e.code === 'not_native'
  );
  await assert.rejects(
    () => printer.listBonded(),
    (e) => e instanceof printer.PrinterError && e.code === 'not_native'
  );
});

test('printer: bytesToBase64 benar', () => {
  assert.equal(printer.bytesToBase64(new Uint8Array([0x1b, 0x40])), 'G0A=');
  assert.equal(printer.bytesToBase64(new Uint8Array([])), '');
});

test('printer: dengan plugin native, printBytes mengirim base64 ke plugin', async () => {
  const calls = [];
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    registerPlugin: () => ({
      write: async (opts) => calls.push(opts),
      isAvailable: async () => ({ enabled: true, ready: true }),
      status: async () => ({ connected: true, name: 'P1' }),
    }),
  };
  try {
    assert.equal(printer.isNative(), true);
    const payload = new Uint8Array([1, 2, 3]);
    await printer.printBytes(payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].data, printer.bytesToBase64(payload));
    const avail = await printer.checkAvailability();
    assert.equal(avail.native, true);
    assert.equal(avail.enabled, true);
  } finally {
    delete globalThis.Capacitor;
  }
});

test('printer: simpan & baca perangkat serta pengaturan', () => {
  printer.saveDevice({ address: 'AA:BB:CC', transport: 'spp', name: 'Printer X' });
  assert.deepEqual(printer.getSavedDevice(), {
    address: 'AA:BB:CC',
    transport: 'spp',
    name: 'Printer X',
  });
  printer.saveSettings({ width: '80', autoPrint: true });
  assert.deepEqual(printer.getSettings(), { width: '80', autoPrint: true });
  printer.clearDevice();
  assert.equal(printer.getSavedDevice(), null);
  printer.saveSettings({ width: '58', autoPrint: false });
});
