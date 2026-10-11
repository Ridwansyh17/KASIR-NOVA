/**
 * Logika UI panel Admin Platform (Vanilla JS modular).
 *
 * Alur: login (peran terkunci platform_admin) -> daftar owner (cari/filter/
 * paginasi) -> buat/ubah/status/reset password/hapus. Semua otorisasi tetap
 * ditegakkan server; UI ini hanya alat bantu.
 */
import { api, login, logout, tokenStore, ApiError } from './api.js';

const $ = (id) => document.getElementById(id);
const state = { page: 1, limit: 10, total: 0, search: '', status: '', owners: [] };

const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('id-ID');
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
    await loadOwners();
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

// -------------------------------------------------------------- Owners -----
const fetchCurrentUser = async () => {
  const { user } = await guard(() => api.me());
  $('current-user').textContent = user ? `${user.fullName} (${user.email})` : '';
};

const renderOwners = (items) => {
  const tbody = $('owners-body');
  tbody.innerHTML = '';
  hide($('empty-state'));

  if (!items.length) {
    show($('empty-state'));
    return;
  }

  for (const o of items) {
    const tr = document.createElement('tr');
    const statusBadge =
      o.status === 'active'
        ? '<span class="badge ok">aktif</span>'
        : '<span class="badge off">nonaktif</span>';
    const toggleLabel = o.status === 'active' ? 'Nonaktifkan' : 'Aktifkan';

    tr.innerHTML = `
      <td>${escapeHtml(o.full_name)}</td>
      <td>${escapeHtml(o.email)}</td>
      <td>${escapeHtml(o.phone ?? '—')}</td>
      <td>${statusBadge}</td>
      <td class="muted">${escapeHtml(fmtDate(o.created_at))}</td>
      <td class="right actions">
        <button class="btn small" data-action="edit" data-id="${o.id}">Ubah</button>
        <button class="btn small" data-action="toggle" data-id="${o.id}">${toggleLabel}</button>
        <button class="btn small" data-action="reset" data-id="${o.id}">Reset sandi</button>
        <button class="btn small danger" data-action="delete" data-id="${o.id}">Hapus</button>
      </td>`;
    tbody.appendChild(tr);
  }
};

const loadOwners = async () => {
  const body = await guard(() =>
    api.listOwners({
      search: state.search,
      status: state.status,
      page: state.page,
      limit: state.limit,
    })
  );
  if (!body) return;

  state.owners = body.items;
  state.total = body.total;
  renderOwners(body.items);

  const pages = Math.max(1, Math.ceil(body.total / state.limit));
  if (state.page > pages) {
    state.page = pages;
    return loadOwners();
  }
  $('page-info').textContent = `Halaman ${state.page} / ${pages} • ${body.total} owner`;
  $('prev-btn').disabled = state.page <= 1;
  $('next-btn').disabled = state.page >= pages;
};

// Delegasi aksi pada tabel
$('owners-body').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  const owner = state.owners.find((o) => o.id === id);
  if (!owner) return;

  if (action === 'edit') return openEditModal(owner);

  if (action === 'toggle') {
    const next = owner.status === 'active' ? 'suspended' : 'active';
    if (!confirm(`Ubah status ${owner.email} menjadi "${next}"?`)) return;
    try {
      await guard(() => api.setStatus(id, next));
      alertBox('Status berhasil diubah.', 'ok');
      await loadOwners();
    } catch (err) {
      alertBox(describeError(err), 'error');
    }
    return;
  }

  if (action === 'reset') {
    const pw = prompt(`Password baru untuk ${owner.email} (minimal 8 karakter):`);
    if (!pw) return;
    try {
      await guard(() => api.resetPassword(id, pw));
      alertBox('Password berhasil direset. Semua sesi owner dicabut.', 'ok');
    } catch (err) {
      alertBox(describeError(err), 'error');
    }
    return;
  }

  if (action === 'delete') {
    if (!confirm(`Hapus (nonaktifkan) owner ${owner.email}?`)) return;
    try {
      await guard(() => api.deleteOwner(id));
      alertBox('Owner dihapus.', 'ok');
      await loadOwners();
    } catch (err) {
      alertBox(describeError(err), 'error');
    }
  }
});

// ---------------------------------------------------- Toolbar & paging -----
let searchTimer = null;
$('search').addEventListener('input', (event) => {
  state.search = event.target.value.trim();
  state.page = 1;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadOwners, 300);
});

$('status-filter').addEventListener('change', (event) => {
  state.status = event.target.value;
  state.page = 1;
  loadOwners();
});

$('refresh-btn').addEventListener('click', () => loadOwners());
$('prev-btn').addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    loadOwners();
  }
});
$('next-btn').addEventListener('click', () => {
  state.page += 1;
  loadOwners();
});
$('new-owner-btn').addEventListener('click', () => openCreateModal());

// -------------------------------------------------------------- Modal ------
const openCreateModal = () => {
  $('modal-title').textContent = 'Owner Baru';
  $('owner-form').reset();
  $('owner-id').value = '';
  show($('password-field'));
  $('owner-password').required = true;
  hide($('form-error'));
  show($('modal'));
};

const openEditModal = (owner) => {
  $('modal-title').textContent = 'Ubah Owner';
  $('owner-id').value = owner.id;
  $('owner-name').value = owner.full_name ?? '';
  $('owner-email').value = owner.email ?? '';
  $('owner-phone').value = owner.phone ?? '';
  hide($('password-field'));
  $('owner-password').required = false;
  hide($('form-error'));
  show($('modal'));
};

const closeModal = () => hide($('modal'));
$('modal-cancel').addEventListener('click', closeModal);
$('modal').addEventListener('click', (event) => {
  if (event.target === $('modal')) closeModal();
});

$('owner-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('form-error'));

  const id = $('owner-id').value;
  const fullName = $('owner-name').value.trim();
  const email = $('owner-email').value.trim();
  const phone = $('owner-phone').value.trim();

  try {
    if (id) {
      const patch = { fullName, email };
      if (phone) patch.phone = phone;
      await guard(() => api.updateOwner(id, patch));
      alertBox('Owner diperbarui.', 'ok');
    } else {
      const password = $('owner-password').value;
      const payload = { fullName, email, password };
      if (phone) payload.phone = phone;
      await guard(() => api.createOwner(payload));
      alertBox('Owner baru berhasil dibuat.', 'ok');
    }
    closeModal();
    await loadOwners();
  } catch (err) {
    const el = $('form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

// ------------------------------------------------------------- Bootstrap ---
const boot = async () => {
  if (tokenStore.access || tokenStore.refresh) {
    try {
      await fetchCurrentUser();
      hide($('login-view'));
      show($('app-view'));
      await loadOwners();
      return;
    } catch {
      tokenStore.clear();
    }
  }
  show($('login-view'));
};

boot();
