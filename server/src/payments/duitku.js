/**
 * Klien payment gateway Duitku (v2 API, tanda tangan HMAC-SHA256).
 *
 * Rujukan: docs.duitku.com/api/id (changelog "Version 2.0", Apr 2026: MD5/SHA256
 * lama sudah usang, semua tanda tangan memakai HMAC-SHA256 heksadesimal
 * huruf kecil).
 *
 * Endpoint yang dipakai:
 *   POST {base}/v2/inquiry         buat tagihan (VA/QRIS/…) -> vaNumber|qrString
 *   POST {base}/transactionStatus  cek status tagihan
 *
 * Verifikasi callback (webhook) TIDAK memanggil jaringan: tanda tangan dihitung
 * ulang dari parameter yang diterima lalu dibandingkan dengan aman-waktu.
 *
 * Catatan penting dari dokumentasi:
 *   - `merchantOrderId` maks 50 karakter, `email` maks 50 karakter.
 *   - `customerVaName` maks 20 karakter.
 *   - Jumlah `itemDetails[].price * quantity` HARUS sama dengan paymentAmount
 *     (kalau tidak: HTTP 409).
 *   - Nilai minimum transaksi Rp 10.000 (HTTP 400 di bawah itu).
 *   - Semua nominal di API Duitku adalah RUPIAH BULAT (tanpa desimal),
 *     sedangkan basis data KASIR NOVA menyimpan SEN. Konversi hanya terjadi
 *     di berkas ini.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../middleware/error.js';

export const DUITKU_ENDPOINTS = {
  sandbox: 'https://sandbox.duitku.com/webapi/api/merchant',
  production: 'https://passport.duitku.com/webapi/api/merchant',
};

const DEFAULT_TIMEOUT_MS = 15_000;

/** HMAC-SHA256 heksadesimal huruf kecil atas gabungan `parts` tanpa pemisah. */
export const hmacHex = (parts, apiKey) =>
  createHmac('sha256', String(apiKey)).update(parts.map((p) => String(p)).join('')).digest('hex');

/** Tanda tangan permintaan transaksi: merchantCode + merchantOrderId + paymentAmount. */
export const signInquiry = ({ merchantCode, orderId, amountIdr, apiKey }) =>
  hmacHex([merchantCode, orderId, amountIdr], apiKey);

/** Tanda tangan permintaan cek status: merchantCode + merchantOrderId. */
export const signStatus = ({ merchantCode, orderId, apiKey }) =>
  hmacHex([merchantCode, orderId], apiKey);

/** Tanda tangan callback: merchantCode + amount + merchantOrderId. */
export const signCallback = ({ merchantCode, amount, orderId, apiKey }) =>
  hmacHex([merchantCode, amount, orderId], apiKey);

/** Perbandingan tanda tangan yang tidak membocorkan waktu (constant time). */
export const safeCompareHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
};

const asString = (v) => (v === undefined || v === null ? '' : String(v).trim());
const truncate = (v, max) => {
  const s = asString(v);
  return s.length > max ? s.slice(0, max) : s;
};

/** Buang tanda tangan sebelum payload disimpan (jangan simpan bukti rahasia). */
export const stripSignature = (payload = {}) => {
  const clean = { ...payload };
  delete clean.signature;
  delete clean.Signature;
  return clean;
};

/**
 * Buat klien Duitku.
 *
 * @param {object} opts
 * @param {string} opts.merchantCode
 * @param {string} opts.apiKey       rahasia; tidak pernah dilog/di-commit
 * @param {string} opts.baseUrl      opsional; default sesuai mode
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.fetchImpl] dipakai tes untuk menyuntik transport
 */
export const createDuitkuClient = ({
  merchantCode,
  apiKey,
  baseUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl,
} = {}) => {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new AppError('Transport HTTP tidak tersedia untuk gateway pembayaran', 500);
  }

  const postJson = async (path, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err?.name === 'AbortError' ? 'tidak merespons (waktu habis)' : 'tidak dapat dihubungi';
      throw new AppError(`Gateway pembayaran ${reason}`, 502);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text().catch(() => '');
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const detail =
        data?.Message ?? data?.message ?? data?.statusMessage ?? data?.responseMessage ?? `HTTP ${res.status}`;
      throw new AppError(`Gateway pembayaran menolak permintaan (${res.status}): ${detail}`, 502);
    }
    return data ?? {};
  };

  return {
    name: 'duitku',
    baseUrl,

    /**
     * Buat tagihan di Duitku.
     * @param {object} p
     * @param {string} p.orderId       nomor pesanan kita (<= 50 char, unik)
     * @param {number} p.amountIdr     nominal RUPIAH bulat
     * @param {string} p.method        kode kanal (BC, I1, …, NQ)
     * @param {string} p.productDetails keterangan (<= 255 char)
     * @param {string} p.email         email pemilik (<= 50 char)
     * @param {string} [p.customerName] nama tampil di bank (<= 20 char)
     * @param {string} [p.phoneNumber]
     * @param {string} p.callbackUrl
     * @param {string} p.returnUrl
     * @param {number} p.expiryMinutes
     */
    createInvoice: async ({
      orderId,
      amountIdr,
      method,
      productDetails,
      email,
      customerName,
      phoneNumber,
      callbackUrl,
      returnUrl,
      expiryMinutes,
    }) => {
      const payload = {
        merchantCode,
        paymentAmount: amountIdr,
        paymentMethod: asString(method).toUpperCase(),
        merchantOrderId: asString(orderId),
        productDetails: truncate(productDetails, 255),
        customerVaName: truncate(customerName || 'KASIR NOVA', 20),
        email: truncate(email, 50),
        itemDetails: [{ name: truncate(productDetails, 255), price: amountIdr, quantity: 1 }],
        callbackUrl,
        returnUrl,
        signature: signInquiry({ merchantCode, orderId, amountIdr, apiKey }),
      };
      if (asString(phoneNumber)) payload.phoneNumber = truncate(phoneNumber, 50);
      if (Number.isFinite(Number(expiryMinutes)) && Number(expiryMinutes) > 0) {
        payload.expiryPeriod = Math.floor(Number(expiryMinutes));
      }

      const res = await postJson('/v2/inquiry', payload);
      if (asString(res.statusCode) !== '00') {
        throw new AppError(
          `Gateway menolak pembuatan tagihan: ${asString(res.statusMessage) || 'tidak diketahui'}`,
          502
        );
      }

      return {
        reference: asString(res.reference) || null,
        vaNumber: asString(res.vaNumber) || null,
        qrString: asString(res.qrString) || null,
        paymentUrl: asString(res.paymentUrl) || null,
        appUrl: asString(res.AppUrl) || null,
        amountIdr: Number(res.amount ?? amountIdr),
        raw: res,
      };
    },

    /**
     * Cek status tagihan. statusCode: 00 sukses, 01 diproses, 02 gagal/kedaluwarsa.
     * Jangan dipanggil berulang otomatis (Duitku membatasi hit rate).
     */
    checkStatus: async (orderId) => {
      const res = await postJson('/transactionStatus', {
        merchantCode,
        merchantOrderId: asString(orderId),
        signature: signStatus({ merchantCode, orderId, apiKey }),
      });
      return {
        statusCode: asString(res.statusCode),
        statusMessage: asString(res.statusMessage),
        amountIdr: Number(res.amount ?? 0),
        reference: asString(res.reference) || null,
        fee: asString(res.fee) || null,
        raw: res,
      };
    },

    /**
     * Verifikasi callback tanpa jaringan.
     * @returns {{ok:boolean, reason?:string, orderId?:string, amountIdr?:number,
     *            resultCode?:string, paymentCode?:string, reference?:string}}
     */
    verifyCallback: (body = {}) => {
      const merchantCodeIn = asString(body.merchantCode ?? body.merchantcode);
      const amountIn = asString(body.amount);
      const orderId = asString(body.merchantOrderId);
      const signature = asString(body.signature);

      if (!merchantCodeIn || !amountIn || !orderId || !signature) {
        return { ok: false, reason: 'parameter_callback_kurang' };
      }
      if (merchantCodeIn !== merchantCode) {
        return { ok: false, reason: 'merchant_code_tidak_cocok' };
      }
      const expected = signCallback({ merchantCode, amount: amountIn, orderId, apiKey });
      if (!safeCompareHex(signature, expected)) {
        return { ok: false, reason: 'tanda_tangan_tidak_sah' };
      }
      if (!/^\d+$/.test(amountIn.replace(/\.0+$/, ''))) {
        return { ok: false, reason: 'nominal_tidak_valid' };
      }

      return {
        ok: true,
        orderId,
        amountIdr: Number(amountIn),
        resultCode: asString(body.resultCode),
        paymentCode: asString(body.paymentCode),
        reference: asString(body.reference) || null,
      };
    },
  };
};

export default createDuitkuClient;
