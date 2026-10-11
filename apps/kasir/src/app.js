/**
 * Logika UI panel Kasir (Vanilla JS modular).
 *
 * Alur: login (peran terkunci cashier) -> /me -> tampilkan profil + konteks
 * outlet/bisnis milik kasir, lalu daftar produk outlet (read-only, Fase 6).
 * Area transaksi penjualan menyusul di fase berikutnya. Verifikasi peran &
 * status tetap ditegakkan server.
 */
import { api, login, logout, tokenStore, ApiError } from './api.js';

const $ = (id) => document.getElementById(id);
const state = { user: null, context: null, products: [] };

const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const fmtIDR = (sen) => `Rp ${((Number(sen) ?? 0) / 100).toLocaleString('id-ID')}`;

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
  if (type !== 'error') setTimeout(() => hide(el), 3000);
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

// --------------------------------------------------------------- Produk -----
const renderProductList = (items) => {
  const list = $('product-list');
  list.innerHTML = '';
  hide($('product-empty'));
  if (!items.length) {
    show($('product-empty'));
    return;
  }
  for (const p of items) {
    const card = document.createElement('div');
    card.className = 'product-card';
    const stockLabel = p.track_stock
      ? `Stok ${Number(p.quantity ?? 0)}`
      : '<span class="muted">tanpa stok</span>';
    card.innerHTML = `
      <div class="product-head">
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <p class="muted small">
            ${p.category_name ? escapeHtml(p.category_name) : 'Tanpa kategori'}
            ${p.sku ? ' • SKU ' + escapeHtml(p.sku) : ''}
          </p>
        </div>
        <div class="right">
          <div class="product-price">${escapeHtml(fmtIDR(p.price))}</div>
        </div>
      </div>
      <div class="outlet-meta muted small">${stockLabel}</div>`;
    list.appendChild(card);
  }
};

const loadProducts = async () => {
  const body = await guard(() => api.products({ search: $('product-search').value.trim() }));
  if (!body) return;
  state.products = body.items;
  renderProductList(body.items);
};

$('product-search').addEventListener('input', debounce(() => loadProducts(), 300));

// ---------------------------------------------------------------- Login ----
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
  alertBox('Data dimuat ulang.');
});

// Pemulihan sesi: jika access token masih ada di storage, langsung tampilkan.
if (tokenStore.access) {
  fetchCurrentUser()
    .then(async () => {
      hide($('login-view'));
      show($('app-view'));
      await loadProducts();
    })
    .catch(() => {
      // guard() sudah menangani 401; error lain cukup dibiarkan ke login.
    });
} else {
  show($('login-view'));
}