/**
 * Konfigurasi runtime Panel Owner — BUKAN rahasia (ikut ter-deploy).
 *
 * `NOVA_API_BASE` = alamat backend API.
 *   - Kosong ('')  => origin yang sama. Dipakai saat DEV: Express menyajikan
 *     berkas statis DAN `/api` dari host yang sama (mis. http://localhost:4000/owner).
 *   - PRODUKSI (Firebase Hosting) => isi URL backend HTTPS, mis.:
 *       window.NOVA_API_BASE = 'https://api.nova.example';
 *     Jangan lupa menambahkan origin site ini ke `CORS_ORIGIN` di server.
 *
 * Lihat docs/20-deploy-firebase-hosting.md.
 */
window.NOVA_API_BASE = window.NOVA_API_BASE ?? '';
