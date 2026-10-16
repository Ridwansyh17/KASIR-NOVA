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
| 7 | Smoke E2E penuh (server lokal) | `npm run e2e:local` | **31/31 lulus** |

Total: **265 pemeriksaan otomatis lulus, 0 gagal**, ditambah **31 langkah E2E**
end-to-end terhadap server lokal + DB dev (lihat §3a).

> Satu perintah untuk seluruh matriks ini: `scripts/qa-local.ps1` (npm
> `qa:local`). Tambahkan `-WithE2E` untuk sekalian menjalankan E2E 31 langkah;
> skrip menampilkan ringkasan LULUS/GAGAL per tahap.

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

## 3a. E2E end-to-end terhadap server LOKAL (31 langkah)

`scripts/e2e-online.mjs` kini juga dijalankan terhadap **server lokal + DB dev**
melalui harness baru `scripts/e2e-local.ps1` (`npm run e2e:local`). Hasil:
**31/31 lulus**. Ini menguji kontrak HTTP nyata (bukan hanya unit/integrasi
per modul):

| Kelompok | Langkah |
| --- | --- |
| Kesehatan & auth | health+DB `up`, login owner, login platform admin |
| Data demo | bisnis demo, outlet utama, langganan `active`, kategori, produk, stok awal |
| Kasir | buat kasir + set PIN, login PIN (pilih kartu), `/auth/me` → outlet benar, katalog read-only |
| Transaksi | penjualan tunai (total dihitung server) + stok berkurang, retry `clientRef` sama tidak menggandakan (`idempotent:true`), void owner mengembalikan stok |
| Laporan & ekspor | laporan penjualan, komparasi outlet, ekspor Excel |
| Keamanan & tenant | kasir ditolak lintas outlet/bisnis, audit log, soft-delete bisnis + login ditolak |
| Statis | halaman Kasir/Admin/Owner HTTP 200 |

## 4. Batasan (jujur)

1. Tidak ada **uji browser end-to-end** otomatis (klik/unduh/scroll ponsel) —
   E2E di atas memakai HTTP API nyata, bukan DOM; `verify-ui.mjs` hanya
   memeriksa integritas statis + HTTP 200 hosting.
2. **Cetak thermal fisik** belum diuji di perangkat nyata.
3. `scripts/e2e-online.mjs` terhadap **produksi** belum dijalankan (tidak ada
   persetujuan deploy); yang dijalankan adalah varian **lokal** (§3a) yang tidak
   mengubah data siapa pun di produksi.
4. Uji ini tidak menyentuh data produksi (memakai DB dev `nova_kasir_dev`
   port 5433) dan tidak melakukan deployment.
