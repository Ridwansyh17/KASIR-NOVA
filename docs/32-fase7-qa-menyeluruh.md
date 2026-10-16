# 32 — FASE 7: QA menyeluruh

Status: **selesai & lulus** (16 Oktober 2026).
Cakupan: auth, produk/stok, transaksi, langganan, laporan, cetak, dan UI statis.

---

## 1. Matriks pengujian & hasil

| # | Suite | Perintah | Hasil |
| --- | --- | --- | --- |
| 1 | Salinan berkas bersama | `node scripts/sync-shared.mjs --check` | **SEMUA SAMA** |
| 2 | Uji backend (semua modul) | `node scripts/clean-test-fixtures.mjs` + `node --test "tests/**/*.test.js"` | **246/246 lulus** |
| 3 | Verifikasi UI statis + smoke hosting | `node scripts/build-hosting.mjs` + `node scripts/verify-ui.mjs` | **SEMUA OK** |
| 4 | Sesi & pemulihan login | `node --test scripts/test-auth-restore.mjs` | **10/10 lulus** |
| 5 | Smart Product Image | `node --test scripts/test-product-image.mjs` | **9/9 lulus** |
| 6 | Sintaks modul kasir | `node --check app.js` (salinan `.mjs`) | **OK** |

Total: **265 pemeriksaan otomatis lulus, 0 gagal**.

## 2. Cakupan uji backend (246)

| Area | Berkas uji |
| --- | --- |
| Auth, sesi, PIN kasir, cabut sesi | `auth*.test.js`, `cashier-pin.test.js`, `session-revoke.test.js` |
| Kesehatan & keamanan header/CORS | `health*.test.js`, `cors.test.js` |
| Langganan (gate operasi) | `subscription-gate.test.js`, `outlet-subscription.test.js` |
| Produk, stok, ketersediaan | `products.test.js`, `v03-features.test.js` |
| Transaksi (atomik, idempotensi, void) | `transactions.test.js` |
| Laporan & ekspor | `reports.test.js`, `report-xlsx.test.js`, `report-comparison.test.js` |
| Audit & platform admin | `audit-log.test.js`, `platform-admin.test.js`, `owner-business.test.js` |
| **Struk & alur struk (FASE 3)** | `receipt-struk.test.js`, `printer-escpos.test.js`, `sale-flow.test.js` |

## 3. Yang DIVERIFIKASI ulang pada QA ini

- **Idempotensi transaksi**: kirim ulang `clientRef` yang sama tidak membuat
  transaksi baru (dipakai Smart Receipt Preview).
- **Atomik penjualan**: total dihitung server + stok berkurang dalam satu
  transaksi; stok tidak pernah negatif.
- **Gate langganan**: kedaluwarsa/past_due memblokir operasi baru, tetapi void
  tetap jalan; idempotensi retry tetap dikembalikan.
- **Hak akses**: kasir hanya outletnya; HPP/laba disembunyikan tanpa izin;
  akses lintas tenant ditolak.
- **Struk**: pratinjau selalu `BELUM DIBAYAR`, cetak hanya untuk transaksi final,
  cetak ulang bertanda, label ESC/POS & HTML berparitas.

## 4. Batasan (jujur)

1. Tidak ada **uji browser end-to-end** otomatis (klik/unduh/scroll ponsel) —
   `verify-ui.mjs` hanya memeriksa integritas statis + HTTP 200 hosting.
2. **Cetak thermal fisik** belum diuji di perangkat nyata.
3. `scripts/e2e-online.mjs` memerlukan backend daring; tidak dijalankan pada
   sesi lokal ini (tidak mengubah status siapa pun).
4. Uji ini tidak menyentuh data produksi (memakai DB dev `nova_kasir_dev`
   port 5433) dan tidak melakukan deployment.
