/**
 * Pengirim email KASIR NOVA.
 *
 * Provider yang didukung (dipilih via `MAIL_PROVIDER`):
 *   - `resend` : HTTP API Resend (tanpa dependency tambahan) — cocok untuk Vercel.
 *   - `smtp`   : SMTP via `nodemailer` (host/port/user/pass dari env).
 *   - `disabled` (default): server tetap berjalan. Di development tautan
 *     verifikasi ditulis ke log; di produksi pendaftaran ditutup (503).
 *
 * Rahasia (RESEND_API_KEY / SMTP_PASS) hanya dibaca dari lingkungan dan tidak
 * pernah dicatat ke log.
 */
import env from '../config/env.js';
import { AppError } from '../middleware/error.js';

const TIMEOUT_MS = 15_000;

let testSender = null;

/**
 * Ganti pengirim saat pengujian. `null` mengembalikan perilaku normal.
 * @param {null | ((message: object) => Promise<object>)} sender
 */
export const setMailerForTests = (sender) => {
  testSender = sender;
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Apakah pengiriman email siap dipakai di lingkungan saat ini. */
export const isMailConfigured = () => {
  const cfg = env.mail;
  if (cfg.provider === 'resend') return Boolean(cfg.resendApiKey && cfg.from);
  if (cfg.provider === 'smtp') {
    return Boolean(cfg.smtp.host && cfg.smtp.port && cfg.from);
  }
  return false;
};

const requireConfigured = () => {
  if (isMailConfigured()) return;
  // Di produksi pendaftaran harus ditutup bila email tidak siap; di dev
  // pendaftaran tetap bisa diuji lewat tautan yang ditulis ke log.
  if (env.isProduction) {
    throw new AppError('Pendaftaran belum dibuka (email belum dikonfigurasi).', 503);
  }
};

const postResend = async (message) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.mail.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.mail.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'waktu habis' : 'tidak dapat dihubungi';
    throw new AppError(`Layanan email ${reason}`, 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[mail] Resend menolak pengiriman:', res.status, detail.slice(0, 200));
    throw new AppError('Email verifikasi gagal dikirim. Coba lagi beberapa saat lagi.', 502);
  }
  return { delivered: true, provider: 'resend' };
};

const postSmtp = async (message) => {
  let nodemailer;
  try {
    nodemailer = await import('nodemailer');
  } catch {
    throw new AppError('Modul email SMTP belum tersedia di server', 500);
  }
  const transporter = nodemailer.default.createTransport({
    host: env.mail.smtp.host,
    port: env.mail.smtp.port,
    secure: env.mail.smtp.secure,
    auth: env.mail.smtp.user
      ? { user: env.mail.smtp.user, pass: env.mail.smtp.pass }
      : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  try {
    await transporter.sendMail({
      from: env.mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } catch (err) {
    console.error('[mail] SMTP gagal:', err?.message ?? 'unknown');
    throw new AppError('Email verifikasi gagal dikirim. Coba lagi beberapa saat lagi.', 502);
  }
  return { delivered: true, provider: 'smtp' };
};

/**
 * Kirim satu email. Tidak pernah mencatat alamat/token ke log produksi.
 * @param {{to:string, subject:string, text:string, html?:string}} message
 */
export const sendEmail = async (message) => {
  if (testSender) return testSender(message);

  const cfg = env.mail;
  if (cfg.provider === 'resend') return postResend(message);
  if (cfg.provider === 'smtp') return postSmtp(message);

  requireConfigured();
  // Dev fallback (MAIL_PROVIDER=disabled): tampilkan isi ke log server.
  console.log('\n[mail:dev] Email tidak dikirim (MAIL_PROVIDER=disabled):');
  console.log(`  Ke     : ${message.to}`);
  console.log(`  Subjek : ${message.subject}`);
  console.log(message.text);
  console.log('');
  return { delivered: false, provider: 'disabled', preview: true };
};

/** Susun & kirim email verifikasi pendaftaran Owner. */
export const sendOwnerVerificationEmail = async ({ to, fullName, verifyUrl, expiresHours }) => {
  const name = String(fullName ?? '').trim() || 'Pemilik';
  const text = [
    `Halo ${name},`,
    '',
    'Terima kasih telah mendaftar di KASIR NOVA.',
    'Buka tautan berikut untuk memverifikasi email Anda:',
    '',
    verifyUrl,
    '',
    `Tautan berlaku ${expiresHours} jam dan hanya dapat dipakai sekali.`,
    'Bila Anda tidak merasa mendaftar, abaikan email ini.',
    '',
    'Salam,',
    'KASIR NOVA',
  ].join('\n');

  const html = `<!doctype html>
<html lang="id"><body style="margin:0;background:#f5fafd;font-family:Segoe UI,Arial,sans-serif;color:#0b1b33">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="background:#062a66;border-radius:16px 16px 0 0;padding:22px 24px;color:#fff">
      <strong style="font-size:20px;letter-spacing:.02em">KASIR NOVA</strong>
    </div>
    <div style="background:#fff;border:1px solid #e0e7f2;border-top:0;border-radius:0 0 16px 16px;padding:26px 24px">
      <p style="margin:0 0 14px">Halo <strong>${escapeHtml(name)}</strong>,</p>
      <p style="margin:0 0 14px">Terima kasih telah mendaftar di KASIR NOVA. Klik tombol di bawah untuk memverifikasi email Anda.</p>
      <p style="margin:22px 0">
        <a href="${escapeHtml(verifyUrl)}" style="background:#0072f6;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:12px;display:inline-block">Verifikasi Email</a>
      </p>
      <p style="margin:0 0 8px;color:#5b6b85;font-size:14px">Atau salin tautan ini ke peramban:</p>
      <p style="margin:0 0 18px;word-break:break-all;font-size:13px"><a href="${escapeHtml(verifyUrl)}" style="color:#0050d2">${escapeHtml(verifyUrl)}</a></p>
      <p style="margin:0;color:#5b6b85;font-size:14px">Tautan berlaku ${Number(expiresHours)} jam dan hanya dapat dipakai sekali. Bila Anda tidak merasa mendaftar, abaikan email ini.</p>
    </div>
  </div>
</body></html>`;

  return sendEmail({
    to,
    subject: 'Verifikasi email akun KASIR NOVA',
    text,
    html,
  });
};

export default { sendEmail, sendOwnerVerificationEmail, isMailConfigured, setMailerForTests };
