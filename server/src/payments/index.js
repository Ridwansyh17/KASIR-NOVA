/**
 * Registri penyedia pembayaran langganan.
 *
 * Saat ini hanya satu penyedia: **Duitku** (uji sandbox). Abstraksinya sengaja
 * tipis — cukup `createInvoice`, `checkStatus`, `verifyCallback`, `name` —
 * supaya penyedia lain (Midtrans/Xendit) dapat ditambahkan tanpa mengubah
 * modul tagihan.
 *
 * Penyedia dipilih lewat env `PAYMENT_PROVIDER`. Bila belum dikonfigurasi
 * (`disabled`/kredensial kosong), server TETAP berjalan: endpoint pembayaran
 * langganan menjawab 503 dengan pesan yang jelas. Konfigurasi yang salah tidak
 * boleh mematikan seluruh aplikasi kasir.
 *
 * Kunci pengaman produksi: mode `production` (uang nyata) hanya dipakai bila
 * `PAYMENT_ALLOW_PRODUCTION=true` — mencegah tagihan nyata tanpa keputusan
 * pemilik.
 */
import env from '../config/env.js';
import { AppError } from '../middleware/error.js';
import { createDuitkuClient, DUITKU_ENDPOINTS } from './duitku.js';
import {
  DEFAULT_CHANNEL_CODES,
  channelsForList,
  channelInfo,
  expiryMinutesFor,
  isKnownChannel,
} from './channels.js';

/** Penyedia pengganti untuk tes (dependency injection). */
let testProvider = null;

export const setProviderForTests = (provider) => {
  testProvider = provider;
};

export const clearProviderForTests = () => {
  testProvider = null;
};

export const getPaymentsConfig = () => env.payments;

/** Nama penyedia yang dikonfigurasi ('duitku' | 'disabled'). */
export const configuredProviderName = () => env.payments.provider || 'disabled';

/** Kanal aktif (kode terdaftar, urut sesuai konfigurasi). */
export const activeChannels = (codes = env.payments.channels) => {
  const list = codes && codes.length > 0 ? codes : DEFAULT_CHANNEL_CODES;
  return channelsForList(list.filter((code) => isKnownChannel(code)));
};

/**
 * Bangun penyedia dari konfigurasi.
 * @returns {{provider: object|null, reason: string|null}}
 */
const buildProvider = () => {
  const cfg = env.payments;
  if (!cfg.provider || cfg.provider === 'disabled') {
    return { provider: null, reason: 'gateway_belum_dikonfigurasi' };
  }
  if (cfg.provider !== 'duitku') {
    return { provider: null, reason: 'penyedia_tidak_dikenal' };
  }
  if (!cfg.duitku.merchantCode || !cfg.duitku.apiKey) {
    return { provider: null, reason: 'kredensial_duitku_belum_lengkap' };
  }
  if (cfg.mode === 'production' && !cfg.allowProduction) {
    return { provider: null, reason: 'mode_produksi_belum_diizinkan' };
  }
  const baseUrl =
    cfg.duitku.baseUrl || DUITKU_ENDPOINTS[cfg.mode] || DUITKU_ENDPOINTS.sandbox;
  return {
    provider: createDuitkuClient({
      merchantCode: cfg.duitku.merchantCode,
      apiKey: cfg.duitku.apiKey,
      baseUrl,
    }),
    reason: null,
  };
};

const resolve = () => (testProvider ? { provider: testProvider, reason: null } : buildProvider());

/** Penyedia aktif atau null bila belum siap. */
export const resolveProvider = () => resolve().provider;

/** true bila pembayaran langganan siap dipakai. */
export const isPaymentsEnabled = () => Boolean(resolve().provider);

/** Penyedia aktif; melempar 503 bila belum dikonfigurasi. */
export const requireProvider = () => {
  const { provider, reason } = resolve();
  if (!provider) {
    const pesan =
      reason === 'kredensial_duitku_belum_lengkap'
        ? 'Kredensial Duitku (DUITKU_MERCHANT_CODE/DUITKU_API_KEY) belum lengkap di server.'
        : reason === 'mode_produksi_belum_diizinkan'
          ? 'Mode produksi gateway belum diizinkan (butuh PAYMENT_ALLOW_PRODUCTION=true).'
          : 'Pembayaran langganan belum dikonfigurasi di server ini.';
    throw new AppError(pesan, 503, { reason });
  }
  return provider;
};

/**
 * Ringkasan status gateway untuk UI Owner (tanpa rahasia apa pun).
 * `enabled=false` berarti tombol bayar dinonaktifkan dan alasannya ditampilkan.
 */
export const describePayments = () => {
  const { provider, reason } = resolve();
  const cfg = env.payments;
  return {
    enabled: Boolean(provider),
    provider: provider?.name ?? null,
    mode: cfg.mode,
    reason,
    min_amount_idr: cfg.minAmountIdr,
    channels: activeChannels().map((c) => ({
      code: c.code,
      label: c.label,
      kind: c.kind,
    })),
  };
};

export {
  channelInfo,
  expiryMinutesFor,
  isKnownChannel,
  channelsForList,
  DEFAULT_CHANNEL_CODES,
};
export { DUITKU_ENDPOINTS };

export default {
  requireProvider,
  resolveProvider,
  isPaymentsEnabled,
  describePayments,
  activeChannels,
  setProviderForTests,
  clearProviderForTests,
};
