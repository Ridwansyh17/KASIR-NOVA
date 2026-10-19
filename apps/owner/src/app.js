/**
 * Logika UI panel Owner (Vanilla JS modular).
 *
 * Alur: login (peran terkunci owner) -> daftar bisnis -> pilih konteks bisnis
 * aktif -> lihat detail bisnis, langganan, dan kelola outlet. Semua otorisasi
 * & isolasi tenant tetap ditegakkan server; UI ini hanya alat bantu.
 */
import { api, login, logout, restoreSession, tokenStore, ApiError } from './api.js';
import { renderPrintReport, PRINT_STATUS_LABELS } from './report-print.js';

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
  // V0.3: bukti/foto yang sedang dipilih pada modal (undefined = tidak diubah)
  formPhoto: undefined,
  formPhotoCurrent: '', // foto produk tersimpan saat modal dibuka (blok gambar otomatis)
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
  const body = await guard(() => api.me());
  const user = body?.user ?? null;
  $('current-user').textContent = user ? `${user.fullName} (${user.email})` : '';
  return user;
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

// ------------------------------------- Pembayaran langganan (gateway) --------
/**
 * Pembayaran langganan online (uji sandbox Duitku).
 *
 * Semua keputusan penting tetap di server: harga paket, kanal yang boleh dipakai,
 * pembuatan tagihan, dan aktivasi langganan. Panel ini hanya:
 *   1. menampilkan status gateway + riwayat tagihan,
 *   2. meminta server membuat tagihan (VA/QRIS),
 *   3. menampilkan nomor/QRIS + tombol "Cek Status" (tanpa polling otomatis,
 *      agar tidak melanggar batas hit rate gateway).
 */
const INVOICE_STATUS_TEXT = {
  pending: 'menunggu',
  paid: 'lunas',
  failed: 'gagal',
  expired: 'kedaluwarsa',
  canceled: 'dibatalkan',
};

state.payGateway = null; // ringkasan gateway dari server (tanpa rahasia apa pun)
state.payPlans = [];
state.payInvoice = null; // tagihan yang sedang ditampilkan di modal

const invoiceStatusBadge = (status) => {
  const cls = status === 'paid' ? 'ok' : status === 'pending' ? '' : 'off';
  return `<span class="badge ${cls}">${escapeHtml(INVOICE_STATUS_TEXT[status] ?? status)}</span>`;
};

/** Catatan status gateway + aktif/nonaktif tombol bayar. */
const renderGatewayNote = () => {
  const g = state.payGateway;
  const note = $('sub-gateway-note');
  const btn = $('sub-pay-btn');
  if (!g) {
    note.textContent = '';
    return;
  }
  if (g.enabled) {
    const kanal = (g.channels ?? []).map((c) => c.label).join(', ');
    note.textContent = `Pembayaran online aktif (${g.provider}, mode ${g.mode}). Kanal: ${kanal || '—'}.`;
    btn.disabled = false;
    btn.title = '';
  } else {
    note.textContent =
      'Pembayaran online belum dikonfigurasi di server. Admin Platform perlu mengisi kredensial gateway.';
    btn.disabled = true;
    btn.title = 'Gateway pembayaran belum dikonfigurasi';
  }
};

const renderSubscriptionInvoices = (data) => {
  const body = $('sub-invoice-body');
  const items = data?.items ?? [];
  body.innerHTML = '';
  $('sub-invoice-empty').classList.toggle('hidden', items.length > 0);

  for (const inv of items) {
    const openBtn = inv.payment_url
      ? `<a class="btn small" href="${escapeHtml(inv.payment_url)}" target="_blank" rel="noopener">Buka</a>`
      : '';
    const syncBtn =
      inv.status === 'pending'
        ? `<button class="btn small" data-action="sync" data-id="${inv.id}">Cek status</button>`
        : '';
    const nomor = inv.va_number
      ? `<div class="muted small">VA ${escapeHtml(inv.va_number)}</div>`
      : inv.qr_string
        ? '<div class="muted small">QRIS</div>'
        : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(fmtDate(inv.created_at))}</td>
      <td>${escapeHtml(inv.plan?.name ?? '—')}${nomor}</td>
      <td class="right strong">${money(inv.amount)}</td>
      <td>${escapeHtml(inv.payment_method_label ?? inv.payment_method ?? '—')}</td>
      <td>${invoiceStatusBadge(inv.status)}</td>
      <td class="right">${syncBtn} ${openBtn}</td>`;
    body.appendChild(tr);
  }
};

/** Muat opsi checkout (paket + status gateway) dan riwayat tagihan bisnis aktif. */
const loadSubscriptionInvoices = async () => {
  const b = activeBusiness();
  if (!b) {
    hide($('subscription-section'));
    return;
  }
  const errEl = $('sub-invoice-error');
  hide(errEl);

  let hasil = null;
  try {
    hasil = await guard(() =>
      Promise.all([
        api.subscriptionPlans(b.id),
        api.subscriptionInvoices(b.id, { limit: 20 }),
      ])
    );
  } catch (err) {
    errEl.textContent = describeError(err);
    show(errEl);
    return;
  }
  if (!hasil) return; // sesi berakhir; guard() sudah mengalihkan ke login

  const [opsi, tagihan] = hasil;
  state.payGateway = opsi.gateway;
  state.payPlans = opsi.plans ?? [];
  renderGatewayNote();
  renderSubscriptionInvoices(tagihan);
};

/** Segarkan kartu langganan + riwayat tagihan setelah pembayaran. */
const refreshSubscriptionOnly = async () => {
  const b = activeBusiness();
  if (!b) return;
  const sub = await guard(() => api.subscription(b.id));
  renderSubscription(sub ?? null);
  await loadSubscriptionInvoices();
};

const renderPayPlanInfo = () => {
  const plan = state.payPlans.find((p) => p.id === $('pay-plan').value);
  $('pay-plan-info').textContent = plan
    ? `Maksimal ${plan.max_outlets} outlet & ${plan.max_cashiers} kasir, aktif ${plan.duration_days} hari sejak pembayaran berhasil.`
    : '';
};

/** Isi pilihan paket + kanal pada langkah pertama modal bayar. */
const renderPayForm = () => {
  const sel = $('pay-plan');
  sel.innerHTML = '';
  const bisaDibeli = state.payPlans.filter((p) => p.purchasable);
  for (const p of state.payPlans) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.disabled = !p.purchasable;
    opt.textContent = `${p.name} — ${fmtIDR(p.price)} / ${p.duration_days} hari${
      p.purchasable ? '' : ' (tidak bisa ditagih)'
    }`;
    sel.appendChild(opt);
  }
  if (bisaDibeli[0]) sel.value = bisaDibeli[0].id;
  renderPayPlanInfo();

  const wrap = $('pay-channels');
  wrap.innerHTML = '';
  const channels = state.payGateway?.channels ?? [];
  for (const c of channels) {
    const ket =
      c.kind === 'qris'
        ? 'Bayar dengan memindai kode QRIS'
        : c.kind === 'va'
          ? 'Bayar lewat m-banking/ATM ke nomor Virtual Account'
          : 'Ikuti instruksi kanal ini';
    const label = document.createElement('label');
    label.className = 'pay-channel';
    label.innerHTML = `
      <input type="radio" name="pay-channel" value="${escapeHtml(c.code)}" />
      <span>
        <strong>${escapeHtml(c.label)}</strong>
        <span class="muted small">${escapeHtml(ket)}</span>
      </span>`;
    wrap.appendChild(label);
  }
  const first = wrap.querySelector('input[name=pay-channel]');
  if (first) first.checked = true;

  const kosong = $('pay-channels-empty');
  const btn = $('pay-create');
  if (!state.payGateway?.enabled || channels.length === 0) {
    kosong.textContent = state.payGateway?.enabled
      ? 'Belum ada kanal pembayaran aktif di server.'
      : 'Pembayaran online belum dikonfigurasi di server.';
    show(kosong);
    btn.disabled = true;
  } else if (bisaDibeli.length === 0) {
    kosong.textContent = 'Belum ada paket berbayar yang dapat dibeli.';
    show(kosong);
    btn.disabled = true;
  } else {
    hide(kosong);
    btn.disabled = false;
  }
};

const openPayModal = async () => {
  const b = activeBusiness();
  if (!b) return;
  state.payInvoice = null;
  hide($('pay-error'));
  hide($('pay-pay-error'));
  try {
    // Muat ulang opsi saat modal dibuka: status gateway bisa berubah tanpa reload.
    const opsi = await guard(() => api.subscriptionPlans(b.id));
    if (!opsi) return;
    state.payGateway = opsi.gateway;
    state.payPlans = opsi.plans ?? [];
    renderGatewayNote();
    renderPayForm();
    show($('pay-step-choose'));
    hide($('pay-step-pay'));
    show($('pay-modal'));
  } catch (err) {
    alertBox(describeError(err), 'error');
  }
};

/**
 * Tampilkan gambar QR dari string QRIS (modul bersama `shared/qr-code.js`).
 *
 * Degradasi rapi: bila pustaka QR belum termuat atau isi ditolak, gambar
 * disembunyikan dan panel tetap menampilkan string QRIS + tautan gateway.
 * @returns {boolean} true bila gambar berhasil dipasang
 */
const showQrImage = (img, text) => {
  const QR = typeof window !== 'undefined' ? window.NovaQr : null;
  const gagal = () => {
    hide(img);
    img.removeAttribute('src');
    return false;
  };
  if (!QR?.isAvailable?.()) return gagal();
  try {
    // margin 4 modul = syarat quiet zone EMVCo/QRIS; scale 6 px per modul.
    img.src = QR.toDataUrl(text, { margin: 4, scale: 6 });
    show(img);
    return true;
  } catch {
    return gagal();
  }
};

/** Tampilkan instruksi pembayaran (nomor VA / kode QRIS + tautan gateway). */
const renderPayInstruction = () => {
  const inv = state.payInvoice;
  if (!inv) return;

  $('pay-invoice-meta').textContent = `${inv.plan?.name ?? 'Paket'} • ${fmtIDR(
    inv.amount
  )} • ${inv.payment_method_label ?? inv.payment_method} • No. pesanan ${inv.order_id}`;

  $('pay-instruction').textContent =
    inv.payment_kind === 'qris'
      ? 'Selesaikan pembayaran QRIS sebesar nominal di atas sebelum masa berlaku berakhir.'
      : inv.payment_kind === 'va'
        ? 'Bayar ke nomor Virtual Account di bawah ini tepat sebesar nominal di atas.'
        : 'Selesaikan pembayaran mengikuti instruksi kanal terpilih.';

  $('pay-number').textContent = inv.va_number || inv.qr_string || inv.order_id || '—';

  const qrWrap = $('pay-qr-wrap');
  const qrImg = $('pay-qr-img');
  if (inv.qr_string && !inv.va_number) {
    $('pay-qr').value = inv.qr_string;
    showQrImage(qrImg, inv.qr_string);
    show(qrWrap);
  } else {
    $('pay-qr').value = '';
    hide(qrImg);
    qrImg.removeAttribute('src');
    hide(qrWrap);
  }

  const open = $('pay-open');
  if (inv.payment_url) {
    open.href = inv.payment_url;
    show(open);
  } else {
    hide(open);
  }
  $('pay-copy').classList.toggle('hidden', !(inv.va_number || inv.qr_string));

  $('pay-expiry').textContent = inv.expires_at
    ? `Berlaku sampai ${fmtDate(inv.expires_at)}.`
    : '';
  $('pay-status-line').innerHTML = `Status tagihan: ${invoiceStatusBadge(inv.status)}`;
  hide($('pay-pay-error'));
};

const createPayInvoice = async () => {
  const b = activeBusiness();
  if (!b) return;
  const errEl = $('pay-error');
  hide(errEl);

  const planId = $('pay-plan').value;
  const method = document.querySelector('input[name=pay-channel]:checked')?.value;
  if (!planId || !method) {
    errEl.textContent = 'Pilih paket dan metode pembayaran terlebih dahulu.';
    show(errEl);
    return;
  }

  const btn = $('pay-create');
  btn.disabled = true;
  btn.textContent = 'Menghubungi gateway…';
  try {
    const hasil = await guard(() =>
      api.createSubscriptionInvoice(b.id, { planId, paymentMethod: method })
    );
    if (!hasil) return; // sesi berakhir
    state.payInvoice = hasil.invoice;
    renderPayInstruction();
    hide($('pay-step-choose'));
    show($('pay-step-pay'));
    await loadSubscriptionInvoices();
    if (hasil.invoice.status === 'paid') await refreshSubscriptionOnly();
  } catch (err) {
    errEl.textContent = describeError(err);
    show(errEl);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buat Tagihan';
  }
};

/** Cek status tagihan ke gateway (manual, dibatasi server). */
const syncPayCurrent = async () => {
  const b = activeBusiness();
  if (!b || !state.payInvoice) return;
  const errEl = $('pay-pay-error');
  hide(errEl);

  const btn = $('pay-sync');
  btn.disabled = true;
  btn.textContent = 'Memeriksa…';
  try {
    const hasil = await guard(() => api.syncSubscriptionInvoice(b.id, state.payInvoice.id));
    if (!hasil) return;
    state.payInvoice = hasil.invoice;
    renderPayInstruction();

    if (hasil.invoice.status === 'paid') {
      alertBox('Pembayaran diterima. Langganan sudah diperbarui.', 'ok');
      await refreshSubscriptionOnly();
    } else if (hasil.checked) {
      const pesan = hasil.gateway_status?.message || hasil.gateway_status?.code || 'belum lunas';
      $('pay-pay-error').textContent = `Gateway menyatakan: ${pesan}.`;
      show($('pay-pay-error'));
    } else {
      alertBox('Status tagihan belum berubah.', 'info');
    }
  } catch (err) {
    errEl.textContent = describeError(err);
    show(errEl);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cek Status';
  }
};

const closePayModal = () => hide($('pay-modal'));

$('sub-pay-btn').addEventListener('click', () => {
  openPayModal().catch((err) => alertBox(describeError(err), 'error'));
});
$('sub-invoice-refresh').addEventListener('click', () => {
  loadSubscriptionInvoices().catch((err) => alertBox(describeError(err), 'error'));
});
$('pay-plan').addEventListener('change', renderPayPlanInfo);
$('pay-cancel').addEventListener('click', closePayModal);
$('pay-close').addEventListener('click', closePayModal);
$('pay-modal').addEventListener('click', (event) => {
  if (event.target === $('pay-modal')) closePayModal();
});
$('pay-create').addEventListener('click', () => {
  createPayInvoice().catch((err) => alertBox(describeError(err), 'error'));
});
$('pay-sync').addEventListener('click', () => {
  syncPayCurrent().catch((err) => alertBox(describeError(err), 'error'));
});
$('pay-copy').addEventListener('click', async () => {
  const teks = state.payInvoice?.va_number || state.payInvoice?.qr_string || '';
  if (!teks) return;
  try {
    await navigator.clipboard.writeText(teks);
    alertBox('Nomor pembayaran disalin.', 'ok');
  } catch {
    alertBox('Tidak dapat menyalin otomatis. Salin manual dari kotak nomor.', 'error');
  }
});

// Tombol "Cek status" pada baris riwayat tagihan.
$('sub-invoice-body').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action="sync"]');
  if (!btn) return;
  const b = activeBusiness();
  if (!b) return;
  btn.disabled = true;
  try {
    const hasil = await guard(() => api.syncSubscriptionInvoice(b.id, btn.dataset.id));
    if (!hasil) return;
    alertBox(
      hasil.invoice.status === 'paid'
        ? 'Tagihan lunas. Langganan sudah diperbarui.'
        : 'Status tagihan diperbarui.',
      'ok'
    );
    await refreshSubscriptionOnly();
  } catch (err) {
    alertBox(describeError(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

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

  // Sinkronkan filter outlet pada bagian transaksi, laporan & keuangan.
  for (const id of [
    'tx-outlet-filter',
    'rep-outlet-filter',
    'fin-outlet-filter',
    'exp-outlet-filter',
    'dep-outlet-filter',
    'mov-outlet-filter',
  ]) {
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
    const profitBadge = c.can_view_profit
      ? '<span class="badge ok">Ya</span>'
      : '<span class="badge off">Tidak</span>';
    const labaBtn = `<button class="btn small" data-action="toggle-profit" data-id="${c.id}" data-name="${name}" data-next="${!c.can_view_profit}">${c.can_view_profit ? 'Cabut' : 'Beri'} Laba</button>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c.full_name)}</td>
      <td>${escapeHtml(c.email)}</td>
      <td>${escapeHtml(c.outlet_name ?? '—')}</td>
      <td>${statusBadge}</td>
      <td>${pinBadge}</td>
      <td>${profitBadge}</td>
      <td class="right">${sessionsBtn} ${labaBtn} ${pinBtn} ${remove} ${unlock}</td>`;
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

  // Sinkronkan filter kasir pada Laporan Setoran.
  const sel = $('dep-cashier-filter');
  const previous = sel.value;
  sel.innerHTML = '<option value="">Semua kasir</option>';
  for (const c of body.items ?? []) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.full_name;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === previous)) sel.value = previous;
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
  if (action === 'toggle-profit') {
    const next = btn.dataset.next === 'true';
    try {
      await guard(() => api.cashiers.update(b.id, cashierId, { canViewProfit: next }));
      alertBox(
        next
          ? `Kasir "${name}" kini dapat melihat HPP/laba.`
          : `Akses HPP kasir "${name}" dicabut.`,
        'ok'
      );
      await loadCashiers();
    } catch (err) {
      alertBox(describeError(err), 'error');
    }
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
    hide($('finance-section'));
    hide($('expense-section'));
    hide($('deposit-section'));
    hide($('inventory-section'));
    hide($('audit-section'));
    show($('waiting-state'));
  } else {
    hide($('waiting-state'));
    renderSelect();
    renderDetail();
    await refreshContext();
  }

  // Perbandingan lintas-bisnis independen dari bisnis aktif (Fase 16).
  await loadCrossReport();
};

/** Muat ulang data yang bergantung pada bisnis aktif (langganan + outlet + produk). */
const refreshContext = async () => {
  const b = activeBusiness();
  if (!b) return;
  const sub = await guard(() => api.subscription(b.id));
  renderSubscription(sub ?? null);
  await loadSubscriptionInvoices();
  await loadOutlets();
  await loadCashiers();
  await loadProducts();
  await loadTransactions();
  await loadReport();
  await loadFinance();
  await loadExpenses();
  await loadDeposits();
  await loadMovements();
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
  const box = $('product-photo-auto');
  if (!box) return;
  if (!PI) {
    box.innerHTML = '';
    return;
  }

  const manual = state.formPhoto !== undefined ? state.formPhoto : state.formPhotoCurrent;
  if (manual) {
    box.innerHTML = '<span class="muted small">Foto produk yang ada dipakai (unggahan menang atas gambar otomatis).</span>';
    return;
  }

  const catName = state.categories.find((c) => c.id === $('product-category').value)?.name ?? '';
  const saran = PI.suggestImage($('product-name').value, catName);
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
    const costLabel =
      p.cost_price != null ? ` • HPP ${escapeHtml(fmtIDR(p.cost_price))}` : '';
    const unitLabel = p.unit ? ` • ${escapeHtml(p.unit)}` : '';
    const availBadge = p.out_of_stock
      ? '<span class="badge off">HABIS</span>'
      : `<span class="badge ${p.status === 'active' ? 'ok' : 'off'}">${escapeHtml(p.status)}</span>`;
    card.innerHTML = `
      <div class="product-head">
        ${productThumbHtml(p, 'product-thumb')}
        <div class="product-main">
          <strong>${escapeHtml(p.name)}</strong>
          <p class="muted small">
            ${p.category_name ? escapeHtml(p.category_name) : 'Tanpa kategori'}
            ${p.sku ? ' • SKU ' + escapeHtml(p.sku) : ''}${unitLabel}
          </p>
        </div>
        <div class="right">
          <div class="product-price">${escapeHtml(fmtIDR(p.price))}</div>
          ${availBadge}
        </div>
      </div>
      <div class="outlet-meta muted small">${stockLabel}${costLabel}</div>
      <div class="detail-actions">
        <button class="btn small" data-action="edit-product" data-id="${p.id}">Ubah</button>
        ${p.track_stock ? `<button class="btn small" data-action="stock" data-id="${p.id}">Atur stok</button>` : ''}
        ${
          p.track_stock
            ? `<button class="btn small" data-action="toggle-oos" data-id="${p.id}" data-oos="${p.out_of_stock}">${
                p.out_of_stock ? 'Aktifkan kembali' : 'Tandai HABIS'
              }</button>`
            : ''
        }
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
  } else if (action === 'toggle-oos') {
    (async () => {
      const next = btn.dataset.oos !== 'true';
      try {
        await guard(() => api.products.setStockStatus(b.id, id, next));
        alertBox(next ? 'Produk ditandai HABIS.' : 'Produk diaktifkan kembali.', 'ok');
        await loadProducts();
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
  state.formPhoto = undefined;
  state.formPhotoCurrent = '';
  $('product-modal-title').textContent = 'Produk Baru';
  $('product-form').reset();
  $('product-id').value = '';
  $('product-track').checked = true;
  hide($('product-status-field'));
  show($('product-initial-field'));
  hide($('product-oos-field'));
  hide($('product-photo-clear-field'));
  $('product-photo-clear').checked = false;
  $('product-photo-preview').innerHTML = '';
  fillCategorySelect($('product-category'), '');
  hide($('product-form-error'));
  show($('product-modal'));
  renderAutoPhoto();
};

const openProductEdit = (p) => {
  state.formPhoto = undefined;
  state.formPhotoCurrent = p.photo_url ?? '';
  $('product-modal-title').textContent = 'Ubah Produk';
  $('product-id').value = p.id;
  $('product-name').value = p.name ?? '';
  $('product-price').value = p.price != null ? Number(p.price) / 100 : '';
  $('product-cost').value = p.cost_price != null ? Number(p.cost_price) / 100 : '';
  $('product-unit').value = p.unit ?? '';
  $('product-sku').value = p.sku ?? '';
  $('product-barcode').value = p.barcode ?? '';
  $('product-track').checked = !!p.track_stock;
  hide($('product-initial-field'));
  $('product-status').value = p.status ?? 'active';
  $('product-oos-field').classList.toggle('hidden', !p.track_stock);
  $('product-oos').checked = !!p.manual_out_of_stock;
  $('product-photo-clear-field').classList.toggle('hidden', !p.photo_url);
  $('product-photo-clear').checked = false;
  $('product-photo-preview').innerHTML = p.photo_url
    ? `<img src="${escapeHtml(p.photo_url)}" alt="Foto produk" />`
    : '';
  fillCategorySelect($('product-category'), p.category_id ?? '');
  show($('product-status-field'));
  hide($('product-form-error'));
  show($('product-modal'));
  renderAutoPhoto();
};

const closeProductModal = () => hide($('product-modal'));
$('product-cancel').addEventListener('click', closeProductModal);
$('product-modal').addEventListener('click', (event) => {
  if (event.target === $('product-modal')) closeProductModal();
});

// ---------- Pengecilan foto produk di klien ----------
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

$('product-photo').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await fileToCompressedDataUrl(file);
    state.formPhoto = dataUrl;
    $('product-photo-clear').checked = false;
    $('product-photo-preview').innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="Pratinjau" />`;
    renderAutoPhoto();
  } catch (err) {
    event.target.value = '';
    alertBox(describeError(err), 'error');
  }
});

$('product-photo-clear').addEventListener('change', (event) => {
  if (event.target.checked) {
    state.formPhoto = '';
    $('product-photo-preview').innerHTML = '';
  }
  renderAutoPhoto();
});

// Gambar otomatis: perbarui saran saat nama atau kategori diubah.
$('product-name').addEventListener('input', renderAutoPhoto);
$('product-category').addEventListener('change', renderAutoPhoto);

$('product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('product-form-error'));

  const b = activeBusiness();
  if (!b) return;

  const id = $('product-id').value;
  const submitBtn = $('product-submit');
  const formError = $('product-form-error');
  const fail = (message) => {
    formError.textContent = message;
    show(formError);
  };

  // ---- Validasi klien: pesan jelas; data form TIDAK dihapus bila gagal ----
  const name = $('product-name').value.trim();
  if (!name) return fail('Nama produk wajib diisi.');

  const priceRp = Number($('product-price').value || 0);
  if (!Number.isFinite(priceRp) || priceRp < 0) {
    return fail('Harga jual harus berupa angka dan tidak boleh negatif.');
  }

  const costRp = Number($('product-cost').value || 0);
  if (!Number.isFinite(costRp) || costRp < 0) {
    return fail('Harga modal (HPP) harus berupa angka dan tidak boleh negatif.');
  }

  const trackStock = $('product-track').checked;
  const initialRaw = $('product-initial-stock').value.trim();
  const initialStock = trackStock && initialRaw !== '' ? Number(initialRaw) : null;
  if (initialStock !== null && (!Number.isInteger(initialStock) || initialStock < 0)) {
    return fail('Stok awal harus bilangan bulat ≥ 0.');
  }

  const payload = {
    name,
    price: Math.round(priceRp * 100),
    costPrice: Math.round(costRp * 100),
    unit: $('product-unit').value.trim() || null,
    sku: $('product-sku').value.trim() || null,
    barcode: $('product-barcode').value.trim() || null,
    categoryId: $('product-category').value || null,
    trackStock,
  };
  if (state.formPhoto !== undefined) payload.photoUrl = state.formPhoto;

  if (id) {
    payload.status = $('product-status').value;
    payload.manualOutOfStock = trackStock ? $('product-oos').checked : false;
  } else if (initialStock !== null) {
    payload.initialStock = initialStock;
  }

  // ---- Kirim: cegah klik ganda + tampilkan status "Menyimpan…" ----
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Menyimpan…';
  try {
    const result = id
      ? await guard(() => api.products.update(b.id, id, payload))
      : await guard(() => api.products.create(b.id, payload));

    // `guard()` mengembalikan undefined saat sesi berakhir (401) dan sudah
    // mengarahkan ke login — jangan pernah menampilkan notifikasi berhasil.
    if (!result) return;

    alertBox(id ? 'Produk diperbarui.' : 'Produk baru berhasil disimpan.', 'ok');
    closeProductModal();
    await loadProducts();
  } catch (err) {
    // Gagal: form tetap terisi agar pengguna dapat memperbaiki & mencoba lagi.
    fail(describeError(err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
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

/** Perbandingan agregat per outlet (Fase 16) — filter sama dengan laporan. */
const renderOutletComparison = ({ items, totals }) => {
  const statusLabel = (s) => (s === 'active' ? 'Aktif' : s === 'inactive' ? 'Nonaktif' : s ?? '—');
  const body = $('rep-outlet-body');
  body.innerHTML = '';
  hide($('rep-outlet-empty'));

  if (!items.length) {
    show($('rep-outlet-empty'));
    return;
  }
  for (const it of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(it.outlet_name)}</strong></td>
      <td>${escapeHtml(statusLabel(it.outlet_status))}</td>
      <td class="right">${it.transactions}</td>
      <td class="right">${it.items_sold}</td>
      <td class="right strong">${escapeHtml(fmtIDR(it.total))}</td>
      <td class="right">${it.voided_total ? escapeHtml(fmtIDR(it.voided_total)) : '—'}</td>
      <td class="right">${it.refunded_total ? escapeHtml(fmtIDR(it.refunded_total)) : '—'}</td>`;
    body.appendChild(tr);
  }
  void totals;
};

/** Filter untuk perbandingan outlet (tanpa groupBy). */
const outletReportQuery = () => {
  const q = reportQuery();
  delete q.groupBy;
  return q;
};

const loadOutletComparison = async (businessId) => {
  const data = await guard(() => api.reports.outlets(businessId, outletReportQuery()));
  if (!data) return;
  renderOutletComparison(data);
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
  await loadOutletComparison(b.id);
};

// ------------------------------- Cetak Laporan Transaksi (17 Okt 2026) ----------
// Halaman cetak HTML siap-simpan-PDF. Baris = PER ITEM (keputusan A3a) dan
// hanya panel Owner yang menyediakannya (keputusan A2b). Tata letak mengikuti
// contoh Pemilik 17 Okt 2026 (lihat docs/35-laporan-transaksi-cetak.md).
// Penyusun HTML + PAGINASI (nomor "Halaman i dari N") ada di modul murni
// `./report-print.js` supaya bisa diuji Node tanpa DOM.

const BULAN_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** 'YYYY-MM-DD' -> '13 Oktober 2026' (tanpa efek zona waktu perangkat). */
const fmtTanggalID = (iso) => {
  const [y, m, d] = String(iso ?? '').split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${d} ${BULAN_ID[m - 1] ?? m} ${y}`;
};

/** Rentang periode: satu hari '13 Oktober 2026'; rentang '1 – 13 Oktober 2026'. */
const fmtPeriodeID = (from, to) => {
  if (!from || !to) return '—';
  if (from === to) return fmtTanggalID(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(to.slice(8, 10))} – ${fmtTanggalID(to)}`;
  return `${fmtTanggalID(from)} – ${fmtTanggalID(to)}`;
};

/** Waktu cetak pada ZONA WAKTU BISNIS: '13 Oktober 2026 17:32'. */
const fmtCetakID = (iso, timezone) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: timezone || 'Asia/Jakarta',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')} ${get('hour')}:${get('minute')}`;
};

/** 'YYYY-MM-DD' + 'HH:MM' -> '13/10/2026 08:45' (kolom tabel detail). */
const fmtTanggalJamRingkas = (date, time) => {
  const [y, m, d] = String(date ?? '').split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y} ${String(time ?? '').slice(0, 5)}`;
};

const printTransactionReport = async () => {
  const b = activeBusiness();
  if (!b) return;
  const btn = $('rep-print-btn');
  const original = btn.innerHTML;
  btn.disabled = true;
  try {
    const data = await guard(() => api.reports.transactions(b.id, reportQuery()));
    if (!data) return;
    $('print-report').innerHTML = renderPrintReport(data, {
      escape: escapeHtml,
      idr: fmtIDR,
      periode: fmtPeriodeID,
      cetak: fmtCetakID,
      tanggalJam: fmtTanggalJamRingkas,
      metode: (list) => (list ?? []).map((m) => METHOD_LABELS[m] ?? m).join(', ') || '—',
      status: (key) => PRINT_STATUS_LABELS[key] ?? key,
    });
    window.print();
    alertBox(
      'Halaman cetak dibuka. Pilih "Simpan sebagai PDF" atau printer Anda. Jangan ubah filter sebelum dialog cetak ditutup.',
      'ok'
    );
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
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

/** Unduh .xlsx dengan status tombol sibuk + notifikasi (dipakai beberapa ekspor). */
const runXlsxDownload = async ({ buttonId, loader, successLabel }) => {
  const btn = $(buttonId);
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Menyiapkan…';
  try {
    const { blob, filename } = await loader();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    alertBox(`${successLabel} (${blob.size.toLocaleString('id-ID')} byte).`, 'ok');
  } catch (err) {
    alertBox(describeError(err), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
};

const downloadExcel = () => {
  const b = activeBusiness();
  if (!b) return;
  return runXlsxDownload({
    buttonId: 'rep-export-xlsx',
    loader: () => api.reports.downloadXlsx(b.id, reportQuery()),
    successLabel: 'Rekapan Excel berhasil diunduh',
  });
};

const downloadOutletExcel = () => {
  const b = activeBusiness();
  if (!b) return;
  return runXlsxDownload({
    buttonId: 'rep-export-outlet-xlsx',
    loader: () => api.reports.outletsXlsx(b.id, outletReportQuery()),
    successLabel: 'Perbandingan outlet berhasil diunduh',
  });
};

const downloadTransactionReportExcel = () => {
  const b = activeBusiness();
  if (!b) return;
  // CATATAN: `reportQuery()` sengaja TIDAK memuat `limit`, sehingga ekspor
  // memakai bawaan server (5000 baris) — lebih lengkap daripada halaman (1000).
  return runXlsxDownload({
    buttonId: 'rep-transactions-xlsx',
    loader: () => api.reports.transactionsXlsx(b.id, reportQuery()),
    successLabel: 'Laporan Transaksi Excel berhasil diunduh',
  });
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
$('rep-export-outlet-xlsx').addEventListener('click', downloadOutletExcel);
$('rep-export-csv').addEventListener('click', () => downloadReport('csv'));
$('rep-export-json').addEventListener('click', () => downloadReport('json'));
// 17 Okt 2026: halaman cetak laporan transaksi (baris per item) — Owner saja.
$('rep-print-btn').addEventListener('click', printTransactionReport);
$('rep-transactions-xlsx').addEventListener('click', downloadTransactionReportExcel);

// ------------------------------------------------ Lintas-bisnis (Fase 16) -----
const crossQuery = () => ({
  from: $('cross-date-from').value,
  to: $('cross-date-to').value,
});

/** Zona acuan tanggal untuk lintas-bisnis (pakai zona bisnis aktif bila ada). */
const crossRangeToday = () => todayInTz(activeBusiness()?.timezone);

/** Isi tanggal default (bulan berjalan) bila belum diatur. */
const ensureCrossDefaults = () => {
  if ($('cross-date-from').value && $('cross-date-to').value) return;
  const today = crossRangeToday();
  $('cross-date-from').value = `${today.slice(0, 7)}-01`;
  $('cross-date-to').value = today;
};

const applyCrossQuickRange = () => {
  const range = $('cross-range').value;
  const today = crossRangeToday();
  if (range === 'today') {
    $('cross-date-from').value = today;
    $('cross-date-to').value = today;
  } else if (range === '7d') {
    $('cross-date-from').value = shiftIsoDays(today, -6);
    $('cross-date-to').value = today;
  } else if (range === 'month') {
    $('cross-date-from').value = `${today.slice(0, 7)}-01`;
    $('cross-date-to').value = today;
  } else if (range === 'year') {
    $('cross-date-from').value = `${today.slice(0, 4)}-01-01`;
    $('cross-date-to').value = today;
  } else {
    return; // kustom: pemilik mengatur tanggal sendiri
  }
  loadCrossReport();
};

const renderCrossReport = ({ items, totals }) => {
  const cards = [
    {
      label: 'Total omzet (semua bisnis)',
      value: fmtIDR(totals.total),
      sub: `${totals.transactions} transaksi`,
    },
    { label: 'Item terjual', value: String(totals.items_sold), sub: '' },
    { label: 'Dibatalkan (void)', value: fmtIDR(totals.voided_total), sub: '' },
    { label: 'Refund', value: fmtIDR(totals.refunded_total), sub: '' },
  ];
  $('cross-summary').innerHTML = cards
    .map(
      (c) => `
      <div class="card stat">
        <span class="stat-label">${escapeHtml(c.label)}</span>
        <strong class="stat-value">${escapeHtml(c.value)}</strong>
        ${c.sub ? `<span class="muted small">${escapeHtml(c.sub)}</span>` : ''}
      </div>`
    )
    .join('');

  const body = $('cross-body');
  body.innerHTML = '';
  hide($('cross-empty'));
  if (!items.length) {
    show($('cross-empty'));
    return;
  }
  for (const it of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(it.name)}</strong></td>
      <td>${escapeHtml(it.business_type || '—')}</td>
      <td class="right">${it.transactions}</td>
      <td class="right">${it.items_sold}</td>
      <td class="right strong">${escapeHtml(fmtIDR(it.total))}</td>
      <td class="right">${it.voided_total ? escapeHtml(fmtIDR(it.voided_total)) : '—'}</td>
      <td class="right">${it.refunded_total ? escapeHtml(fmtIDR(it.refunded_total)) : '—'}</td>
      <td class="right">${it.active_outlets}</td>`;
    body.appendChild(tr);
  }
};

const loadCrossReport = async () => {
  if (!state.businesses.length) {
    hide($('cross-section'));
    return;
  }
  show($('cross-section'));
  ensureCrossDefaults();
  const data = await guard(() => api.reports.businesses(crossQuery()));
  if (!data) return;
  renderCrossReport(data);
};

const downloadCrossExcel = () =>
  runXlsxDownload({
    buttonId: 'cross-export-xlsx',
    loader: () => api.reports.businessesXlsx(crossQuery()),
    successLabel: 'Perbandingan lintas-bisnis berhasil diunduh',
  });

$('cross-refresh-btn').addEventListener('click', loadCrossReport);
$('cross-range').addEventListener('change', applyCrossQuickRange);
$('cross-date-from').addEventListener('change', loadCrossReport);
$('cross-date-to').addEventListener('change', loadCrossReport);
$('cross-export-xlsx').addEventListener('click', downloadCrossExcel);

// ============================================================================
// V0.3 — Keuangan & laba (Fase 4/6), pengeluaran outlet (Fase 5), dan riwayat
// pergerakan stok (Fase 2). Semua perhitungan dilakukan SERVER; panel hanya
// menampilkan hasil yang sudah di-scope ke bisnis aktif.
// ============================================================================

const CATEGORY_LABELS = {
  operational: 'Operasional',
  utilities: 'Utilitas',
  supplies: 'Perlengkapan',
  transport: 'Transport',
  maintenance: 'Pemeliharaan',
  inventory_purchase: 'Beli Persediaan',
  other: 'Lain-lain',
};

const METHOD_LABELS = {
  cash: 'Tunai',
  card: 'Kartu',
  qr: 'QRIS',
  wallet: 'E-Wallet',
  transfer: 'Transfer',
};

const MOVEMENT_LABELS = {
  initial: 'Stok awal',
  adjustment: 'Penyesuaian',
  sale: 'Penjualan',
  void: 'Void penjualan',
  refund: 'Refund',
  mark_out: 'Tandai HABIS',
  restore: 'Aktifkan kembali',
};

const money = (v) => escapeHtml(fmtIDR(v ?? 0));

const statCard = (label, value, sub) => `
  <div class="card stat">
    <span class="stat-label">${escapeHtml(label)}</span>
    <strong class="stat-value">${escapeHtml(value)}</strong>
    ${sub ? `<span class="muted small">${escapeHtml(sub)}</span>` : ''}
  </div>`;

// -------------------------------------------------- Keuangan & laba ----------
const finQuery = () => {
  const range = $('fin-range').value;
  const outletId = $('fin-outlet-filter').value || '';
  if (range === 'custom') {
    return { from: $('fin-date-from').value, to: $('fin-date-to').value, outletId };
  }
  return { period: range, outletId };
};

const renderFinance = (d) => {
  const income = d.income ?? {};
  const exp = d.expenses ?? {};
  const tx = d.transactions ?? {};

  $('fin-period-label').textContent =
    d.period?.from && d.period?.to ? `Periode: ${d.period.from} s.d. ${d.period.to}` : '';

  $('fin-summary').innerHTML = [
    statCard('Total pendapatan', fmtIDR(income.total ?? 0), `${tx.completed ?? 0} transaksi`),
    statCard('Tunai', fmtIDR(income.cash ?? 0)),
    statCard('QRIS', fmtIDR(income.qris ?? 0)),
    statCard('HPP terjual', fmtIDR(d.hpp ?? 0)),
    statCard('Biaya transaksi', fmtIDR(income.transaction_fees ?? 0)),
    statCard('Pengeluaran operasional', fmtIDR(exp.operating_total ?? 0)),
    statCard('Laba kotor', fmtIDR(d.gross_profit ?? 0), 'pendapatan − HPP'),
    statCard('Laba bersih', fmtIDR(d.net_profit ?? 0), '− operasional − biaya'),
  ].join('');

  const methods = d.payment_methods ?? [];
  const mb = $('fin-method-body');
  mb.innerHTML = '';
  $('fin-method-empty').classList.toggle('hidden', methods.length > 0);
  for (const m of methods) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(METHOD_LABELS[m.method] ?? m.method)}</td>
      <td class="right">${m.transactions ?? 0}</td>
      <td class="right strong">${money(m.total)}</td>
      <td class="right">${money(m.fees)}</td>`;
    mb.appendChild(tr);
  }

  const byCat = exp.by_category ?? [];
  const eb = $('fin-expense-body');
  eb.innerHTML = '';
  $('fin-expense-empty').classList.toggle('hidden', byCat.length > 0);
  for (const c of byCat) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(CATEGORY_LABELS[c.category] ?? c.category)}${
        c.counts_as_operating === false ? ' <span class="badge off">non-laba</span>' : ''
      }</td>
      <td class="right">${c.entries ?? 0}</td>
      <td class="right strong">${money(c.total)}</td>`;
    eb.appendChild(tr);
  }

  const outlets = d.outlets ?? [];
  const ob = $('fin-outlet-body');
  ob.innerHTML = '';
  $('fin-outlet-empty').classList.toggle('hidden', outlets.length > 0);
  for (const o of outlets) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(o.outlet_name ?? '—')}</td>
      <td class="right">${o.transactions ?? 0}</td>
      <td class="right">${money(o.income)}</td>
      <td class="right">${money(o.hpp)}</td>
      <td class="right">${money(o.operating_expense)}</td>
      <td class="right strong">${money(o.gross_profit)}</td>
      <td class="right strong">${money(o.net_profit)}</td>`;
    ob.appendChild(tr);
  }
};

const loadFinance = async () => {
  const b = activeBusiness();
  if (!b) {
    hide($('finance-section'));
    return;
  }
  show($('finance-section'));
  const data = await guard(() => api.reports.finance(b.id, finQuery()));
  if (!data) return;
  renderFinance(data);
};

$('fin-refresh-btn').addEventListener('click', loadFinance);
$('fin-range').addEventListener('change', loadFinance);
$('fin-date-from').addEventListener('change', loadFinance);
$('fin-date-to').addEventListener('change', loadFinance);
$('fin-outlet-filter').addEventListener('change', loadFinance);
$('fin-export-xlsx').addEventListener('click', () => {
  const b = activeBusiness();
  if (!b) return;
  runXlsxDownload({
    buttonId: 'fin-export-xlsx',
    loader: () => api.reports.financeXlsx(b.id, finQuery()),
    successLabel: 'Laporan keuangan berhasil diunduh',
  });
});

// -------------------------------------------------- Pengeluaran outlet -------
const expQuery = () => ({
  outletId: $('exp-outlet-filter').value || '',
  category: $('exp-category-filter').value || '',
  status: $('exp-status-filter').value || '',
  from: $('exp-date-from').value || '',
  to: $('exp-date-to').value || '',
  limit: 100,
});

const renderExpenses = (data) => {
  const items = data.items ?? [];
  const totals = data.totals ?? {};
  $('exp-summary').innerHTML = [
    statCard('Total tampil', fmtIDR(totals.total ?? 0), `${items.length} catatan`),
    statCard('Operasional', fmtIDR(totals.operating_total ?? 0), 'masuk laba bersih'),
    statCard('Beli persediaan', fmtIDR(totals.inventory_total ?? 0), 'tidak dihitung laba'),
  ].join('');

  const body = $('exp-body');
  body.innerHTML = '';
  $('exp-empty').classList.toggle('hidden', items.length > 0);
  for (const e of items) {
    const voided = e.status === 'voided';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(fmtDay(e.spent_on))}</td>
      <td>${escapeHtml(e.outlet_name ?? '—')}</td>
      <td>${escapeHtml(CATEGORY_LABELS[e.category] ?? e.category)}</td>
      <td>${escapeHtml(METHOD_LABELS[e.method] ?? e.method)}</td>
      <td class="right strong">${money(e.amount)}</td>
      <td>${escapeHtml(e.officer_name ?? '—')}${voided ? ' <span class="badge off">VOID</span>' : ''}</td>
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
  const b = activeBusiness();
  if (!b) {
    hide($('expense-section'));
    return;
  }
  show($('expense-section'));
  const data = await guard(() => api.expenses.list(b.id, expQuery()));
  if (!data) return;
  renderExpenses(data);
};

$('exp-refresh-btn').addEventListener('click', loadExpenses);
$('exp-category-filter').addEventListener('change', loadExpenses);
$('exp-status-filter').addEventListener('change', loadExpenses);
$('exp-date-from').addEventListener('change', loadExpenses);
$('exp-date-to').addEventListener('change', loadExpenses);
$('exp-outlet-filter').addEventListener('change', loadExpenses);

// Modal pengeluaran (owner wajib memilih outlet)
const fillExpenseOutlets = async () => {
  const b = activeBusiness();
  if (!b) return;
  const body = await guard(() => api.outlets.list(b.id));
  const sel = $('exp-outlet');
  sel.innerHTML = '';
  for (const o of body?.items ?? []) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    sel.appendChild(opt);
  }
  const filter = $('exp-outlet-filter').value;
  if (filter) sel.value = filter;
};

const openExpenseModal = async () => {
  state.formPhoto = undefined;
  $('exp-form').reset();
  await fillExpenseOutlets();
  const today = new Date().toISOString().slice(0, 10);
  $('exp-date').value = today;
  hide($('exp-form-error'));
  show($('exp-modal'));
  $('exp-amount').focus();
};

$('exp-new-btn').addEventListener('click', () => {
  openExpenseModal().catch((err) => alertBox(describeError(err), 'error'));
});
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
  const b = activeBusiness();
  if (!b) return;
  const outletId = $('exp-outlet').value;
  if (!outletId) {
    err.textContent = 'Pilih outlet terlebih dahulu.';
    show(err);
    return;
  }
  const amount = Math.round(Number($('exp-amount').value || 0) * 100);
  if (amount <= 0) {
    err.textContent = 'Nominal harus lebih dari 0.';
    show(err);
    return;
  }
  const payload = {
    outletId,
    category: $('exp-category').value,
    amount,
    method: $('exp-method').value,
    date: $('exp-date').value || new Date().toISOString().slice(0, 10),
  };
  const note = $('exp-note').value.trim();
  if (note) payload.note = note;
  if (typeof state.formPhoto === 'string' && state.formPhoto) {
    payload.receiptUrl = state.formPhoto;
  }

  const btn = $('exp-form').querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await guard(() => api.expenses.create(b.id, payload));
    alertBox('Pengeluaran dicatat.', 'ok');
    hide($('exp-modal'));
    await loadExpenses();
    await loadFinance();
  } catch (e) {
    err.textContent = describeError(e);
    show(err);
  } finally {
    btn.disabled = false;
  }
});

// Void pengeluaran (append-only; butuh alasan)
let voidExpenseId = null;
let voidExpenseLabel = '';

$('exp-body').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action="void"]');
  if (!btn) return;
  voidExpenseId = btn.dataset.id;
  const row = btn.closest('tr');
  voidExpenseLabel = row?.children?.[0]?.textContent?.trim() ?? '';
  $('void-info').textContent = `Batalkan pengeluaran ${voidExpenseLabel}. Baris tidak dihapus.`;
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
  const b = activeBusiness();
  const reason = $('void-reason').value.trim();
  if (reason.length < 3) {
    err.textContent = 'Alasan minimal 3 karakter.';
    show(err);
    return;
  }
  if (!b || !voidExpenseId) return;
  try {
    await guard(() => api.expenses.void(b.id, voidExpenseId, reason));
    alertBox('Pengeluaran dibatalkan.', 'ok');
    hide($('void-modal'));
    await loadExpenses();
    await loadFinance();
  } catch (e) {
    err.textContent = describeError(e);
    show(err);
  }
});

// ---------------------------------------------------- Laporan Setoran ------
// Migrasi 0012: setoran kas adalah PERPINDAHAN KAS (bukan pendapatan/beban).
// Panel hanya menampilkan hasil hitung server (semua nominal SEN).
const DEP_STATUS_TEXT = {
  draft: 'DRAFT',
  completed: 'SELESAI',
  voided: 'DIBATALKAN',
  recorded: 'SELESAI',
};

const depStatusBadge = (status) => {
  const label = DEP_STATUS_TEXT[status] ?? status ?? '—';
  const tone = status === 'completed' || status === 'recorded' ? 'ok' : 'off';
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
};

const DEP_PAGE_SIZE = 20;
let depPage = 1;
let depPreviewData = null;
let depCompleteId = null;
let depCompleteRequired = 0;
let voidDepositId = null;

const depFilters = () => ({
  outletId: $('dep-outlet-filter').value || '',
  cashierId: $('dep-cashier-filter').value || '',
  from: $('dep-date-from').value || '',
  to: $('dep-date-to').value || '',
});

const depQuery = () => ({
  ...depFilters(),
  status: $('dep-status-filter').value || 'all',
  page: depPage,
  limit: DEP_PAGE_SIZE,
});

const depReportQuery = () => ({
  ...depFilters(),
  group: $('dep-group').value || 'day',
});

const depExportQuery = () => ({
  ...depFilters(),
  status: $('dep-status-filter').value || 'all',
});

/** Label periode rekap sesuai pengelompokan (hari/minggu/bulan). */
const fmtDepPeriod = (period, group) => {
  if (!period) return '—';
  if (group === 'month') {
    const [y, m] = String(period).split('-').map(Number);
    return `${BULAN_ID[m - 1] ?? m} ${y}`;
  }
  if (group === 'week') return `Minggu ${fmtDay(period)}`;
  return fmtDay(period);
};

const renderDepositSummary = (listTotals = {}, reportTotals = {}) => {
  const diff = Number(reportTotals.difference ?? 0);
  const shortfall = Number(reportTotals.shortfall ?? 0);
  $('dep-summary').innerHTML = [
    statCard('Total pendapatan', fmtIDR(reportTotals.total_revenue ?? 0), 'setoran selesai'),
    statCard('Pengeluaran', fmtIDR(reportTotals.total_expense ?? 0), 'kas + non-tunai'),
    statCard('Wajib setor tunai', fmtIDR(reportTotals.required_cash ?? 0), 'pendapatan kas − pengeluaran kas'),
    statCard('Tunai aktual', fmtIDR(reportTotals.actual_cash ?? 0), 'sudah disetor'),
    statCard('Selisih', fmtIDR(diff), diff < 0 ? 'kurang dari wajib' : diff > 0 ? 'lebih dari wajib' : 'pas'),
    statCard('Kekurangan kas', fmtIDR(shortfall), 'pengeluaran > pendapatan kas'),
    statCard('Setoran selesai', String(listTotals.completed_count ?? reportTotals.count ?? 0), 'status SELESAI'),
    statCard('Draft', String(listTotals.draft_count ?? 0), 'belum diselesaikan'),
  ].join('');
};

const renderDepositRecap = (report) => {
  const groups = report.groups ?? [];
  const group = report.group ?? ($('dep-group').value || 'day');
  $('dep-recap-note').textContent =
    `Rekap ${group === 'month' ? 'bulanan' : group === 'week' ? 'mingguan' : 'harian'} — hanya setoran berstatus SELESAI.`;

  const body = $('dep-recap-body');
  body.innerHTML = '';
  $('dep-recap-empty').classList.toggle('hidden', groups.length > 0);
  for (const g of groups) {
    const cashExpense = Number(g.cash_expense ?? 0);
    const noncashExpense = Number(g.total_expense ?? 0) - cashExpense;
    const diff = Number(g.difference ?? 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(fmtDepPeriod(g.period, group))}</td>
      <td class="right">${Number(g.count ?? 0)}</td>
      <td class="right strong">${money(g.total_revenue)}</td>
      <td class="right">${money(cashExpense)}</td>
      <td class="right">${money(noncashExpense)}</td>
      <td class="right">${money(g.required_cash)}</td>
      <td class="right">${money(g.actual_cash)}</td>
      <td class="right ${diff < 0 ? 'danger-text' : diff > 0 ? 'ok-text' : ''}">${money(diff)}</td>
      <td class="right ${Number(g.shortfall ?? 0) > 0 ? 'danger-text' : ''}">${money(g.shortfall)}</td>
      <td class="right strong">${money(g.actual_cash)}</td>`;
    body.appendChild(tr);
  }
};

const renderDepositRows = (data) => {
  const items = data.items ?? [];
  const total = Number(data.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / DEP_PAGE_SIZE));
  if (depPage > pages) {
    depPage = pages;
    return loadDeposits();
  }

  const body = $('dep-body');
  body.innerHTML = '';
  $('dep-empty').classList.toggle('hidden', items.length > 0);

  for (const d of items) {
    const isDraft = d.status === 'draft';
    const isVoid = d.status === 'voided';
    const canVoid = d.status === 'completed' || d.status === 'recorded';
    const diff = Number(d.difference ?? 0);
    const actions = [
      `<button class="btn small" data-action="detail" data-id="${d.id}">Detail</button>`,
      isDraft
        ? `<button class="btn small primary" data-action="complete" data-id="${d.id}">Selesaikan</button>`
        : '',
      isDraft
        ? `<button class="btn small danger" data-action="delete" data-id="${d.id}">Hapus</button>`
        : '',
      canVoid
        ? `<button class="btn small danger" data-action="void" data-id="${d.id}">Batalkan</button>`
        : '',
    ].filter(Boolean);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(fmtDay(d.deposited_on))}</td>
      <td class="mono">${escapeHtml(d.settlement_no ?? '—')}</td>
      <td>${escapeHtml(d.outlet_name ?? '—')}</td>
      <td>${escapeHtml(d.shift_label ?? '—')}</td>
      <td>${depStatusBadge(d.status)}</td>
      <td class="right">${money(d.required_cash)}</td>
      <td class="right">${isDraft || isVoid ? '—' : money(d.actual_cash)}</td>
      <td class="right ${diff < 0 ? 'danger-text' : diff > 0 ? 'ok-text' : ''}">${
        isDraft || isVoid ? '—' : money(diff)
      }</td>
      <td class="right ${Number(d.shortfall ?? 0) > 0 ? 'danger-text' : ''}">${money(d.shortfall)}</td>
      <td class="right">${actions.join(' ')}</td>`;
    body.appendChild(tr);
  }

  $('dep-page-info').textContent = `Halaman ${depPage} / ${pages} • ${total} setoran`;
  $('dep-prev-btn').disabled = depPage <= 1;
  $('dep-next-btn').disabled = depPage >= pages;
};

const loadDeposits = async () => {
  const b = activeBusiness();
  if (!b) {
    hide($('deposit-section'));
    return;
  }
  show($('deposit-section'));
  const [data, report] = await Promise.all([
    guard(() => api.cashDeposits.list(b.id, depQuery())),
    guard(() => api.cashDeposits.report(b.id, depReportQuery())),
  ]);
  if (!data || !report) return;
  renderDepositSummary(data.totals ?? {}, report.totals ?? {});
  renderDepositRecap(report);
  renderDepositRows(data);
};

const reloadDepositsFromFilters = () => {
  depPage = 1;
  loadDeposits();
};

$('dep-refresh-btn').addEventListener('click', reloadDepositsFromFilters);
$('dep-status-filter').addEventListener('change', reloadDepositsFromFilters);
$('dep-group').addEventListener('change', reloadDepositsFromFilters);
$('dep-date-from').addEventListener('change', reloadDepositsFromFilters);
$('dep-date-to').addEventListener('change', reloadDepositsFromFilters);
$('dep-outlet-filter').addEventListener('change', reloadDepositsFromFilters);
$('dep-cashier-filter').addEventListener('change', reloadDepositsFromFilters);
$('dep-prev-btn').addEventListener('click', () => {
  if (depPage > 1) {
    depPage -= 1;
    loadDeposits();
  }
});
$('dep-next-btn').addEventListener('click', () => {
  depPage += 1;
  loadDeposits();
});

const downloadDepositExcel = () => {
  const b = activeBusiness();
  if (!b) return;
  return runXlsxDownload({
    buttonId: 'dep-export-xlsx',
    loader: () => api.cashDeposits.exportXlsx(b.id, depExportQuery()),
    successLabel: 'Laporan Setoran Excel berhasil diunduh',
  });
};
$('dep-export-xlsx').addEventListener('click', downloadDepositExcel);

// ------------------------------------------------- Detail setoran -----------
const openDepositDetail = async (depositId) => {
  const b = activeBusiness();
  if (!b) return;
  const data = await guard(() => api.cashDeposits.detail(b.id, depositId));
  if (!data) return;
  const d = data.deposit ?? {};
  const outletName = d.outlet_name ?? data.outlet_name ?? '—';

  $('dep-detail-title').textContent = `Detail Setoran ${d.settlement_no ?? ''}`.trim();
  $('dep-detail-outlet').textContent = outletName;
  $('dep-detail-period').textContent =
    d.period_start || d.period_end
      ? `${fmtDate(d.period_start)} – ${fmtDate(d.period_end)}`
      : fmtDay(d.deposited_on);
  $('dep-detail-shift').textContent = d.shift_label ?? '—';
  $('dep-detail-status').innerHTML = depStatusBadge(d.status);
  $('dep-detail-officer').textContent = d.officer_name ?? data.officer_name ?? '—';
  $('dep-detail-deposited').textContent = d.completed_at
    ? fmtDate(d.completed_at)
    : fmtDay(d.deposited_on);
  $('dep-detail-note').textContent = d.note || d.cashier_note || '—';
  $('dep-detail-void').textContent = d.void_reason || '—';

  const diff = Number(d.difference ?? 0);
  $('dep-detail-summary').innerHTML = [
    statCard('Pendapatan', fmtIDR(d.total_revenue ?? 0), `${d.shift_label ?? ''}`),
    statCard('Tunai', fmtIDR(d.cash_revenue ?? 0), 'pendapatan kas'),
    statCard('QRIS', fmtIDR(d.qris_revenue ?? 0), 'non-tunai'),
    statCard('Pengeluaran', fmtIDR(d.total_expense ?? 0), 'kas + non-tunai'),
    statCard('Wajib setor', fmtIDR(d.required_cash ?? 0), 'tunai'),
    statCard('Tunai aktual', fmtIDR(d.actual_cash ?? 0), 'diserahkan'),
    statCard('Selisih', fmtIDR(diff), diff < 0 ? 'kurang' : diff > 0 ? 'lebih' : 'pas'),
    statCard('Kekurangan kas', fmtIDR(d.shortfall ?? 0), 'pengeluaran > pendapatan kas'),
  ].join('');

  const txBody = $('dep-detail-tx-body');
  const tx = data.transactions ?? [];
  txBody.innerHTML = '';
  $('dep-detail-tx-empty').classList.toggle('hidden', tx.length > 0);
  for (const t of tx) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(fmtDate(t.created_at))}</td>
      <td class="mono">${escapeHtml(t.invoice_no ?? '—')}</td>
      <td>${escapeHtml(METHOD_LABELS[t.method] ?? t.method ?? '—')}</td>
      <td class="right strong">${money(t.amount)}</td>`;
    txBody.appendChild(tr);
  }

  const expBody = $('dep-detail-exp-body');
  const exp = data.expenses ?? [];
  expBody.innerHTML = '';
  $('dep-detail-exp-empty').classList.toggle('hidden', exp.length > 0);
  for (const e of exp) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(fmtDay(e.spent_on))}</td>
      <td>${escapeHtml(CATEGORY_LABELS[e.category] ?? e.category ?? '—')}</td>
      <td>${escapeHtml(METHOD_LABELS[e.method] ?? e.method ?? '—')}</td>
      <td>${escapeHtml(e.note ?? '—')}</td>
      <td class="right strong">${money(e.amount)}</td>`;
    expBody.appendChild(tr);
  }

  show($('dep-detail-modal'));
};
$('dep-detail-close').addEventListener('click', () => hide($('dep-detail-modal')));
$('dep-detail-modal').addEventListener('click', (event) => {
  if (event.target === $('dep-detail-modal')) hide($('dep-detail-modal'));
});

// ------------------------------------------------- Setoran baru -------------
const fillDepositOutlets = async () => {
  const b = activeBusiness();
  if (!b) return;
  const body = await guard(() => api.outlets.list(b.id));
  const sel = $('dep-outlet');
  sel.innerHTML = '';
  for (const o of body?.items ?? []) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    sel.appendChild(opt);
  }
  const filter = $('dep-outlet-filter').value;
  if (filter && [...sel.options].some((o) => o.value === filter)) sel.value = filter;
};

const loadDepositPreview = async () => {
  const b = activeBusiness();
  if (!b) return null;
  const outletId = $('dep-outlet').value;
  const overlapEl = $('dep-preview-overlap');
  hide(overlapEl);
  hide($('dep-preview-empty'));
  if (!outletId) {
    hide($('dep-preview'));
    return null;
  }

  const data = await guard(() =>
    api.cashDeposits.preview(b.id, {
      outletId,
      date: $('dep-date').value || undefined,
      shift: $('dep-shift').value || 'full',
    })
  );
  if (!data) return null;
  depPreviewData = data;

  show($('dep-preview'));
  $('dep-preview-period').textContent = [
    data.outlet?.name ?? '—',
    data.period?.date ? fmtDay(data.period.date) : '',
    data.period?.shift_label ?? '',
  ]
    .filter(Boolean)
    .join(' • ');

  const t = data.totals ?? {};
  $('dep-preview-summary').innerHTML = [
    statCard('Pendapatan tunai', fmtIDR(t.cash_revenue ?? 0), `${(data.transactions ?? []).length} transaksi`),
    statCard('Pendapatan QRIS', fmtIDR(t.qris_revenue ?? 0), 'non-tunai'),
    statCard('Pengeluaran', fmtIDR(t.total_expense ?? 0), 'kas + non-tunai'),
    statCard('Wajib setor tunai', fmtIDR(t.required_cash ?? 0), 'tunai'),
    statCard('Kekurangan kas', fmtIDR(t.shortfall ?? 0), 'jika pengeluaran > tunai'),
  ].join('');

  if (data.overlap) {
    overlapEl.textContent = `Periode ini tumpang tindih dengan setoran ${
      data.overlap.settlement_no ?? data.overlap.id
    }. Pilih tanggal/shift lain.`;
    show(overlapEl);
  }

  const hasRows = (data.transactions ?? []).length > 0 || (data.expenses ?? []).length > 0;
  $('dep-preview-empty').classList.toggle('hidden', hasRows);
  return data;
};

const openDepositModal = async () => {
  depPreviewData = null;
  $('dep-form').reset();
  await fillDepositOutlets();
  $('dep-date').value = todayInTz(activeBusiness()?.timezone);
  hide($('dep-form-error'));
  hide($('dep-preview'));
  show($('dep-modal'));
  $('dep-outlet').focus();
  await loadDepositPreview();
};

$('dep-new-btn').addEventListener('click', () => {
  openDepositModal().catch((err) => alertBox(describeError(err), 'error'));
});
$('dep-preview-btn').addEventListener('click', () => {
  loadDepositPreview().catch((err) => alertBox(describeError(err), 'error'));
});
$('dep-outlet').addEventListener('change', () => {
  loadDepositPreview().catch((err) => alertBox(describeError(err), 'error'));
});
$('dep-date').addEventListener('change', () => {
  loadDepositPreview().catch((err) => alertBox(describeError(err), 'error'));
});
$('dep-shift').addEventListener('change', () => {
  loadDepositPreview().catch((err) => alertBox(describeError(err), 'error'));
});
$('dep-cancel').addEventListener('click', () => hide($('dep-modal')));
$('dep-modal').addEventListener('click', (event) => {
  if (event.target === $('dep-modal')) hide($('dep-modal'));
});

$('dep-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const err = $('dep-form-error');
  hide(err);
  const b = activeBusiness();
  if (!b) return;
  const outletId = $('dep-outlet').value;
  if (!outletId) {
    err.textContent = 'Pilih outlet terlebih dahulu.';
    show(err);
    return;
  }

  const saveAs = $('dep-save-as').value || 'completed';
  const note = $('dep-note').value.trim();
  const payload = {
    outletId,
    date: $('dep-date').value || todayInTz(b.timezone),
    shift: $('dep-shift').value || 'full',
    saveAs,
  };
  if (note) payload.note = note;
  const recipient = $('dep-recipient').value.trim();
  if (recipient) payload.recipientName = recipient;

  if (saveAs === 'completed') {
    const raw = $('dep-amount').value.trim();
    if (raw === '') {
      err.textContent = 'Uang tunai aktual wajib diisi untuk menyelesaikan setoran.';
      show(err);
      return;
    }
    const actual = Math.round(Number(raw) * 100);
    if (!Number.isFinite(actual) || actual < 0) {
      err.textContent = 'Uang tunai aktual tidak valid.';
      show(err);
      return;
    }
    payload.actualCash = actual;

    // Validasi cepat hanya bila pratinjau cocok dengan pilihan saat ini;
    // server tetap menjadi penentu akhir (menghindari blokir dari data basi).
    const previewMatches =
      depPreviewData &&
      depPreviewData.outlet?.id === outletId &&
      depPreviewData.period?.date === payload.date &&
      depPreviewData.period?.shift === payload.shift;
    if (previewMatches) {
      const required = Number(depPreviewData.totals?.required_cash ?? 0);
      if (actual !== required && note.length < 3) {
        err.textContent = 'Alasan selisih wajib diisi (minimal 3 karakter).';
        show(err);
        return;
      }
    }
  }

  const btn = $('dep-form').querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await guard(() => api.cashDeposits.createSettlement(b.id, payload));
    alertBox(
      saveAs === 'draft' ? 'Setoran disimpan sebagai draft.' : 'Setoran kas berhasil diselesaikan.',
      'ok'
    );
    hide($('dep-modal'));
    depPage = 1;
    await loadDeposits();
  } catch (e) {
    err.textContent = describeError(e);
    show(err);
  } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------- Selesaikan / hapus draft -------
const openCompleteModal = async (depositId) => {
  const b = activeBusiness();
  if (!b) return;
  const data = await guard(() => api.cashDeposits.detail(b.id, depositId));
  if (!data) return;
  const d = data.deposit ?? {};
  depCompleteId = depositId;
  depCompleteRequired = Number(d.required_cash ?? 0);
  $('dep-complete-info').textContent = `${d.settlement_no ?? 'Setoran'} • ${
    d.outlet_name ?? data.outlet_name ?? '—'
  } • wajib setor ${fmtIDR(depCompleteRequired)}`;
  $('dep-complete-amount').value = String(Math.round(depCompleteRequired / 100));
  $('dep-complete-note').value = d.note ?? d.cashier_note ?? '';
  $('dep-complete-recipient').value = d.recipient_name ?? '';
  hide($('dep-complete-error'));
  show($('dep-complete-modal'));
  $('dep-complete-amount').focus();
};

$('dep-complete-cancel').addEventListener('click', () => hide($('dep-complete-modal')));
$('dep-complete-modal').addEventListener('click', (event) => {
  if (event.target === $('dep-complete-modal')) hide($('dep-complete-modal'));
});

$('dep-complete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const err = $('dep-complete-error');
  hide(err);
  const b = activeBusiness();
  if (!b || !depCompleteId) return;
  const raw = $('dep-complete-amount').value.trim();
  if (raw === '') {
    err.textContent = 'Uang tunai aktual wajib diisi.';
    show(err);
    return;
  }
  const actual = Math.round(Number(raw) * 100);
  if (!Number.isFinite(actual) || actual < 0) {
    err.textContent = 'Uang tunai aktual tidak valid.';
    show(err);
    return;
  }
  const note = $('dep-complete-note').value.trim();
  if (actual !== depCompleteRequired && note.length < 3) {
    err.textContent = 'Alasan selisih wajib diisi (minimal 3 karakter).';
    show(err);
    return;
  }
  const payload = { actualCash: actual };
  if (note) payload.note = note;
  const recipient = $('dep-complete-recipient').value.trim();
  if (recipient) payload.recipientName = recipient;

  const btn = $('dep-complete-form').querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await guard(() => api.cashDeposits.complete(b.id, depCompleteId, payload));
    alertBox('Setoran draft diselesaikan.', 'ok');
    hide($('dep-complete-modal'));
    await loadDeposits();
  } catch (e) {
    err.textContent = describeError(e);
    show(err);
  } finally {
    btn.disabled = false;
  }
});

const deleteDraftDeposit = async (depositId) => {
  const b = activeBusiness();
  if (!b) return;
  if (!confirm('Hapus setoran draft ini? Tindakan ini tidak dapat dibatalkan.')) return;
  await guard(() => api.cashDeposits.deleteDraft(b.id, depositId));
  alertBox('Setoran draft dihapus.', 'ok');
  await loadDeposits();
};

// ------------------------------------------------------ Aksi baris ----------
$('dep-body').addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  try {
    if (action === 'detail') {
      await openDepositDetail(id);
    } else if (action === 'complete') {
      await openCompleteModal(id);
    } else if (action === 'delete') {
      await deleteDraftDeposit(id);
    } else if (action === 'void') {
      voidDepositId = id;
      const row = btn.closest('tr');
      const label = row?.querySelector('td:nth-child(2)')?.textContent?.trim() || id;
      $('dep-void-info').textContent = `Batalkan setoran ${label}. Baris tidak dihapus.`;
      $('dep-void-reason').value = '';
      hide($('dep-void-error'));
      show($('dep-void-modal'));
      $('dep-void-reason').focus();
    }
  } catch (err) {
    alertBox(describeError(err), 'error');
  }
});

// Void setoran kas (append-only; butuh alasan)
$('dep-void-cancel').addEventListener('click', () => hide($('dep-void-modal')));
$('dep-void-modal').addEventListener('click', (event) => {
  if (event.target === $('dep-void-modal')) hide($('dep-void-modal'));
});

$('dep-void-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const err = $('dep-void-error');
  hide(err);
  const b = activeBusiness();
  const reason = $('dep-void-reason').value.trim();
  if (reason.length < 3) {
    err.textContent = 'Alasan minimal 3 karakter.';
    show(err);
    return;
  }
  if (!b || !voidDepositId) return;
  try {
    await guard(() => api.cashDeposits.void(b.id, voidDepositId, reason));
    alertBox('Setoran kas dibatalkan.', 'ok');
    hide($('dep-void-modal'));
    await loadDeposits();
  } catch (e) {
    err.textContent = describeError(e);
    show(err);
  }
});

// ---------------------------------------- Riwayat pergerakan stok ------------
const movQuery = () => ({
  outletId: $('mov-outlet-filter').value || '',
  type: $('mov-type-filter').value || '',
  limit: 100,
});

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
      <td>${escapeHtml(fmtDate(m.created_at))}</td>
      <td>${escapeHtml(m.outlet_name ?? '—')}</td>
      <td>${escapeHtml(m.product_name ?? '—')}</td>
      <td>${escapeHtml(MOVEMENT_LABELS[m.type] ?? m.type)}</td>
      <td class="right ${delta > 0 ? 'ok-text' : delta < 0 ? 'danger-text' : ''}">${escapeHtml(sign)}</td>
      <td class="right">${m.qty_after != null ? Number(m.qty_after) : '—'}</td>
      <td>${escapeHtml(m.reason ?? m.actor_name ?? '—')}</td>`;
    body.appendChild(tr);
  }
};

const loadMovements = async () => {
  const b = activeBusiness();
  if (!b) {
    hide($('inventory-section'));
    return;
  }
  show($('inventory-section'));
  const data = await guard(() => api.inventoryMovements.list(b.id, movQuery()));
  if (!data) return;
  renderMovements(data);
};

$('mov-refresh-btn').addEventListener('click', loadMovements);
$('mov-type-filter').addEventListener('change', loadMovements);
$('mov-outlet-filter').addEventListener('change', loadMovements);

// ------------------------------------------------------------- Bootstrap -----
/**
 * Tangani kembalinya pengguna dari halaman pembayaran gateway
 * (`?pembayaran=selesai&order_id=...&status=...`).
 *
 * HANYA informasi: dokumentasi Duitku memperingatkan parameter `resultCode` pada
 * redirect dapat diubah manual, jadi status langganan TIDAK diubah di sini.
 * Status resmi hanya berubah lewat callback bertanda tangan atau tombol
 * "Cek status". Query dibersihkan agar pesan tidak muncul lagi saat dimuat ulang.
 */
const handlePaymentReturn = () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('pembayaran') !== 'selesai') return;
  const orderId = params.get('order_id');
  alertBox(
    orderId
      ? `Terima kasih. Pembayaran untuk pesanan ${orderId} sedang diverifikasi. Gunakan "Cek status" bila langganan belum berubah.`
      : 'Terima kasih. Pembayaran sedang diverifikasi oleh sistem.',
    'ok'
  );
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
};

/**
 * Bootstrap panel Owner dengan PEMULIHAN SESI (persistent login).
 *
 * Alur lama bergantung pada `guard()` yang menelan 401 dan tetap
 * menampilkan app-view; pemulihan hanya terjadi sebagai efek samping
 * `request()`. Sekarang sesi diverifikasi eksplisit lewat `restoreSession()`
 * sebelum memutuskan layar mana yang tampil, sehingga sesi yang masih valid
 * langsung membuka dashboard tanpa login ulang.
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
    await loadBusinesses();
    handlePaymentReturn();
  } catch (err) {
    // Sesi tidak dapat diverifikasi (mis. jaringan). Token TIDAK dihapus;
    // tampilkan login disertai pesan agar penyebabnya jelas.
    show($('login-view'));
    const el = $('login-error');
    el.textContent = describeError(err);
    show(el);
  }
};

// Bila tab/aplikasi kembali aktif dari background, perbarui sesi diam-diam
// supaya pengguna tidak terlempar ke login hanya karena access token basi.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tokenStore.hasSession) {
    restoreSession().catch(() => {});
  }
});

boot();