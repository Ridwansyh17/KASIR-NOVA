/**
 * Logika UI panel Kasir (Vanilla JS modular).
 *
 * Alur: login (peran terkunci cashier) -> /me -> tampilkan profil + konteks
 * outlet/bisnis milik kasir. Area penjualan (produk, transaksi) menyusul di
 * fase berikutnya. Verifikasi peran & status tetap ditegakkan server.
 */
import { api, login, logout, tokenStore, ApiError } from './api.js';

const $ = (id) => document.getElementById(id);
const state = { user: null, context: null };

const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

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
  alertBox('Data dimuat ulang.');
});

// Pemulihan sesi: jika access token masih ada di storage, langsung tampilkan.
if (tokenStore.access) {
  fetchCurrentUser()
    .then(() => {
      hide($('login-view'));
      show($('app-view'));
    })
    .catch(() => {
      // guard() sudah menangani 401; error lain cukup dibiarkan ke login.
    });
} else {
  show($('login-view'));
}