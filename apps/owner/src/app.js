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
const state = {
  businesses: [],
  activeId: null,
  categories: [],
  products: [],
  // audit log
  auditPage: 1,
  auditLimit: 20,
  auditTotal: 0,
};

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
        Pajak ${Number(o.tax_rate)}%${o.tax_inclusive ? ' (sudah termasuk harga)' : ''} • dibuat ${escapeHtml(fmtDate(o.created_at))}
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

  // Sinkronkan filter outlet pada bagian transaksi & laporan.
  for (const id of ['tx-outlet-filter', 'rep-outlet-filter']) {
    const sel = $(id);
    const previous = sel.value;
    sel.innerHTML = '<option value="">Semua outlet</option>';
    for (const o of body.items) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.name;
      sel.appendChild(opt);
    }
    if ([...sel.options].some((o) => o.value === previous)) sel.value = previous;
  }
};

// ------------------------------------------------------------ Kasir ----------
const renderCashierList = (items) => {
  const tbody = $('cashier-list');
  tbody.innerHTML = '';
  $('cashier-empty').classList.toggle('hidden', items.length > 0);

  for (const c of items) {
    const hasPin = Boolean(c.pin_set_at);
    const locked = c.status === 'locked';
    const statusBadge = locked
      ? '<span class="badge off">Terkunci</span>'
      : c.status === 'active'
        ? '<span class="badge ok">Aktif</span>'
        : '<span class="badge off">Nonaktif</span>';
    const pinBadge = hasPin
      ? '<span class="badge ok">PIN aktif</span>'
      : '<span class="muted">—</span>';
    const name = encodeURIComponent(c.full_name);
    const pinBtn = hasPin
      ? `<button class="btn small" data-action="pin" data-id="${c.id}" data-name="${name}">Ganti PIN</button>`
      : `<button class="btn small" data-action="pin" data-id="${c.id}" data-name="${name}">Pasang PIN</button>`;
    const remove = hasPin
      ? `<button class="btn small" data-action="remove-pin" data-id="${c.id}" data-name="${name}">Hapus PIN</button>`
      : '';
    const unlock = locked
      ? `<button class="btn small" data-action="unlock" data-id="${c.id}" data-name="${name}">Buka Kunci</button>`
      : '';
    const sessionsBtn = `<button class="btn small" data-action="sessions" data-id="${c.id}" data-name="${name}">Sesi</button>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c.full_name)}</td>
      <td>${escapeHtml(c.email)}</td>
      <td>${escapeHtml(c.outlet_name ?? '—')}</td>
      <td>${statusBadge}</td>
      <td>${pinBadge}</td>
      <td class="right">${sessionsBtn} ${pinBtn} ${remove} ${unlock}</td>`;
    tbody.appendChild(tr);
  }
};

const loadCashiers = async () => {
  const b = activeBusiness();
  if (!b) {
    hide($('cashier-section'));
    return;
  }
  const body = await guard(() => api.cashiers.list(b.id));
  if (!body) return;
  show($('cashier-section'));
  renderCashierList(body.items ?? []);
};

/** Isi pilihan outlet pada formulir tambah kasir. */
const fillCashierOutlets = async () => {
  const b = activeBusiness();
  if (!b) return;
  const body = await guard(() => api.outlets.list(b.id));
  const sel = $('cashier-outlet-select');
  sel.innerHTML = '';
  for (const o of body?.items ?? []) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    sel.appendChild(opt);
  }
};

const hideCashierForm = () => {
  hide($('cashier-create-form'));
  $('cashier-create-error').classList.add('hidden');
  $('cashier-name').value = '';
  $('cashier-email').value = '';
  $('cashier-password').value = '';
  $('cashier-pin').value = '';
  $('cashier-outlet-select').innerHTML = '';
};

$('new-cashier-btn').addEventListener('click', async () => {
  await fillCashierOutlets();
  show($('cashier-create-form'));
  $('cashier-name').focus();
});

$('cashier-create-cancel').addEventListener('click', hideCashierForm);

$('cashier-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const err = $('cashier-create-error');
  err.classList.add('hidden');
  const b = activeBusiness();
  if (!b) return;
  const data = {
    fullName: $('cashier-name').value.trim(),
    email: $('cashier-email').value.trim(),
    password: $('cashier-password').value,
    outletId: $('cashier-outlet-select').value,
  };
  const pinRaw = $('cashier-pin').value.trim();
  if (pinRaw) {
    if (!/^\d{4}$/.test(pinRaw)) {
      err.textContent = 'PIN harus 4 digit angka.';
      err.classList.remove('hidden');
      return;
    }
    data.pin = pinRaw;
  }
  try {
    await guard(() => api.cashiers.create(b.id, data));
    alertBox('Kasir berhasil ditambahkan.', 'ok');
    hideCashierForm();
    await loadCashiers();
  } catch (e) {
    err.textContent = describeError(e);
    err.classList.remove('hidden');
  }
});

// Aksi baris kasir: pasang/ganti PIN, hapus PIN, buka kunci.
$('cashier-list').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const b = activeBusiness();
  const cashierId = btn.dataset.id;
  const name = btn.dataset.name ? decodeURIComponent(btn.dataset.name) : 'Kasir';
  const action = btn.dataset.action;
  if (!b) return;

  if (action === 'pin') {
    // Modal PIN
    $('pin-modal-title').textContent = 'PIN Kasir';
    $('pin-modal-cashier').textContent = `Set PIN 4 digit untuk ${name}.`;
    $('pin-modal-input').value = '';
    $('pin-modal-error').classList.add('hidden');
    $('pin-modal').dataset.cashierId = cashierId;
    show($('pin-modal'));
    $('pin-modal-input').focus();
    return;
  }
  if (action === 'sessions') {
    await openSessionModal(b.id, cashierId, name);
    return;
  }
  if (action === 'remove-pin') {
    if (!confirm(`Hapus PIN kasir "${name}"? Kasir kembali login pakai email/password.`)) return;
    try {
      await guard(() => api.cashiers.removePin(b.id, cashierId));
      alertBox('PIN kasir dihapus.', 'ok');
      await loadCashiers();
    } catch (e) {
      alertBox(describeError(e), 'error');
    }
    return;
  }
  if (action === 'unlock') {
    try {
      await guard(() => api.cashiers.unlock(b.id, cashierId));
      alertBox(`Kunci kasir "${name}" dibuka.`, 'ok');
      await loadCashiers();
    } catch (e) {
      alertBox(describeError(e), 'error');
    }
  }
});

$('pin-modal-cancel').addEventListener('click', () => hide($('pin-modal')));

$('pin-modal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const modal = $('pin-modal');
  const errEl = $('pin-modal-error');
  errEl.classList.add('hidden');
  const b = activeBusiness();
  const cashierId = modal.dataset.cashierId;
  if (!b || !cashierId) return;
  const pin = $('pin-modal-input').value.trim();
  if (!/^\d{4}$/.test(pin)) {
    errEl.textContent = 'PIN harus 4 digit angka.';
    errEl.classList.remove('hidden');
    return;
  }
  try {
    await guard(() => api.cashiers.setPin(b.id, cashierId, pin));
    alertBox('PIN kasir disimpan.', 'ok');
    hide(modal);
    await loadCashiers();
  } catch (e) {
    errEl.textContent = describeError(e);
    errEl.classList.remove('hidden');
  }
});

// ============================================================ Sesi Kasir ------
let sessionContext = null; // { businessId, cashierId, name }

const renderSessionRows = (items) => {
  const tbody = $('session-modal-body');
  tbody.innerHTML = '';
  $('session-modal-empty').classList.toggle('hidden', items.length > 0);
  for (const s of items) {
    const active = !s.revoked_at && new Date(s.expires_at) > new Date();
    const badge = active
      ? '<span class="badge ok">aktif</span>'
      : s.revoked_at
        ? '<span class="badge off">dicabut</span>'
        : '<span class="badge off">kedaluwarsa</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(fmtDate(s.created_at))}</td>
      <td>${escapeHtml(fmtDate(s.expires_at))}</td>
      <td>${badge}</td>
      <td class="muted small">${escapeHtml(s.ip || '—')}<div>${escapeHtml((s.user_agent || '—').slice(0, 60))}</div></td>`;
    tbody.appendChild(tr);
  }
};

const openSessionModal = async (businessId, cashierId, name) => {
  sessionContext = { businessId, cashierId, name };
  $('session-modal-cashier').textContent = `${name} — ${businessId.slice(0, 8)}…`;
  $('session-modal-error').classList.add('hidden');
  show($('session-modal'));
  await loadSessionModal();
};

const loadSessionModal = async () => {
  if (!sessionContext) return;
  const { businessId, cashierId, name } = sessionContext;
  try {
    const body = await guard(() => api.cashiers.sessions.list(businessId, cashierId));
    renderSessionRows(body?.items ?? []);
  } catch (err) {
    const el = $('session-modal-error');
    el.textContent = describeError(err);
    show(el);
  }
};

$('session-revoke-btn').addEventListener('click', async () => {
  if (!sessionContext) return;
  const { businessId, cashierId, name } = sessionContext;
  if (
    !confirm(
      `Paksa logout SEMUA sesi "${name}"?\nSesi di perangkat lain akan berakhir pada request berikutnya (berlaku di server).`
    )
  ) {
    return;
  }
  try {
    const result = await guard(() => api.cashiers.sessions.revoke(businessId, cashierId));
    alertBox(`Semua sesi ${name} dicabut (${result.revoked} sesi).`, 'ok');
    await loadSessionModal();
  } catch (err) {
    const el = $('session-modal-error');
    el.textContent = describeError(err);
    show(el);
  }
});
$('session-cancel').addEventListener('click', () => hide($('session-modal')));
$('session-modal').addEventListener('click', (event) => {
  if (event.target === $('session-modal')) hide($('session-modal'));
});

// ============================================================ Audit Log -------
const roleLabel = (role) =>
  ({ platform_admin: 'Admin', owner: 'Owner', cashier: 'Kasir' }[role] ?? role);

const auditFilters = () => ({
  actorRole: $('audit-role-filter').value || undefined,
  action: $('audit-action-filter').value.trim() || undefined,
  from: $('audit-date-from').value || undefined,
  to: $('audit-date-to').value || undefined,
});

const renderAuditRows = (items) => {
  const tbody = $('audit-body');
  tbody.innerHTML = '';
  hide($('audit-empty'));
  if (!items.length) {
    show($('audit-empty'));
    return;
  }
  for (const a of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(fmtDate(a.created_at))}</td>
      <td>${escapeHtml(a.actor_name || a.actor_email || '—')}</td>
      <td>${escapeHtml(roleLabel(a.actor_role))}</td>
      <td class="mono">${escapeHtml(a.action)}</td>
      <td>${escapeHtml(a.entity_type)}${a.entity_id ? `<div class="muted small mono">${escapeHtml(a.entity_id.slice(0, 8))}</div>` : ''}</td>
      <td class="mono">${escapeHtml(a.ip || '—')}</td>`;
    tbody.appendChild(tr);
  }
};

const loadAuditLog = async () => {
  const b = activeBusiness();
  if (!b) {
    hide($('audit-section'));
    return;
  }
  const offset = (state.auditPage - 1) * state.auditLimit;
  const body = await guard(() =>
    api.auditLogs.list(b.id, { ...auditFilters(), limit: state.auditLimit, offset })
  );
  if (!body) return;
  show($('audit-section'));
  renderAuditRows(body.items);
  state.auditTotal = body.total;

  const pages = Math.max(1, Math.ceil(body.total / state.auditLimit));
  if (state.auditPage > pages) {
    state.auditPage = pages;
    return loadAuditLog();
  }
  $('audit-page-info').textContent = `Halaman ${state.auditPage} / ${pages} • ${body.total} entri`;
  $('audit-prev-btn').disabled = state.auditPage <= 1;
  $('audit-next-btn').disabled = state.auditPage >= pages;
};

const resetAuditPageAndLoad = () => {
  state.auditPage = 1;
  loadAuditLog();
};
$('audit-refresh-btn').addEventListener('click', resetAuditPageAndLoad);
$('audit-role-filter').addEventListener('change', resetAuditPageAndLoad);
$('audit-date-from').addEventListener('change', resetAuditPageAndLoad);
$('audit-date-to').addEventListener('change', resetAuditPageAndLoad);
$('audit-action-filter').addEventListener(
  'input',
  debounce(() => {
    state.auditPage = 1;
    loadAuditLog();
  }, 400)
);
$('audit-prev-btn').addEventListener('click', () => {
  if (state.auditPage > 1) {
    state.auditPage -= 1;
    loadAuditLog();
  }
});
$('audit-next-btn').addEventListener('click', () => {
  state.auditPage += 1;
  loadAuditLog();
});

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
    hide($('cashier-section'));
    hide($('product-section'));
    hide($('tx-section'));
    hide($('report-section'));
    hide($('audit-section'));
    show($('waiting-state'));
  } else {
    hide($('waiting-state'));
    renderSelect();
    renderDetail();
    await refreshContext();
  }
};

/** Muat ulang data yang bergantung pada bisnis aktif (langganan + outlet + produk). */
const refreshContext = async () => {
  const b = activeBusiness();
  if (!b) return;
  const sub = await guard(() => api.subscription(b.id));
  renderSubscription(sub ?? null);
  await loadOutlets();
  await loadCashiers();
  await loadProducts();
  await loadTransactions();
  await loadReport();
  await loadAuditLog();
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
  $('outlet-tax-inclusive').checked = !!o.tax_inclusive;
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
  payload.taxInclusive = $('outlet-tax-inclusive').checked;

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

// ----------------------------------------------------- Produk & Kategori ----
const fillCategorySelect = (selectEl, selectedId = '', includeEmpty = true) => {
  selectEl.innerHTML = '';
  if (includeEmpty) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— tanpa kategori —';
    selectEl.appendChild(opt);
  }
  for (const c of state.categories) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    selectEl.appendChild(opt);
  }
  selectEl.value = selectedId ?? '';
};

const renderCategoryChips = () => {
  const wrap = $('category-chips');
  wrap.innerHTML = '';
  $('category-empty').classList.toggle('hidden', state.categories.length > 0);

  for (const c of state.categories) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(c.name)} <span class="muted">(${Number(c.product_count)})</span>
      <button type="button" data-action="delete-category" data-id="${c.id}" title="Hapus kategori">×</button>`;
    wrap.appendChild(chip);
  }

  // Sinkronkan filter kategori di daftar produk.
  fillCategorySelect($('product-filter-category'), $('product-filter-category').value, true);
  $('product-filter-category').querySelector('option[value=""]').textContent = 'Semua kategori';
};

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
      ? `Stok ${Number(p.total_stock)}`
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
          <span class="badge ${p.status === 'active' ? 'ok' : 'off'}">${escapeHtml(p.status)}</span>
        </div>
      </div>
      <div class="outlet-meta muted small">${stockLabel}</div>
      <div class="detail-actions">
        <button class="btn small" data-action="edit-product" data-id="${p.id}">Ubah</button>
        ${p.track_stock ? `<button class="btn small" data-action="stock" data-id="${p.id}">Atur stok</button>` : ''}
        <button class="btn small danger" data-action="delete-product" data-id="${p.id}">Hapus</button>
      </div>`;
    list.appendChild(card);
  }
};

const loadCategories = async (b) => {
  const body = await guard(() => api.categories.list(b.id));
  if (!body) return;
  state.categories = body.items;
  renderCategoryChips();
};

const loadProducts = async () => {
  const b = activeBusiness();
  if (!b) {
    hide($('product-section'));
    return;
  }
  show($('product-section'));
  await loadCategories(b);
  const body = await guard(() =>
    api.products.list(b.id, {
      search: $('product-search').value.trim(),
      categoryId: $('product-filter-category').value,
    })
  );
  if (!body) return;
  state.products = body.items;
  renderProductList(body.items);
};

$('new-product-btn').addEventListener('click', () => openProductCreate());
$('product-search').addEventListener('input', debounce(() => loadProducts(), 300));
$('product-filter-category').addEventListener('change', () => loadProducts());

$('product-list').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  const b = activeBusiness();
  if (!b) return;

  if (action === 'edit-product') {
    (async () => {
      try {
        const detail = await guard(() => api.products.get(b.id, id));
        if (detail?.product) openProductEdit(detail.product);
      } catch (err) {
        alertBox(describeError(err), 'error');
      }
    })();
  } else if (action === 'stock') {
    (async () => {
      try {
        const detail = await guard(() => api.products.get(b.id, id));
        if (detail) openStockModal(detail);
      } catch (err) {
        alertBox(describeError(err), 'error');
      }
    })();
  } else if (action === 'delete-product') {
    (async () => {
      if (!confirm('Hapus produk ini?')) return;
      try {
        await guard(() => api.products.remove(b.id, id));
        alertBox('Produk dihapus.', 'ok');
        await loadProducts();
      } catch (err) {
        alertBox(describeError(err), 'error');
      }
    })();
  }
});

// ---------- Modal kategori ----------
$('new-category-btn').addEventListener('click', () => {
  $('category-form').reset();
  hide($('category-form-error'));
  show($('category-modal'));
});
const closeCategoryModal = () => hide($('category-modal'));
$('category-cancel').addEventListener('click', closeCategoryModal);
$('category-modal').addEventListener('click', (event) => {
  if (event.target === $('category-modal')) closeCategoryModal();
});
$('category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('category-form-error'));
  const b = activeBusiness();
  if (!b) return;
  try {
    await guard(() => api.categories.create(b.id, { name: $('category-name').value.trim() }));
    alertBox('Kategori ditambahkan.', 'ok');
    closeCategoryModal();
    await loadCategories(b);
  } catch (err) {
    const el = $('category-form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

$('category-chips').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action="delete-category"]');
  if (!btn) return;
  const b = activeBusiness();
  if (!b) return;
  (async () => {
    if (!confirm('Hapus kategori ini?')) return;
    try {
      await guard(() => api.categories.remove(b.id, btn.dataset.id));
      alertBox('Kategori dihapus.', 'ok');
      await loadCategories(b);
    } catch (err) {
      alertBox(describeError(err), 'error');
    }
  })();
});

// ---------- Modal produk ----------
const openProductCreate = () => {
  const b = activeBusiness();
  if (!b) return;
  $('product-modal-title').textContent = 'Produk Baru';
  $('product-form').reset();
  $('product-id').value = '';
  $('product-track').checked = true;
  hide($('product-status-field'));
  fillCategorySelect($('product-category'), '');
  hide($('product-form-error'));
  show($('product-modal'));
};

const openProductEdit = (p) => {
  $('product-modal-title').textContent = 'Ubah Produk';
  $('product-id').value = p.id;
  $('product-name').value = p.name ?? '';
  $('product-price').value = p.price != null ? Number(p.price) / 100 : '';
  $('product-sku').value = p.sku ?? '';
  $('product-barcode').value = p.barcode ?? '';
  $('product-track').checked = !!p.track_stock;
  $('product-status').value = p.status ?? 'active';
  fillCategorySelect($('product-category'), p.category_id ?? '');
  show($('product-status-field'));
  hide($('product-form-error'));
  show($('product-modal'));
};

const closeProductModal = () => hide($('product-modal'));
$('product-cancel').addEventListener('click', closeProductModal);
$('product-modal').addEventListener('click', (event) => {
  if (event.target === $('product-modal')) closeProductModal();
});

$('product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('product-form-error'));
  const b = activeBusiness();
  if (!b) return;

  const id = $('product-id').value;
  const categoryId = $('product-category').value || null;
  const payload = {
    name: $('product-name').value.trim(),
    price: Math.round(Number($('product-price').value || 0) * 100),
    sku: $('product-sku').value.trim() || null,
    barcode: $('product-barcode').value.trim() || null,
    categoryId,
    trackStock: $('product-track').checked,
  };
  if (id) payload.status = $('product-status').value;

  try {
    if (id) {
      await guard(() => api.products.update(b.id, id, payload));
      alertBox('Produk diperbarui.', 'ok');
    } else {
      await guard(() => api.products.create(b.id, payload));
      alertBox('Produk baru berhasil dibuat.', 'ok');
    }
    closeProductModal();
    await loadProducts();
  } catch (err) {
    const el = $('product-form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

// ---------- Modal stok ----------
let stockContext = null;

const openStockModal = (detail) => {
  stockContext = { productId: detail.product.id };
  $('stock-product-name').textContent = detail.product.name;
  const rows = $('stock-rows');
  rows.innerHTML = '';
  hide($('stock-form-error'));

  if (!detail.stocks.length) {
    rows.innerHTML = '<p class="muted small">Belum ada outlet. Tambahkan outlet dulu.</p>';
  }

  for (const s of detail.stocks) {
    const row = document.createElement('div');
    row.className = 'stock-row';
    row.innerHTML = `
      <span>${escapeHtml(s.outlet_name)}</span>
      <div class="filter-bar" style="margin:0">
        <input type="number" min="0" step="1" value="${Number(s.quantity)}" data-outlet="${s.outlet_id}" />
        <button type="button" class="btn small primary" data-action="save-stock">Simpan</button>
      </div>`;
    rows.appendChild(row);
  }
  show($('stock-modal'));
};

$('stock-rows').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action="save-stock"]');
  if (!btn) return;
  const b = activeBusiness();
  if (!b || !stockContext) return;
  const input = btn.closest('.stock-row').querySelector('input[data-outlet]');
  (async () => {
    try {
      await guard(() => api.products.setStock(b.id, stockContext.productId, input.dataset.outlet, Number(input.value)));
      alertBox('Stok disimpan.', 'ok');
      await loadProducts();
    } catch (err) {
      const el = $('stock-form-error');
      el.textContent = describeError(err);
      show(el);
    }
  })();
});

const closeStockModal = () => hide($('stock-modal'));
$('stock-cancel').addEventListener('click', closeStockModal);
$('stock-modal').addEventListener('click', (event) => {
  if (event.target === $('stock-modal')) closeStockModal();
});

// ----------------------------------------------------- Transaksi --------------
const renderTxList = (items) => {
  const list = $('tx-list');
  list.innerHTML = '';
  hide($('tx-empty'));

  if (!items.length) {
    show($('tx-empty'));
    return;
  }

  for (const t of items) {
    const row = document.createElement('div');
    row.className = 'tx-row';
    row.innerHTML = `
      <div>
        <div class="mono">${escapeHtml(t.invoice_no)}</div>
        <span class="muted small">
          ${escapeHtml(t.outlet_name)} • ${escapeHtml(fmtDate(t.created_at))} • ${escapeHtml(fmtIDR(t.total))}
        </span>
      </div>
      <div class="right">
        <span class="badge ${t.status === 'completed' ? 'ok' : 'off'}">${escapeHtml(t.status)}</span>
        <button type="button" class="btn small" data-action="tx-detail" data-id="${t.id}">Detail</button>
      </div>`;
    list.appendChild(row);
  }
};

const loadTransactions = async () => {
  const b = activeBusiness();
  if (!b) {
    hide($('tx-section'));
    return;
  }
  show($('tx-section'));
  const body = await guard(() =>
    api.transactions.list(b.id, {
      status: $('tx-status-filter').value,
      outletId: $('tx-outlet-filter').value,
      dateFrom: $('tx-date-from').value,
      dateTo: $('tx-date-to').value,
    })
  );
  if (!body) return;
  renderTxList(body.items);
};

let activeTx = null;

const buildTxDetail = (t) => {
  const methodLabel = { cash: 'Tunai', card: 'Kartu', qr: 'QRIS', wallet: 'E-Wallet' };
  const rows = t.items
    .map(
      (it) => `
      <div class="tx-row">
        <div>
          <strong>${escapeHtml(it.product_name)}</strong>
          <span class="muted small">${escapeHtml(fmtIDR(it.unit_price))} × ${it.qty}</span>
        </div>
        <span class="right mono">${escapeHtml(fmtIDR(it.line_total))}</span>
      </div>`
    )
    .join('');

  const pays = t.payments
    .map(
      (p) => `
      <div class="tx-row">
        <div>
          <strong>${escapeHtml(methodLabel[p.method] ?? p.method)}</strong>
          ${p.reference ? `<span class="muted small">${escapeHtml(p.reference)}</span>` : ''}
        </div>
        <span class="right mono">${escapeHtml(fmtIDR(p.amount))}</span>
      </div>`
    )
    .join('');

  return `
    <div class="detail-head" style="margin-bottom:12px">
      <div>
        <p class="mono">${escapeHtml(t.invoice_no)}</p>
        <p class="muted small">${escapeHtml(t.outlet_name)} • kasir ${escapeHtml(t.cashier_name ?? '—')}</p>
        <p class="muted small">${escapeHtml(fmtDate(t.created_at))}</p>
      </div>
      <span class="badge ${t.status === 'completed' ? 'ok' : 'off'}">${escapeHtml(t.status)}</span>
    </div>
    <h4>Item</h4>
    <div class="tx-list">${rows}</div>
    <h4>Pembayaran</h4>
    <div class="tx-list">${pays}</div>
    <dl class="meta">
      <div><dt>Subtotal</dt><dd>${escapeHtml(fmtIDR(t.subtotal))}</dd></div>
      <div><dt>Diskon</dt><dd>${escapeHtml(fmtIDR(t.discount_total))}</dd></div>
      <div><dt>Pajak (${Number(t.tax_rate)}%)</dt><dd>${escapeHtml(fmtIDR(t.tax_total))}</dd></div>
      <div><dt>Total</dt><dd class="strong">${escapeHtml(fmtIDR(t.total))}</dd></div>
      <div><dt>Dibayar</dt><dd>${escapeHtml(fmtIDR(t.paid_amount))}</dd></div>
      <div><dt>Kembalian</dt><dd>${escapeHtml(fmtIDR(t.change_amount))}</dd></div>
    </dl>`;
};

const closeTxModal = () => {
  hide($('tx-modal'));
  activeTx = null;
};

const openTxDetail = async (id) => {
  const b = activeBusiness();
  if (!b) return;
  hide($('tx-form-error'));
  try {
    const { transaction } = await guard(() => api.transactions.get(b.id, id));
    activeTx = transaction;
    $('tx-modal-title').textContent = 'Detail Transaksi';
    $('tx-detail').innerHTML = buildTxDetail(transaction);
    $('tx-void-btn').classList.toggle('hidden', transaction.status !== 'completed');
    show($('tx-modal'));
  } catch (err) {
    alertBox(describeError(err), 'error');
  }
};

$('tx-list').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action="tx-detail"]');
  if (btn) openTxDetail(btn.dataset.id);
});

$('tx-refresh-btn').addEventListener('click', loadTransactions);
$('tx-status-filter').addEventListener('change', loadTransactions);
$('tx-outlet-filter').addEventListener('change', loadTransactions);
$('tx-date-from').addEventListener('change', loadTransactions);
$('tx-date-to').addEventListener('change', loadTransactions);

$('tx-void-btn').addEventListener('click', async () => {
  const b = activeBusiness();
  if (!b || !activeTx) return;
  if (!confirm(`Batalkan transaksi ${activeTx.invoice_no}? Stok akan dikembalikan otomatis.`)) return;
  hide($('tx-form-error'));
  try {
    await guard(() => api.transactions.void(b.id, activeTx.id));
    alertBox(`Transaksi ${activeTx.invoice_no} dibatalkan; stok dikembalikan.`, 'ok');
    closeTxModal();
    await loadTransactions();
  } catch (err) {
    const el = $('tx-form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

$('tx-cancel').addEventListener('click', closeTxModal);
$('tx-modal').addEventListener('click', (event) => {
  if (event.target === $('tx-modal')) closeTxModal();
});

// ------------------------------------------------------------- Laporan --------
const todayInTz = (timezone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Jakarta' }).format(new Date());

/** Kurangi/tambah hari dari tanggal ISO tanpa efek zona waktu (aritmetika UTC). */
const shiftIsoDays = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const reportQuery = () => ({
  groupBy: $('rep-group-by').value,
  outletId: $('rep-outlet-filter').value,
  from: $('rep-date-from').value,
  to: $('rep-date-to').value,
  status: $('rep-status').value,
  paymentMethod: $('rep-payment-method').value,
  paymentStatus: $('rep-payment-status').value,
  search: $('rep-search').value.trim(),
});

/** Rentang cepat: hari ini / 7 hari / bulan ini / kustom (biarkan tanggal). */
const applyQuickRange = () => {
  const b = activeBusiness();
  if (!b) return;
  const range = $('rep-range').value;
  const today = todayInTz(b.timezone);
  if (range === 'today') {
    $('rep-date-from').value = today;
    $('rep-date-to').value = today;
  } else if (range === '7d') {
    $('rep-date-from').value = shiftIsoDays(today, -6);
    $('rep-date-to').value = today;
  } else if (range === 'month') {
    $('rep-date-from').value = `${today.slice(0, 7)}-01`;
    $('rep-date-to').value = today;
  } else {
    return; // kustom: pemilik mengatur tanggal sendiri
  }
  loadReport();
};

const renderReport = ({ rows, sum, top }) => {
  // Kartu ringkasan.
  const cards = [
    { label: 'Total pendapatan', value: fmtIDR(sum.total), sub: `${sum.transactions} transaksi` },
    { label: 'Rata-rata per transaksi', value: fmtIDR(sum.avg_total), sub: '' },
    { label: 'Dibatalkan (void)', value: fmtIDR(sum.voided_total), sub: '' },
    { label: 'Outlet aktif', value: `${sum.active_outlets}`, sub: '' },
  ];
  $('rep-summary').innerHTML = cards
    .map(
      (c) => `
      <div class="card stat">
        <span class="stat-label">${escapeHtml(c.label)}</span>
        <strong class="stat-value">${escapeHtml(c.value)}</strong>
        ${c.sub ? `<span class="muted small">${escapeHtml(c.sub)}</span>` : ''}
      </div>`
    )
    .join('');

  // Produk terlaris.
  const prodList = $('rep-top-products');
  prodList.innerHTML = '';
  hide($('rep-top-empty'));
  if (top.length) {
    for (const p of top) {
      const row = document.createElement('div');
      row.className = 'tx-row';
      row.innerHTML = `
        <div><strong>${escapeHtml(p.product_name)}</strong>
          <span class="muted small">${p.qty} item terjual</span></div>
        <span class="right mono">${escapeHtml(fmtIDR(p.revenue))}</span>`;
      prodList.appendChild(row);
    }
  } else {
    show($('rep-top-empty'));
  }

  // Tabel agregat.
  const body = $('rep-body');
  body.innerHTML = '';
  hide($('rep-empty'));
  if (!rows.length) {
    show($('rep-empty'));
    return;
  }
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(r.period_start)}</td>
      <td class="right">${r.transactions}</td>
      <td class="right">${r.items_sold}</td>
      <td class="right">${escapeHtml(fmtIDR(r.subtotal))}</td>
      <td class="right">${escapeHtml(fmtIDR(r.discount_total))}</td>
      <td class="right">${escapeHtml(fmtIDR(r.tax_total))}</td>
      <td class="right strong">${escapeHtml(fmtIDR(r.total))}</td>
      <td class="right">${r.voided_total ? escapeHtml(fmtIDR(r.voided_total)) : '—'}</td>`;
    body.appendChild(tr);
  }
};

const loadReport = async () => {
  const b = activeBusiness();
  if (!b) {
    hide($('report-section'));
    return;
  }
  show($('report-section'));
  $('rep-business-type').textContent = b.business_type
    ? `• ${b.business_type}`
    : '';
  const query = reportQuery();
  const rows = await guard(() => api.reports.grouped(b.id, query));
  if (!rows) return;
  const { summary: sum, top_products: top } = await guard(() =>
    api.reports.summary(b.id, query)
  );
  if (!sum) return;
  renderReport({ rows, sum, top });
};

const downloadReport = async (format) => {
  const b = activeBusiness();
  if (!b) return;
  try {
    const data = await guard(() => api.reports.download(b.id, reportQuery(), format));
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([text], {
      type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `laporan-${(b.name ?? 'bisnis').toLowerCase().replace(/\s+/g, '-')}-${today}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alertBox(describeError(err), 'error');
  }
};

const downloadExcel = async () => {
  const b = activeBusiness();
  if (!b) return;
  const btn = $('rep-export-xlsx');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Menyiapkan…';
  try {
    const { blob, filename } = await api.reports.downloadXlsx(b.id, reportQuery());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    alertBox(`Rekapan Excel berhasil diunduh (${blob.size.toLocaleString('id-ID')} byte).`, 'ok');
  } catch (err) {
    alertBox(describeError(err), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
};

$('rep-refresh-btn').addEventListener('click', loadReport);
$('rep-range').addEventListener('change', applyQuickRange);
$('rep-group-by').addEventListener('change', loadReport);
$('rep-outlet-filter').addEventListener('change', loadReport);
$('rep-date-from').addEventListener('change', loadReport);
$('rep-date-to').addEventListener('change', loadReport);
$('rep-status').addEventListener('change', loadReport);
$('rep-payment-method').addEventListener('change', loadReport);
$('rep-payment-status').addEventListener('change', loadReport);
$('rep-search').addEventListener('input', debounce(loadReport, 350));
$('rep-export-xlsx').addEventListener('click', downloadExcel);
$('rep-export-csv').addEventListener('click', () => downloadReport('csv'));
$('rep-export-json').addEventListener('click', () => downloadReport('json'));

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