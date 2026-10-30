/**
 * Logika UI panel Admin Platform (Vanilla JS modular).
 *
 * Tab Owner      : kelola akun owner (buat/ubah/status/reset/hapus).
 * Tab Paket      : kelola paket langganan (kuota outlet/kasir, harga, default).
 * Tab Bisnis     : lihat semua bisnis + kelola langganannya (pasang paket/status).
 * Tab Setoran    : monitoring setoran kasir lintas bisnis (baca saja).
 *
 * Semua otorisasi tetap ditegakkan server; UI ini hanya alat bantu.
 */
import { api, login, logout, restoreSession, tokenStore, ApiError } from './api.js';
import './pw-toggle.js';

const $ = (id) => document.getElementById(id);

const state = {
  // owners
  page: 1, limit: 10, total: 0, search: '', status: '', owners: [],
  // approval center
  approvalStatus: 'pending', approvalSearch: '', approvals: [], approvalsPending: 0,
  // plans
  plans: [],
  // businesses
  bizPage: 1, bizLimit: 20, bizTotal: 0, bizSearch: '', businesses: [],
  // audit log
  auditPage: 1, auditLimit: 20, auditTotal: 0, audits: [],
  // sessions
  cashierSessions: [],
  // settlements (monitoring Platform Admin)
  settlePage: 1, settleLimit: 20, settleTotal: 0, settlements: [],
};

const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

// --------------------------------------------------------- Sidebar ----------
/** Buka/tutup navigasi samping pada layar kecil. */
const setSidebarOpen = (open) => {
  document.body.classList.toggle('sidebar-open', open);
  $('sidebar-toggle')?.setAttribute('aria-expanded', String(open));
};

$('sidebar-toggle')?.addEventListener('click', () => {
  setSidebarOpen(!document.body.classList.contains('sidebar-open'));
});
$('sidebar-overlay')?.addEventListener('click', () => setSidebarOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setSidebarOpen(false);
});

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

const waNumber = (phone) => {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return digits;
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
    setSidebarOpen(false);
    document.querySelectorAll('.tab-view').forEach((v) => hide(v));
    show($(`view-${tab.dataset.tab}`));
    if (tab.dataset.tab === 'approvals') loadApprovals();
    if (tab.dataset.tab === 'plans') loadPlans();
    if (tab.dataset.tab === 'businesses') loadBusinesses();
    if (tab.dataset.tab === 'audit') loadAuditLogs();
    if (tab.dataset.tab === 'sessions') loadCashierSessions();
    if (tab.dataset.tab === 'settlements') loadSettlements();
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
    await loadApprovals();
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

// ------------------------------------------------------- Ganti sandi --------
// Keputusan #5: pengguna dapat mengganti sandi sendiri. Server memverifikasi
// sandi lama dan mencabut sesi di perangkat lain; sesi ini dipertahankan
// dengan mengirim refresh token perangkat.
const openPasswordModal = () => {
  $('password-form').reset();
  hide($('password-error'));
  hide($('password-success'));
  show($('password-modal'));
  $('password-current').focus();
};

const closePasswordModal = () => hide($('password-modal'));

$('change-password-btn').addEventListener('click', openPasswordModal);
$('password-cancel').addEventListener('click', closePasswordModal);
$('password-modal').addEventListener('click', (event) => {
  if (event.target === $('password-modal')) closePasswordModal();
});

$('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('password-error'));
  hide($('password-success'));

  const currentPassword = $('password-current').value;
  const newPassword = $('password-new').value;
  if (newPassword !== $('password-confirm').value) {
    $('password-error').textContent = 'Konfirmasi sandi baru tidak sama.';
    show($('password-error'));
    return;
  }

  const button = event.submitter ?? $('password-form').querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await guard(() => api.changePassword({ currentPassword, newPassword }));
    $('password-current').value = '';
    $('password-new').value = '';
    $('password-confirm').value = '';
    $('password-success').textContent =
      'Sandi berhasil diubah. Sesi di perangkat lain telah diakhiri.';
    show($('password-success'));
    setTimeout(closePasswordModal, 1500);
  } catch (err) {
    $('password-error').textContent = describeError(err);
    show($('password-error'));
  } finally {
    button.disabled = false;
  }
});

const fetchCurrentUser = async () => {
  const body = await guard(() => api.me());
  const user = body?.user ?? null;
  $('current-user').textContent = user ? `${user.fullName} (${user.email})` : '';
  return user;
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
    const registrationLabels = {
      draft: '<span class="badge warn">draft</span>',
      pending: '<span class="badge warn">menunggu approval</span>',
      approved: '<span class="badge ok">disetujui</span>',
      rejected: '<span class="badge off">ditolak</span>',
    };
    const verifyBadge = o.registration_status
      ? registrationLabels[o.registration_status] ?? escapeHtml(o.registration_status)
      : o.email_verified_at
        ? '<span class="badge ok">owner lama</span>'
        : '<span class="badge warn">belum aktif</span>';
    const toggleLabel = o.status === 'active' ? 'Nonaktifkan' : 'Aktifkan';
    const pending = o.pending_business_name
      ? `<div class="muted small">Bisnis: ${escapeHtml(o.pending_business_name)}</div>`
      : '';
    const wa = waNumber(o.phone);
    const waLink = wa
      ? `<a class="btn small" href="https://wa.me/${wa}" target="_blank" rel="noopener">WA</a>`
      : '';
    const approveBtn =
      o.registration_status === 'pending' && o.registration_id
        ? `<button class="btn small primary" data-action="approve-registration" data-id="${o.id}">Setujui</button>`
        : '';

    tr.innerHTML = `
      <td>${escapeHtml(o.full_name)}${pending}</td>
      <td>${escapeHtml(o.email)}</td>
      <td>${escapeHtml(o.phone ?? '—')}</td>
      <td>${statusBadge}</td>
      <td>${verifyBadge}</td>
      <td class="muted">${escapeHtml(fmtDate(o.created_at))}</td>
      <td class="right actions">
        ${approveBtn}
        ${waLink}
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

  if (action === 'approve-registration') {
    if (!owner.registration_id) {
      alertBox('alert-owners', 'Data pendaftaran tidak ditemukan. Muat ulang daftar.', 'error');
      return;
    }
    openApprovalModal('approve', {
      id: owner.registration_id,
      business_name: owner.pending_business_name ?? owner.full_name,
      owner: { full_name: owner.full_name, email: owner.email },
      plan: { name: '—' },
    });
    return;
  }

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

// ========================================================== APPROVAL CENTER ===
const setApprovalBadge = (count) => {
  state.approvalsPending = Number(count) || 0;
  const badge = $('approval-badge');
  if (!badge) return;
  badge.textContent = state.approvalsPending;
  badge.classList.toggle('hidden', state.approvalsPending === 0);
};

const renderApprovals = (items) => {
  const tbody = $('approvals-body');
  tbody.innerHTML = '';
  hide($('approvals-empty'));

  if (!items.length) {
    show($('approvals-empty'));
    return;
  }

  for (const item of items) {
    const tr = document.createElement('tr');
    const statusBadge =
      item.status === 'approved'
        ? '<span class="badge ok">disetujui</span>'
        : item.status === 'rejected'
          ? '<span class="badge off">ditolak</span>'
          : item.status === 'pending'
            ? '<span class="badge warn">menunggu</span>'
            : '<span class="badge">draft</span>';
    const owner = item.owner ?? {};
    const plan = item.plan ?? {};
    const periode = item.billing_period === 'yearly' ? 'Tahunan' : 'Bulanan';
    const harga = item.agreed_price ? ` • ${fmtIDR(item.agreed_price)}` : '';
    const actions =
      item.status === 'pending'
        ? `<button class="btn small primary" data-approval-action="approve" data-id="${item.id}">Setujui</button>
           <button class="btn small danger" data-approval-action="reject" data-id="${item.id}">Tolak</button>`
        : item.status === 'rejected'
          ? `<div class="muted small">${escapeHtml(item.rejection_reason ?? '')}</div>`
          : `<div class="muted small">${escapeHtml(fmtDate(item.approved_at))}</div>`;

    tr.innerHTML = `
      <td>${escapeHtml(owner.full_name ?? '—')}
        <div class="muted small">${escapeHtml(owner.email ?? '')}</div></td>
      <td>${escapeHtml(item.business_name)}</td>
      <td>${escapeHtml(item.registration_number)}</td>
      <td>${escapeHtml(plan.name ?? '—')}
        <div class="muted small">${escapeHtml(periode)}${escapeHtml(harga)}</div></td>
      <td class="muted">${escapeHtml(fmtDate(item.requested_at))}</td>
      <td>${statusBadge}</td>
      <td class="right actions">${actions}</td>`;
    tbody.appendChild(tr);
  }
};

const loadApprovals = async () => {
  const body = await guard(() =>
    api.listApprovals({
      status: state.approvalStatus,
      search: state.approvalSearch,
      limit: 100,
    })
  );
  if (!body) return;
  state.approvals = body.items;
  renderApprovals(body.items);
  setApprovalBadge(body.pending);
};

// Konfirmasi memakai modal di dalam panel, bukan `confirm()`/`prompt()` bawaan
// browser: sebagian WebView/mode kios menekan dialog native tanpa memberi tahu
// pengguna, sehingga tombol Setujui terlihat "tidak berfungsi".
let approvalTarget = null;

const closeApprovalModal = () => {
  approvalTarget = null;
  hide($('approval-modal'));
};

const openApprovalModal = (action, item) => {
  approvalTarget = { action, item };
  const approving = action === 'approve';
  $('approval-modal-title').textContent = approving
    ? 'Setujui Pendaftaran'
    : 'Tolak Pendaftaran';
  const planName = item.plan?.name && item.plan.name !== '—' ? item.plan.name : null;
  const periode = item.billing_period === 'yearly' ? 'Tahunan' : 'Bulanan';
  const harga = item.agreed_price ? `, ${fmtIDR(item.agreed_price)}` : '';
  $('approval-modal-text').textContent = approving
    ? `Setujui ${item.owner?.full_name ?? 'Owner'} / ${item.business_name}? ` +
      (planName ? `Paket: ${planName} (${periode}${harga}). ` : '') +
      'Masa gratis 30 hari dimulai sekarang.'
    : `Tolak pendaftaran ${item.business_name}? Bisnis dan langganan tidak dibuat.`;
  $('approval-modal-error').classList.add('hidden');
  $('approval-reason').value = '';
  $('approval-reason-wrap').classList.toggle('hidden', approving);
  $('approval-confirm').textContent = approving ? 'Setujui' : 'Tolak';
  $('approval-confirm').classList.toggle('danger', !approving);
  $('approval-confirm').classList.toggle('primary', approving);
  show($('approval-modal'));
  if (!approving) $('approval-reason').focus();
};

const submitApproval = async () => {
  if (!approvalTarget) return;
  const { action, item } = approvalTarget;
  const button = $('approval-confirm');
  const errorEl = $('approval-modal-error');
  hide(errorEl);
  button.disabled = true;
  try {
    const result =
      action === 'approve'
        ? await guard(() => api.approveApproval(item.id))
        : await guard(() => api.rejectApproval(item.id, $('approval-reason').value.trim()));
    closeApprovalModal();
    alertBox(
      'alert-approvals',
      result?.message ??
        (action === 'approve' ? 'Pendaftaran disetujui.' : 'Pendaftaran ditolak.'),
      'ok'
    );
    await loadApprovals();
    await loadOwners();
  } catch (err) {
    errorEl.textContent = describeError(err);
    show(errorEl);
  } finally {
    button.disabled = false;
  }
};

$('approvals-body').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-approval-action]');
  if (!btn) return;
  const item = state.approvals.find((row) => row.id === btn.dataset.id);
  if (!item) {
    alertBox('alert-approvals', 'Data pendaftaran tidak ditemukan. Muat ulang daftar.', 'error');
    return;
  }
  openApprovalModal(btn.dataset.approvalAction, item);
});

$('approval-cancel').addEventListener('click', closeApprovalModal);
$('approval-confirm').addEventListener('click', submitApproval);
$('approval-modal').addEventListener('click', (event) => {
  if (event.target === $('approval-modal')) closeApprovalModal();
});
$('approval-reason').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submitApproval();
});

let approvalTimer = null;
$('approval-search').addEventListener('input', (event) => {
  state.approvalSearch = event.target.value.trim();
  clearTimeout(approvalTimer);
  approvalTimer = setTimeout(loadApprovals, 300);
});
$('approval-status').addEventListener('change', (event) => {
  state.approvalStatus = event.target.value;
  loadApprovals();
});
$('refresh-approvals-btn').addEventListener('click', () => loadApprovals());

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
    const monthly = p.price_monthly ?? p.price;
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(p.name)}</strong>
        ${p.is_public ? '' : '<div class="muted small">tidak publik</div>'}
      </td>
      <td><code>${escapeHtml(p.slug ?? '—')}</code></td>
      <td>${p.max_outlets}</td>
      <td>${p.max_cashiers}</td>
      <td>${p.is_custom_price ? '<span class="badge">konsultasi</span>' : escapeHtml(fmtIDR(monthly))}</td>
      <td>${p.price_yearly != null ? escapeHtml(fmtIDR(p.price_yearly)) : '—'}</td>
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
  $('plan-slug').value = '';
  $('plan-price-monthly').value = 0;
  $('plan-price-yearly').value = '';
  $('plan-duration').value = 30;
  $('plan-features').value = '';
  $('plan-active').checked = true;
  $('plan-public').checked = true;
  $('plan-custom-price').checked = false;
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
    $('plan-slug').value = plan.slug ?? '';
    $('plan-max-outlets').value = plan.max_outlets ?? 1;
    $('plan-max-cashiers').value = plan.max_cashiers ?? 1;
    $('plan-price-monthly').value = plan.price_monthly ?? plan.price ?? 0;
    $('plan-price-yearly').value = plan.price_yearly ?? '';
    $('plan-duration').value = plan.duration_days ?? 30;
    $('plan-features').value = Array.isArray(plan.features?.highlights)
      ? plan.features.highlights.join('\n')
      : '';
    $('plan-default').checked = Boolean(plan.is_default);
    $('plan-active').checked = Boolean(plan.is_active);
    $('plan-public').checked = Boolean(plan.is_public);
    $('plan-custom-price').checked = Boolean(plan.is_custom_price);
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
  const monthly = Number($('plan-price-monthly').value);
  const yearlyRaw = $('plan-price-yearly').value.trim();
  const highlights = $('plan-features')
    .value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const payload = {
    name: $('plan-name').value.trim(),
    slug: $('plan-slug').value.trim() || undefined,
    maxOutlets: Number($('plan-max-outlets').value),
    maxCashiers: Number($('plan-max-cashiers').value),
    price: monthly,
    priceMonthly: monthly,
    priceYearly: yearlyRaw ? Number(yearlyRaw) : null,
    durationDays: Number($('plan-duration').value),
    features: highlights.length ? { highlights } : {},
    isDefault: $('plan-default').checked,
    isActive: $('plan-active').checked,
    isPublic: $('plan-public').checked,
    isCustomPrice: $('plan-custom-price').checked,
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

const fmtRupiahSmall = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) return '—';
  return new Intl.NumberFormat('id-ID').format(num);
};

const loadSubInvoices = async () => {
  const tbody = $('sub-invoice-body');
  const empty = $('sub-invoice-empty');
  const msg = $('sub-invoice-msg');
  if (!currentSubBusinessId) return;
  tbody.innerHTML = '';
  hide(empty);
  msg.textContent = 'Memuat...';
  try {
    const body = await guard(() => api.listBusinessInvoices(currentSubBusinessId, { limit: 50 }));
    if (!body) {
      msg.textContent = 'Gagal memuat tagihan.';
      return;
    }
    const items = body.items ?? body.invoices ?? [];
    if (!items.length) {
      show(empty);
      msg.textContent = '';
      return;
    }
    for (const inv of items) {
      const tr = document.createElement('tr');
      const canCancel = inv.status === 'pending';
      tr.innerHTML = `
        <td class="mono small">${escapeHtml(inv.order_id || inv.id)}</td>
        <td>${escapeHtml(inv.plan_name || '—')}</td>
        <td>${inv.billing_period === 'yearly' ? 'Tahunan' : 'Bulanan'}</td>
        <td class="right mono">Rp ${fmtRupiahSmall(inv.amount_rupiah ?? inv.amount)}</td>
        <td>${escapeHtml(inv.payment_method || '—')}</td>
        <td>${escapeHtml(inv.status)}</td>
        <td class="small">${fmtDate(inv.expires_at)}</td>
        <td>${canCancel ? `<button class="btn small danger" data-inv-cancel="${escapeHtml(inv.id)}">Batalkan</button>` : '—'}</td>`;
      tbody.appendChild(tr);
    }
    msg.textContent = '';
  } catch (err) {
    msg.textContent = describeError(err);
  }
};

const openSubModal = async (businessId) => {
  currentSubBusinessId = businessId;
  hide($('sub-form-error'));
  hide($('sub-invoice-empty'));
  $('sub-invoice-body').innerHTML = '';
  $('sub-invoice-msg').textContent = '';
  show($('sub-modal'));

  // Isi pilihan paket (semua paket aktif).
  const plansBody = await guard(() => api.listPlans());
  const select = $('sub-plan-select');
  select.innerHTML = '';
  for (const p of (plansBody?.items ?? [])) {
    const opt = document.createElement('option');
    opt.value = p.id;
    const priceMonthly = p.is_custom_price ? 'konsultasi' : fmtIDR(p.price_monthly ?? p.price);
    const priceYearly = p.is_custom_price ? 'konsultasi' : fmtIDR(p.price_yearly);
    opt.textContent = `${p.name} — ${priceMonthly}/bulan / ${priceYearly}/tahun (${p.max_outlets} outlet, ${p.max_cashiers} kasir)${p.is_default ? ' — default' : ''}`;
    select.appendChild(opt);
  }
  if (plansBody?.items?.length) select.selectedIndex = 0;

  // Info langganan saat ini.
  try {
    const viewBody = await guard(() => api.getBusinessSubscription(businessId));
    $('sub-current').textContent = `Saat ini: ${viewBody?.plan?.name ?? '—'} — status ${viewBody?.subscription?.status ?? '—'} · periode ${viewBody?.subscription?.billing_period === 'yearly' ? 'Tahunan' : 'Bulanan'} · sampai ${fmtDate(viewBody?.subscription?.expires_at)}`;
    $('sub-status-select').value = viewBody?.subscription?.status ?? 'active';
    $('sub-period-select').value = viewBody?.subscription?.billing_period === 'yearly' ? 'yearly' : 'monthly';
  } catch (err) {
    if (err.status === 404) {
      $('sub-current').textContent = 'Bisnis belum memiliki langganan.';
    } else {
      $('sub-current').textContent = describeError(err);
    }
  }

  await loadSubInvoices();
};

$('biz-body').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn || btn.dataset.action !== 'sub') return;
  await openSubModal(btn.dataset.id);
});

$('sub-assign').addEventListener('click', async () => {
  const planId = $('sub-plan-select').value;
  const billingPeriod = $('sub-period-select').value;
  try {
    await guard(() => api.assignSubscription(currentSubBusinessId, planId, billingPeriod));
    alertBox('alert-biz', 'Paket langganan berhasil dipasang/ganti.', 'ok');
    hide($('sub-form-error'));
    await openSubModal(currentSubBusinessId);
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
    hide($('sub-form-error'));
    await openSubModal(currentSubBusinessId);
    await loadBusinesses();
  } catch (err) {
    const el = $('sub-form-error');
    el.textContent = describeError(err);
    show(el);
  }
});

$('sub-load-invoices').addEventListener('click', async () => {
  await loadSubInvoices();
});

$('sub-invoice-body').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-inv-cancel]');
  if (!btn) return;
  const invoiceId = btn.dataset.invCancel;
  if (!currentSubBusinessId || !invoiceId) return;
  if (!confirm('Batalkan tagihan pending ini?')) return;
  try {
    await guard(() => api.cancelBusinessInvoice(currentSubBusinessId, invoiceId));
    alertBox('alert-biz', 'Tagihan pending dibatalkan.', 'ok');
    await loadSubInvoices();
  } catch (err) {
    $('sub-invoice-msg').textContent = describeError(err);
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

// ================================================== TAB AUDIT LOG =============
const roleLabel = (role) =>
  ({ platform_admin: 'Admin', owner: 'Owner', cashier: 'Kasir' }[role] ?? role);

const auditFilters = () => ({
  actorRole: $('audit-role-filter').value || undefined,
  action: $('audit-action-filter').value.trim() || undefined,
  from: $('audit-from').value || undefined,
  to: $('audit-to').value || undefined,
});

const renderAuditLogs = (items) => {
  const tbody = $('audit-body');
  tbody.innerHTML = '';
  hide($('audit-empty'));
  if (!items.length) {
    show($('audit-empty'));
    return;
  }
  const businessNames = new Map(state.businesses.map((b) => [b.id, b.name]));
  for (const a of items) {
    const biz = a.business_id
      ? (businessNames.get(a.business_id) ?? a.business_id.slice(0, 8))
      : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(fmtDate(a.created_at))}</td>
      <td>${escapeHtml(a.actor_name || a.actor_email || '—')}</td>
      <td>${escapeHtml(roleLabel(a.actor_role))}</td>
      <td class="mono">${escapeHtml(a.action)}</td>
      <td>${escapeHtml(a.entity_type)}${a.entity_id ? `<div class="muted small mono">${escapeHtml(a.entity_id.slice(0, 8))}</div>` : ''}</td>
      <td>${escapeHtml(biz)}</td>
      <td class="mono">${escapeHtml(a.ip || '—')}</td>`;
    tbody.appendChild(tr);
  }
};

const loadAuditLogs = async () => {
  const offset = (state.auditPage - 1) * state.auditLimit;
  const body = await guard(() =>
    api.listAuditLogs({ ...auditFilters(), limit: state.auditLimit, offset })
  );
  if (!body) return;

  state.audits = body.items;
  state.auditTotal = body.total;
  renderAuditLogs(body.items);

  const pages = Math.max(1, Math.ceil(body.total / state.auditLimit));
  if (state.auditPage > pages) {
    state.auditPage = pages;
    return loadAuditLogs();
  }
  $('audit-page-info').textContent = `Halaman ${state.auditPage} / ${pages} • ${body.total} entri`;
  $('audit-prev-btn').disabled = state.auditPage <= 1;
  $('audit-next-btn').disabled = state.auditPage >= pages;
};

const resetAuditPageAndLoad = () => {
  state.auditPage = 1;
  loadAuditLogs();
};

$('refresh-audit-btn').addEventListener('click', resetAuditPageAndLoad);
$('audit-role-filter').addEventListener('change', resetAuditPageAndLoad);
$('audit-from').addEventListener('change', resetAuditPageAndLoad);
$('audit-to').addEventListener('change', resetAuditPageAndLoad);

let auditTimer = null;
$('audit-action-filter').addEventListener('input', (event) => {
  clearTimeout(auditTimer);
  auditTimer = setTimeout(resetAuditPageAndLoad, 400);
});

$('audit-prev-btn').addEventListener('click', () => {
  if (state.auditPage > 1) {
    state.auditPage -= 1;
    loadAuditLogs();
  }
});
$('audit-next-btn').addEventListener('click', () => {
  state.auditPage += 1;
  loadAuditLogs();
});

// ================================================== TAB SESI KASIR ============
const renderCashierSessions = (items) => {
  const tbody = $('sessions-body');
  tbody.innerHTML = '';
  hide($('sessions-empty'));
  if (!items.length) {
    show($('sessions-empty'));
    return;
  }
  for (const c of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(c.full_name)}</strong><div class="muted small">${escapeHtml(c.email)}</div></td>
      <td>${escapeHtml(c.outlet_name)}</td>
      <td>${escapeHtml(c.business_name)}</td>
      <td><span class="badge ${Number(c.active_count) > 0 ? 'ok' : 'off'}">${escapeHtml(String(c.active_count))}</span></td>
      <td>${escapeHtml(fmtDate(c.last_active_at))}</td>
      <td class="right actions">
        <button class="btn small" data-session-revoke="${c.id}" ${Number(c.active_count) > 0 ? '' : 'disabled'}>Paksa Logout</button>
      </td>`;
    tbody.appendChild(tr);
  }
};

const loadCashierSessions = async () => {
  const body = await guard(() => api.listCashierSessions());
  if (!body) return;
  state.cashierSessions = body.items;
  renderCashierSessions(body.items);
};

$('refresh-sessions-btn').addEventListener('click', loadCashierSessions);

$('sessions-body').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-session-revoke]');
  if (!btn) return;
  const cashierId = btn.dataset.sessionRevoke;
  const row = state.cashierSessions.find((c) => c.id === cashierId);
  const name = row?.full_name ?? 'Kasir ini';
  if (
    !window.confirm(
      `Paksa logout semua sesi "${name}"?\nRefresh token kasir akan langsung dicabut di server, sehingga sesi berakhir pada request berikutnya.`
    )
  ) {
    return;
  }
  try {
    const result = await guard(() => api.revokeCashierSessions(cashierId));
    alertBox('alert-sessions', `Sesi ${name} dicabut (${result.revoked} sesi).`, 'ok');
  } catch (err) {
    alertBox('alert-sessions', describeError(err), 'error');
  }
  await loadCashierSessions();
});

// ================================================== TAB SETORAN KASIR ========
/** Label status setoran; `recorded` adalah data legacy yang dianggap selesai. */
const SETTLEMENT_STATUS_LABELS = {
  draft: 'DRAFT',
  completed: 'SELESAI',
  voided: 'DIBATALKAN',
  recorded: 'SELESAI',
};

const settlementStatusLabel = (status) =>
  SETTLEMENT_STATUS_LABELS[status] ?? String(status ?? '—').toUpperCase();

const settlementStatusBadge = (status) => {
  const cls = status === 'completed' || status === 'recorded' ? 'ok' : 'off';
  return `<span class="badge ${cls}">${escapeHtml(settlementStatusLabel(status))}</span>`;
};

/** Filter tabel setoran; nilai kosong tidak dikirim ke API. */
const settlementFilters = () => ({
  status: $('settle-status-filter').value || 'all',
  from: $('settle-from').value || undefined,
  to: $('settle-to').value || undefined,
  businessId: $('settle-business-filter').value.trim() || undefined,
  outletId: $('settle-outlet-filter').value.trim() || undefined,
});

const sumSettlementField = (items, key) =>
  items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);

/**
 * Ringkasan filter setoran.
 *
 * Memakai `totals` dari server bila tersedia (menjumlah seluruh hasil filter,
 * bukan hanya halaman aktif). Bila respons belum menyertakan `totals`, nilai
 * dihitung dari baris halaman ini agar strip tetap informatif.
 */
const settlementTotals = (items, returnedTotals) => {
  const pageTotals = {
    total_revenue: sumSettlementField(items, 'total_revenue'),
    total_expense: sumSettlementField(items, 'total_expense'),
    required_cash: sumSettlementField(items, 'required_cash'),
    actual_cash: sumSettlementField(items, 'actual_cash'),
    difference: sumSettlementField(items, 'difference'),
    shortfall: sumSettlementField(items, 'shortfall'),
  };
  return returnedTotals ? { ...pageTotals, ...returnedTotals } : pageTotals;
};

const renderSettlementSummary = (totals, exact) => {
  const cards = [
    { label: 'Total pendapatan', value: totals.total_revenue },
    { label: 'Pengeluaran', value: totals.total_expense },
    { label: 'Setoran wajib', value: totals.required_cash },
    { label: 'Tunai aktual', value: totals.actual_cash },
    { label: 'Selisih', value: totals.difference },
    { label: 'Kekurangan', value: totals.shortfall },
  ];
  $('settlements-summary').innerHTML = cards
    .map(
      (c) => `
      <div class="card stat">
        <span class="stat-label">${escapeHtml(c.label)}</span>
        <strong class="stat-value">${escapeHtml(fmtIDR(c.value))}</strong>
        <span class="muted small">${exact ? 'Total filter aktif' : 'Dari baris halaman ini'}</span>
      </div>`
    )
    .join('');
};

const renderSettlements = (items) => {
  const tbody = $('settlements-body');
  tbody.innerHTML = '';
  hide($('settlements-empty'));
  if (!items.length) {
    show($('settlements-empty'));
    return;
  }

  for (const d of items) {
    const hasActual = d.actual_cash !== null && d.actual_cash !== undefined;
    const hasDifference = d.difference !== null && d.difference !== undefined;
    const hasShortfall = d.shortfall !== null && d.shortfall !== undefined;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(fmtDate(d.deposited_on))}</td>
      <td class="mono">${escapeHtml(d.settlement_no || '—')}</td>
      <td>
        <strong>${escapeHtml(d.business_name || '—')}</strong>
        ${d.business_id ? `<div class="muted small mono">${escapeHtml(d.business_id.slice(0, 8))}</div>` : ''}
      </td>
      <td>${escapeHtml(d.outlet_name || '—')}</td>
      <td>${escapeHtml(d.officer_name || '—')}</td>
      <td>${escapeHtml(d.shift_label || '—')}</td>
      <td class="right">${escapeHtml(fmtIDR(d.total_revenue))}</td>
      <td class="right">${escapeHtml(fmtIDR(d.total_expense))}</td>
      <td class="right">${escapeHtml(fmtIDR(d.required_cash))}</td>
      <td class="right">${hasActual ? escapeHtml(fmtIDR(d.actual_cash)) : '—'}</td>
      <td class="right${hasDifference && Number(d.difference) < 0 ? ' strong' : ''}">${hasDifference ? escapeHtml(fmtIDR(d.difference)) : '—'}</td>
      <td class="right">${hasShortfall ? escapeHtml(fmtIDR(d.shortfall)) : '—'}</td>
      <td>${settlementStatusBadge(d.status)}</td>`;
    tbody.appendChild(tr);
  }
};

const loadSettlements = async () => {
  try {
    const body = await guard(() =>
      api.listCashSettlements({
        ...settlementFilters(),
        page: state.settlePage,
        limit: state.settleLimit,
      })
    );
    if (!body) return;

    const items = body.items ?? [];
    state.settlements = items;
    state.settleTotal = body.total ?? items.length;
    renderSettlements(items);
    renderSettlementSummary(settlementTotals(items, body.totals), Boolean(body.totals));

    const pages = Math.max(1, Math.ceil(state.settleTotal / state.settleLimit));
    if (state.settlePage > pages) {
      state.settlePage = pages;
      return loadSettlements();
    }
    $('settle-page-info').textContent = `Halaman ${state.settlePage} / ${pages} • ${state.settleTotal} setoran`;
    $('settle-prev-btn').disabled = state.settlePage <= 1;
    $('settle-next-btn').disabled = state.settlePage >= pages;
  } catch (err) {
    alertBox('alert-settlements', describeError(err), 'error');
  }
};

const resetSettlementsAndLoad = () => {
  state.settlePage = 1;
  loadSettlements();
};

$('refresh-settlements-btn').addEventListener('click', resetSettlementsAndLoad);
$('settle-status-filter').addEventListener('change', resetSettlementsAndLoad);
$('settle-from').addEventListener('change', resetSettlementsAndLoad);
$('settle-to').addEventListener('change', resetSettlementsAndLoad);

let settlementTimer = null;
for (const id of ['settle-business-filter', 'settle-outlet-filter']) {
  $(id).addEventListener('input', () => {
    clearTimeout(settlementTimer);
    settlementTimer = setTimeout(resetSettlementsAndLoad, 400);
  });
}

$('settle-prev-btn').addEventListener('click', () => {
  if (state.settlePage > 1) {
    state.settlePage -= 1;
    loadSettlements();
  }
});
$('settle-next-btn').addEventListener('click', () => {
  state.settlePage += 1;
  loadSettlements();
});

// ------------------------------------------------------------- Bootstrap -----
/**
 * Bootstrap panel Admin dengan PEMULIHAN SESI (persistent login).
 * Verifikasi sesi eksplisit lewat `restoreSession()` sebelum memutuskan layar.
 */
const boot = async () => {
  if (!tokenStore.hasSession) {
    show($('login-view'));
    return;
  }
  try {
    const body = await restoreSession();
    const user = body?.user ?? null;
    if (!user) {
      show($('login-view'));
      return;
    }
    $('current-user').textContent = `${user.fullName} (${user.email})`;
    hide($('login-view'));
    show($('app-view'));
    await loadOwners();
    await loadApprovals();
  } catch (err) {
    // Sesi tidak dapat diverifikasi (mis. jaringan). Token TIDAK dihapus.
    show($('login-view'));
    const el = $('login-error');
    el.textContent = describeError(err);
    show(el);
  }
};

// Saat tab kembali aktif, perbarui sesi diam-diam agar tidak terlempar ke login.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tokenStore.hasSession) {
    restoreSession().catch(() => {});
  }
});

boot();