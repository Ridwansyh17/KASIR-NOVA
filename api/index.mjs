/**
 * Entry point serverless untuk Vercel.
 *
 * Vercel memanggil handler ini untuk setiap request (lihat vercel.json:
 * semua path di-rewrite ke fungsi ini). Kita cukup mengekspor aplikasi
 * Express yang SAMA dengan yang dipakai di server biasa — tanpa app.listen().
 *
 * Semua logika (routing /api/*, middleware, CORS, dsb.) ada di
 * server/src/app.js sehingga tidak ada duplikasi.
 */
import app from '../server/src/app.js';

export default app;
