/**
 * Bootstrap variabel lingkungan untuk tes alur pembayaran.
 *
 * WAJIB diimpor PALING AWAL pada berkas tes (sebelum `helpers/request.js`),
 * karena `src/config/env.js` membaca `process.env` saat pertama kali dimuat.
 * dotenv TIDAK menimpa nilai yang sudah ada, sehingga nilai di sini menang atas
 * `server/.env` — tes jadi deterministik walau mesin pengembang sudah mengisi
 * kredensial Duitku sungguhan.
 *
 * Nilai yang dipaksa:
 *   - PAYMENT_PROVIDER=disabled     -> penyedia diuji lewat injeksi kode
 *                                      (`setProviderForTests`), bukan env.
 *   - PAYMENT_MODE=sandbox          -> tidak menyentuh endpoint produksi.
 *   - PAYMENT_API_BASE_URL=localhost-> dasar penyusunan callbackUrl/returnUrl.
 *   - Daftar IP callback dikosongkan-> semua callback lolos filter IP (yang diuji
 *                                      adalah verifikasi tanda tangan HMAC).
 *   - PAYMENT_CHANNELS / PAYMENT_MIN_AMOUNT_IDR / PAYMENT_EXPIRY_MINUTES
 *     dipaksa ke NILAI DEFAULT. Tanpa ini, `server/.env` milik pengembang
 *     (mis. menambah `NQ` untuk uji QRIS, atau menaikkan minimum) bocor ke tes
 *     dan membuat asersi "nilai default" gagal padahal kode tidak salah.
 *     (Ditemukan 17 Okt 2026: tes kanal gagal karena `.env` memuat `NQ`.)
 */
process.env.PAYMENT_PROVIDER = 'disabled';
process.env.PAYMENT_MODE = 'sandbox';
process.env.PAYMENT_ALLOW_PRODUCTION = 'false';
process.env.PAYMENT_API_BASE_URL = 'http://127.0.0.1:4000';
process.env.PAYMENT_CALLBACK_IP_ALLOWLIST = '';
process.env.PAYMENT_CALLBACK_URL = '';
process.env.PAYMENT_RETURN_URL = '';
process.env.PAYMENT_OWNER_PANEL_URL = '';
process.env.PAYMENT_CHANNELS = 'BC,I1,M2,BR';
process.env.PAYMENT_MIN_AMOUNT_IDR = '10000';
process.env.PAYMENT_EXPIRY_MINUTES = '1440';

export default { forced: true };
