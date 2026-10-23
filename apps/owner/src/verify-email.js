/**
 * Halaman verifikasi email Owner.
 *
 * - State berasal dari URL tautan verifikasi Firebase (JWT bertanda tangan).
 * - Email & status diambil dari backend; frontend TIDAK menentukan status.
 * - Tombol "Saya Sudah Verifikasi" meminta backend memeriksa Firebase Admin SDK.
 * - Tombol "Kirim Ulang Email" dibatasi rate limit + cooldown di server.
 */
import {
  ApiError,
  firebaseVerificationStatus,
  resendFirebaseVerification,
  verifyFirebaseOwner,
} from './api.js';

const $ = (id) => document.getElementById(id);
const STATE_KEY = 'nova_owner_verify_state';
const EMAIL_KEY = 'nova_owner_verify_email';

const ui = {
  email: $('verify-email'),
  loading: $('verify-loading'),
  message: $('verify-message'),
  check: $('check-verify'),
  resend: $('resend-verify'),
  back: $('back-login'),
};

let state = null;
let retryTimer = null;
let initialEmailSent = true;

const setLoading = (loading) => {
  ui.loading.classList.toggle('hidden', !loading);
};

const showMessage = (text, type = 'ok') => {
  ui.message.textContent = text;
  ui.message.className = `alert ${type}`;
};

const hideMessage = () => {
  ui.message.className = 'alert hidden';
  ui.message.textContent = '';
};

const setButtons = ({ check = true, resend = true } = {}) => {
  ui.check.disabled = !check || !state;
  ui.resend.disabled = !resend || !state;
};

const describeError = (err) => {
  if (err instanceof ApiError && err.details?.fields?.length) {
    return err.details.fields.map((f) => f.message).join('; ');
  }
  return err?.message ?? 'Terjadi kesalahan. Coba lagi.';
};

const storeEmail = (email) => {
  if (!email) return;
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    /* localStorage dapat diblokir */
  }
};

const readStoredEmail = () => {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
};

const stateFromUrl = () => {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('state');
  if (fromUrl) {
    initialEmailSent = url.searchParams.get('sent') !== '0';
    try {
      localStorage.setItem(STATE_KEY, fromUrl);
    } catch {
      /* abaikan */
    }
    url.searchParams.delete('state');
    url.searchParams.delete('sent');
    window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    return fromUrl;
  }
  try {
    return localStorage.getItem(STATE_KEY);
  } catch {
    return null;
  }
};

const startCooldown = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    setButtons({ check: true, resend: true });
    return;
  }
  let remaining = Math.ceil(seconds);
  clearInterval(retryTimer);
  ui.resend.disabled = true;
  ui.check.disabled = false;
  ui.resend.textContent = `Kirim Ulang Email (${remaining}s)`;
  retryTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(retryTimer);
      ui.resend.disabled = false;
      ui.resend.textContent = 'Kirim Ulang Email';
      return;
    }
    ui.resend.textContent = `Kirim Ulang Email (${remaining}s)`;
  }, 1000);
};

const applyStatus = (status) => {
  if (status.email) {
    ui.email.textContent = status.email;
    storeEmail(status.email);
  }
  if (status.verified) {
    showMessage('Email Anda sudah terverifikasi. Silakan masuk ke panel Owner.', 'ok');
    setButtons({ check: false, resend: false });
    ui.back.textContent = 'Masuk ke panel Owner';
    return;
  }
  setButtons({ check: true, resend: status.canResend !== false });
  if (status.retryAfterSeconds) startCooldown(status.retryAfterSeconds);
  if (!initialEmailSent) {
    showMessage(
      'Email verifikasi belum terkirim saat pendaftaran. Tekan Kirim Ulang Email untuk mencoba lagi.',
      'error'
    );
  }
};

const loadStatus = async () => {
  if (!state) {
    setLoading(false);
    ui.email.textContent = '—';
    showMessage(
      'Tautan verifikasi tidak ditemukan. Buka kembali tautan dari email atau masuk ke panel Owner.',
      'error'
    );
    setButtons({ check: false, resend: false });
    return;
  }

  setLoading(true);
  hideMessage();
  try {
    const status = await firebaseVerificationStatus(state);
    ui.email.textContent = status.email || readStoredEmail() || '—';
    applyStatus(status);
  } catch (err) {
    showMessage(describeError(err), 'error');
    if (err instanceof ApiError && err.details?.retryAfterSeconds) {
      startCooldown(err.details.retryAfterSeconds);
    } else {
      setButtons({ check: true, resend: false });
    }
  } finally {
    setLoading(false);
  }
};

ui.check.addEventListener('click', async () => {
  if (!state) return;
  clearInterval(retryTimer);
  hideMessage();
  setLoading(true);
  setButtons({ check: false, resend: false });
  ui.check.textContent = 'Memeriksa…';
  try {
    const result = await verifyFirebaseOwner(state);
    if (result.verified) {
      showMessage(result.message ?? 'Email berhasil diverifikasi. Silakan masuk.', 'ok');
      setLoading(false);
      setButtons({ check: false, resend: false });
      ui.back.textContent = 'Masuk ke panel Owner';
      return;
    }
    showMessage(result.message ?? 'Email belum diverifikasi. Buka tautan di email Anda.', 'error');
  } catch (err) {
    showMessage(describeError(err), 'error');
  } finally {
    ui.check.textContent = 'Saya Sudah Verifikasi';
    setLoading(false);
    if (!ui.back.textContent.includes('Masuk ke panel')) {
      setButtons({ check: true, resend: ui.resend.disabled === false });
    }
  }
});

ui.resend.addEventListener('click', async () => {
  if (!state) return;
  hideMessage();
  setLoading(true);
  ui.resend.disabled = true;
  ui.resend.textContent = 'Mengirim…';
  try {
    const result = await resendFirebaseVerification(state);
    if (result.verified) {
      showMessage(result.message ?? 'Email sudah terverifikasi. Silakan masuk.', 'ok');
      setButtons({ check: false, resend: false });
      ui.back.textContent = 'Masuk ke panel Owner';
      return;
    }
    showMessage(result.message ?? 'Email verifikasi baru telah dikirim.', 'ok');
    startCooldown(result.retryAfterSeconds ?? 60);
  } catch (err) {
    showMessage(describeError(err), 'error');
    if (err instanceof ApiError && err.details?.retryAfterSeconds) {
      startCooldown(err.details.retryAfterSeconds);
    } else {
      ui.resend.disabled = false;
    }
  } finally {
    setLoading(false);
    if (!ui.resend.disabled) {
      ui.resend.textContent = 'Kirim Ulang Email';
      setButtons({ check: true, resend: true });
    }
  }
});

// Muat status awal. Jika state tidak ada, tampilkan panduan.
state = stateFromUrl();
if (readStoredEmail()) ui.email.textContent = readStoredEmail();
loadStatus();
