/**
 * Logika UI panel Owner (Vanilla JS modular).
 *
 * Alur: login (peran terkunci owner) -> daftar bisnis -> pilih konteks bisnis
 * aktif -> lihat detail bisnis, langganan, dan kelola outlet. Semua otorisasi
 * & isolasi tenant tetap ditegakkan server; UI ini hanya alat bantu.
 */
import { api, login, logout, tokenStore, ApiError } from './api.js';

const $ = (id) => document.getElementById(id);
const ACTIVE_KEY = 'nova_owner_business';
const state = { businesses: [], activeId: null };

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

const fmtIDR = (sen) =>
  `Rp ${((Number(sen) ?? 0) / 100).toLocaleString('id-ID')}`;

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
    await loadBusinesses();
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

// ------------------------------------------------------------ Bisnis ---------
const fetchCurrentUser = async () => {
  const { user } = await guard(() => api.me());
  $('current-user').textContent = user ? `${user.fullName} (${user.email})` : '';
};

const activeBusiness = () => state.businesses.find((b) => b.id === state.activeId) ?? null;

const renderSelect = () => {
  const select = $('business-select');
  select.innerHTML = '';
  if (!state.businesses.length) {
    const opt = document.createElement('option');
    opt.textContent = '— belum ada bisnis —';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  for (const b of state.businesses) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.status === 'active' ? b.name : `${b.name} (nonaktif)`;
    select.appendChild(opt);
  }
  select.disabled = false;
  select.value = state.activeId ?? '';
};

const renderDetail = () => {
  const b = activeBusiness();
  if (!b) {
    hide($('business-detail'));
    return;
  }
  show($('business-detail'));

  $('detail-name').textContent = b.name;
  $('detail-type').textContent = b.business_type || 'Tanpa jenis usaha';
  $('detail-id').textContent = b.id;
  $('detail-currency').textContent = b.currency;
  $('detail-timezone').textContent = b.timezone;
  $('detail-created').textContent = fmtDate(b.created_at);
  $('detail-updated').textContent = fmtDate(b.updated_at);

  const badge = $('detail-status');
  badge.textContent = b.status === 'active' ? 'aktif' : 'nonaktif';
  badge.className = `badge ${b.status === 'active' ? 'ok' : 'off'}`;

  const toggle = $('toggle-status-btn');
  toggle.textContent = b.status === 'active' ? 'Nonaktifkan' : 'Aktifkan';
  toggle.className = `btn ${b.status === 'active' ? 'danger' : ''}`;
};

// --------------------------------------------------------- Langganan ---------
const renderSubscription = (view) => {
  const section = $('subscription-section');
  if (!view) {
    hide(section);
    return;
  }
  show(section);
  const st = view.subscription;
  const pl = view.plan;
  const sBadge = $('sub-badge');
  sBadge.textContent = st.status;
  sBadge.className = `badge ${st.status === 'active' ? 'ok' : 'off'}`;
  $('sub-plan').textContent = `${pl.name} ${pl.is_default ? '(default)' : ''}`;
  $('sub-max-outlets').textContent = pl.max_outlets;
  $('sub-max-cashiers').textContent = pl.max_cashiers;
  $('sub-price').textContent = fmtIDR(pl.price);
  $('sub-expires').textContent = fmtDate(st.expires_at);
};

// ----------------------------------------------------------- Outlet ----------
const renderOutletList = (items) => {
  const list = $('outlet-list');
  list.innerHTML = '';
  hide($('outlet-empty'));

  if (!items.length) {
    show($('outlet-empty'));
    return;
  }

  for (const o of items) {
    const card = document.createElement('div');
    card.className = 'outlet-card';
    card.innerHTML = `
      <div class="outlet-head">
        <div>
          <strong>${escapeHtml(o.name)}</strong>
          <p class="muted small">${escapeHtml(o.address || 'Tanpa alamat')}${o.phone ? ' • ' + escapeHtml(o.phone) : ''}</p>
        </div>
        <span class="badge ${o.status === 'active' ? 'ok' : 'off'}">${escapeHtml(o.status)}</span>
      </div>
      <div class="outlet-meta muted small">
        Pajak ${Number(o.tax_rate)}% • dibuat ${escapeHtml(fmtDate(o.created_at))}
      </div>
      <div class="detail-actions">
        <button class="btn small" data-action="edit" data-id="${o.id}">Ubah</button>
        <button class="btn small danger" data-action="delete" data-id="${o.id}">Hapus</button>
      </div>`;
    list.appendChild(card);
  }
};

const loadOutlets = async () => {
  const b = activeBusiness();
  if (!b) {
    hide($('outlet-section'));
    return;
  }
  const body = await guard(() => api.outlets.list(b.id));
  if (!body) return;
  show($('outlet-section'));
  renderOutletList(body.items);
};

// --------------------------------------------------------- Muat konteks ------
const loadBusinesses = async () => {
  const body = await guard(() => api.listBusinesses());
  if (!body) return;

  state.businesses = body.items;

  if (!state.businesses.some((b) => b.id === state.activeId)) {
    const stored = localStorage.getItem(ACTIVE_KEY);
    state.activeId =
      (stored && state.businesses.some((b) => b.id === stored) ? stored : null) ??
      state.businesses[0]?.id ??
      null;
  }
  if (state.activeId) localStorage.setItem(ACTIVE_KEY, state.activeId);
  else localStorage.removeItem(ACTIVE_KEY);

  $('empty-state').classList.toggle('hidden', state.businesses.length > 0);

  if (!state.activeId) {
    hide($('business-detail'));
    hide($('subscription-section'));
    hide($('outlet-section'));
    show($('waiting-state'));
  } else {
    hide($('waiting-state'));
    renderSelect();
    renderDetail();
    await refreshContext();
  }
};

/** Muat ulang data yang bergantung pada bisnis aktif (langganan + outlet). */
const refreshContext = async () => {
  const b = activeBusiness();
  if (!b) return;
  const sub = await guard(() => api.subscription(b.id));
  renderSubscription(sub ?? null);
  await loadOutlets();
};

$('business-select').addEventListener('change', async (event) => {
  state.activeId = event.target.value || null;
  if (state.activeId) localStorage.setItem(ACTIVE_KEY, state.activeId);
  renderDetail();
  await refreshContext();
});

$('refresh-btn').addEventListener('click', () => loadBusinesses());
$('new-business-btn').addEventListener('click', () => openCreateModal());
$('empty-new-btn').addEventListener('click', () => openCreateModal());
$('edit-business-btn').addEventListener('click', () => {
  const b = activeBusiness();
  if (b) openEditModal(b);
});

$('toggle-status-btn').addEventListener('click', async () => {
  const b = activeBusiness();
  if (!b) return;
  const next = b.status === 'active' ? 'suspended' : 'active';
  if (!confirm(`Ubah status "${b.name}" menjadi "${next}"?`)) return;
  try {
    await guard(() => api.setStatus(b.id, next));
    alertBox('Status bisnis berhasil diubah.', 'ok');
    await loadBusinesses();
  } catch (err) {
    alertBox(describeError(err), 'error');
  }
});

// -------------------------------------------------- Modal bisnis -------------
const openCreateModal = () => {
  $('modal-title').textContent = 'Bisnis Baru';
  $('business-form').reset();
  $('business-id').value = '';
  hide($('form-error'));
  show($('modal'));
};

const openEditModal = (b) => {
  $('modal-title').textContent = 'Ubah Bisnis';
  $('business-id').value = b.id;
  $('business-name').value = b.name ?? '';
  $('business-type').value = b.business_type ?? '';
  $('business-currency').value = b.currency ?? '';
  $('business-timezone').value = b.timezone ?? '';
  hide($('form-error'));
  show($('modal'));
};

const closeModal = () => hide($('modal'));
$('modal-cancel').addEventListener('click', closeModal);
$('modal').addEventListener('click', (event) => {
  if (event.target === $('modal')) closeModal();
});

$('business-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('form-error'));

  const id = $('business-id').value;
  const name = $('business-name').value.trim();
  const type = $('business-type').value.trim();
  const currency = $('business-currency').value.trim();
  const timezone = $('business-timezone').value.trim();

  const payload = { name, businessType: type };
  if (currency) payload.currency = currency.toUpperCase();
  if (timezone) payload.timezone = timezone;

  try {
    if (id) {
      await guard(() => api.updateBusiness(id, payload));
      alertBox('Bisnis diperbarui.', 'ok');
    } else {
      const { business } = await guard(() => api.createBusiness(payload));
      alertBox('Bisnis baru berhasil dibuat (langganan Gratis otomatis).', 'ok');
      if (business?.id) {
        state.activeId = business.id;
        localStorage.setItem(ACTIVE_KEY, business.id);
      }
    }
    closeModal();
    await loadBusinesses();
  } catch (err) {
    const el = $('form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

// -------------------------------------------------- Modal outlet -------------
const openOutletCreate = () => {
  $('outlet-modal-title').textContent = 'Outlet Baru';
  $('outlet-form').reset();
  $('outlet-id').value = '';
  hide($('outlet-form-error'));
  show($('outlet-modal'));
};

const openOutletEdit = (o) => {
  $('outlet-modal-title').textContent = 'Ubah Outlet';
  $('outlet-id').value = o.id;
  $('outlet-name').value = o.name ?? '';
  $('outlet-address').value = o.address ?? '';
  $('outlet-phone').value = o.phone ?? '';
  $('outlet-tax').value = o.tax_rate ?? '';
  hide($('outlet-form-error'));
  show($('outlet-modal'));
};

$('new-outlet-btn').addEventListener('click', openOutletCreate);

$('outlet-list').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  const b = activeBusiness();
  if (!b) return;

  if (action === 'edit') {
    (async () => {
      try {
        const { outlet } = await guard(() => api.outlets.get(b.id, id));
        if (outlet) openOutletEdit(outlet);
      } catch (err) {
        alertBox(describeError(err), 'error');
      }
    })();
    return;
  }

  if (action === 'delete') {
    (async () => {
      if (!confirm('Hapus outlet ini?')) return;
      try {
        await guard(() => api.outlets.remove(b.id, id));
        alertBox('Outlet dihapus.', 'ok');
        await loadOutlets();
      } catch (err) {
        alertBox(describeError(err), 'error');
      }
    })();
  }
});

const closeOutletModal = () => hide($('outlet-modal'));
$('outlet-cancel').addEventListener('click', closeOutletModal);
$('outlet-modal').addEventListener('click', (event) => {
  if (event.target === $('outlet-modal')) closeOutletModal();
});

$('outlet-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('outlet-form-error'));

  const b = activeBusiness();
  if (!b) return;

  const id = $('outlet-id').value;
  const payload = {
    name: $('outlet-name').value.trim(),
    address: $('outlet-address').value.trim(),
    phone: $('outlet-phone').value.trim(),
  };
  const tax = $('outlet-tax').value.trim();
  if (tax !== '') payload.taxRate = Number(tax);

  try {
    if (id) {
      await guard(() => api.outlets.update(b.id, id, payload));
      alertBox('Outlet diperbarui.', 'ok');
    } else {
      await guard(() => api.outlets.create(b.id, payload));
      alertBox('Outlet baru berhasil dibuat.', 'ok');
    }
    closeOutletModal();
    await loadOutlets();
  } catch (err) {
    const el = $('outlet-form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

// ------------------------------------------------------------- Bootstrap -----
const boot = async () => {
  if (tokenStore.access || tokenStore.refresh) {
    try {
      await fetchCurrentUser();
      hide($('login-view'));
      show($('app-view'));
      await loadBusinesses();
      return;
    } catch {
      tokenStore.clear();
    }
  }
  show($('login-view'));
};

boot();