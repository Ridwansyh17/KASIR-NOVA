/**
 * Route PUBLIK gateway pembayaran — dipasang di `/api/payments`.
 *
 *   POST /api/payments/duitku/callback  callback pembayaran dari Duitku
 *   GET  /api/payments/duitku/return    halaman pengembalian setelah bayar
 *
 * Tanpa sesi (gateway tidak punya JWT). Pengamanan berlapis:
 *   1. rate limiter per IP (mencegah banjir permintaan),
 *   2. daftar IP opsional (env `PAYMENT_CALLBACK_IP_ALLOWLIST`; kosong = lewati),
 *   3. verifikasi TANDA TANGAN HMAC-SHA256 di service — kontrol utama.
 *
 * Callback tidak pernah mempercayai nominal dari klien: nilai callback wajib
 * sama dengan nominal tagihan di basis data, dan status lunas hanya berubah
 * lewat unit kerja idempoten di service.
 *
 * Duitku mewajibkan respons HTTP 200; kegagalan (non-200) membuat Duitku
 * mengirim ulang callback maksimal 5 kali.
 */
import { Router } from 'express';
import env from '../../config/env.js';
import { webhookLimiter } from '../../middleware/rateLimit.js';
import * as service from './service.js';

const router = Router();

const clientIp = (req) => String(req.ip ?? '').replace(/^::ffff:/, '');

/** Callback pembayaran (x-www-form-urlencoded dari Duitku). */
router.post('/duitku/callback', webhookLimiter, async (req, res, next) => {
  try {
    const allow = env.payments.callbackIpAllowlist;
    const ip = clientIp(req);
    if (allow.length > 0 && !allow.includes(ip)) {
      console.warn('[payment] callback diabaikan dari IP di luar daftar:', ip);
      return res.status(403).json({ error: { message: 'IP tidak diizinkan' } });
    }

    const result = await service.handleDuitkuCallback({ body: req.body ?? {}, ip });
    // Wajib 200: gateway berhenti mengulang hanya setelah menerima 200.
    // `ignored` juga 200 agar tagihan asing tidak diulang berkali-kali.
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * Halaman pengembalian (returnUrl). Hanya INFORMASI: dokumentasi Duitku
 * memperingatkan `resultCode` pada redirect dapat diubah manual oleh pengguna,
 * sehingga status pembayaran TIDAK diubah di sini (hanya callback/cek status).
 */
router.get('/duitku/return', (req, res) => {
  const { ownerPanelUrl } = env.payments;
  const orderId = String(req.query.merchantOrderId ?? '');
  const resultCode = String(req.query.resultCode ?? '');

  if (ownerPanelUrl) {
    const url = new URL(`${ownerPanelUrl}/index.html`);
    url.searchParams.set('pembayaran', 'selesai');
    if (orderId) url.searchParams.set('order_id', orderId);
    if (resultCode) url.searchParams.set('status', resultCode);
    return res.redirect(302, url.toString());
  }

  res.type('text/plain').send(
    `Pembayaran selesai. Nomor pesanan: ${orderId || '-'} (kode ${resultCode || '-'}).\n` +
      'Status resmi langganan hanya diperbarui lewat callback gateway atau tombol Cek Status di panel Owner.'
  );
});

export default router;
