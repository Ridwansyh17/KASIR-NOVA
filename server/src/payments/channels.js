/**
 * Katalog kanal pembayaran Duitku yang dipakai KASIR NOVA.
 *
 * Daftar kode diambil dari dokumentasi resmi Duitku
 * (docs.duitku.com/api/id — bagian "Metode Pembayaran").
 *
 * Yang disimpan di sini hanya metadata presentasi + masa berlaku (expiry):
 *   - `kind`   : cara tagihan diselesaikan (va/qris/retail/ewallet/card/other)
 *                -> menentukan cara UI menampilkan tagihan (nomor VA vs QR).
 *   - `label`  : nama kanal untuk Owner.
 *   - `defaultExpiry`/`maxExpiry`: menit. Duitku mengabaikan nilai di atas
 *                `maxExpiry` untuk sebagian kanal (mis. QRIS ShopeePay = 60).
 *
 * Tidak ada rahasia di berkas ini.
 */

export const DUITKU_CHANNELS = {
  // --- Virtual Account -----------------------------------------------------
  BC: { label: 'BCA Virtual Account', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  I1: { label: 'BNI Virtual Account', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  M2: { label: 'Mandiri Virtual Account', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  BR: { label: 'BRI Virtual Account (BRIVA)', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  VA: { label: 'Maybank Virtual Account', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  B1: { label: 'CIMB Niaga Virtual Account', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  BT: { label: 'Permata Virtual Account', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  DM: { label: 'Danamon Virtual Account', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  BV: { label: 'BSI Virtual Account', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  NC: { label: 'Bank Neo Commerce Virtual Account', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  A1: { label: 'ATM Bersama', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  AG: { label: 'Bank Artha Graha', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },
  S1: { label: 'Bank Sahabat Sampoerna', kind: 'va', defaultExpiry: 1440, maxExpiry: 1440 },

  // --- QRIS ----------------------------------------------------------------
  NQ: { label: 'QRIS (Nobu)', kind: 'qris', defaultExpiry: 1440, maxExpiry: 1440 },
  SP: { label: 'QRIS (ShopeePay)', kind: 'qris', defaultExpiry: 60, maxExpiry: 60 },
  SQ: { label: 'QRIS (Nusapay)', kind: 'qris', defaultExpiry: 60, maxExpiry: 60 },

  // --- Ritel / e-wallet / kartu (disediakan untuk kelengkapan katalog) ------
  IR: { label: 'Indomaret', kind: 'retail', defaultExpiry: 1440, maxExpiry: 1440 },
  FT: { label: 'Pegadaian / ALFA / Pos', kind: 'retail', defaultExpiry: 1440, maxExpiry: 1440 },
  OV: { label: 'OVO', kind: 'ewallet', defaultExpiry: 10, maxExpiry: 1440 },
  DA: { label: 'DANA', kind: 'ewallet', defaultExpiry: 1440, maxExpiry: 1440 },
  SA: { label: 'ShopeePay (aplikasi)', kind: 'ewallet', defaultExpiry: 10, maxExpiry: 60 },
  LF: { label: 'LinkAja (biaya tetap)', kind: 'ewallet', defaultExpiry: 24, maxExpiry: 1440 },
  LA: { label: 'LinkAja (biaya persen)', kind: 'ewallet', defaultExpiry: 24, maxExpiry: 1440 },
  VC: { label: 'Kartu Kredit (Visa/Mastercard/JCB)', kind: 'card', defaultExpiry: 30, maxExpiry: 30 },
};

/**
 * Kanal yang dipakai default: hanya Virtual Account.
 *
 * Alasan: kanal VA di sandbox Duitku bisa diselesaikan lewat halaman demo
 * (tanpa aplikasi staging), sedangkan QRIS sandbox perlu aplikasi staging
 * (ShopeePay/Nusapay). Kanal lain tetap dapat dinyalakan lewat env
 * `PAYMENT_CHANNELS` tanpa mengubah kode.
 */
export const DEFAULT_CHANNEL_CODES = ['BC', 'I1', 'M2', 'BR'];

const FALLBACK = { label: null, kind: 'other', defaultExpiry: 1440, maxExpiry: 1440 };

/** Metadata kanal; `label` null berarti kode tidak dikenal. */
export const channelInfo = (code) => {
  const key = String(code ?? '').trim().toUpperCase();
  const found = DUITKU_CHANNELS[key];
  if (!found) return { code: key, label: null, ...FALLBACK };
  return { code: key, ...found };
};

export const isKnownChannel = (code) => Boolean(DUITKU_CHANNELS[String(code ?? '').trim().toUpperCase()]);

/** Daftar kanal siap-tampil untuk Owner (kode yang dikonfigurasi saja). */
export const channelsForList = (codes = DEFAULT_CHANNEL_CODES) =>
  codes
    .map((code) => channelInfo(code))
    .filter((c) => c.label !== null && c.code.length > 0);

/**
 * Masa berlaku tagihan (menit) untuk sebuah kanal:
 * `min(nilai diminta, maxExpiry kanal)`, minimal 1 menit.
 */
export const expiryMinutesFor = (code, requestedMinutes) => {
  const info = channelInfo(code);
  const requested = Number.isFinite(Number(requestedMinutes)) && Number(requestedMinutes) > 0
    ? Math.floor(Number(requestedMinutes))
    : info.defaultExpiry;
  return Math.max(1, Math.min(requested, info.maxExpiry));
};

export default {
  DUITKU_CHANNELS,
  DEFAULT_CHANNEL_CODES,
  channelInfo,
  isKnownChannel,
  channelsForList,
  expiryMinutesFor,
};
