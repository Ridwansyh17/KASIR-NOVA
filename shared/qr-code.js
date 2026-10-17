/**
 * KASIR NOVA — Kode QR (wrapper tipis di atas pustaka QR yang di-vendor)
 * =============================================================================
 * Dipakai panel Owner untuk menampilkan **QRIS** dari `qrString` yang
 * dikembalikan gateway pembayaran (lihat docs/38-pembayaran-langganan-gateway.md).
 *
 * Pustaka pihak ketiga (di-vendor, TIDAK diubah):
 *   shared/vendor/qrcode-generator.js
 *   "QR Code Generator for JavaScript" — Copyright (c) 2009 Kazuhiko Arase
 *   Lisensi MIT — http://www.opensource.org/licenses/mit-license.php
 *   Diambil dari: https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js
 *
 * Aturan penting:
 *  - Keluaran berupa **SVG data URL** (tanpa canvas), sehingga cukup
 *    `<img src="...">` dan tidak ada dependensi DOM/tambahan apa pun.
 *  - **Quiet zone 4 modul** (syarat EMVCo/QRIS) — `QUIET_ZONE_MODULES`.
 *  - ECC default **M**; bila isi terlalu panjang untuk versi 40 pada ECC M,
 *    otomatis turun ke **L** (aturan `qrcode-generator`: `typeNumber = 0`
 *    memilih versi terkecil yang muat).
 *  - Keamanan: `qrString` **tidak pernah** ditulis ke dalam markup SVG — hanya
 *    koordinat modul (angka) hasil hitungan pustaka. Jadi tidak ada jalur
 *    injeksi HTML/SVG dari data gateway.
 *  - Modul ini murni (tidak menyentuh DOM), jadi bisa diuji di Node:
 *    `globalThis.qrcode` diisi dari berkas vendor sebelum modul ini dimuat
 *    (lihat `scripts/test-qr-code.mjs`).
 *
 * Berkas ini adalah **sumber kanonik**; salinannya ada di
 * `apps/owner/src/qr-code.js` dan dijaga identik oleh `scripts/verify-ui.mjs`.
 * Jalankan `node scripts/sync-shared.mjs` setelah mengubah berkas ini.
 *
 * Format: UMD — di browser memasang `window.NovaQr`; di Node lewat
 * `module.exports`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NovaQr = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  /** ECC default & cadangan (turun kelas hanya bila isi terlalu panjang). */
  const DEFAULT_ECC = 'M';
  const FALLBACK_ECC = 'L';

  /** Tingkat koreksi galat yang dikenal pustaka. */
  const KNOWN_ECC = ['L', 'M', 'Q', 'H'];

  /** Syarat EMVCo/QRIS: zona sunyi minimal 4 modul di semua sisi. */
  const QUIET_ZONE_MODULES = 4;

  /** Lebar minimum 1 modul (dalam px) agar tetap tajam saat ditampilkan. */
  const MIN_MODULE_SCALE = 4;

  /** Pustaka vendor diambil dari global (urutan <script> sudah dijamin). */
  const lib = () => (typeof globalThis !== 'undefined' ? globalThis.qrcode : null);

  /** Apakah pustaka QR sudah termuat? (dipakai untuk degradasi yang rapi) */
  const isAvailable = () => typeof lib() === 'function';

  const normalize = (text) => {
    const value = String(text ?? '').trim();
    if (!value) throw new Error('Isi kode QR kosong');
    return value;
  };

  const build = (text, ecc) => {
    const create = lib();
    if (typeof create !== 'function') {
      throw new Error('Pustaka QR belum termuat (vendor/qrcode-generator.js)');
    }
    const qr = create(0, ecc); // 0 = pilih versi terkecil yang muat
    qr.addData(text);
    qr.make();
    return qr;
  };

  /**
   * Bangun matriks QR.
   * @returns {{ qr: object, ecc: string, version: number, count: number, text: string }}
   */
  const encode = (text, options = {}) => {
    const value = normalize(text);
    const wanted = options.ecc ?? DEFAULT_ECC;
    if (!KNOWN_ECC.includes(wanted)) throw new Error(`ECC tidak dikenal: ${wanted}`);

    const tooLong = (err) =>
      new Error(`Isi terlalu panjang untuk kode QR (${value.length} karakter): ${err.message}`);

    let qr;
    let ecc = wanted;
    try {
      qr = build(value, wanted);
    } catch (err) {
      if (wanted !== DEFAULT_ECC) throw tooLong(err);
      try {
        qr = build(value, FALLBACK_ECC);
        ecc = FALLBACK_ECC;
      } catch (err2) {
        throw tooLong(err2);
      }
    }

    const count = qr.getModuleCount();
    return { qr, ecc, version: (count - 17) / 4, count, text: value };
  };

  /** Markup SVG (string) untuk kode QR. */
  const toSvg = (text, options = {}) => {
    const { qr, count } = encode(text, options);
    const margin = Number.isInteger(options.margin) ? options.margin : QUIET_ZONE_MODULES;
    const scale =
      Number.isFinite(options.scale) && options.scale > 0 ? options.scale : MIN_MODULE_SCALE;
    const dark = options.dark ?? '#000000';
    const light = options.light ?? '#ffffff';
    const size = count + margin * 2;

    let path = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
      }
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size * scale}" height="${size * scale}"` +
      ` viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img">` +
      `<rect width="${size}" height="${size}" fill="${light}"/>` +
      `<path d="${path}" fill="${dark}"/></svg>`
    );
  };

  /** Data URL SVG — langsung untuk `<img src="...">`. */
  const toDataUrl = (text, options = {}) =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSvg(text, options))}`;

  return {
    isAvailable,
    encode,
    toSvg,
    toDataUrl,
    DEFAULT_ECC,
    FALLBACK_ECC,
    QUIET_ZONE_MODULES,
  };
});
