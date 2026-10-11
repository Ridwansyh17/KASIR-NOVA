/**
 * Logika UI panel Kasir — Titik Penjualan (Fase 7).
 *
 * Alur: login (peran terkunci cashier) -> /me -> konteks outlet/bisnis ->
 * katalog produk outlet -> keranjang -> diskon/pembayaran -> "Bayar".
 * Semua perhitungan total & pajak tetap dilakukan SERVER; perhitungan di sini
 * hanya perkiraan untuk tampilan. Verifikasi peran/status ditegakkan server.
 */
import { api, login, logout, tokenStore, ApiError } from './api.js';

const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  context: null,
  products: [],
  cart: new Map(), // productId -> { product, qty }
};

const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const fmtIDR = (sen) => `Rp ${((Number(sen) ?? 0) / 100).toLocaleString('id-ID')}`;
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('id-ID');
};

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
    renderProfile();
  });

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
    const out = p.track_stock && Number(p.quantity ?? 0) <= 0;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `pos-product ${out ? 'out' : ''}`;
    card.dataset.id = p.id;
    card.disabled = out;
    card.innerHTML = `
      <strong>${escapeHtml(p.name)}</strong>
      <span class="pos-product-price">${escapeHtml(fmtIDR(p.price))}</span>
      <span class="muted small">
        ${p.track_stock ? `Stok ${Number(p.quantity ?? 0)}` : 'tanpa stok'}
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
  // Kosongkan isi struk ringkas (pertahankan header + tombol cetak).
  const receipt = $('receipt');
  const info = receipt.querySelectorAll('p.mono, .cart-row, dl.meta');
  info.forEach((node) => node.remove());
  lastTx = null;
  hide($('receipt'));
  renderCart();
};

let lastTx = null;

const renderReceipt = (t) => {
  lastTx = t;
  const el = $('receipt');
  const rows = t.items
    .map(
      (it) => `
      <div class="cart-row">
        <div class="cart-info"><strong>${escapeHtml(it.product_name)}</strong>
          <span class="muted small">${escapeHtml(fmtIDR(it.unit_price))} × ${it.qty}</span></div>
        <span class="right mono">${escapeHtml(fmtIDR(it.line_total))}</span>
      </div>`
    )
    .join('');

  const methodLabel = { cash: 'Tunai', card: 'Kartu', qr: 'QRIS', wallet: 'E-Wallet' }[
    t.payments?.[0]?.method
  ] ?? '-';

  el.querySelector('.receipt-head strong').textContent = `Transaksi berhasil`;
  const info = document.createElement('div');
  info.innerHTML = `
    <p class="mono">${escapeHtml(t.invoice_no)}</p>
    ${rows}
    <dl class="meta">
      <div><dt>Subtotal</dt><dd>${escapeHtml(fmtIDR(t.subtotal))}</dd></div>
      <div><dt>Diskon</dt><dd>${escapeHtml(fmtIDR(t.discount_total))}</dd></div>
      <div><dt>Pajak</dt><dd>${escapeHtml(fmtIDR(t.tax_total))}</dd></div>
      <div><dt><strong>Total</strong></dt><dd class="strong">${escapeHtml(fmtIDR(t.total))}</dd></div>
      <div><dt>Dibayar (${escapeHtml(methodLabel)})</dt><dd>${escapeHtml(fmtIDR(t.paid_amount))}</dd></div>
      <div><dt>Kembalian</dt><dd>${escapeHtml(fmtIDR(t.change_amount))}</dd></div>
    </dl>
    <p class="muted small">${escapeHtml(fmtDate(t.created_at))}</p>`;
  el.appendChild(info);
  show(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

/** Isi template struk 58mm lalu buka dialog cetak. */
const printStruk = () => {
  const t = lastTx;
  if (!t) return;
  const methodLabel = { cash: 'Tunai', card: 'Kartu', qr: 'QRIS', wallet: 'E-Wallet' }[
    t.payments?.[0]?.method
  ] ?? '-';
  const rows = t.items
    .map(
      (it) => `${escapeHtml(it.product_name)}\n  ${it.qty} x ${escapeHtml(fmtIDR(it.unit_price))}  ${escapeHtml(fmtIDR(it.line_total))}`
    )
    .join('');

  const out = state.context?.business?.name ?? 'KASIR NOVA';
  const outlet = state.context?.outlet?.name ?? '';
  $('print-struk').innerHTML =
    `<div class="struk-head"><strong>${escapeHtml(out)}</strong></div>` +
    `<div class="struk-sub">${escapeHtml(outlet)} ${escapeHtml(state.user?.fullName ?? '')}</div>` +
    `<div class="struk-sub mono">${escapeHtml(t.invoice_no)}</div>` +
    `<div class="struk-sub">${escapeHtml(fmtDate(t.created_at))}</div>` +
    `<pre class="struk-items">${rows}</pre>` +
    `<div class="struk-row"><span>Subtotal</span><span>${escapeHtml(fmtIDR(t.subtotal))}</span></div>` +
    `<div class="struk-row"><span>Diskon</span><span>-${escapeHtml(fmtIDR(t.discount_total))}</span></div>` +
    `<div class="struk-row"><span>Pajak (${Number(t.tax_rate)}%)</span><span>${escapeHtml(fmtIDR(t.tax_total))}</span></div>` +
    `<div class="struk-row total"><span>Total</span><span>${escapeHtml(fmtIDR(t.total))}</span></div>` +
    `<div class="struk-row"><span>Dibayar (${escapeHtml(methodLabel)})</span><span>${escapeHtml(fmtIDR(t.paid_amount))}</span></div>` +
    `<div class="struk-row"><span>Kembalian</span><span>${escapeHtml(fmtIDR(t.change_amount))}</span></div>` +
    `<div class="struk-foot">Terima kasih atas kunjungan Anda</div>`;
  window.print();
};

$('print-struk-btn').addEventListener('click', printStruk);

$('checkout-btn').addEventListener('click', async () => {
  hide($('checkout-error'));
  if (!state.cart.size) {
    $('checkout-error').textContent = 'Keranjang masih kosong.';
    show($('checkout-error'));
    return;
  }

  const { total } = computeEstimate();
  const rawDiscount = parseFloat($('discount-value').value);
  const method = $('payment-method').value;
  const paidRp = Math.round((parseFloat($('payment-amount').value) || 0) * 100);
  if (method === 'cash' && paidRp < total) {
    $('checkout-error').textContent = 'Uang tunai kurang dari total.';
    show($('checkout-error'));
    return;
  }
  if (method !== 'cash' && paidRp !== total) {
    $('checkout-error').textContent = 'Jumlah bayar non-tunai harus sama dengan total.';
    show($('checkout-error'));
    return;
  }

  const payload = {
    items: [...state.cart.values()].map((it) => ({ productId: it.product.id, qty: it.qty })),
    payment: {
      method,
      amount: paidRp,
    },
    clientRef: crypto.randomUUID(),
  };
  if (rawDiscount > 0) {
    payload.discount = {
      type: $('discount-type').value,
      value:
        $('discount-type').value === 'percent' ? rawDiscount : Math.round(rawDiscount * 100),
    };
  }
  const note = $('sale-note').value.trim();
  if (note) payload.note = note;

  const btn = $('checkout-btn');
  btn.disabled = true;
  try {
    const { transaction } = await guard(() => api.createTransaction(payload));
    renderReceipt(transaction);
    alertBox(`Transaksi ${transaction.invoice_no} berhasil.`, 'ok');
    resetSaleForm();
    await loadProducts();
    await loadHistory();
  } catch (err) {
    const el = $('checkout-error');
    el.textContent = describeError(err);
    show(el);
  } finally {
    btn.disabled = false;
  }
});

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
    if (transaction) renderReceipt(transaction);
  } catch (err) {
    alertBox(describeError(err), 'error');
  }
});

// ---------------------------------------------------------------- Login -----
$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('login-error'));
  const button = event.submitter ?? $('login-form').querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await login($('login-email').value.trim(), $('login-password').value);
    $('login-password').value = '';
    await fetchCurrentUser();
    hide($('login-view'));
    show($('app-view'));
    await loadProducts();
    await loadHistory();
  } catch (err) {
    const el = $('login-error');
    el.textContent = describeError(err);
    show(el);
  } finally {
    button.disabled = false;
  }
});

$('logout-btn').addEventListener('click', async () => {
  await logout();
  hide($('app-view'));
  show($('login-view'));
});

$('refresh-btn').addEventListener('click', async () => {
  await fetchCurrentUser();
  await loadProducts();
  await loadHistory();
  alertBox('Data dimuat ulang.');
});

$('history-refresh-btn').addEventListener('click', loadHistory);

// Pemulihan sesi: jika access token masih ada di storage, langsung tampilkan.
if (tokenStore.access) {
  fetchCurrentUser()
    .then(async () => {
      hide($('login-view'));
      show($('app-view'));
      await loadProducts();
      await loadHistory();
    })
    .catch(() => {
      // guard() sudah menangani 401; error lain cukup dibiarkan ke login.
    });
} else {
  show($('login-view'));
}