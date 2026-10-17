/**
 * KASIR NOVA — PENGIRIM STRUK PDF (simpan / kirim / cetak).
 *
 * Menjembatani dua lingkungan:
 *   1. **Peramban** (panel Kasir versi web/PWA): simpan = unduh berkas,
 *      kirim = Web Share API (Android Chrome/desktop yang mendukung kirim
 *      berkas), cetak = dialog cetak halaman (ditangani `app.js`).
 *   2. **APK Android (Capacitor)**: plugin kustom `NovaReceipt`
 *      (`share` / `save` / `print`) — karena WebView Android tidak mendukung
 *      unduhan berkas, `navigator.share`, maupun `window.print`.
 *
 * Modul ini sengaja MURNI terhadap impor relatif (tanpa impor berkas lain)
 * supaya bisa diuji di Node lewat data: URL, mengikuti pola `printer.js`.
 * `base64` dikirim pemanggil (dari `receipt-pdf.js`) sehingga tidak ada
 * penyalinan encoder di sini.
 */

export const NATIVE_PLUGIN = 'NovaReceipt';

const root = () => (typeof globalThis !== 'undefined' ? globalThis : {});

/** True bila berjalan di dalam aplikasi native Capacitor (Android). */
export const isNative = () => {
  const c = root().Capacitor;
  return Boolean(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
};

/** Objek plugin `NovaReceipt`, atau null bila tidak tersedia. */
export const nativeReceipt = () => {
  const c = root().Capacitor;
  if (!c || typeof c.isNativePlatform !== 'function' || !c.isNativePlatform()) return null;
  try {
    if (typeof c.registerPlugin === 'function') return c.registerPlugin(NATIVE_PLUGIN);
  } catch {
    /* lanjut ke fallback */
  }
  return c.Plugins?.[NATIVE_PLUGIN] ?? null;
};

/** Apakah perangkat ini punya jalur native untuk struk PDF? */
export const canUseNative = () => Boolean(nativeReceipt());

/** Berkas PDF (untuk Web Share). Null bila `File` tidak tersedia. */
export const pdfFile = (bytes, filename) => {
  const FileCtor = root().File;
  if (typeof FileCtor !== 'function') return null;
  return new FileCtor([bytes], filename, { type: 'application/pdf' });
};

/** MIME berkas Excel (.xlsx) — dipakai ekspor laporan transaksi kasir. */
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Berkas apa pun (Web Share). Null bila `File` tidak tersedia. */
export const fileOf = (bytes, filename, mime) => {
  const FileCtor = root().File;
  if (typeof FileCtor !== 'function') return null;
  return new FileCtor([bytes], filename, { type: mime });
};

/** True bila peramban mampu mengirim BERKAS PDF lewat `navigator.share`. */
export const canSharePdf = (bytes, filename) => {
  const nav = root().navigator;
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  const file = pdfFile(bytes, filename);
  if (!file) return false;
  try {
    return Boolean(nav.canShare({ files: [file] }));
  } catch {
    return false;
  }
};

/**
 * Simpan berkas APA PUN lewat unduhan peramban (jalur web).
 * @param {{bytes: Uint8Array, filename: string, mime: string}} args
 */
export const downloadFile = ({ bytes, filename, mime }) => {
  const doc = root().document;
  const urlApi = root().URL;
  const BlobCtor = root().Blob;
  if (!doc || !urlApi?.createObjectURL || typeof BlobCtor !== 'function') {
    return { ok: false, reason: 'no_download' };
  }
  // PENTING: memanggil konstruktor langsung dari `root()` TIDAK sah (JS
  // memparsingnya sebagai konstruksi `root()` itu sendiri), jadi konstruktor
  // diambil ke variabel lokal — sama seperti `pdfFile()`.
  const blob = new BlobCtor([bytes], { type: mime });
  const url = urlApi.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  // Beri waktu peramban membaca blob sebelum dilepas.
  const revoke = () => urlApi.revokeObjectURL(url);
  if (typeof root().setTimeout === 'function') root().setTimeout(revoke, 10000);
  return { ok: true, via: 'download' };
};

/** Simpan lewat unduhan peramban (jalur web) — PDF struk. */
export const downloadPdf = ({ bytes, filename }) =>
  downloadFile({ bytes, filename, mime: 'application/pdf' });

/**
 * SIMPAN berkas apa pun (.xlsx dsb.): plugin native `save` di APK, unduhan di
 * peramban. Menerima `base64` (dari bytes) karena plugin native memerlukannya.
 * @returns {Promise<{ok: boolean, via?: string, reason?: string}>}
 */
export const saveFile = async ({ bytes, base64, filename, mime }) => {
  const plugin = nativeReceipt();
  if (plugin) {
    if (typeof plugin.save === 'function') {
      await plugin.save({ filename, base64, mime });
      return { ok: true, via: 'native-save' };
    }
    if (typeof plugin.share === 'function') {
      // Plugin lama tanpa `save`: pakai lembar berbagi (ada "Simpan ke File").
      await plugin.share({ filename, base64, mime });
      return { ok: true, via: 'native-share' };
    }
    return { ok: false, reason: 'native_unavailable' };
  }
  return downloadFile({ bytes, filename, mime });
};

/** KIRIM berkas apa pun ke aplikasi lain (APK lewat plugin, web lewat Web Share). */
export const shareFile = async ({ bytes, base64, filename, mime, title = '', text = '' }) => {
  const plugin = nativeReceipt();
  if (plugin) {
    if (typeof plugin.share !== 'function') return { ok: false, reason: 'native_unavailable' };
    await plugin.share({ filename, base64, mime, title, text });
    return { ok: true, via: 'native-share' };
  }

  const nav = root().navigator;
  if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    const file = fileOf(bytes, filename, mime);
    if (file) {
      try {
        if (!nav.canShare({ files: [file] })) return { ok: false, reason: 'share_unsupported' };
        await nav.share({ files: [file], title, text });
        return { ok: true, via: 'share' };
      } catch (err) {
        if (err?.name === 'AbortError') return { ok: true, via: 'share-cancelled' };
        return { ok: false, reason: 'share_failed' };
      }
    }
  }
  return { ok: false, reason: 'share_unsupported' };
};

/** Simpan berkas Excel (.xlsx) hasil ekspor laporan. */
export const saveXlsx = ({ bytes, base64, filename }) =>
  saveFile({ bytes, base64, filename, mime: XLSX_MIME });

/**
 * SIMPAN struk PDF.
 * @returns {Promise<{ok: boolean, via?: string, reason?: string}>}
 */
export const savePdf = async ({ bytes, base64, filename }) => {
  const plugin = nativeReceipt();
  if (plugin) {
    if (typeof plugin.save === 'function') {
      await plugin.save({ filename, base64, mime: 'application/pdf' });
      return { ok: true, via: 'native-save' };
    }
    if (typeof plugin.share === 'function') {
      // Plugin lama tanpa `save`: pakai lembar berbagi (ada "Simpan ke File").
      await plugin.share({ filename, base64, mime: 'application/pdf' });
      return { ok: true, via: 'native-share' };
    }
    return { ok: false, reason: 'native_unavailable' };
  }
  return downloadPdf({ bytes, filename });
};

/**
 * KIRIM struk PDF ke aplikasi lain (WhatsApp, e-mail, dsb.).
 * @returns {Promise<{ok: boolean, via?: string, reason?: string}>}
 */
export const sharePdf = async ({ bytes, base64, filename, title = '', text = '' }) => {
  const plugin = nativeReceipt();
  if (plugin) {
    if (typeof plugin.share !== 'function') return { ok: false, reason: 'native_unavailable' };
    await plugin.share({ filename, base64, mime: 'application/pdf', title, text });
    return { ok: true, via: 'native-share' };
  }

  const nav = root().navigator;
  if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    const file = pdfFile(bytes, filename);
    if (file) {
      try {
        if (!nav.canShare({ files: [file] })) return { ok: false, reason: 'share_unsupported' };
        await nav.share({ files: [file], title, text });
        return { ok: true, via: 'share' };
      } catch (err) {
        // Pengguna membatalkan lembar berbagi bukan kegagalan.
        if (err?.name === 'AbortError') return { ok: true, via: 'share-cancelled' };
        return { ok: false, reason: 'share_failed' };
      }
    }
  }
  return { ok: false, reason: 'share_unsupported' };
};

/**
 * CETAK struk PDF. Hanya jalur native yang bisa mencetak BERKAS PDF;
 * di peramban `app.js` memakai dialog cetak halaman (struk HTML).
 * @returns {Promise<{ok: boolean, via?: string, reason?: string}>}
 */
export const printPdf = async ({ base64, filename, jobName = '' }) => {
  const plugin = nativeReceipt();
  if (!plugin) return { ok: false, reason: 'not_native' };
  if (typeof plugin.print !== 'function') return { ok: false, reason: 'native_unavailable' };
  await plugin.print({ filename, base64, mime: 'application/pdf', jobName: jobName || filename });
  return { ok: true, via: 'native-print' };
};

export default {
  NATIVE_PLUGIN,
  XLSX_MIME,
  isNative,
  nativeReceipt,
  canUseNative,
  pdfFile,
  fileOf,
  canSharePdf,
  downloadPdf,
  downloadFile,
  savePdf,
  saveFile,
  saveXlsx,
  sharePdf,
  shareFile,
  printPdf,
};
