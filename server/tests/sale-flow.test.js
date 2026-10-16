/**
 * Uji alur "Smart Receipt Preview" (FASE 3).
 *
 * `apps/kasir/src/sale-flow.js` sengaja dibuat murni (tanpa DOM/jaringan/impor
 * relatif) agar dapat diuji langsung di Node lewat data: URL — sama seperti
 * `receipt.js`. Karena berkas ditulis sebagai ES module di dalam app statis
 * (tanpa `type: module`), pemuatan memakai data: URL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const flowSrc = load('../../apps/kasir/src/sale-flow.js');
const flow = await import(
  'data:text/javascript;base64,' + Buffer.from(flowSrc).toString('base64')
);
const {
  MODE_DRAFT,
  MODE_FINAL,
  DRAFT_STATUS,
  DRAFT_LABEL,
  REPRINT_LABEL,
  validateSale,
  createDraft,
  draftToTransaction,
  buildSalePayload,
  confirmDraft,
  isPrintable,
  isDraftState,
  afterPrintFailure,
  createSnapshot,
  markReprint,
  hasSnapshot,
  renderPrintHtml,
} = flow;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('clientRef dari createDraft: UUID v4 unik (kunci idempotensi server)', () => {
  const a = createDraft({ items: [{ productId: 'p1', qty: 1 }] });
  const b = createDraft({ items: [{ productId: 'p1', qty: 1 }] });
  assert.match(a.clientRef, UUID_RE);
  assert.notEqual(a.clientRef, b.clientRef);
});

// --------------------------------------------------------------- validate ----

test('validateSale: keranjang kosong ditolak', () => {
  assert.deepEqual(validateSale({ items: [], method: 'cash', amount: 0, total: 0 }), {
    ok: false,
    error: 'Keranjang masih kosong.',
  });
});

test('validateSale: tunai kurang dari total ditolak', () => {
  const r = validateSale({ items: [{ productId: 'p1', qty: 1 }], method: 'cash', amount: 900, total: 1000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /kurang/i);
});

test('validateSale: non-tunai harus persis sama dengan total', () => {
  assert.equal(
    validateSale({ items: [{ productId: 'p1', qty: 1 }], method: 'qr', amount: 1200, total: 1000 }).ok,
    false
  );
  assert.equal(
    validateSale({ items: [{ productId: 'p1', qty: 1 }], method: 'qr', amount: 1000, total: 1000 }).ok,
    true
  );
});

test('validateSale: tunai pas / lebih diterima', () => {
  assert.equal(validateSale({ items: [{ productId: 'p1', qty: 1 }], method: 'cash', amount: 1000, total: 1000 }).ok, true);
  assert.equal(validateSale({ items: [{ productId: 'p1', qty: 1 }], method: 'cash', amount: 5000, total: 1000 }).ok, true);
});

// ------------------------------------------------------------------ draft ----

test('createDraft: mode draft, clientRef UUID, item dinormalisasi', () => {
  const d = createDraft({
    items: [{ productId: 'p1', qty: 2 }, { product_id: 'p2', qty: 0 }],
    method: 'cash',
    amount: 5000.4,
  });
  assert.equal(d.mode, 'draft');
  assert.match(d.clientRef, UUID_RE);
  assert.equal(d.amount, 5000);
  assert.equal(d.items[0].productId, 'p1');
  assert.equal(d.items[0].qty, 2);
  // qty 0 -> minimal 1 (keranjang tidak boleh berisi 0 item).
  assert.equal(d.items[1].qty, 1);
});

test('createDraft: clientRef yang diberikan dipakai ulang (kunci idempotensi)', () => {
  const ref = 'ref-tetap-123';
  const a = createDraft({ items: [{ productId: 'p1', qty: 1 }], clientRef: ref });
  const b = createDraft({ items: [{ productId: 'p1', qty: 1 }], clientRef: ref });
  assert.equal(a.clientRef, ref);
  assert.equal(b.clientRef, ref);
});

test('draftToTransaction: status draft & kembalian dihitung di perangkat', () => {
  const d = createDraft({ items: [{ productId: 'p1', qty: 1 }], method: 'cash', amount: 5000000 });
  const tx = draftToTransaction(d, {
    items: [{ product_name: 'Nasi Goreng', qty: 1, unit_price: 3100000, line_total: 3100000 }],
    totals: { subtotal: 3100000, discount_total: 0, tax_total: 0, total: 3100000 },
  });
  assert.equal(tx.status, 'draft');
  assert.equal(tx.invoice_no, '(belum dicatat)');
  assert.equal(tx.change_amount, 1900000);
  assert.equal(tx.payments[0].status, 'pending');
  assert.equal(tx.total, 3100000);
});

test('draftToTransaction: non-tunai tidak menghitung kembalian', () => {
  const d = createDraft({ items: [{ productId: 'p1', qty: 1 }], method: 'qr', amount: 5000 });
  const tx = draftToTransaction(d, { totals: { total: 5000 } });
  assert.equal(tx.change_amount, 0);
});

// ------------------------------------------------------------------ payload ---

test('buildSalePayload: menyertakan clientRef & tidak mengirim harga dari klien', () => {
  const d = createDraft({
    items: [{ productId: 'p1', qty: 2 }],
    method: 'cash',
    amount: 50000,
    discount: { type: 'percent', value: 10 },
    note: 'dibungkus',
  });
  const p = buildSalePayload(d);
  assert.deepEqual(p.items, [{ productId: 'p1', qty: 2 }]);
  assert.deepEqual(p.payment, { method: 'cash', amount: 50000 });
  assert.deepEqual(p.discount, { type: 'percent', value: 10 });
  assert.equal(p.note, 'dibungkus');
  assert.equal(p.clientRef, d.clientRef);
  // Harga/total TIDAK dikirim klien (server yang menentukan).
  assert.equal(p.price, undefined);
  assert.equal(p.total, undefined);
});

test('buildSalePayload: tanpa diskon/catatan -> kunci tidak dikirim', () => {
  const d = createDraft({ items: [{ productId: 'p1', qty: 1 }], method: 'cash', amount: 1000 });
  const p = buildSalePayload(d);
  assert.equal('discount' in p, false);
  assert.equal('note' in p, false);
});

// ------------------------------------------------------------------- state ----

test('confirmDraft: menjadi final & mempertahankan transaksi', () => {
  const d = createDraft({ items: [{ productId: 'p1', qty: 1 }], method: 'cash', amount: 1000 });
  const st = confirmDraft(d, { id: 'tx-1', invoice_no: 'INV-1' }, { at: '2026-10-16T00:00:00Z' });
  assert.equal(st.mode, 'final');
  assert.equal(st.transaction.id, 'tx-1');
  assert.equal(st.confirmedAt, '2026-10-16T00:00:00Z');
});

test('isPrintable: hanya transaksi final yang boleh dicetak', () => {
  const d = createDraft({ items: [{ productId: 'p1', qty: 1 }], method: 'cash', amount: 1000 });
  assert.equal(isPrintable(null), false);
  assert.equal(isPrintable(d), false);
  assert.equal(isPrintable(confirmDraft(d, { id: 'tx-1' })), true);
  // Final tanpa id/invoice tidak layak cetak.
  assert.equal(isPrintable({ mode: 'final', transaction: {} }), false);
});

test('isDraftState: hanya pratinjau', () => {
  const d = createDraft({ items: [{ productId: 'p1', qty: 1 }], method: 'cash', amount: 1 });
  assert.equal(isDraftState(d), true);
  assert.equal(isDraftState(confirmDraft(d, { id: 'x' })), false);
  assert.equal(isDraftState(null), false);
});

test('afterPrintFailure: tetap final & mencatat galat (tidak membatalkan)', () => {
  const d = createDraft({ items: [{ productId: 'p1', qty: 1 }], method: 'cash', amount: 1000 });
  const fin = confirmDraft(d, { id: 'tx-1', invoice_no: 'INV-1' });
  const after = afterPrintFailure(fin, 'printer mati');
  assert.equal(after.mode, 'final');
  assert.equal(after.transaction.id, 'tx-1');
  assert.equal(after.printError, 'printer mati');
  assert.equal(isPrintable(after), true);
  // Pesan default bila tidak diberi pesan.
  assert.match(afterPrintFailure(fin).printError, /tetap tersimpan/);
});

// ---------------------------------------------------------------- snapshot ----

test('snapshot: cetakan pertama apa adanya, kedua bertanda CETAK ULANG', () => {
  const snap = createSnapshot({
    transaction: { id: 'tx-1' },
    html: '<div class="struk-head">KASIR NOVA</div>',
  });
  assert.equal(hasSnapshot(snap), true);
  assert.equal(snap.reprint, false);
  assert.equal(renderPrintHtml(snap), snap.html);

  const again = markReprint(snap, { at: '2026-10-16T04:30:00.000Z' });
  assert.equal(again.reprint, true);
  const html = renderPrintHtml(again);
  assert.match(html, /CETAK ULANG/);
  assert.match(html, /struk-reprint/);
  assert.ok(html.endsWith(snap.html));
  // Snapshot asal TIDAK berubah (immutable).
  assert.equal(snap.reprint, false);
  assert.doesNotMatch(renderPrintHtml(snap), /CETAK ULANG/);
});

test('snapshot: tanpa HTML tidak menghasilkan apa pun', () => {
  assert.equal(hasSnapshot(createSnapshot({})), false);
  assert.equal(renderPrintHtml(createSnapshot({})), '');
  assert.equal(renderPrintHtml(null), '');
});

test('snapshot: lebar dinormalisasi ke 58/80 dan aman dari nilai aneh', () => {
  assert.equal(createSnapshot({ width: '80' }).width, '80');
  assert.equal(createSnapshot({ width: 80 }).width, '80');
  assert.equal(createSnapshot({ width: 'xx' }).width, '58');
  assert.equal(createSnapshot({}).width, '58');
});

test('renderPrintHtml: penanda cetak ulang di-escape (tanpa HTML injection)', () => {
  const snap = markReprint(
    createSnapshot({ html: '<p>x</p>' }),
    { at: '2026-10-16T04:30:00.000Z' }
  );
  const html = renderPrintHtml(snap);
  assert.doesNotMatch(html, /<script>/);
});

test('createSnapshot: default aman (tanpa argumen)', () => {
  const snap = createSnapshot();
  assert.equal(snap.transaction, null);
  assert.equal(snap.width, '58');
  assert.equal(hasSnapshot(snap), false);
});

// ----------------------------------------------------------- konstanta alur --

test('label alur: pratinjau selalu BELUM DIBAYAR', () => {
  assert.equal(DRAFT_LABEL, 'BELUM DIBAYAR');
  assert.equal(DRAFT_LABEL === 'LUNAS', false);
  assert.equal(DRAFT_STATUS, 'draft');
  assert.equal(REPRINT_LABEL, 'CETAK ULANG');
  assert.equal(MODE_DRAFT, 'draft');
  assert.equal(MODE_FINAL, 'final');
});
