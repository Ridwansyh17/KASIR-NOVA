# KASIR NOVA — Laporan Transaksi Siap-Cetak (Owner)

> **Status:** dikerjakan & diuji lokal **17 Okt 2026**; **belum dideploy** (menunggu
> izin pemilik). APK Kasir **tidak disentuh**.
>
> **Sumber permintaan:** contoh tata letak dari pemilik, `contoh laporan transaksi.png`
> (1224 × 1285 px). Berkas itu sudah dipindahkan ke
> `KASIR-NOVA-V3-REFERENSI-LENGKAP/_masukan-pemilik/` — folder referensi yang
> **gitignored**, sehingga tidak lagi berada di akar repo.

---

## 1. Keputusan pemilik (17 Okt 2026)

| # | Pertanyaan | Jawaban pemilik | Penerapan |
|---|---|---|---|
| A1 | Bentuk keluaran cetak | **a** — halaman cetak HTML lalu PDF lewat browser | `#print-report` + `window.print()` (`@media print`) |
| A2 | Siapa yang boleh membuat | **b** — hanya **Owner** (kasir tetap 403, kebijakan akses tidak diubah) | Rute di `/api/owner/...` + `requireBusinessAccess` |
| A3 | Rincian baris | **a** — **satu baris per ITEM** | `rows[]` dari `transaction_items` |
| A4 | Prefix nomor transaksi | **a** — tetap **`INV-`** (contoh memakai `TRX-`) | Tidak ada perubahan penomoran |
| A5 | Cakupan laporan kasir | **a** — semua transaksi outlet | Dicatat untuk kebutuhan mendatang (belum ada laporan kasir) |

Keputusan lain yang sudah berlaku: halaman cetak **tidak** dibuat untuk panel Kasir
(mobile maupun web), dan **tidak ada** perubahan pada aturan langganan, aturan
1 kasir = 1 outlet, maupun alur pembayaran/struk.

---

## 2. Cara membaca contoh (agen tidak dapat "melihat" gambar)

Teks + posisi diambil dengan OCR bawaan Windows
(`scripts/mockup-ocr.ps1`, Windows PowerShell 5.1). Hasil mentah:
`KASIR-NOVA-V3-REFERENSI-LENGKAP/hasil-ekstraksi/laporan-transaksi-owner.txt`.
Warna diambil dengan `scripts/mockup-colors.ps1` (grid 6 × 22): halaman contoh
didominasi **putih/latar sangat terang** (tidak ada bilah navy besar) sehingga
versi cetak memakai garis tipis + latar terang, bukan blok berwarna.

Hasil pembacaan tata letak (koordinat ternormalisasi 0..1):

| Bagian | Isi pada contoh | Posisi (x, y) |
|---|---|---|
| Kop kiri | logo + `KASIR NOVA` + tagline `Solusi Kasir Semua Bisnis` | 0,095 / 0,030–0,057 |
| Kop kanan | `Laporan Transaksi` + `Periode 13 Oktober 2026` | 0,767 / 0.024; 0.802 / 0.057 |
| Info | `Outlet` = Outlet Utama · `Kasir` = Rina Wati · `Tanggal Cetak` = 13 Oktober 2026 17:32 | y ≈ 0,11–0,13 |
| Kartu KPI (5) | Total Transaksi **18** (Transaksi) · Total Penjualan **Rp 482.000** · **Tunai** Rp 282.000 (58.5%) · **QRIS** Rp 200.000 (41.5%) · Rata-rata Transaksi Rp 26.778 (transaksi) | y ≈ 0,19–0,24 |
| Tabel Detail Transaksi | NO · No. Transaksi · Tanggal & Waktu · Produk · Qty · Harga Satuan · Total · Metode Pembayaran · Kasir · Outlet | y ≈ 0,32 dst |
| Blok bawah (3 kolom) | **Ringkasan Penjualan** (Total Transaksi, Total Penjualan (Omzet), Tunai, QRIS) · **Produk Terlaris** (Produk, Qty, Total) · **Catatan** | y ≈ 0,80–0,92 |
| Footer | `KASIR NOVA · Solusi Kasir Semua Bisnis` + `Dicetak … 17:32 | Halaman 1 dari 1` | y ≈ 0,96 |

Catatan: huruf kecil pada header kolom "Produk" tidak terbaca OCR (sel kosong di
x ≈ 0,326), disimpulkan dari isi kolomnya (nama produk) dan dari keputusan A3a.

---

## 3. Tata letak yang diterapkan

Halaman cetak (`#print-report`) meniru contoh:

1. **Kop** — logo `assets/logo-kasir-nova.png`, nama **KASIR NOVA**, tagline
   **"Solusi Kasir Semua Bisnis"**, judul **Laporan Transaksi**, dan `Periode …`.
2. **Info** — Outlet (nama outlet filter atau "Semua outlet"), Kasir (nama kasir
   filter atau "Semua kasir yang bertugas"), **Tanggal Cetak** (zona waktu bisnis).
3. **Kartu KPI** — Total Transaksi, Total Penjualan, **satu kartu per metode
   pembayaran** (dinamis: label + nominal + persentase), lalu Rata-rata Transaksi.
   Dengan dua metode hasilnya identik dengan contoh (Tunai, QRIS).
4. **Detail Transaksi** — baris **per item** (A3a): NO · No. Transaksi ·
   Tanggal & Waktu · Produk · Qty · Harga Satuan · Total · Metode · Kasir · Outlet.
5. **Ringkasan Penjualan** — Total Transaksi, Total Penjualan (Omzet), tiap metode
   + persentase; bila ada **void/refund** pada rentang itu, angkanya ikut ditampilkan
   (contoh tidak memuatnya; ini agar tidak ada angka tersembunyi).
6. **Produk Terlaris** — 5 produk teratas **urut Qty** + kolom Total (omzet).
7. **Catatan** — "Laporan ini dihasilkan dari sistem KASIR NOVA.", data transaksi
   per outlet, kasir yang bertugas, periode, dan ucapan terima kasih.
8. **Footer** — merek + `Dicetak <waktu>` (+ `Halaman 1 dari 1` bila laporan ≤ 28 baris).

Cetak aman untuk printer hitam-putih & hemat tinta: latar putih, garis tipis
`#e2e9f4`, judul navy `#062a66`, header tabel `#eef4fd`. `@page { size: A4 portrait;
margin: 12mm; }`, header tabel diulang di tiap halaman
(`thead { display: table-header-group }`), dan baris tidak terpotong antar halaman.

---

## 4. Penyimpangan yang disengaja dari contoh

| # | Contoh | Penerapan | Alasan |
|---|---|---|---|
| 1 | Satu baris = satu transaksi (18 baris, satu produk/transaksi) | Satu baris = satu **item**; satu transaksi berisi 2 item tampil 2 baris dengan nomor transaksi sama | Keputusan pemilik **A3a** |
| 2 | Nomor `TRX-20261013-001` | Tetap `INV-YYYYMMDD-NNNN` | Keputusan pemilik **A4a**; penomoran invoice tidak diubah |
| 3 | Persentase metode memakai titik (`58.5%`) | Ikut contoh (titik) di kartu KPI & Ringkasan | Meniru contoh apa adanya |
| 3 | Kartu metode = 2 kartu tetap (Tunai, QRIS) | Jumlah kartu **dinamis** mengikuti metode yang ada pada periode | Data bisa > 2 metode (kartu/e-wallet) |
| 4 | Hanya omzet Tunai/QRIS di Ringkasan | Ditambah baris **void/refund** bila ada | Transparansi; contoh tidak mengandung void |
| 5 | "Halaman 1 dari 1" selalu | Ditampilkan bila ≤ 28 baris; laporan panjang hanya menampilkan waktu cetak | Tidak mengarang jumlah halaman |
| 6 | — | Ada peringatan bila daftar baris **dipotong** (`limit`) | Mencegah laporan tampak lengkap padahal terpotong |
| 6b | Tabel detail bisa sangat panjang | `limit` bawaan **1000** baris (maks 5000), diurut transaksi lalu nama produk | Anti-lonjakan memori; `transaction_items` tidak menyimpan `created_at` |
| 7 | Kartu KPI berwarna (mockup layar) | Garis tipis + latar terang saat dicetak | Hemat tinta, tetap terbaca hitam-putih |

---

## 5. API

`GET /api/owner/businesses/:businessId/reports/transactions` (rincian lengkap di
`docs/16-api-laporan.md`). Ringkas:

- **Query:** `from`, `to`, `outletId`, `cashierId`, `status`, `paymentMethod`,
  `paymentStatus`, `search`, `limit` (1…5000, bawaan 1000).
- **Balasan:** `business`, `outlet`, `cashier`, `period`, `printed_at`, `summary`,
  `payment_methods[]`, `top_products[]`, `rows[]` (per item), `truncated`.
- **Aturan angka:** baris & omzet hanya transaksi `completed` (kecuali `status`
  diminta lain); `voided`/`refunded` selalu disebut di `summary`; omzet per metode
  diambil dari `t.total` (satu transaksi = satu pembayaran) sehingga persentase
  tepat 100%.
- **Keamanan:** `requireBusinessAccess` + `WHERE business_id = $1`; owner lain →
  **404**, kasir → **403**, `platform_admin` → 200 (baca saja). Filter outlet/kasir
  milik bisnis lain hanya menghasilkan **kosong** (tidak bocor).

---

## 6. Berkas yang dibuat / diubah

**Dibuat**

- `server/tests/report-transactions.test.js` — 5 kasus uji integrasi.
- `docs/35-laporan-transaksi-cetak.md` (dokumen ini).

**Diubah**

- `server/src/modules/report/schema.js` — `transactionReportQuerySchema`.
- `server/src/modules/report/service.js` — `transactionReport()`.
- `server/src/modules/report/controller.js` — `transactionReport`.
- `server/src/modules/report/routes.js` — rute `GET /transactions`.
- `apps/owner/src/api.js` — `reports.transactions(businessId, params)`.
- `apps/owner/index.html` — tombol `#rep-print-btn` + wadah `#print-report`.
- `apps/owner/src/app.js` — `renderPrintReport`, `printTransactionReport`, formatter tanggal Indonesia.
- `apps/owner/styles/styles.css` — blok `@media print` (ter-scope ke `#print-report`).
- `scripts/verify-ui.mjs` — bagian pengunci **"laporan transaksi cetak (17 Okt 2026)"**.
- `scripts/qa-local.ps1` — label jumlah tes backend (248 → **253**, **265** setelah tes struk PDF, lalu **266** setelah tes omzet/kembalian).
- `docs/16-api-laporan.md`, `docs/05-roadmap.md` — endpoint + catatan progres.

Tidak ada migrasi baru: laporan hanya membaca skema Fase 7
(`transactions`, `transaction_items`, `payments`).

---

## 6b. Halaman cetak tidak mengganggu layar

- `#print-report` **selalu** `display: none` di layar; hanya `@media print` yang
  menampilkannya, dan pada mode cetak semua elemen lain (`body > *:not(#print-report)`)
  disembunyikan — mengikuti pola `#print-struk` pada aplikasi Kasir.
- Kontrak UI dikunci `scripts/verify-ui.mjs` agar tombol, wadah, fungsi render,
  endpoint, dan aturan cetak tidak hilang saat desain berikutnya.

---

## 7. Pengujian (lokal, 17 Okt 2026)

| Perintah | Hasil |
|---|---|
| `node --test tests/report-transactions.test.js` | **6/6 lulus** (termasuk tes omzet/kembalian) |
| `node --test "tests/**/*.test.js"` (server) | **253/253 lulus** (sebelum tes struk PDF; kini **266/266**) |
| `node scripts/verify-ui.mjs` | **SEMUA OK** (termasuk bagian baru + **sintaks semua berkas JS panel**) |

> **Regresi 17 Okt 2026 (dilaporkan pemilik):** blok duplikat di
> `apps/owner/src/app.js` membuat **panel Owner blank putih** setelah deploy
> (galat sintaks → modul gagal dimuat). Sudah diperbaiki & hosting dideploy ulang;
> `verify-ui` kini menjalankan `node --check` atas seluruh berkas `apps/*/src/*.js`
> agar galat sintaks tertangkap sebelum deploy. Bukti: `docs/24` bagian
> "Insiden 17 Okt 2026".

Kasus uji `report-transactions.test.js`:

1. Satu baris per item (satu penjualan 2 item → 2 baris), ringkasan (jumlah, total,
   rata-rata), void dipisah, rekap metode + persentase (53,3% / 26,7% / 20% = 100%),
   produk terlaris urut qty + omzet, format `INV-…`.
2. Filter outlet & kasir; **outlet milik bisnis lain → 0 baris** (tidak bocor).
3. `status=voided` dan pencarian nomor transaksi/pembayaran.
4. **Laporan keuangan:** penjualan tunai total 40.000 dibayar 100.000 (kembalian
   60.000) → `income.cash = 40.000` (bukan 100.000), `income.total = 75.000`
   (bukan 135.000), rekap **per outlet** sama; `SUM(payments.amount)` tetap
   135.000 sebagai pembanding (uang diterima ≠ omzet). Lihat §9.
5. `limit` + `truncated`; validasi `limit` (0 / 99999 / bukan angka), `status`,
   rentang terbalik, `outletId` bukan UUID → **422**.
6. Isolasi tenant & peran: owner lain → **404**, kasir → **403**, admin platform → **200**.

Uji pada peramban (dialog cetak, PDF, tata letak A4) **belum** dijalankan —
memerlukan perangkat/manusia; dicatat sebagai pekerjaan pemilik.

---

## 8. Belum dikerjakan

- **Uji cetak nyata** (Chrome/Edge → "Simpan sebagai PDF") dan penyesuaian margin
  bila diperlukan.
- **Varian Excel** dari laporan yang sama (opsional).
- **Laporan untuk Kasir** (keputusan A5a dicatat, belum diminta).
- **Nomor halaman multi-halaman** (butuh perhitungan paginasi; saat ini hanya untuk
  laporan ≤ 28 baris).

---

## 9. Temuan omzet tunai — SUDAH DIPERBAIKI (17 Okt 2026, izin pemilik)

`payments.amount` menyimpan **uang diterima**, bukan bagian dari total. Untuk
pembayaran **tunai** nilainya termasuk **kembalian** (contoh: total 40.000 dibayar
100.000 → `payments.amount = 100.000`). Bukti pada DB dev: satu bisnis demo mencatat
`SUM(payments.amount)` tunai **38.000.000** sedangkan omzet `transactions` hanya
**31.080.000**.

Akibatnya `incomeByMethod()` (dipakai **laporan keuangan/laba** `docs/16` bagian
V0.3) **melebihkan** pendapatan tunai sebesar total kembalian — dan karena
`income.total` dijumlahkan dari situ, **laba kotor & laba bersih** juga ikut
membesar.

**Perbaikan (17 Okt 2026, disetujui pemilik):**

- `incomeByMethod()` dan rekap **per outlet** pada `financeSummary()` kini
  memakai **`SUM(t.total)`**, sama seperti laporan transaksi; `payments` hanya
  dipakai untuk `fee_amount` & status `paid`.
- Dampak: `income.cash/total`, `payment_methods[].total`, `outlets[].income`,
  `gross_profit`, dan `net_profit` pada laporan keuangan **turun** ke angka omzet
  riil (sebelumnya melebihkan sebesar kembalian tunai). Dashboard Owner, laporan
  harian kasir, dan ekspor XLSX ikut memakai angka yang sama (satu fungsi).
- Pengujian: `server/tests/report-transactions.test.js` — kasus penjualan tunai
  total 40.000 dibayar 100.000 membuktikan `income.cash = 40.000` (bukan
  100.000), `income.total = 75.000` (bukan 135.000), dan `outlets[].income` sama.
- Asumsi yang tetap berlaku: **satu transaksi = satu pembayaran** (split payment
  belum ada), sehingga `SUM(t.total)` per metode tidak menghitung ganda.
