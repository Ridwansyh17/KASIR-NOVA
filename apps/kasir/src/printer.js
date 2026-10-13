/**
 * KASIR NOVA — Layanan printer thermal Bluetooth (lapisan transport).
 *
 * Modul ini TIDAK membentuk struk (itu tugas `escpos.js`). Ia hanya mengurus:
 *   - deteksi platform native (Capacitor),
 *   - izin Bluetooth,
 *   - daftar perangkat (Classic SPP terpasang & hasil pindai BLE),
 *   - sambung/putus,
 *   - kirim byte ESC/POS ke plugin native `NovaPrinter`,
 *   - simpan perangkat & pengaturan di localStorage.
 *
 * Tanpa impor relatif supaya dapat diuji di Node (data: URL). Akses ke
 * Capacitor/localStorage/btoa lewat `globalThis` dengan penjagaan, sehingga
 * modul ini aman dimuat di lingkungan web biasa (di sana `isNative()` = false).
 *
 * Plugin native diakses lewat `window.Capacitor.Plugins.NovaPrinter` (fallback
 * `Capacitor.registerPlugin('NovaPrinter')`). Tidak butuh bundler.
 */

export const PLUGIN_NAME = 'NovaPrinter';
export const DEVICE_KEY = 'nova_kasir_printer_device';
export const SETTINGS_KEY = 'nova_kasir_printer_settings';

export class PrinterError extends Error {
  constructor(message, code = 'printer_error') {
    super(message);
    this.name = 'PrinterError';
    this.code = code;
  }
}

const root = () => (typeof globalThis !== 'undefined' ? globalThis : {});
const capacity = () => root().Capacitor;

/** True bila berjalan di dalam aplikasi native Capacitor (Android/iOS). */
export const isNative = () => {
  const c = capacity();
  return Boolean(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
};

/** Ambil objek plugin native, atau null bila tidak tersedia. */
const getPlugin = () => {
  const c = capacity();
  if (!c || typeof c.isNativePlatform !== 'function' || !c.isNativePlatform()) return null;
  try {
    if (typeof c.registerPlugin === 'function') return c.registerPlugin(PLUGIN_NAME);
  } catch {
    /* lanjut ke fallback */
  }
  return c.Plugins?.[PLUGIN_NAME] ?? null;
};

const pluginOrThrow = () => {
  const p = getPlugin();
  if (!p) {
    throw new PrinterError(
      'Cetak thermal hanya tersedia di aplikasi Android KASIR NOVA.',
      'not_native'
    );
  }
  return p;
};

// --- Penyimpanan (aman bila localStorage tidak ada) -------------------------
const readJSON = (key) => {
  try {
    const raw = root().localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const writeJSON = (key, value) => {
  try {
    root().localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* abaikan (mode privat / storage penuh) */
  }
};
const removeKey = (key) => {
  try {
    root().localStorage?.removeItem(key);
  } catch {
    /* abaikan */
  }
};

/** Uint8Array -> base64 (untuk jembatan Capacitor). */
export const bytesToBase64 = (bytes) => {
  const b64 = root().btoa;
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  if (typeof b64 === 'function') return b64(bin);
  // Fallback manual bila btoa tak ada (seharusnya tak terjadi di WebView/Node).
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bin.length; i += 3) {
    const c1 = bin.charCodeAt(i);
    const c2 = bin.charCodeAt(i + 1);
    const c3 = bin.charCodeAt(i + 2);
    const n = (c1 << 16) | ((Number.isNaN(c2) ? 0 : c2) << 8) | (Number.isNaN(c3) ? 0 : c3);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += Number.isNaN(c2) ? '=' : chars[(n >> 6) & 63];
    out += Number.isNaN(c3) ? '=' : chars[n & 63];
  }
  return out;
};

// --- Izin & ketersediaan ----------------------------------------------------
/** Ringkasan status adaptor Bluetooth (native). */
export const checkAvailability = async () => {
  if (!isNative()) return { native: false, ready: false, enabled: false };
  const p = getPlugin();
  if (!p) return { native: true, ready: false, enabled: false };
  try {
    const res = await p.isAvailable();
    return { native: true, ready: true, enabled: true, ...res };
  } catch (err) {
    return { native: true, ready: false, enabled: false, error: err?.message ?? String(err) };
  }
};

/** Minta izin Bluetooth (Android 12+ / lokasi untuk BLE di versi lama). */
export const requestPermissions = async () => {
  const p = pluginOrThrow();
  return p.requestPermissions();
};

/** Periksa izin tanpa meminta. */
export const checkPermissions = async () => {
  const p = pluginOrThrow();
  return p.checkPermissions();
};

// --- Daftar perangkat -------------------------------------------------------
/** Perangkat Classic Bluetooth yang sudah dipasangkan (bonded) di Android. */
export const listBonded = async () => {
  const p = pluginOrThrow();
  const res = await p.listBondedDevices();
  return res?.devices ?? [];
};

/** Pindai perangkat BLE selama `timeoutMs` milidetik. */
export const scanBle = async ({ timeoutMs = 8000 } = {}) => {
  const p = pluginOrThrow();
  const res = await p.startBleScan({ timeoutMs });
  return res?.devices ?? [];
};

export const stopBleScan = async () => {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.stopBleScan();
  } catch {
    /* abaikan */
  }
};

// --- Sambungan --------------------------------------------------------------
/**
 * Sambungkan ke printer.
 * @param {{address:string, transport?:'spp'|'ble', name?:string}} device
 */
export const connect = async ({ address, transport = 'spp', name = '' }) => {
  const p = pluginOrThrow();
  if (!address) throw new PrinterError('Alamat perangkat kosong.', 'bad_device');
  const res = await p.connect({ address, transport, name });
  const device = { address, transport, name: res?.name ?? name };
  saveDevice(device);
  return device;
};

export const disconnect = async () => {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.disconnect();
  } catch {
    /* abaikan */
  }
};

/** Status sambungan saat ini (dari sisi native). */
export const connectionStatus = async () => {
  const p = getPlugin();
  if (!p) return { connected: false };
  try {
    return await p.status();
  } catch {
    return { connected: false };
  }
};

// --- Kirim data -------------------------------------------------------------
/**
 * Kirim byte ESC/POS ke printer yang tersambung.
 * @param {Uint8Array} bytes
 */
export const printBytes = async (bytes) => {
  const p = pluginOrThrow();
  if (!bytes || !bytes.length) throw new PrinterError('Tidak ada data untuk dicetak.', 'empty');
  await p.write({ data: bytesToBase64(bytes) });
  return true;
};

// --- Perangkat & pengaturan tersimpan --------------------------------------
export const getSavedDevice = () => readJSON(DEVICE_KEY);
export const saveDevice = (device) => writeJSON(DEVICE_KEY, device);
export const clearDevice = () => removeKey(DEVICE_KEY);

export const DEFAULT_SETTINGS = { width: '58', autoPrint: false };

export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...(readJSON(SETTINGS_KEY) ?? {}) });
export const saveSettings = (settings) => writeJSON(SETTINGS_KEY, { ...getSettings(), ...settings });

export default {
  PLUGIN_NAME,
  isNative,
  checkAvailability,
  requestPermissions,
  checkPermissions,
  listBonded,
  scanBle,
  stopBleScan,
  connect,
  disconnect,
  connectionStatus,
  printBytes,
  bytesToBase64,
  getSavedDevice,
  saveDevice,
  clearDevice,
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  PrinterError,
};
