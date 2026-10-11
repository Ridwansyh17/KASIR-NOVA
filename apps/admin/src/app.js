/**
 * Logika UI panel Admin Platform (Vanilla JS modular).
 *
 * Tab Owner  : kelola akun owner (buat/ubah/status/reset/hapus).
 * Tab Paket  : kelola paket langganan (kuota outlet/kasir, harga, default).
 * Tab Bisnis : lihat semua bisnis + kelola langganannya (pasang paket/status).
 *
 * Semua otorisasi tetap ditegakkan server; UI ini hanya alat bantu.
 */
import { api, login, logout, tokenStore, ApiError } from './api.js';

const $ = (id) => document.getElementById(id);

const state = {
  // owners
  page: 1, limit: 10, total: 0, search: '', status: '', owners: [],
  // plans
  plans: [],
  // businesses
  bizPage: 1, bizLimit: 20, bizTotal: 0, bizSearch: '', businesses: [],
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

const fmtIDR = (sen) => `Rp ${((Number(sen) ?? 0) / 100).toLocaleString('id-ID')}`;

const describeError = (err) => {
  if (err instanceof ApiError && err.details?.fields?.length) {
    return err.details.fields.map((f) => `${f.path ? f.path + ': ' : ''}${f.message}`).join('; ');
  }
  return err?.message ?? 'Terjadi kesalahan';
};

const alertBox = (alertId, message, type = 'info') => {
  const el = $(alertId);
  if (!el) return;
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

// ------------------------------------------------------------- Tabs ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-view').forEach((v) => hide(v));
    show($(`view-${tab.dataset.tab}`));
    if (tab.dataset.tab === 'plans') loadPlans();
    if (tab.dataset.tab === 'businesses') loadBusinesses();
  });
});

// ---------------------------------------------------------------- Login ------
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

const fetchCurrentUser = async () => {
  const { user } = await guard(() => api.me());
  $('current-user').textContent = user ? `${user.fullName} (${user.email})` : '';
};

// =============================================================== TAB OWNER ===
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
      alertBox('alert-owners', 'Status berhasil diubah.', 'ok');
      await loadOwners();
    } catch (err) {
      alertBox('alert-owners', describeError(err), 'error');
    }
    return;
  }

  if (action === 'reset') {
    const pw = prompt(`Password baru untuk ${owner.email} (minimal 8 karakter):`);
    if (!pw) return;
    try {
      await guard(() => api.resetPassword(id, pw));
      alertBox('alert-owners', 'Password berhasil direset. Semua sesi owner dicabut.', 'ok');
    } catch (err) {
      alertBox('alert-owners', describeError(err), 'error');
    }
    return;
  }

  if (action === 'delete') {
    if (!confirm(`Hapus (nonaktifkan) owner ${owner.email}?`)) return;
    try {
      await guard(() => api.deleteOwner(id));
      alertBox('alert-owners', 'Owner dihapus.', 'ok');
      await loadOwners();
    } catch (err) {
      alertBox('alert-owners', describeError(err), 'error');
    }
  }
});

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
      alertBox('alert-owners', 'Owner diperbarui.', 'ok');
    } else {
      const password = $('owner-password').value;
      const payload = { fullName, email, password };
      if (phone) payload.phone = phone;
      await guard(() => api.createOwner(payload));
      alertBox('alert-owners', 'Owner baru berhasil dibuat.', 'ok');
    }
    closeModal();
    await loadOwners();
  } catch (err) {
    const el = $('form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

// =============================================================== TAB PAKET ===
const renderPlans = (items) => {
  const tbody = $('plans-body');
  tbody.innerHTML = '';
  hide($('plans-empty'));
  if (!items.length) {
    show($('plans-empty'));
    return;
  }
  for (const p of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${p.max_outlets}</td>
      <td>${p.max_cashiers}</td>
      <td>${escapeHtml(fmtIDR(p.price))}</td>
      <td>${p.duration_days}</td>
      <td>${p.is_default ? '<span class="badge ok">default</span>' : '—'}</td>
      <td>${p.is_active ? '<span class="badge ok">aktif</span>' : '<span class="badge off">nonaktif</span>'}</td>
      <td class="right actions">
        <button class="btn small" data-action="edit" data-id="${p.id}">Ubah</button>
        <button class="btn small" data-action="toggle" data-id="${p.id}">${p.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
      </td>`;
    tbody.appendChild(tr);
  }
};

const loadPlans = async () => {
  const body = await guard(() => api.listPlans());
  if (!body) return;
  state.plans = body.items;
  renderPlans(body.items);
};

$('refresh-plans-btn').addEventListener('click', () => loadPlans());
$('new-plan-btn').addEventListener('click', () => {
  $('plan-modal-title').textContent = 'Paket Baru';
  $('plan-form').reset();
  $('plan-id').value = '';
  $('plan-active').checked = true;
  hide($('plan-form-error'));
  show($('plan-modal'));
});

$('plans-body').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  const plan = state.plans.find((p) => p.id === id);
  if (!plan) return;

  if (action === 'edit') {
    $('plan-modal-title').textContent = 'Ubah Paket';
    $('plan-id').value = plan.id;
    $('plan-name').value = plan.name ?? '';
    $('plan-max-outlets').value = plan.max_outlets ?? 1;
    $('plan-max-cashiers').value = plan.max_cashiers ?? 1;
    $('plan-price').value = plan.price ?? 0;
    $('plan-duration').value = plan.duration_days ?? 30;
    $('plan-default').checked = Boolean(plan.is_default);
    $('plan-active').checked = Boolean(plan.is_active);
    hide($('plan-form-error'));
    show($('plan-modal'));
    return;
  }

  if (action === 'toggle') {
    const next = !plan.is_active;
    try {
      await guard(() => api.updatePlan(id, { isActive: next }));
      alertBox('alert-plans', `Paket ${plan.name} ${next ? 'diaktifkan' : 'dinonaktifkan'}.`, 'ok');
      await loadPlans();
    } catch (err) {
      alertBox('alert-plans', describeError(err), 'error');
    }
  }
});

$('plan-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('plan-form-error'));
  const id = $('plan-id').value;
  const payload = {
    name: $('plan-name').value.trim(),
    maxOutlets: Number($('plan-max-outlets').value),
    maxCashiers: Number($('plan-max-cashiers').value),
    price: Number($('plan-price').value),
    durationDays: Number($('plan-duration').value),
    isDefault: $('plan-default').checked,
    isActive: $('plan-active').checked,
  };
  try {
    if (id) {
      await guard(() => api.updatePlan(id, payload));
      alertBox('alert-plans', 'Paket diperbarui.', 'ok');
    } else {
      await guard(() => api.createPlan(payload));
      alertBox('alert-plans', 'Paket baru berhasil dibuat.', 'ok');
    }
    hide($('plan-modal'));
    await loadPlans();
  } catch (err) {
    const el = $('plan-form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

$('plan-cancel').addEventListener('click', () => hide($('plan-modal')));
$('plan-modal').addEventListener('click', (event) => {
  if (event.target === $('plan-modal')) hide($('plan-modal'));
});

// ================================================== TAB BISNIS & LANGGANAN ===
const renderBusinesses = (items) => {
  const tbody = $('biz-body');
  tbody.innerHTML = '';
  hide($('biz-empty'));
  if (!items.length) {
    show($('biz-empty'));
    return;
  }
  for (const b of items) {
    const tr = document.createElement('tr');
    const subBadge = b.subscription_status
      ? `<span class="badge ${b.subscription_status === 'active' ? 'ok' : 'off'}">${escapeHtml(b.subscription_status)}</span>`
      : '<span class="badge off">belum ada</span>';
    tr.innerHTML = `
      <td><strong>${escapeHtml(b.name)}</strong><div class="muted small">${escapeHtml(b.business_type || '—')}</div></td>
      <td>${escapeHtml(b.owner_name)}<div class="muted small">${escapeHtml(b.owner_email)}</div></td>
      <td>${escapeHtml(b.plan_name || '—')}</td>
      <td>${subBadge}</td>
      <td>${b.status === 'active' ? '<span class="badge ok">aktif</span>' : '<span class="badge off">nonaktif</span>'}</td>
      <td class="right actions">
        <button class="btn small" data-action="report" data-id="${b.id}">Laporan</button>
        <button class="btn small" data-action="sub" data-id="${b.id}">Langganan</button>
      </td>`;
    tbody.appendChild(tr);
  }
};

const loadBusinesses = async () => {
  const body = await guard(() =>
    api.listBusinesses({ search: state.bizSearch, page: state.bizPage, limit: state.bizLimit })
  );
  if (!body) return;

  state.businesses = body.items;
  state.bizTotal = body.total;
  renderBusinesses(body.items);

  const pages = Math.max(1, Math.ceil(body.total / state.bizLimit));
  if (state.bizPage > pages) {
    state.bizPage = pages;
    return loadBusinesses();
  }
  $('biz-page-info').textContent = `Halaman ${state.bizPage} / ${pages} • ${body.total} bisnis`;
  $('biz-prev-btn').disabled = state.bizPage <= 1;
  $('biz-next-btn').disabled = state.bizPage >= pages;
};

let bizTimer = null;
$('biz-search').addEventListener('input', (event) => {
  state.bizSearch = event.target.value.trim();
  state.bizPage = 1;
  clearTimeout(bizTimer);
  bizTimer = setTimeout(loadBusinesses, 300);
});
$('refresh-biz-btn').addEventListener('click', () => loadBusinesses());
$('biz-prev-btn').addEventListener('click', () => {
  if (state.bizPage > 1) {
    state.bizPage -= 1;
    loadBusinesses();
  }
});
$('biz-next-btn').addEventListener('click', () => {
  state.bizPage += 1;
  loadBusinesses();
});

let currentSubBusinessId = null;

const openSubModal = async (businessId) => {
  currentSubBusinessId = businessId;
  hide($('sub-form-error'));
  show($('sub-modal'));

  // Isi pilihan paket (semua paket aktif).
  const plansBody = await guard(() => api.listPlans());
  const select = $('sub-plan-select');
  select.innerHTML = '';
  const store = state.businesses.find((b) => b.id === businessId);
  const currentPlanName = store?.plan_name ?? '';
  for (const p of (plansBody?.items ?? [])) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.max_outlets} outlet, ${p.max_cashiers} kasir)${p.is_default ? ' — default' : ''}`;
    select.appendChild(opt);
  }
  if (plansBody?.items?.length) select.selectedIndex = 0;

  // Info langganan saat ini.
  try {
    const viewBody = await guard(() => api.getBusinessSubscription(businessId));
    $('sub-current').textContent = `Saat ini: ${viewBody?.plan?.name ?? '—'} — status ${viewBody?.subscription?.status ?? '—'} · sampai ${fmtDate(viewBody?.subscription?.expires_at)}`;
    $('sub-status-select').value = viewBody?.subscription?.status ?? 'active';
  } catch (err) {
    if (err.status === 404) {
      $('sub-current').textContent = 'Bisnis belum memiliki langganan.';
    } else {
      $('sub-current').textContent = describeError(err);
    }
  }
};

$('biz-body').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn || btn.dataset.action !== 'sub') return;
  await openSubModal(btn.dataset.id);
});

$('sub-assign').addEventListener('click', async () => {
  const planId = $('sub-plan-select').value;
  try {
    await guard(() => api.assignSubscription(currentSubBusinessId, planId));
    alertBox('alert-biz', 'Paket langganan berhasil dipasang.', 'ok');
    hide($('sub-modal'));
    await loadBusinesses();
  } catch (err) {
    const el = $('sub-form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

$('sub-set-status').addEventListener('click', async () => {
  const status = $('sub-status-select').value;
  try {
    await guard(() => api.setSubscriptionStatus(currentSubBusinessId, status));
    alertBox('alert-biz', `Status langganan diubah menjadi ${status}.`, 'ok');
    hide($('sub-modal'));
    await loadBusinesses();
  } catch (err) {
    const el = $('sub-form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

$('sub-cancel').addEventListener('click', () => hide($('sub-modal')));
$('sub-modal').addEventListener('click', (event) => {
  if (event.target === $('sub-modal')) hide($('sub-modal'));
});

// ================================================== MODAL LAPORAN (baca) ======
let currentReportBusinessId = null;

const openReportModal = async (businessId) => {
  currentReportBusinessId = businessId;
  hide($('report-modal-error'));
  const store = state.businesses.find((b) => b.id === businessId);
  $('report-modal-title').textContent = `Laporan — ${store?.name ?? 'Bisnis'}`;
  $('report-modal-sub').textContent = store?.owner_name
    ? `Owner: ${store.owner_name}`
    : '';
  show($('report-modal'));
  await loadReportModal();
};

const reportModalQuery = () => ({
  groupBy: $('rep-modal-group-by').value,
  from: $('rep-modal-from').value,
  to: $('rep-modal-to').value,
});

const renderReportModal = ({ rows, sum, top }) => {
  const cards = [
    { label: 'Total pendapatan', value: fmtIDR(sum.total), sub: `${sum.transactions} transaksi` },
    { label: 'Rata-rata / transaksi', value: fmtIDR(sum.avg_total), sub: '' },
    { label: 'Dibatalkan (void)', value: fmtIDR(sum.voided_total), sub: '' },
    { label: 'Outlet aktif', value: `${sum.active_outlets}`, sub: '' },
  ];
  $('rep-modal-summary').innerHTML = cards
    .map(
      (c) => `
      <div class="card stat">
        <span class="stat-label">${escapeHtml(c.label)}</span>
        <strong class="stat-value">${escapeHtml(c.value)}</strong>
        ${c.sub ? `<span class="muted small">${escapeHtml(c.sub)}</span>` : ''}
      </div>`
    )
    .join('');

  const topEl = $('rep-modal-top');
  topEl.innerHTML = '';
  for (const p of top) {
    const row = document.createElement('div');
    row.className = 'tx-row';
    row.innerHTML = `
      <div><strong>${escapeHtml(p.product_name)}</strong>
        <span class="muted small">${p.qty} item terjual</span></div>
      <span class="right mono">${escapeHtml(fmtIDR(p.revenue))}</span>`;
    topEl.appendChild(row);
  }

  const tbody = $('rep-modal-body');
  tbody.innerHTML = '';
  hide($('rep-modal-empty'));
  if (!rows.length) {
    show($('rep-modal-empty'));
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
    tbody.appendChild(tr);
  }
};

const loadReportModal = async () => {
  if (!currentReportBusinessId) return;
  hide($('report-modal-error'));
  try {
    const query = reportModalQuery();
    const rows = await guard(() => api.reports.grouped(currentReportBusinessId, query));
    const { summary: sum, top_products: top } = await guard(() =>
      api.reports.summary(currentReportBusinessId, query)
    );
    if (!rows || !sum) return;
    renderReportModal({ rows, sum, top });
  } catch (err) {
    const el = $('report-modal-error');
    el.textContent = describeError(err);
    show(el);
  }
};

const downloadReportModal = async (format) => {
  if (!currentReportBusinessId) return;
  try {
    const data = await guard(() =>
      api.reports.download(currentReportBusinessId, { from: $('rep-modal-from').value, to: $('rep-modal-to').value }, format)
    );
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([text], {
      type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-${currentReportBusinessId}-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    const el = $('report-modal-error');
    el.textContent = describeError(err);
    show(el);
  }
};

$('biz-body').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn || btn.dataset.action !== 'report') return;
  await openReportModal(btn.dataset.id);
});

$('rep-modal-load').addEventListener('click', loadReportModal);
$('rep-modal-group-by').addEventListener('change', loadReportModal);
$('rep-modal-from').addEventListener('change', loadReportModal);
$('rep-modal-to').addEventListener('change', loadReportModal);
$('rep-modal-csv').addEventListener('click', () => downloadReportModal('csv'));
$('rep-modal-json').addEventListener('click', () => downloadReportModal('json'));
$('report-modal-close').addEventListener('click', () => hide($('report-modal')));
$('report-modal').addEventListener('click', (event) => {
  if (event.target === $('report-modal')) hide($('report-modal'));
});

// ------------------------------------------------------------- Bootstrap -----
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