# 31 — FASE 6: Verifikasi fitur 13 Oktober 2026

Status: **selesai & lulus uji** (16 Oktober 2026).
Tujuan: memastikan fitur yang dirilis 13 Okt 2026 (V0.3 / Fase 15–17) **masih
utuh** setelah perombakan desain V2 (FASE 1), Smart Product Image (FASE 2), dan
Smart Receipt Preview (FASE 3) — bukan hanya tampilannya, tetapi **kabel API dan
endpoint server**-nya.

---

## 1. Fitur yang diverifikasi

| Fitur (13 Okt 2026) | Permukaan | Sumber |
| --- | --- | --- |
| Laporan keuangan & laba (pendapatan per metode, HPP, laba kotor/bersih) | Owner → panel **Keuangan** | `App.js`/API `reports.finance`, `reports.financeXlsx` |
| Ekspor rekap transaksi, per-outlet, lintas-bisnis ke **.xlsx** | Owner → **Laporan**, **Perbandingan Outlet**, **Lintas Bisnis** | `reports.downloadXlsx`, `reports.outletsXlsx`, `reports.businessesXlsx` |
| Pengeluaran operasional (catat/void, filter kategori & rentang) | Owner & Kasir | `expenses.*` |
| Pergerakan stok (append-only) | Owner & Kasir | `inventoryMovements.list` |
| Ketersediaan & stok habis (out-of-stock) | Kasir | `setStockStatus`, `setStock` |
| Pendapatan harian outlet | Kasir → pane **Pendapatan** | `daily` |
| Perbandingan outlet & lintas bisnis | Owner | `reports.outlets`, `reports.businesses` |

## 2. Cara verifikasi

### 2.1 Guard otomatis — `scripts/verify-ui.mjs`

Ditambahkan blok **[fitur 13 Okt 2026 (FASE 6)]** yang memeriksa **55 penanda
pada 14 berkas**:

- **HTML** Owner: `finance-section`, `fin-summary`, `fin-export-xlsx`,
  `fin-refresh-btn`, `fin-method-body`, `fin-expense-body`, `fin-outlet-body`,
  `expense-section`, `exp-body`, `exp-new-btn`, `cross-section`, `cross-summary`,
  `cross-export-xlsx`, `cross-body`.
- **HTML** Kasir: pane `produk`, `pendapatan`, `pengeluaran`, `stok`.
- **app.js** ← → **api.js** (Owner & Kasir): setiap fungsi yang dipakai UI harus
  punya definisinya (mis. `api.reports.finance(` ↔ `finance:`).
- **Server**: rute `/summary`, `/outlets`, `/export`, `/finance`,
  `/finance/export` (modul report) dan `/reports/daily`, `/expenses`,
  `/inventory-movements` (modul cashier-area) harus tetap terdaftar.

Guard ini **gagal keras** bila ada perubahan (mis. saat redesign) yang
menghapus id/fungsi/endpoint tanpa sengaja — sehingga fitur 13 Okt tidak bisa
hilang diam-diam.

### 2.2 Uji backend relevan

```
cd server
node scripts/clean-test-fixtures.mjs
node --test tests/reports.test.js tests/report-xlsx.test.js \
  tests/report-comparison.test.js tests/v03-features.test.js \
  tests/products.test.js tests/transactions.test.js
```

## 3. Hasil (16 Okt 2026)

| Pemeriksaan | Hasil |
| --- | --- |
| Uji backend fitur 13 Okt (6 berkas) | **66/66 lulus** |
| Seluruh uji server (semua berkas) | **246/246 lulus** |
| `node scripts/verify-ui.mjs` | **SEMUA OK** (termasuk 55 penanda FASE 6) |

Uji kunci yang lulus, antara lain:

- `Fase 4/6: laporan keuangan harian akurat (Tunai/QRIS/HPP/laba)`
- `Fase 6: ekspor laporan keuangan ke .xlsx`
- `Fase 6: filter pengeluaran per kategori & rentang tanggal`
- `Fase 5: koreksi lewat void (bukan hapus); kasir hanya boleh void miliknya`
- `Fase 4: kasir melihat pendapatan outletnya; HPP/laba disembunyikan tanpa izin`

## 4. Catatan jujur

1. Verifikasi ini bersifat **statis + uji API**, bukan uji klik di browser.
   Pengujian browser nyata (terutama tombol unduh .xlsx di ponsel) tetap perlu
   dijalankan pemilik.
2. HPP/laba tetap **disembunyikan dari kasir** tanpa izin `canViewProfit`
   (dijaga uji backend), konsisten dengan keputusan hak akses.
3. Tidak ada perubahan perilaku bisnis pada fase ini — murni verifikasi + guard.
