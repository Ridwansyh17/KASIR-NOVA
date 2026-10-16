/**
 * Logika UI panel Kasir — Titik Penjualan (Fase 7).
 *
 * Alur: login (peran terkunci cashier) -> /me -> konteks outlet/bisnis ->
 * katalog produk outlet -> keranjang -> diskon/pembayaran -> "Bayar".
 * Semua perhitungan total & pajak tetap dilakukan SERVER; perhitungan di sini
 * hanya perkiraan untuk tampilan. Verifikasi peran/status ditegakkan server.
 */
import { api, login, logout, loginWithPin, listPinCashiers, restoreSession, tokenStore, ApiError } from './api.js';
import {
  escapeHtml,
  fmtIDR,
  fmtDate,
  METHOD_LABELS,
  DRAFT_LABEL,
  DRAFT_NOTICE,
  paymentStatusLabel,
  strukPageCss,
  buildStrukHtml,
} from './receipt.js';
import {
  MODE_DRAFT,
  MODE_FINAL,
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
} from './sale-flow.js';
import { buildStrukEscPos, buildTestEscPos } from './escpos.js';
import * as printer from './printer.js';

const $ = (id) => document.getElementById(id);

/**
 * Tanggal saja (YYYY-MM-DD) untuk kolom bertipe DATE (`spent_on`).
 * Aman untuk nilai string maupun objek Date dari driver Postgres.
 */
const fmtDay = (value) => {
  if (!value) return '—';
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const state = {
  user: null,
  context: null,
  products: [],
  cart: new Map(), // productId -> { product, qty }
  canViewProfit: false, // izin HPP dari server (bukan dari UI)
  categories: [],
  mgmt: { items: [], total: 0 }, // katalog di tab "Produk"
  activeTab: 'beranda',
  formPhoto: undefined, // perubahan foto pada modal produk (undefined = tak diubah)
  formPhotoCurrent: '', // foto tersimpan saat modal dibuka (untuk blok gambar otomatis)
};

const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

// Binding perangkat -> outlet (untuk layar pemilih login PIN).
const OUTLET_KEY = 'nova_kasir_outlet';

const debounce = (fn, delay = 300) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const describeError = (err) => {
  if (err instanceof ApiError && err.details?.fields?.length) {
    return err.details.fields.map((f) => `${f.path ? f.path + ': ' : ''}${f.message}`).join('; ');
  }
  return err?.message ?? 'Terjadi kesalahan';
};

const alertBox = (message, type = 'info') => {
  const el = $('alert');
  el.textContent = message;
  el.className = `alert ${type}`;
  show(el);
  if (type !== 'error') setTimeout(() => hide(el), 3500);
};

/** Bungkus aksi: bila sesi berakhir (401), kembali ke login. */
const guard = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      tokenStore.clear();
      clearReceipt();
      hide($('app-view'));
      show($('login-view'));
      return;
    }
    throw err;
  }
};

// ------------------------------------------------------------ Profil ---------
const renderProfile = () => {
  const { user, context } = state;
  if (!user) return;

  $('current-user').textContent = user.fullName;
  // Konteks pada bilah atas versi HP: "Kasir • <nama outlet>".
  $('brand-context').textContent = `${user.role === 'cashier' ? 'Kasir' : user.role} • ${
    context?.outlet?.name ?? 'Tanpa outlet'
  }`;
  $('profile-name').textContent = user.fullName;
  $('profile-email').textContent = user.email;
  $('profile-status').textContent = user.status === 'active' ? 'Aktif' : 'Nonaktif';
  $('profile-status').className = `badge ${user.status === 'active' ? 'ok' : 'off'}`;

  $('profile-outlet').textContent = context?.outlet?.name ?? '—';
  $('profile-business').textContent = context?.business?.name ?? '—';
  $('profile-currency').textContent = context?.business?.currency ?? '—';
  const rate = Number(context?.outlet?.tax_rate ?? 0);
  $('profile-tax').textContent =
    rate === 0
      ? '0%'
      : `${rate}% ${context.outlet.tax_inclusive ? '(sudah termasuk harga)' : '(ditambahkan)'}`;
};

const fetchCurrentUser = () =>
  guard(async () => {
    const { user, context } = await api.me();
    if (user.role !== 'cashier') {
      throw new ApiError('Sesi bukan kasir. Silakan masuk lewat panel yang benar.', 403);
    }
    state.user = user;
    state.context = context;
    // Ikat perangkat ke outlet agar layar login PIN tahu daftar kasir yang mana.
    if (context?.outlet?.id) localStorage.setItem(OUTLET_KEY, context.outlet.id);
    renderProfile();
    return user;
  });

// --------------------------------------------- Smart Product Image (FASE 2) --
// Modul dimuat oleh <script src="./src/product-image.js"> (sebelum app.js).
// Urutan prioritas gambar: foto unggahan -> pustaka internal (nama produk) ->
// gambar kategori -> placeholder. Lihat shared/product-image.js.
const PI = typeof window !== 'undefined' ? window.NovaProductImage : null;
if (!PI) console.warn('product-image.js tidak termuat: gambar produk otomatis nonaktif');

/** HTML <img> gambar produk (otomatis bila tidak ada foto unggahan). */
const productThumbHtml = (product, className) => {
  if (!PI) return '';
  try {
    return PI.renderThumb(product, { className, alt: product?.name ?? '' });
  } catch (err) {
    console.warn('gagal membuat gambar produk', err);
    return '';
  }
};

/** Perbarui blok "Gambar otomatis" pada form produk. */
const renderAutoPhoto = () => {
  const box = $('mprod-photo-auto');
  if (!box) return;
  if (!PI) {
    box.innerHTML = '';
    return;
  }

  // state.formPhoto: undefined = biarkan foto lama, '' = hapus, dataURL = baru.
  const manual = state.formPhoto !== undefined ? state.formPhoto : state.formPhotoCurrent;
  if (manual) {
    box.innerHTML = '<span class="muted small">Foto produk yang ada dipakai (unggahan menang atas gambar otomatis).</span>';
    return;
  }

  const catName = state.categories.find((c) => c.id === $('mprod-category').value)?.name ?? '';
  const saran = PI.suggestImage($('mprod-name').value, catName);
  const label =
    saran.source === 'library'
      ? 'Gambar otomatis sesuai nama produk'
      : saran.source === 'category'
        ? 'Gambar otomatis sesuai kategori'
        : 'Gambar bawaan (nama/kategori belum dikenali)';

  box.innerHTML =
    `<img src="${PI.escapeAttr(saran.src)}" alt="Gambar otomatis produk" />` +
    `<span class="muted small">${label}</span>`;
};

// ------------------------------------------------------------ Produk ---------
const renderProducts = () => {
  const grid = $('pos-products');
  grid.innerHTML = '';
  hide($('product-empty'));

  if (!state.products.length) {
    show($('product-empty'));
    return;
  }

  for (const p of state.products) {
    const out = Boolean(p.out_of_stock); // status HABIS ditentukan server
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `pos-product ${out ? 'out' : ''}`;
    card.dataset.id = p.id;
    card.disabled = out;
    card.innerHTML = `
      ${productThumbHtml(p, 'pos-photo')}
      <strong>${escapeHtml(p.name)}</strong>
      <span class="pos-product-price">${escapeHtml(fmtIDR(p.price))}</span>
      <span class="muted small">
        ${out ? 'HABIS' : p.track_stock ? `Stok ${Number(p.quantity ?? 0)}` : 'tanpa stok'}
      </span>`;
    grid.appendChild(card);
  }
};

const loadProducts = async () => {
  const body = await guard(() => api.products({ search: $('product-search').value.trim() }));
  if (!body) return;
  state.products = body.items;
  renderProducts();
};

$('product-search').addEventListener('input', debounce(() => loadProducts(), 300));

// ----------------------------------------------------------- Keranjang -------
const addToCart = (productId) => {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  const existing = state.cart.get(productId);
  if (existing) existing.qty += 1;
  else state.cart.set(productId, { product, qty: 1 });
  renderCart();
};

const setQty = (productId, delta) => {
  const entry = state.cart.get(productId);
  if (!entry) return;
  entry.qty += delta;
  if (entry.qty <= 0) state.cart.delete(productId);
  renderCart();
};

const removeFromCart = (productId) => {
  state.cart.delete(productId);
  renderCart();
};

/** Perkiraan total (UI). Perhitungan final tetap oleh server. */
const computeEstimate = () => {
  let subtotal = 0;
  for (const it of state.cart.values()) {
    subtotal += Number(it.product.price) * it.qty;
  }

  let discountTotal = 0;
  const rawDiscount = parseFloat($('discount-value').value);
  const discountType = $('discount-type').value;
  if (rawDiscount > 0) {
    discountTotal =
      discountType === 'percent'
        ? Math.round((subtotal * rawDiscount) / 100)
        : Math.round(rawDiscount * 100);
    if (discountTotal > subtotal) discountTotal = subtotal;
  }

  const discounted = subtotal - discountTotal;
  const rate = Number(state.context?.outlet?.tax_rate ?? 0);
  let taxTotal = 0;
  let total = discounted;
  if (rate > 0) {
    if (state.context.outlet.tax_inclusive) {
      taxTotal = Math.round((discounted * rate) / (100 + rate));
      total = discounted;
    } else {
      taxTotal = Math.round((discounted * rate) / 100);
      total = discounted + taxTotal;
    }
  }
  return { subtotal, discountTotal, taxTotal, total };
};

const renderCart = () => {
  invalidateDraft(); // keranjang berubah -> pratinjau lama tidak lagi cocok
  const list = $('cart-list');
  list.innerHTML = '';
  const hasItems = state.cart.size > 0;
  $('cart-empty').classList.toggle('hidden', hasItems);

  for (const [id, it] of state.cart) {
    const row = document.createElement('div');
    row.className = 'cart-row';
    row.innerHTML = `
      <div class="cart-info">
        <strong>${escapeHtml(it.product.name)}</strong>
        <span class="muted small">${escapeHtml(fmtIDR(it.product.price))} × ${it.qty}</span>
      </div>
      <div class="right">
        <span class="cart-line">${escapeHtml(fmtIDR(Number(it.product.price) * it.qty))}</span>
        <div class="cart-controls">
          <button type="button" class="btn small" data-action="dec" data-id="${id}">−</button>
          <span class="mono">${it.qty}</span>
          <button type="button" class="btn small" data-action="inc" data-id="${id}">+</button>
          <button type="button" class="btn small danger" data-action="remove" data-id="${id}">×</button>
        </div>
      </div>`;
    list.appendChild(row);
  }

  updateCalc();
};

const updateCalc = () => {
  // Form pembayaran/diskon berubah -> pratinjau lama tidak lagi mewakili form.
  invalidateDraft();
  const { subtotal, discountTotal, taxTotal, total } = computeEstimate();
  $('calc-subtotal').textContent = fmtIDR(subtotal);
  $('calc-discount').textContent = discountTotal > 0 ? `-${fmtIDR(discountTotal)}` : fmtIDR(0);
  $('calc-tax').textContent = fmtIDR(taxTotal);
  $('calc-total').textContent = fmtIDR(total);

  const method = $('payment-method').value;
  const paid = Math.round((parseFloat($('payment-amount').value) || 0) * 100);
  const change = method === 'cash' && paid >= total ? paid - total : 0;
  $('calc-change').textContent = change > 0 ? fmtIDR(change) : 'Rp 0';
};

['discount-type', 'discount-value', 'payment-method', 'payment-amount', 'sale-note'].forEach((id) =>
  $(id).addEventListener('input', updateCalc)
);

$('pos-products').addEventListener('click', (event) => {
  const card = event.target.closest('.pos-product');
  if (!card || card.disabled) return;
  addToCart(card.dataset.id);
});

$('cart-list').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'inc') {
    const it = state.cart.get(id);
    if (it) it.qty += 1;
    renderCart();
  } else if (action === 'dec') {
    setQty(id, -1);
  } else if (action === 'remove') {
    removeFromCart(id);
  }
});

// ----------------------------------------------------------- Checkout --------
const resetSaleForm = () => {
  state.cart.clear();
  $('discount-value').value = '';
  $('payment-amount').value = '';
  $('sale-note').value = '';
  hide($('checkout-error'));
  // Catatan: struk terakhir DIBIARKAN tampil (beserta tombol cetak) agar
  // kasir bisa mencetak ulang; renderReceiptView berikutnya yang menggantinya.
  renderCart();
};

/**
 * Status struk yang sedang tampil (FASE 3 — Smart Receipt Preview).
 *   - `receiptState`    : hasil `sale-flow.js` → `{ mode: 'draft' | 'final', ... }`.
 *   - `receiptSnapshot` : HTML struk + data yang DIBEKUKAN saat konfirmasi,
 *     dipakai untuk cetak & cetak ulang (tidak dihitung ulang dari state UI).
 */
let lastTx = null;
let receiptState = null;
let receiptSnapshot = null;
let thermalPrinted = false;

/** Transaksi terkonfirmasi yang sedang tampil (null saat pratinjau). */
const shownTransaction = () => receiptState?.transaction ?? null;

/**
 * Buang pratinjau yang sudah basi (keranjang/form berubah setelah pratinjau
 * dibuat). Struk FINAL tidak pernah dibuang oleh perubahan form.
 */
const invalidateDraft = () => {
  if (!isDraftState(receiptState)) return;
  receiptState = null;
  const el = $('receipt');
  el.querySelectorAll('.receipt-body').forEach((node) => node.remove());
  el.classList.remove('draft', 'final');
  hide(el);
};

/** Bangun objek transaksi TIRUAN untuk merender pratinjau struk. */
const buildDraftTransaction = (draft) => {
  const est = computeEstimate();
  const items = [...state.cart.values()].map((it) => ({
    product_name: it.product.name,
    qty: it.qty,
    unit_price: Number(it.product.price),
    line_total: Number(it.product.price) * it.qty,
  }));
  return draftToTransaction(draft, {
    items,
    totals: {
      subtotal: est.subtotal,
      discount_total: est.discountTotal,
      tax_total: est.taxTotal,
      tax_rate: Number(state.context?.outlet?.tax_rate ?? 0),
      total: est.total,
    },
  });
};

/** Tombol & gaya panel berbeda antara pratinjau (draft) dan struk final. */
const applyReceiptMode = (mode) => {
  const isDraft = mode === MODE_DRAFT;
  const isFinal = mode === MODE_FINAL;
  const el = $('receipt');
  el.classList.toggle('draft', isDraft);
  el.classList.toggle('final', isFinal);
  $('receipt-pay-row').classList.toggle('hidden', !isDraft);
  $('receipt-done-btn').classList.toggle('hidden', !isFinal);
  // CETAK hanya tersedia setelah pembayaran terkonfirmasi server.
  $('print-struk-btn').classList.toggle('hidden', !isFinal);
  $('print-struk-btn-80').classList.toggle('hidden', !isFinal);
  hide($('receipt-print-error'));
  updateThermalButton();
};

/**
 * Isi panel struk di layar.
 * @param {object} t detail transaksi (asli dari server atau tiruan pratinjau).
 * @param {'draft'|'final'} mode mode tampilan.
 */
const renderReceiptView = (t, mode) => {
  const el = $('receipt');
  el.querySelectorAll('.receipt-body').forEach((node) => node.remove());

  const rows = (t.items ?? [])
    .map(
      (it) => `
      <div class="cart-row">
        <div class="cart-info"><strong>${escapeHtml(it.product_name)}</strong>
          <span class="muted small">${escapeHtml(fmtIDR(it.unit_price))} × ${it.qty}</span></div>
        <span class="right mono">${escapeHtml(fmtIDR(it.line_total))}</span>
      </div>`
    )
    .join('');

  const method = t.payments?.[0]?.method ?? 'cash';
  const methodLabel = METHOD_LABELS[method] ?? '-';
  const statusLabel = paymentStatusLabel(t);
  const isDraft = mode === MODE_DRAFT;

  $('receipt-headline').textContent = isDraft
    ? 'Pratinjau struk (belum dibayar)'
    : statusLabel === 'LUNAS'
      ? 'Transaksi berhasil'
      : `Transaksi ${statusLabel.toLowerCase()}`;

  const note = $('receipt-note');
  if (isDraft) {
    note.textContent = `${DRAFT_LABEL}: ${DRAFT_NOTICE}`;
    show(note);
  } else {
    hide(note);
  }

  const info = document.createElement('div');
  info.className = 'receipt-body';
  info.innerHTML = `
    <p class="mono">${escapeHtml(t.invoice_no)}</p>
    ${rows}
    <dl class="meta">
      <div><dt>Subtotal</dt><dd>${escapeHtml(fmtIDR(t.subtotal))}</dd></div>
      <div><dt>Diskon</dt><dd>${escapeHtml(fmtIDR(t.discount_total))}</dd></div>
      <div><dt>Pajak</dt><dd>${escapeHtml(fmtIDR(t.tax_total))}</dd></div>
      <div><dt><strong>Total</strong></dt><dd class="strong">${escapeHtml(fmtIDR(t.total))}</dd></div>
      <div><dt>Pembayaran</dt><dd>${escapeHtml(methodLabel)}</dd></div>
      <div><dt>Status</dt><dd class="strong">${escapeHtml(statusLabel)}</dd></div>
      ${
        method === 'cash' && !isDraft && statusLabel === 'LUNAS'
          ? `<div><dt>Uang Diterima</dt><dd>${escapeHtml(fmtIDR(t.paid_amount))}</dd></div>
             <div><dt>Kembalian</dt><dd>${escapeHtml(fmtIDR(t.change_amount))}</dd></div>`
          : ''
      }
      ${
        method === 'cash' && isDraft
          ? `<div><dt>Rencana Bayar</dt><dd>${escapeHtml(fmtIDR(t.paid_amount))}</dd></div>
             <div><dt>Kembalian</dt><dd>${escapeHtml(fmtIDR(t.change_amount))}</dd></div>`
          : ''
      }
    </dl>
    <p class="muted small">${escapeHtml(fmtDate(t.created_at))}</p>`;
  el.appendChild(info);

  applyReceiptMode(mode);
  show(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

/** Buang struk/pratinjau (mis. saat keluar) agar tidak tampil di sesi lain. */
const clearReceipt = () => {
  lastTx = null;
  receiptState = null;
  receiptSnapshot = null;
  thermalPrinted = false;
  const el = $('receipt');
  el.querySelectorAll('.receipt-body').forEach((node) => node.remove());
  el.classList.remove('draft', 'final');
  $('receipt-headline').textContent = 'Transaksi berhasil';
  hide($('receipt-note'));
  hide($('receipt-print-error'));
  hide(el);
};

/** Batalkan pratinjau. Keranjang TIDAK diubah agar kasir bisa memperbaiki. */
const cancelPreview = () => {
  receiptState = null;
  const el = $('receipt');
  el.querySelectorAll('.receipt-body').forEach((node) => node.remove());
  el.classList.remove('draft', 'final');
  hide(el);
  alertBox('Pratinjau dibatalkan. Keranjang tidak diubah.', 'ok');
};

/** Tutup struk final -> siap untuk transaksi berikutnya. */
const finishReceipt = () => {
  clearReceipt();
  $('payment-amount').value = '';
  updateCalc();
};

/**
 * Atur ukuran kertas cetak (58mm/80mm) lewat stylesheet dinamis.
 * Elemen `<style>` di-append ke <head> sehingga berada SETELAH stylesheet utama
 * dan menang atas aturan `@page` default di styles.css.
 */
const setPrintPageSize = (width) => {
  let el = document.getElementById('print-page-size');
  if (!el) {
    el = document.createElement('style');
    el.id = 'print-page-size';
    document.head.appendChild(el);
  }
  el.textContent = strukPageCss(width);
};

/**
 * Cetak struk lewat dialog cetak browser — SELALU dari snapshot (FASE 3).
 *
 * Cetakan PERTAMA = HTML apa adanya; cetakan berikutnya memakai snapshot yang
 * sama + penanda "CETAK ULANG" (bukan menghitung ulang dari state UI).
 * @param {'58'|'80'} width lebar kertas (mm). Default 58.
 */
const printStruk = (width = '58') => {
  // Pratinjau TIDAK boleh dicetak: hanya transaksi terkonfirmasi server.
  if (!isPrintable(receiptState) || !hasSnapshot(receiptSnapshot)) {
    alertBox('Cetak tersedia setelah pembayaran dikonfirmasi.', 'error');
    return;
  }

  const w = String(width) === '80' ? '80' : '58';
  setPrintPageSize(w);
  $('print-struk').innerHTML = renderPrintHtml(receiptSnapshot);

  window.print();

  // Cetakan berikutnya dari snapshot yang sama = cetak ulang.
  receiptSnapshot = markReprint(receiptSnapshot);
  alertBox('Struk dikirim ke dialog cetak. Cek tombol cetak ulang bila perlu.', 'ok');
};

$('print-struk-btn').addEventListener('click', () => printStruk('58'));
const btnPrint80 = $('print-struk-btn-80');
if (btnPrint80) btnPrint80.addEventListener('click', () => printStruk('80'));

// ------------------------------------------------------- Printer thermal ----
// Cetak langsung ke printer Bluetooth (Classic SPP / BLE) di aplikasi Android.
// Di web biasa panel disembunyikan dan fungsi-fungsi ini tidak dipakai.
const printerState = { devices: [], connected: null, busy: false };

const setPrinterStatus = (text, kind = '') => {
  const el = $('printer-status');
  if (!el) return;
  el.textContent = text;
  el.className = `badge${kind ? ` ${kind}` : ''}`;
};

const updateThermalButton = () => {
  const btn = $('print-struk-thermal');
  if (!btn) return;
  // Hanya setelah transaksi TERKONFIRMASI (bukan pratinjau) & printer siap.
  const printable = isPrintable(receiptState);
  btn.classList.toggle('hidden', !(printable && printer.isNative() && printerState.connected));
};

const renderPrinterDevices = () => {
  const wrap = $('printer-devices');
  wrap.innerHTML = '';
  for (const d of printerState.devices) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'printer-device';
    row.dataset.address = d.address;
    row.dataset.transport = d.transport || 'spp';
    row.dataset.name = d.name || '';
    const kind = d.transport === 'ble' ? 'BLE' : 'Classic';
    row.innerHTML =
      `<span class="printer-device-name">${escapeHtml(d.name || d.address)}</span>` +
      `<span class="printer-device-meta">${escapeHtml(kind)} · ${escapeHtml(d.address)}</span>`;
    wrap.appendChild(row);
  }
};

const describePrinterError = (err) => err?.message ?? 'Terjadi kesalahan pada printer.';

const scanPrinters = async () => {
  if (printerState.busy) return;
  printerState.busy = true;
  const btn = $('printer-scan-btn');
  const hint = $('printer-hint');
  btn.disabled = true;
  hint.textContent = 'Meminta izin & memindai printer…';
  let bluetoothOff = false;
  try {
    await printer.requestPermissions();
    const avail = await printer.checkAvailability();
    bluetoothOff = avail.enabled === false;
    const [bonded, ble] = await Promise.all([
      printer.listBonded().catch(() => []),
      printer.scanBle({ timeoutMs: 8000 }).catch(() => []),
    ]);
    const map = new Map();
    for (const d of [
      ...bonded.map((x) => ({ ...x, transport: 'spp' })),
      ...ble.map((x) => ({ ...x, transport: 'ble' })),
    ]) {
      if (!d.address) continue;
      if (!map.has(d.address) || d.transport === 'spp') map.set(d.address, d);
    }
    printerState.devices = [...map.values()];
    renderPrinterDevices();
    if (bluetoothOff) {
      hint.textContent =
        'Bluetooth sedang mati. Aktifkan Bluetooth di pengaturan Android, lalu pindai lagi.';
    } else {
      hint.textContent = printerState.devices.length
        ? 'Pilih printer pada daftar di bawah untuk menyambungkan.'
        : 'Tidak ada printer ditemukan. Nyalakan printer & pasangkan (pair) dulu di pengaturan Bluetooth Android.';
    }
  } catch (err) {
    hint.textContent = describePrinterError(err);
  } finally {
    printerState.busy = false;
    btn.disabled = false;
  }
};

const connectPrinter = async (device) => {
  printerState.busy = true;
  const hint = $('printer-hint');
  hint.textContent = `Menyambungkan ke ${device.name || device.address}…`;
  try {
    const connected = await printer.connect(device);
    printerState.connected = device;
    setPrinterStatus(`Tersambung: ${connected.name || connected.address}`, 'ok');
    updateThermalButton();
    hint.textContent = 'Printer siap. Gunakan "Uji Cetak" untuk memastikan.';
  } catch (err) {
    printerState.connected = null;
    setPrinterStatus('Gagal menyambung', 'off');
    hint.textContent = describePrinterError(err);
    updateThermalButton();
  } finally {
    printerState.busy = false;
  }
};

const disconnectPrinter = async () => {
  await printer.disconnect();
  printerState.connected = null;
  setPrinterStatus('Belum tersambung', '');
  updateThermalButton();
  $('printer-hint').textContent = 'Printer diputuskan.';
};

const sendThermal = async (transaction, { silent = false, reprint = false } = {}) => {
  const t = transaction ?? receiptSnapshot?.transaction ?? lastTx;
  if (!t) {
    if (!silent) alertBox('Belum ada transaksi untuk dicetak.', 'error');
    return;
  }
  if (!printerState.connected) {
    if (!silent) alertBox('Printer belum tersambung.', 'error');
    return;
  }
  const bytes = buildStrukEscPos({
    transaction: t,
    context: state.context ?? {},
    cashier: state.user?.fullName,
    width: printer.getSettings().width,
    reprint,
  });
  await printer.printBytes(bytes);
};

/**
 * Cetak thermal dari STRUCT yang tampil (setelah konfirmasi). Kegagalan printer
 * TIDAK membatalkan transaksi — hanya menampilkan catatan yang tidak memblokir.
 */
const printReceiptThermal = async ({ silent = false } = {}) => {
  if (!isPrintable(receiptState)) {
    if (!silent) alertBox('Cetak thermal tersedia setelah pembayaran dikonfirmasi.', 'error');
    return;
  }
  if (!printerState.connected) {
    // Belum tersambung ≠ gagal cetak; jangan tandai sudah pernah dicetak.
    if (!silent) alertBox('Printer belum tersambung.', 'error');
    return;
  }
  const errEl = $('receipt-print-error');
  try {
    await sendThermal(receiptSnapshot?.transaction ?? shownTransaction(), {
      silent,
      reprint: thermalPrinted,
    });
    thermalPrinted = true;
    hide(errEl);
  } catch (err) {
    const msg = describePrinterError(err);
    // Transaksi tetap final & tetap bisa dicetak ulang (lihat sale-flow.js).
    receiptState = afterPrintFailure(receiptState, msg);
    errEl.textContent = `Cetak gagal: ${msg} Transaksi tetap tersimpan — tekan cetak lagi.`;
    show(errEl);
    if (!silent) alertBox(`Cetak gagal: ${msg}`, 'error');
  }
};

const testPrint = async () => {
  const hint = $('printer-hint');
  if (!printerState.connected) {
    hint.textContent = 'Sambungkan printer terlebih dahulu.';
    return;
  }
  try {
    await printer.printBytes(
      buildTestEscPos({ context: state.context ?? {}, width: printer.getSettings().width })
    );
    hint.textContent = 'Uji cetak terkirim ke printer.';
  } catch (err) {
    hint.textContent = describePrinterError(err);
  }
};

const initPrinter = async () => {
  const native = printer.isNative();
  $('printer-web-note').classList.toggle('hidden', native);
  $('printer-panel').classList.toggle('hidden', !native);
  updateThermalButton();
  if (!native) {
    setPrinterStatus('Hanya di aplikasi Android', '');
    return;
  }
  const settings = printer.getSettings();
  $('printer-width').value = settings.width;
  $('printer-autoprint').checked = Boolean(settings.autoPrint);
  const avail = await printer.checkAvailability();
  if (avail.enabled === false) {
    setPrinterStatus('Bluetooth mati', 'off');
    $('printer-hint').textContent =
      'Aktifkan Bluetooth di pengaturan Android, lalu tekan "Pindai & Hubungkan".';
    return;
  }
  const saved = printer.getSavedDevice();
  const st = await printer.connectionStatus();
  if (st?.connected && saved) {
    printerState.connected = saved;
    setPrinterStatus(`Tersambung: ${st.name || saved.name || saved.address}`, 'ok');
  } else {
    setPrinterStatus('Belum tersambung', '');
    $('printer-hint').textContent =
      'Tekan "Pindai & Hubungkan" untuk mencari printer Bluetooth.';
  }
  updateThermalButton();
};

$('printer-scan-btn').addEventListener('click', scanPrinters);
$('printer-disconnect-btn').addEventListener('click', () => {
  disconnectPrinter().catch((err) => alertBox(describePrinterError(err), 'error'));
});
$('printer-test-btn').addEventListener('click', testPrint);
$('printer-devices').addEventListener('click', (event) => {
  const row = event.target.closest('.printer-device');
  if (!row) return;
  connectPrinter({
    address: row.dataset.address,
    transport: row.dataset.transport,
    name: row.dataset.name,
  }).catch((err) => alertBox(describePrinterError(err), 'error'));
});
$('printer-width').addEventListener('change', () => {
  printer.saveSettings({ width: $('printer-width').value });
});
$('printer-autoprint').addEventListener('change', () => {
  printer.saveSettings({ autoPrint: $('printer-autoprint').checked });
});
$('print-struk-thermal').addEventListener('click', () => {
  printReceiptThermal().catch((err) => alertBox(describePrinterError(err), 'error'));
});

/**
 * Ambil nilai form pembayaran saat ini (dipakai pratinjau & konfirmasi).
 * Nominal dalam SEN; perhitungan FINAL tetap milik server.
 */
const readSaleForm = () => {
  const rawDiscount = parseFloat($('discount-value').value);
  const discountType = $('discount-type').value;
  const method = $('payment-method').value;
  const amount = Math.round((parseFloat($('payment-amount').value) || 0) * 100);
  let discount = null;
  if (rawDiscount > 0) {
    discount = {
      type: discountType,
      value: discountType === 'percent' ? rawDiscount : Math.round(rawDiscount * 100),
    };
  }
  return { method, amount, discount, note: $('sale-note').value.trim() };
};

/**
 * LANGKAH 1 — tampilkan pratinjau struk berstatus BELUM DIBAYAR.
 * Belum ada permintaan tulis ke server; keranjang & total belum diubah.
 */
const openPreview = () => {
  hide($('checkout-error'));
  const { total } = computeEstimate();
  const form = readSaleForm();
  const items = [...state.cart.values()].map((it) => ({ productId: it.product.id, qty: it.qty }));

  const check = validateSale({ items, method: form.method, amount: form.amount, total });
  if (!check.ok) {
    const el = $('checkout-error');
    el.textContent = check.error;
    show(el);
    return;
  }

  // clientRef dibuat SEKALI di sini dan dipakai ulang saat konfirmasi sehingga
  // percobaan ulang tidak pernah membuat transaksi ganda (idempoten server).
  const draft = createDraft({
    items,
    method: form.method,
    amount: form.amount,
    discount: form.discount,
    note: form.note,
    context: state.context,
    cashier: state.user?.fullName ?? '',
  });
  receiptState = draft;
  renderReceiptView(buildDraftTransaction(draft), MODE_DRAFT);
};

/**
 * Tampilkan struk FINAL (dari konfirmasi server atau dari riwayat) dan bekukan
 * snapshot HTML-nya sebagai dasar semua cetak/cetak ulang.
 */
const showFinalReceipt = (transaction, { idempotent = false } = {}) => {
  const context = state.context ?? {};
  const cashier = state.user?.fullName ?? '';
  lastTx = transaction;
  receiptState = confirmDraft(isDraftState(receiptState) ? receiptState : null, transaction, {
    at: transaction.created_at,
  });
  receiptState.idempotent = Boolean(idempotent);
  thermalPrinted = false;
  receiptSnapshot = createSnapshot({
    transaction,
    context,
    cashier,
    html: buildStrukHtml({ transaction, context, cashier }),
    width: printer.getSettings().width,
    at: transaction.created_at,
  });
  renderReceiptView(transaction, MODE_FINAL);
};

/**
 * LANGKAH 2 — konfirmasi: catat transaksi ke server, lalu tampilkan struk FINAL.
 * Status LUNAS hanya muncul dari respons server. Kegagalan cetak printer tidak
 * membatalkan transaksi (lihat `printReceiptThermal`).
 */
const confirmPayment = async () => {
  if (!isDraftState(receiptState)) return;
  const draft = receiptState;
  const btn = $('receipt-pay-btn');
  const hint = $('checkout-error');
  btn.disabled = true;
  btn.textContent = 'Memproses…';
  hide(hint);
  try {
    const res = await guard(() => api.createTransaction(buildSalePayload(draft)));
    // `guard()` mengembalikan undefined saat sesi berakhir (401) — keluar saja.
    if (!res?.transaction) return;
    const { transaction, idempotent } = res;

    showFinalReceipt(transaction, { idempotent });
    alertBox(
      idempotent
        ? `Transaksi ${transaction.invoice_no} sudah tercatat sebelumnya (tidak dibuat ganda).`
        : `Transaksi ${transaction.invoice_no} berhasil — pembayaran terkonfirmasi.`,
      'ok'
    );

    resetSaleForm();
    await loadProducts();
    await loadHistory();

    if (printer.getSettings().autoPrint && printerState.connected) {
      // Cetak otomatis bersifat opsional; gagal cetak tidak membatalkan apa pun.
      await printReceiptThermal({ silent: true });
    }
  } catch (err) {
    hint.textContent = describeError(err);
    show(hint);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Bayar Sekarang';
  }
};

$('checkout-btn').addEventListener('click', openPreview);
$('receipt-pay-btn').addEventListener('click', () => {
  confirmPayment().catch((err) => alertBox(describeError(err), 'error'));
});
$('receipt-cancel-btn').addEventListener('click', cancelPreview);
$('receipt-done-btn').addEventListener('click', finishReceipt);

// ----------------------------------------------------------- Riwayat ---------
const loadHistory = async () => {
  const body = await guard(() => api.transactions({ limit: 10 }));
  if (!body) return;
  const list = $('history-list');
  list.innerHTML = '';
  hide($('history-empty'));

  if (!body.items.length) {
    show($('history-empty'));
    return;
  }

  for (const t of body.items) {
    const row = document.createElement('div');
    row.className = 'tx-row';
    row.innerHTML = `
      <div>
        <div class="mono">${escapeHtml(t.invoice_no)}</div>
        <span class="muted small">${escapeHtml(fmtDate(t.created_at))} • ${escapeHtml(fmtIDR(t.total))}</span>
      </div>
      <div class="right">
        <span class="badge ${t.status === 'completed' ? 'ok' : 'off'}">${escapeHtml(t.status === 'completed' ? 'selesai' : t.status)}</span>
        <button type="button" class="btn small" data-action="detail" data-id="${t.id}">Detail</button>
      </div>`;
    list.appendChild(row);
  }
};

$('history-list').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action="detail"]');
  if (!btn) return;
  try {
    const { transaction } = await guard(() => api.transaction(btn.dataset.id));
    if (transaction) showFinalReceipt(transaction);
  } catch (err) {
    alertBox(describeError(err), 'error');
  }
});

// ---------------------------------------------------------------- Login -----
/** Masuk ke aplikasi setelah sesi didapat (email/password atau PIN). */
const enterApp = async () => {
  await fetchCurrentUser();
  hide($('login-view'));
  show($('app-view'));
  await initPrinter().catch(() => {});
  await loadCashierInfo();
  await loadProducts();
  await loadHistory();
  switchTab(state.activeTab || 'beranda');
};

/** Muat kartu kasir ber-PIN untuk outlet yang terikat perangkat ini. */
const loadPinCashiers = async () => {
  const outletId = localStorage.getItem(OUTLET_KEY);
  const select = $('pin-cashier-select');
  const hint = $('pin-hint');
  select.innerHTML = '';
  hide($('pin-error'));
  if (!outletId) {
    hint.textContent =
      'Perangkat belum terikat outlet. Login sekali dengan email/password agar PIN tersedia.';
    show(hint);
    return;
  }
  try {
    const items = await listPinCashiers(outletId);
    if (!items.length) {
      hint.textContent = 'Belum ada kasir ber-PIN di outlet perangkat ini.';
      show(hint);
      return;
    }
    hide(hint);
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.full_name;
      select.appendChild(opt);
    }
  } catch (err) {
    hint.textContent = describeError(err);
    show(hint);
  }
};

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('login-error'));
  const button = event.submitter ?? $('login-form').querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await login($('login-email').value.trim(), $('login-password').value);
    $('login-password').value = '';
    await enterApp();
  } catch (err) {
    const el = $('login-error');
    el.textContent = describeError(err);
    show(el);
  } finally {
    button.disabled = false;
  }
});

$('show-pin').addEventListener('click', () => {
  hide($('login-error'));
  hide($('login-form'));
  show($('pin-form'));
  loadPinCashiers();
  $('pin-code').focus();
});

$('show-email').addEventListener('click', () => {
  hide($('pin-error'));
  hide($('pin-form'));
  show($('login-form'));
  $('login-email').focus();
});

$('pin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('pin-error'));
  const button = event.submitter ?? $('pin-form').querySelector('button[type=submit]');
  button.disabled = true;
  const pin = $('pin-code').value.trim();
  if (!/^\d{4}$/.test(pin)) {
    const el = $('pin-error');
    el.textContent = 'PIN harus 4 digit angka.';
    show(el);
    button.disabled = false;
    return;
  }
  try {
    await loginWithPin($('pin-cashier-select').value, pin);
    $('pin-code').value = '';
    await enterApp();
  } catch (err) {
    const el = $('pin-error');
    el.textContent = describeError(err);
    show(el);
  } finally {
    button.disabled = false;
  }
});

$('logout-btn').addEventListener('click', async () => {
  await logout();
  clearReceipt();
  hide($('app-view'));
  show($('login-view'));
});

$('refresh-btn').addEventListener('click', async () => {
  await fetchCurrentUser();
  await loadCashierInfo();
  await loadProducts();
  await loadHistory();
  if (state.activeTab === 'beranda') await loadHome();
  if (state.activeTab === 'produk') await loadMgmtProducts();
  if (state.activeTab === 'pendapatan') await loadDaily();
  if (state.activeTab === 'pengeluaran') await loadExpenses();
  if (state.activeTab === 'stok') await loadMovements();
  alertBox('Data dimuat ulang.');
});

$('history-refresh-btn').addEventListener('click', loadHistory);

// ------------------- Bootstrap dengan pemulihan sesi (persistent login) ------
/**
 * AKAR BUG LAMA: blok ini hanya memeriksa ACCESS token di `sessionStorage`.
 * `sessionStorage` selalu kosong setelah aplikasi/tab ditutup, sehingga kasir
 * SELALU dipaksa login ulang walaupun REFRESH token di `localStorage` masih
 * valid (terutama di APK Android).
 *
 * Perbaikan: bila ada sesi tersimpan apa pun (access ATAU refresh), pulihkan
 * lewat `restoreSession()` (otomatis memakai refresh token) sebelum memutuskan
 * layar mana yang ditampilkan.
 */
const boot = async () => {
  if (tokenStore.hasSession) {
    try {
      const body = await restoreSession();
      const user = body?.user ?? null;
      if (user && user.role === 'cashier') {
        state.user = user;
        state.context = body.context ?? null;
        // Ikat perangkat ke outlet agar layar login PIN tahu daftar kasir.
        if (state.context?.outlet?.id) {
          localStorage.setItem(OUTLET_KEY, state.context.outlet.id);
        }
        renderProfile();
        hide($('login-view'));
        show($('app-view'));
        await initPrinter().catch(() => {});
        await loadCashierInfo();
        await loadProducts();
        await loadHistory();
        switchTab(state.activeTab || 'kasir');
        return;
      }
      // Sesi milik peran lain: jangan dipakai di panel Kasir.
      tokenStore.clear();
    } catch {
      // Gangguan jaringan: token TIDAK dihapus; pengguna bisa mencoba lagi
      // tanpa kehilangan sesi.
    }
  }
  show($('login-view'));
  // Tawarkan masuk cepat via PIN bila perangkat sudah pernah terikat outlet.
  if (localStorage.getItem(OUTLET_KEY)) {
    hide($('login-form'));
    show($('pin-form'));
    loadPinCashiers();
  }
};

// Saat aplikasi kembali aktif (dari background), perbarui sesi diam-diam.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tokenStore.hasSession) {
    restoreSession().catch(() => {});
  }
});

boot();

// ============================================================================
// V0.3 — Tab, manajemen produk, laporan harian, pengeluaran, riwayat stok.
// Seluruh keputusan bisnis (HPP, HABIS, laba) ditegakkan SERVER; UI hanya
// menyesuaikan tampilan berdasarkan izin yang dikirim server.
// ============================================================================

const TABS = ['beranda', 'kasir', 'produk', 'pendapatan', 'pengeluaran', 'stok', 'lainnya'];

const CATEGORY_LABELS = {
  operational: 'Operasional',
  utilities: 'Utilitas',
  supplies: 'Perlengkapan',
  transport: 'Transport',
  maintenance: 'Pemeliharaan',
  inventory_purchase: 'Beli Persediaan',
  other: 'Lain-lain',
};

const EXPENSE_METHOD_LABELS = { cash: 'Tunai', transfer: 'Transfer', qr: 'QRIS' };

const MOVEMENT_LABELS = {
  initial: 'Stok awal',
  adjustment: 'Penyesuaian',
  sale: 'Penjualan',
  void: 'Void penjualan',
  refund: 'Refund',
  mark_out: 'Tandai HABIS',
  restore: 'Aktifkan kembali',
};

const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: state.context?.business?.timezone || 'Asia/Jakarta',
  }).format(new Date());

const rpToSen = (value) => Math.round((Number(value) || 0) * 100);
const senToRpInput = (sen) => (sen == null ? '' : String(Number(sen) / 100));

/** Info outlet + izin server (`can_view_profit`). */
const loadCashierInfo = async () => {
  try {
    const info = await api.info();
    state.canViewProfit = Boolean(info?.permissions?.can_view_profit);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
    state.canViewProfit = false; // gagal memuat izin -> sembunyikan HPP (aman)
  }
};

// ---------------------------------------------------------------- Tab ------
/** Judul & subjudul halaman tiap pane (judul mengikuti referensi desain V2). */
const PAGE_INFO = {
  beranda: ['Beranda', 'Ringkasan penjualan outlet Anda'],
  kasir: ['Transaksi', 'Pilih produk, lalu konfirmasi pembayaran ke server'],
  produk: ['Katalog Produk', 'Cari produk, atur stok, dan tambah produk outlet'],
  pendapatan: ['Laporan', 'Ringkasan pendapatan, metode bayar, dan laba outlet'],
  pengeluaran: ['Pengeluaran', 'Catat & telusuri pengeluaran outlet'],
  stok: ['Riwayat Stok', 'Catatan pergerakan stok (append-only)'],
  lainnya: ['Lainnya', 'Pengeluaran, riwayat stok, printer, dan akun kasir'],
};

/** Butir bilah navigasi bawah (HP). Pane lain diwakili butir "Lainnya". */
const BOTTOM_NAV = ['beranda', 'produk', 'kasir', 'pendapatan', 'lainnya'];
const bottomNavKey = (tab) => (BOTTOM_NAV.includes(tab) ? tab : 'lainnya');

const switchTab = (tab) => {
  if (!TABS.includes(tab)) tab = 'beranda';
  state.activeTab = tab;
  for (const el of document.querySelectorAll('[data-pane]')) {
    el.classList.toggle('hidden', el.dataset.pane !== tab);
  }
  for (const btn of document.querySelectorAll('#main-tabs .tab')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }
  for (const btn of document.querySelectorAll('#bottom-nav .bn-item')) {
    btn.classList.toggle('active', btn.dataset.tab === bottomNavKey(tab));
  }
  const [title, subtitle] = PAGE_INFO[tab] ?? PAGE_INFO.beranda;
  $('page-title').textContent = title;
  $('page-subtitle').textContent = subtitle;
  // Struk terakhir hanya relevan di tab Kasir.
  if (tab === 'kasir') $('receipt').classList.toggle('hidden', !receiptState);
  else $('receipt').classList.add('hidden');

  if (tab === 'beranda') loadHome();
  else if (tab === 'produk') loadMgmtProducts();
  else if (tab === 'pendapatan') loadDaily();
  else if (tab === 'pengeluaran') loadExpenses();
  else if (tab === 'stok') loadMovements();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Satu penanganan untuk semua navigasi: tab desktop, bilah bawah HP, dan
// pintasan di Beranda / menu Lainnya (semuanya memakai `data-tab`).
document.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-tab]');
  if (btn) switchTab(btn.dataset.tab);
});

// --------------------------------------------- Pengecilan foto di klien ----
const MAX_PHOTO_CHARS = 380_000;

const compressImage = (file, maxDim, quality) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca berkas'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Berkas bukan gambar yang valid'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

/** JPEG data URL < ~280 KB agar aman terhadap batas body server. */
const fileToCompressedDataUrl = async (file) => {
  let last = '';
  for (const [dim, q] of [[640, 0.82], [512, 0.78], [384, 0.7], [256, 0.6], [160, 0.5]]) {
    last = await compressImage(file, dim, q);
    if (last.length <= MAX_PHOTO_CHARS) return last;
  }
  throw new Error('Foto terlalu besar, mohon pilih gambar lain');
};

// ------------------------------------------------------ Manajemen produk --
const fillMgmtCategories = (selected = '') => {
  const sel = $('mprod-category');
  sel.innerHTML = '<option value="">— tanpa kategori —</option>';
  for (const c of state.categories) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  sel.value = selected ?? '';
};

const renderMgmtProducts = () => {
  const list = $('mprod-list');
  list.innerHTML = '';
  const items = state.mgmt.items;
  $('mprod-empty').classList.toggle('hidden', items.length > 0);

  for (const p of items) {
    const card = document.createElement('div');
    card.className = 'product-card';
    const cost =
      state.canViewProfit && p.cost_price != null
        ? `<span class="muted small">HPP ${escapeHtml(fmtIDR(p.cost_price))}</span> • `
        : '';
    const avail = p.out_of_stock
      ? '<span class="badge off">HABIS</span>'
      : '<span class="badge ok">Tersedia</span>';
    card.innerHTML = `
      <div class="product-head">
        ${productThumbHtml(p, 'product-thumb')}
        <div class="product-main">
          <strong>${escapeHtml(p.name)}</strong>
          <p class="muted small">
            ${p.category_name ? escapeHtml(p.category_name) : 'Tanpa kategori'}
            ${p.sku ? ' • SKU ' + escapeHtml(p.sku) : ''}
            ${p.unit ? ' • ' + escapeHtml(p.unit) : ''}
          </p>
        </div>
        <div class="right">
          <div class="product-price">${escapeHtml(fmtIDR(p.price))}</div>
          ${avail}
        </div>
      </div>
      <div class="outlet-meta muted small">
        ${cost}${p.track_stock ? `Stok ${Number(p.quantity ?? 0)}` : 'Tanpa pelacakan stok'}
      </div>
      <div class="detail-actions">
        <button class="btn small" data-action="edit" data-id="${p.id}">Ubah</button>
        ${
          p.track_stock
            ? `<button class="btn small" data-action="stock" data-id="${p.id}">Atur stok</button>`
            : ''
        }
        <button class="btn small" data-action="toggle-oos" data-id="${p.id}" data-oos="${p.out_of_stock}">
          ${p.out_of_stock ? 'Aktifkan kembali' : 'Tandai HABIS'}
        </button>
      </div>`;
    list.appendChild(card);
  }
};

const loadMgmtProducts = async () => {
  const body = await guard(() =>
    api.products({
      search: $('mprod-search').value.trim(),
      availability: $('mprod-availability').value || 'all',
      sort: $('mprod-sort').value || 'name',
      limit: 100,
    })
  );
  if (!body) return;
  state.mgmt.items = body.items ?? [];
  const cats = await guard(() => api.categories());
  if (cats) state.categories = cats.items ?? [];
  renderMgmtProducts();
};

const openMgmtCreate = () => {
  state.formPhoto = undefined;
  state.formPhotoCurrent = '';
  $('mprod-form').reset();
  $('mprod-id').value = '';
  $('mprod-modal-title').textContent = 'Produk Baru';
  $('mprod-track').checked = true;
  $('mprod-cost-field').classList.toggle('hidden', !state.canViewProfit);
  $('mprod-initial-field').classList.remove('hidden');
  $('mprod-status-field').classList.add('hidden');
  $('mprod-oos-field').classList.add('hidden');
  $('mprod-photo-clear-field').classList.add('hidden');
  $('mprod-photo-clear').checked = false;
  $('mprod-photo-preview').innerHTML = '';
  fillMgmtCategories('');
  hide($('mprod-error'));
  show($('mprod-modal'));
  renderAutoPhoto();
  $('mprod-name').focus();
};

const openMgmtEdit = (p) => {
  state.formPhoto = undefined;
  state.formPhotoCurrent = p.photo_url ?? '';
  $('mprod-id').value = p.id;
  $('mprod-modal-title').textContent = 'Ubah Produk';
  $('mprod-name').value = p.name ?? '';
  $('mprod-price').value = senToRpInput(p.price);
  $('mprod-cost').value = state.canViewProfit ? senToRpInput(p.cost_price) : '';
  $('mprod-cost-field').classList.toggle('hidden', !state.canViewProfit);
  $('mprod-unit').value = p.unit ?? '';
  $('mprod-sku').value = p.sku ?? '';
  $('mprod-barcode').value = p.barcode ?? '';
  $('mprod-track').checked = !!p.track_stock;
  $('mprod-initial-field').classList.add('hidden');
  $('mprod-status-field').classList.add('hidden');
  $('mprod-oos-field').classList.toggle('hidden', !p.track_stock);
  $('mprod-oos').checked = !!p.manual_out_of_stock;
  $('mprod-photo-clear-field').classList.toggle('hidden', !p.photo_url);
  $('mprod-photo-clear').checked = false;
  $('mprod-photo-preview').innerHTML = p.photo_url
    ? `<img src="${escapeHtml(p.photo_url)}" alt="Foto produk" />`
    : '';
  fillMgmtCategories(p.category_id ?? '');
  hide($('mprod-error'));
  show($('mprod-modal'));
  renderAutoPhoto();
};

$('mprod-new-btn').addEventListener('click', openMgmtCreate);
$('mprod-refresh-btn').addEventListener('click', () => loadMgmtProducts());
$('mprod-search').addEventListener('input', debounce(() => loadMgmtProducts(), 300));
$('mprod-availability').addEventListener('change', () => loadMgmtProducts());
$('mprod-sort').addEventListener('change', () => loadMgmtProducts());

$('mprod-photo').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await fileToCompressedDataUrl(file);
    state.formPhoto = dataUrl;
    $('mprod-photo-clear').checked = false;
    $('mprod-photo-preview').innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="Pratinjau" />`;
    renderAutoPhoto();
  } catch (err) {
    event.target.value = '';
    alertBox(describeError(err), 'error');
  }
});

$('mprod-photo-clear').addEventListener('change', (event) => {
  if (event.target.checked) {
    state.formPhoto = '';
    $('mprod-photo-preview').innerHTML = '';
  }
  renderAutoPhoto();
});

// Gambar otomatis: perbarui saran saat nama atau kategori diubah.
$('mprod-name').addEventListener('input', renderAutoPhoto);
$('mprod-category').addEventListener('change', renderAutoPhoto);

const closeMgmtModal = () => hide($('mprod-modal'));
$('mprod-cancel').addEventListener('click', closeMgmtModal);
$('mprod-modal').addEventListener('click', (event) => {
  if (event.target === $('mprod-modal')) closeMgmtModal();
});

$('mprod-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('mprod-error'));

  const id = $('mprod-id').value;
  const submitBtn = $('mprod-submit');
  const formError = $('mprod-error');
  const fail = (message) => {
    formError.textContent = message;
    show(formError);
  };

  // ---- Validasi klien: pesan jelas; data form TIDAK dihapus bila gagal ----
  const name = $('mprod-name').value.trim();
  if (!name) return fail('Nama produk wajib diisi.');

  const priceRp = Number($('mprod-price').value || 0);
  if (!Number.isFinite(priceRp) || priceRp < 0) {
    return fail('Harga jual harus berupa angka dan tidak boleh negatif.');
  }

  const trackStock = $('mprod-track').checked;
  const initialRaw = $('mprod-initial').value.trim();
  const initialStock = trackStock && initialRaw !== '' ? Number(initialRaw) : null;
  if (!id && initialStock !== null && (!Number.isInteger(initialStock) || initialStock < 0)) {
    return fail('Stok awal harus bilangan bulat ≥ 0.');
  }

  const payload = {
    name,
    price: rpToSen($('mprod-price').value),
    unit: $('mprod-unit').value.trim() || null,
    sku: $('mprod-sku').value.trim() || null,
    barcode: $('mprod-barcode').value.trim() || null,
    categoryId: $('mprod-category').value || null,
    trackStock,
  };
  if (state.canViewProfit && !$('mprod-cost-field').classList.contains('hidden')) {
    payload.costPrice = rpToSen($('mprod-cost').value);
  }
  if (state.formPhoto !== undefined) payload.photoUrl = state.formPhoto;

  if (id) {
    payload.manualOutOfStock = trackStock ? $('mprod-oos').checked : false;
  } else if (initialStock !== null) {
    payload.initialStock = initialStock;
  }

  // ---- Kirim: cegah klik ganda + tampilkan status "Menyimpan…" ----
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Menyimpan…';
  try {
    const result = id
      ? await guard(() => api.updateProduct(id, payload))
      : await guard(() => api.createProduct(payload));

    // `guard()` mengembalikan undefined saat sesi berakhir (401).
    if (!result) return;

    alertBox(id ? 'Produk diperbarui.' : 'Produk berhasil disimpan.', 'ok');
    closeMgmtModal();
    await loadMgmtProducts();
    await loadProducts();
  } catch (err) {
    // Gagal: form tetap terisi agar pengguna dapat memperbaiki & mencoba lagi.
    fail(describeError(err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

$('mprod-list').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  const product = state.mgmt.items.find((p) => p.id === id);
  if (!product) return;

  if (action === 'edit') {
    openMgmtEdit(product);
  } else if (action === 'stock') {
    openStockModal(product);
  } else if (action === 'toggle-oos') {
    const next = btn.dataset.oos !== 'true';
    (async () => {
      try {
        await guard(() => api.setStockStatus(id, next));
        alertBox(next ? 'Produk ditandai HABIS.' : 'Produk diaktifkan kembali.', 'ok');
        await loadMgmtProducts();
        await loadProducts();
      } catch (err) {
        alertBox(describeError(err), 'error');
      }
    })();
  }
});

// ---------- Modal stok (satu outlet: outlet kasir) ----------
let stockProduct = null;

const openStockModal = (product) => {
  stockProduct = product;
  $('cstock-product').textContent = product.name ?? '';
  $('cstock-qty').value = product.quantity != null ? Number(product.quantity) : 0;
  $('cstock-reason').value = '';
  hide($('cstock-error'));
  show($('cstock-modal'));
  $('cstock-qty').focus();
};

$('cstock-cancel').addEventListener('click', () => hide($('cstock-modal')));
$('cstock-modal').addEventListener('click', (event) => {
  if (event.target === $('cstock-modal')) hide($('cstock-modal'));
});

$('cstock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!stockProduct) return;
  const err = $('cstock-error');
  hide(err);
  const qty = Number($('cstock-qty').value);
  if (!Number.isInteger(qty) || qty < 0) {
    err.textContent = 'Stok harus bilangan bulat >= 0.';
    show(err);
    return;
  }
  try {
    await guard(() => api.setStock(stockProduct.id, qty, $('cstock-reason').value.trim()));
    alertBox('Stok disimpan.', 'ok');
    hide($('cstock-modal'));
    await loadMgmtProducts();
    await loadProducts();
  } catch (e) {
    err.textContent = describeError(e);
    show(err);
  }
});

// -------------------------------------------------------- Laporan harian --
const dailyQuery = () => {
  const range = $('fin-range').value;
  if (range === 'custom') return { date: $('fin-date').value || todayIso() };
  return { period: range };
};

const renderDaily = (data) => {
  const income = data.income ?? {};
  const tx = data.transactions ?? {};
  const exp = data.expenses ?? {};
  const allowProfit = Boolean(data.can_view_profit);

  const cards = [
    {
      label: 'Total pendapatan',
      value: fmtIDR(income.total ?? 0),
      sub: `${tx.completed ?? 0} transaksi`,
    },
    { label: 'Tunai', value: fmtIDR(income.cash ?? 0) },
    { label: 'QRIS', value: fmtIDR(income.qris ?? 0) },
    { label: 'Item terjual', value: String(tx.items_sold ?? 0) },
    { label: 'Pengeluaran operasional', value: fmtIDR(exp.operating_total ?? 0) },
  ];
  if (allowProfit) {
    cards.push({ label: 'HPP terjual', value: fmtIDR(data.hpp ?? 0) });
    cards.push({ label: 'Laba kotor', value: fmtIDR(data.gross_profit ?? 0) });
    cards.push({ label: 'Laba bersih', value: fmtIDR(data.net_profit ?? 0) });
  }

  $('fin-summary').innerHTML = cards
    .map(
      (c) => `
      <div class="card stat">
        <span class="stat-label">${escapeHtml(c.label)}</span>
        <strong class="stat-value">${escapeHtml(c.value)}</strong>
        ${c.sub ? `<span class="muted small">${escapeHtml(c.sub)}</span>` : ''}
      </div>`
    )
    .join('');

  const range = data.period ?? {};
  $('fin-range-label').textContent =
    range.from && range.to
      ? `Periode: ${range.from}${range.to !== range.from ? ` s.d. ${range.to}` : ''}`
      : '';

  const methods = data.payment_methods ?? [];
  const body = $('fin-methods');
  body.innerHTML = '';
  $('fin-methods-empty').classList.toggle('hidden', methods.length > 0);
  for (const m of methods) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(METHOD_LABELS[m.method] ?? m.method)}</td>
      <td class="right">${m.transactions ?? 0}</td>
      <td class="right strong">${escapeHtml(fmtIDR(m.total ?? 0))}</td>
      <td class="right">${escapeHtml(fmtIDR(m.fees ?? 0))}</td>`;
    body.appendChild(tr);
  }
};

const loadDaily = async () => {
  const data = await guard(() => api.daily(dailyQuery()));
  if (!data) return;
  renderDaily(data);
};

$('fin-refresh-btn').addEventListener('click', loadDaily);
$('fin-range').addEventListener('change', () => {
  const custom = $('fin-range').value === 'custom';
  $('fin-date').classList.toggle('hidden', !custom);
  if (custom && !$('fin-date').value) $('fin-date').value = todayIso();
  loadDaily();
});
$('fin-date').addEventListener('change', loadDaily);
$('fin-date').classList.add('hidden');

// ------------------------------------------------- Beranda (ringkasan) ------
/**
 * Beranda kasir: kartu ringkasan hari ini + grafik omzet 7 hari terakhir.
 *
 * Angka diambil dari endpoint laporan yang SAMA dengan tab Laporan
 * (`/reports/daily` dan `/reports/daily-series`), jadi tidak ada perhitungan
 * ulang di klien dan outlet tetap ditentukan server (bukan dari browser).
 */
/** Daftar tanggal YYYY-MM-DD dari `from` s.d. `to` (maksimal `max` hari). */
const eachDate = (from, to, max = 31) => {
  const out = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (!from || !to || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (let d = start; d <= end && out.length < max; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

const DAY_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

/** Nominal ringkas untuk label di atas batang grafik (input: sen). */
const shortIDR = (sen) => {
  const value = Number(sen ?? 0) / 100;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} rb`;
  return String(Math.round(value));
};

const renderHomeSummary = (data) => {
  const income = data.income ?? {};
  const tx = data.transactions ?? {};
  const cards = [
    { label: 'Omzet Hari Ini', value: fmtIDR(income.total ?? 0), sub: data.period?.from ?? '' },
    {
      label: 'Transaksi',
      value: String(tx.completed ?? 0),
      sub: `${tx.items_sold ?? 0} item terjual`,
    },
    {
      label: 'Tunai / QRIS',
      value: `${fmtIDR(income.cash ?? 0)} / ${fmtIDR(income.qris ?? 0)}`,
      sub: 'Pendapatan per metode',
    },
  ];
  // Laba hanya ditampilkan bila server mengizinkan (izin `can_view_profit`).
  if (data.can_view_profit) {
    cards.push({
      label: 'Laba Bersih',
      value: fmtIDR(data.net_profit ?? 0),
      sub: `Laba kotor ${fmtIDR(data.gross_profit ?? 0)}`,
    });
  }
  $('home-summary').innerHTML = cards
    .map(
      (c) => `
      <div class="card stat">
        <span class="stat-label">${escapeHtml(c.label)}</span>
        <strong class="stat-value">${escapeHtml(c.value)}</strong>
        ${c.sub ? `<span class="muted small">${escapeHtml(c.sub)}</span>` : ''}
      </div>`
    )
    .join('');
};

const renderHomeChart = (series) => {
  const byDate = new Map((series?.points ?? []).map((p) => [p.date, p]));
  const days = eachDate(series?.period?.from ?? '', series?.period?.to ?? '').map((date) => ({
    date,
    total: Number(byDate.get(date)?.total ?? 0),
    transactions: Number(byDate.get(date)?.transactions ?? 0),
  }));
  const max = Math.max(1, ...days.map((d) => d.total));
  $('home-chart').innerHTML = days
    .map((d) => {
      const wd = DAY_SHORT[new Date(`${d.date}T00:00:00Z`).getUTCDay()];
      const pct = d.total > 0 ? Math.max(6, Math.round((d.total / max) * 100)) : 1;
      const title = `${d.date} • ${fmtIDR(d.total)} • ${d.transactions} transaksi`;
      return `
      <div class="chart-col" title="${escapeHtml(title)}">
        <span class="chart-value">${d.total > 0 ? escapeHtml(shortIDR(d.total)) : ''}</span>
        <span class="chart-bar${d.total > 0 ? '' : ' empty'}" style="height:${pct}%"></span>
        <span class="chart-label">${wd}</span>
      </div>`;
    })
    .join('');
  const { from, to } = series?.period ?? {};
  $('home-chart-caption').textContent =
    from && to ? `Omzet harian ${from} s.d. ${to}` : '7 hari terakhir';
  $('home-chart-empty').classList.toggle('hidden', days.some((d) => d.total > 0));
};

const loadHome = async () => {
  try {
    const [daily, series] = await Promise.all([
      guard(() => api.daily({ period: 'today' })),
      guard(() => api.dailySeries({ period: 'week' })),
    ]);
    if (daily) renderHomeSummary(daily);
    if (series) renderHomeChart(series);
  } catch (err) {
    alertBox(describeError(err), 'error');
  }
};

// ------------------------------------------------------------ Pengeluaran --
const expenseQuery = () => ({
  category: $('exp-category-filter').value,
  status: $('exp-status-filter').value || 'recorded',
  from: $('exp-date-from').value,
  to: $('exp-date-to').value,
  limit: 100,
});

const renderExpenses = (data) => {
  const items = data.items ?? [];
  const totals = data.totals ?? {};
  $('exp-summary').innerHTML = `
    <div class="card stat">
      <span class="stat-label">Total tampil</span>
      <strong class="stat-value">${escapeHtml(fmtIDR(totals.total ?? 0))}</strong>
      <span class="muted small">${items.length} catatan</span>
    </div>
    <div class="card stat">
      <span class="stat-label">Operasional</span>
      <strong class="stat-value">${escapeHtml(fmtIDR(totals.operating_total ?? 0))}</strong>
      <span class="muted small">masuk perhitungan laba</span>
    </div>
    <div class="card stat">
      <span class="stat-label">Beli persediaan</span>
      <strong class="stat-value">${escapeHtml(fmtIDR(totals.inventory_total ?? 0))}</strong>
      <span class="muted small">tidak dihitung ganda</span>
    </div>`;

  const body = $('exp-body');
  body.innerHTML = '';
  $('exp-empty').classList.toggle('hidden', items.length > 0);
  for (const e of items) {
    const voided = e.status === 'voided';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(fmtDay(e.spent_on))}</td>
      <td>${escapeHtml(CATEGORY_LABELS[e.category] ?? e.category)}</td>
      <td>${escapeHtml(EXPENSE_METHOD_LABELS[e.method] ?? e.method)}</td>
      <td class="right strong">${escapeHtml(fmtIDR(e.amount ?? 0))}</td>
      <td>${escapeHtml(e.note ?? '—')}${voided ? ' <span class="badge off">VOID</span>' : ''}</td>
      <td class="right">
        ${
          voided
            ? '—'
            : `<button class="btn small danger" data-action="void" data-id="${e.id}">Batalkan</button>`
        }
      </td>`;
    body.appendChild(tr);
  }
};

const loadExpenses = async () => {
  const data = await guard(() => api.expenses(expenseQuery()));
  if (!data) return;
  renderExpenses(data);
};

$('exp-refresh-btn').addEventListener('click', loadExpenses);
$('exp-category-filter').addEventListener('change', loadExpenses);
$('exp-status-filter').addEventListener('change', loadExpenses);
$('exp-date-from').addEventListener('change', loadExpenses);
$('exp-date-to').addEventListener('change', loadExpenses);

const openExpenseModal = () => {
  state.formPhoto = undefined;
  $('exp-form').reset();
  $('exp-date').value = todayIso();
  hide($('exp-form-error'));
  show($('exp-modal'));
  $('exp-amount').focus();
};

$('exp-new-btn').addEventListener('click', openExpenseModal);
$('exp-cancel').addEventListener('click', () => hide($('exp-modal')));
$('exp-modal').addEventListener('click', (event) => {
  if (event.target === $('exp-modal')) hide($('exp-modal'));
});

$('exp-receipt').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    state.formPhoto = undefined;
    return;
  }
  try {
    state.formPhoto = await fileToCompressedDataUrl(file);
  } catch (err) {
    event.target.value = '';
    state.formPhoto = undefined;
    alertBox(describeError(err), 'error');
  }
});

$('exp-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const err = $('exp-form-error');
  hide(err);
  const amount = rpToSen($('exp-amount').value);
  if (amount <= 0) {
    err.textContent = 'Nominal harus lebih dari 0.';
    show(err);
    return;
  }
  const payload = {
    category: $('exp-category').value,
    amount,
    method: $('exp-method').value,
    date: $('exp-date').value || todayIso(),
  };
  const note = $('exp-note').value.trim();
  if (note) payload.note = note;
  if (typeof state.formPhoto === 'string' && state.formPhoto) {
    payload.receiptUrl = state.formPhoto;
  }

  const btn = $('exp-form').querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await guard(() => api.createExpense(payload));
    alertBox('Pengeluaran dicatat.', 'ok');
    hide($('exp-modal'));
    await loadExpenses();
  } catch (e) {
    err.textContent = describeError(e);
    show(err);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Void pengeluaran ----------
let voidExpenseId = null;

$('exp-body').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action="void"]');
  if (!btn) return;
  voidExpenseId = btn.dataset.id;
  $('void-reason').value = '';
  hide($('void-error'));
  show($('void-modal'));
  $('void-reason').focus();
});

$('void-cancel').addEventListener('click', () => hide($('void-modal')));
$('void-modal').addEventListener('click', (event) => {
  if (event.target === $('void-modal')) hide($('void-modal'));
});

$('void-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const err = $('void-error');
  hide(err);
  const reason = $('void-reason').value.trim();
  if (reason.length < 3) {
    err.textContent = 'Alasan minimal 3 karakter.';
    show(err);
    return;
  }
  if (!voidExpenseId) return;
  try {
    await guard(() => api.voidExpense(voidExpenseId, reason));
    alertBox('Pengeluaran dibatalkan.', 'ok');
    hide($('void-modal'));
    await loadExpenses();
  } catch (e) {
    err.textContent = describeError(e);
    show(err);
  }
});

// --------------------------------------------- Riwayat pergerakan stok ----
const renderMovements = (data) => {
  const items = data.items ?? [];
  const body = $('mov-body');
  body.innerHTML = '';
  $('mov-empty').classList.toggle('hidden', items.length > 0);
  for (const m of items) {
    const delta = Number(m.qty_delta ?? 0);
    const sign = delta > 0 ? `+${delta}` : String(delta);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(fmtDate(m.created_at))}</td>
      <td>${escapeHtml(m.product_name ?? '—')}</td>
      <td>${escapeHtml(MOVEMENT_LABELS[m.type] ?? m.type)}</td>
      <td class="right ${delta > 0 ? 'ok-text' : delta < 0 ? 'danger-text' : ''}">${escapeHtml(sign)}</td>
      <td class="right">${m.qty_after != null ? Number(m.qty_after) : '—'}</td>
      <td>${escapeHtml(m.reason ?? '—')}</td>`;
    body.appendChild(tr);
  }
};

const loadMovements = async () => {
  const data = await guard(() => api.inventoryMovements({ limit: 50 }));
  if (!data) return;
  renderMovements(data);
};

$('mov-refresh-btn').addEventListener('click', loadMovements);
