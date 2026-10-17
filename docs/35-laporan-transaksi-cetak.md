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

**Tambahan (17 Okt 2026, sesudah halaman cetak selesai):** pemilik memilih
**Ekspor Excel untuk Laporan Transaksi** dari daftar pekerjaan lanjutan —
diterapkan pada **§5b** (tombol *Ekspor Laporan Transaksi (.xlsx)*).

**Tambahan berikutnya (17 Okt 2026):** pemilik memilih **nomor halaman pada
cetak laporan** — diterapkan pada **§5c** ("Halaman i dari N" per halaman).

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

## 5b. Ekspor Excel (17 Okt 2026 — permintaan pemilik)

Halaman Laporan Transaksi punya tombol **"Ekspor Laporan Transaksi (.xlsx)"**
(`#rep-transactions-xlsx`) di samping tombol Cetak. Berkasnya dihasilkan dari
**endpoint & filter yang sama** dengan halaman cetak (nomor, urutan baris, dan
angka identik), hanya disajikan sebagai Excel:

| Sheet | Isi |
|---|---|
| `Ringkasan` | Informasi laporan + filter terpakai, ringkasan (jumlah transaksi, omzet, rata-rata, void/refund), rekap metode, **PERINGATAN** bila baris terpotong |
| `Detail Transaksi` | **Satu baris per item** (keputusan A3a) + baris **TOTAL** (qty & subtotal) |
| `Rekap Metode Pembayaran` | Metode, jumlah transaksi, omzet, **persentase** (format persen) |
| `Produk Terlaris` | 5 produk teratas urut qty + omzet (seri qty diurutkan omzet menurun) |

Keputusan teknis:

- `limit` ekspor **5000** (maksimum 20000) — lebih lengkap daripada halaman
  (1000). Bila data masih terpotong, berkas **memberi peringatan sendiri**
  (`Ringkasan`) supaya tidak disangka lengkap; halaman tetap utuh.
- Nominal dikonversi ke **rupiah** (sen ÷ 100) dan diberi format mata uang agar
  bisa langsung di-*SUM* di Excel; teks diamankan dari *formula injection*.
- Berkas dibuat dengan **ExcelJS** (sudah dipakai Fase 15 untuk rekapan & Fase 16
  untuk perbandingan) — tanpa dependensi baru.
- Tidak ada migrasi: hanya membaca `transactions`, `transaction_items`,
  `payments` seperti halaman cetak.

---

## 5c. Paginasi & nomor halaman (17 Okt 2026 — permintaan pemilik)

Pemilik meminta **nomor halaman** (mis. "Halaman 1 dari 3") pada cetak laporan
yang lebih dari satu halaman A4.

**Masalah:** peramban memenggal halaman sendiri, dan CSS paged media **tidak
menyediakan nomor halaman** untuk dipakai di dalam aliran dokumen
(`@page { @bottom-center { content: counter(page) } }` tidak didukung Chrome —
hanya bekerja pada mesin cetak seperti PrinceXML/WeasyPrint). Karena itu nomor
halaman **tidak mungkin** benar tanpa memenggal halaman secara eksplisit.

**Penyelesaian:** laporan disusun menjadi **beberapa halaman eksplisit**
(`div.pr-page`, dipisah `break-before: page`) sehingga setiap halaman menulis
footer-nya sendiri: **"Dicetak &lt;tanggal&gt; | Halaman i dari N"**. Halaman 2
dan seterusnya memakai **kop ringkas** + judul "Detail Transaksi (lanjutan)" dan
**header tabel diulang** (setiap halaman punya `<table>` sendiri dengan `thead`).

**Kapasitas baris per halaman diukur, bukan dikira-kira.** Alat ukurnya
`scripts/print-report-check.mjs`: menyusun laporan sintetis (memuat nama produk
panjang), mencetaknya ke PDF dengan **Chrome headless** (`--print-to-pdf`, A4),
lalu membandingkan **jumlah halaman PDF** dengan **jumlah halaman rencana**.
Bila sebuah halaman rencana meluber, halaman PDF bertambah sehingga ketahuan.

| Batas ukur (data uji nama panjang) | Baris |
|---|---|
| Halaman 1 (kop + info + kartu KPI) | ≈ 24 baris |
| Halaman lanjutan (kop ringkas) | ≈ 29 baris |
| Blok bawah (Ringkasan + Produk Terlaris + Catatan) | ≈ 5 baris |

Nilai yang dipakai (`PRINT_LAYOUT` di `apps/owner/src/report-print.js`)
**sengaja lebih kecil** sebagai margin aman (nama produk pada data nyata bisa
lebih panjang sehingga baris terlipat dan bertambah tinggi):
**halaman 1 = 21 baris**, **halaman lanjutan = 26 baris**, **blok bawah = 5 baris**.

Konsekuensi yang diterima pemilik (dan dicatat jujur di sini):

- Laporan **kecil (≤ 16 baris)** tetap **satu halaman** bersama blok bawah.
- Laporan yang lebih besar bisa memakai **halaman terakhir khusus blok bawah**
  (17 baris = 17 + 5 > 21) — lebih baik daripada ringkasan terpotong; sebelumnya
  (tanpa paginasi) laporan ≥ 29 baris terpotong tanpa nomor halaman.
- Halaman yang belum penuh itu **wajar**; yang tidak boleh adalah isi terpotong.

Pembuktian akhir (17 Okt 2026, Chrome 140):

```powershell
node scripts/print-report-check.mjs --counts=0,1,16,17,20,21,46,47,68,120,400
# SEMUA OK: jumlah halaman PDF = jumlah halaman yang direncanakan
```

---

## 6. Berkas yang dibuat / diubah

**Dibuat**

- `server/tests/report-transactions.test.js` — **8 kasus** uji integrasi (6 inti +
  2 ekspor Excel).
- `docs/35-laporan-transaksi-cetak.md` (dokumen ini).

**Diubah**

- `server/src/modules/report/schema.js` — `transactionReportQuerySchema` +
  `transactionReportExportQuerySchema` (ekspor, `limit` 5000/20000).
- `server/src/modules/report/service.js` — `transactionReport()` +
  `exportTransactionReportXlsx()`.
- `server/src/modules/report/controller.js` — `transactionReport` +
  `transactionReportExport`.
- `server/src/modules/report/routes.js` — rute `GET /transactions` +
  `GET /transactions/export`.
- `server/src/modules/report/xlsx.js` — `buildTransactionReportWorkbook()`
  (4 sheet; memakai helper & gaya yang sama dengan ekspor Fase 15/16).
- `apps/owner/src/api.js` — `reports.transactions(businessId, params)` +
  `reports.transactionsXlsx(businessId, params)`.
- `apps/owner/index.html` — tombol `#rep-print-btn`, `#rep-transactions-xlsx`,
  wadah `#print-report`.
- `apps/owner/src/app.js` — `printTransactionReport`,
  `downloadTransactionReportExcel`, formatter tanggal Indonesia; penyusun HTML
  laporan dipindah ke modul `report-print.js` (§5c).
- `apps/owner/src/report-print.js` (**baru**) — modul **murni** (tanpa DOM):
  `planPrintPages()` (pembagian baris per halaman), `renderPrintReport()`
  (HTML + footer nomor halaman), `PRINT_STATUS_LABELS`.
- `apps/owner/styles/styles.css` — blok `@media print` (ter-scope ke `#print-report`),
  pemisah `#print-report .pr-page + .pr-page { break-before: page }`, kop ringkas `.pr-cont`.
- `scripts/print-report-check.mjs` (**baru**) — pengukur/pembukti tata letak cetak
  (Chrome headless `--print-to-pdf`, A4; bandingkan halaman rencana vs halaman PDF).
- `server/tests/report-print-pages.test.js` (**baru**) — 10 kasus paginasi & nomor halaman.
- `scripts/verify-ui.mjs` — pengunci **"laporan transaksi cetak (17 Okt 2026)"**,
  **"nomor halaman cetak laporan (17 Okt 2026)"**, **"ekspor Excel laporan transaksi (17 Okt 2026)"**,
  dan penjaga regresi `STATUS_LABELS` tanpa definisi.
- `scripts/qa-local.ps1` — label jumlah tes backend (248 → **253**, **265** setelah tes struk PDF, **266** setelah tes omzet/kembalian, **268** setelah tes ekspor Excel, **278** setelah tes paginasi cetak).
- `docs/16-api-laporan.md`, `docs/05-roadmap.md`, `README.md` — endpoint + catatan progres.

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
| `node --test tests/report-transactions.test.js` | **8/8 lulus** (termasuk omzet/kembalian + 2 tes ekspor Excel) |
| `node --test tests/report-print-pages.test.js` | **10/10 lulus** (paginasi + nomor halaman, lihat §5c) |
| `node --test "tests/**/*.test.js"` (server) | **253/253 lulus** (sebelum tes struk PDF; kini **278/278**) |
| `node scripts/verify-ui.mjs` | **SEMUA OK** (termasuk bagian baru + **sintaks semua berkas JS panel**) |
| `node scripts/print-report-check.mjs` | **SEMUA OK** — jumlah halaman PDF = jumlah halaman rencana untuk 0…400 baris (Chrome headless) |

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
7. **Ekspor Excel** (`/transactions/export`): 4 sheet bernama benar, baris per item
   (+ baris TOTAL), nominal rupiah, persentase format persen, urutan produk
   terlaris (qty lalu omzet) — berkas di-*parse balik* dengan ExcelJS.
8. **Ekspor Excel**: filter status void & outlet bisnis lain, `limit=2` memunculkan
   baris **PERINGATAN "TERPOTONG"**, batas `limit` (0 / 20001 / bukan angka → 422),
   isolasi peran (owner lain 404, kasir 403, admin 200 dengan angka identik).

Kasus uji `report-print-pages.test.js` (§5c, modul murni dimuat lewat `data:` URL):

9. Pembagian halaman: kapasitas halaman 1 (21) < lanjutan (26); blok bawah menempel
   bila masih ada ruang (16 baris → 1 halaman; 17 baris → blok bawah pindah halaman);
   nomor baris menerus & `startIndex` benar; laporan kosong tetap 1 halaman;
   kapasitas 0 tidak membuat perulangan tanpa akhir.
10. Hasil render: 400 baris → **16 halaman** dan **setiap** halaman memuat
    "Halaman i dari 16"; kolom NO menerus 1…400; kop ringkas + judul "(lanjutan)"
    hanya di halaman 2+; blok bawah hanya di halaman terakhir; teks berbahaya
    di-escape; peringatan "dipotong" hanya di halaman 1; status void → "Dibatalkan"
    (regresi `STATUS_LABELS`).

Uji pada peramban (dialog cetak, PDF, tata letak A4) **belum** dijalankan oleh agen —
dialog cetak memerlukan manusia; dicatat sebagai pekerjaan pemilik. Sebagai gantinya
**tata letak A4 diukur otomatis**: `scripts/print-report-check.mjs` mencetak laporan
sintetis ke PDF lewat **Chrome headless** (A4, `--print-to-pdf`) dan memastikan
jumlah halaman PDF = jumlah halaman rencana untuk 0…400 baris (tanpa halaman meluber
atau kosong). Berkas Excel diverifikasi **otomatis** (dibuka ulang dengan ExcelJS),
tetapi pembukaan di **Microsoft Excel/Google Sheets** tetap menunggu pemilik.

---

## 8. Belum dikerjakan

- **Uji cetak nyata** (Chrome/Edge → "Simpan sebagai PDF") dan penyesuaian margin
  bila diperlukan.
- **Uji buka berkas Excel** di aplikasi Excel/Google Sheets milik pemilik
  (isi & format sudah diverifikasi otomatis lewat ExcelJS).
- **Laporan untuk Kasir** (keputusan A5a dicatat, belum diminta).

> **Selesai 17 Okt 2026 (permintaan pemilik):** **Varian Excel** dari laporan ini
> sudah tersedia — tombol *Ekspor Laporan Transaksi (.xlsx)* di panel Owner
> (lihat §5b).
>
> **Selesai 17 Okt 2026 (permintaan pemilik):** **nomor halaman** pada laporan
> multi-halaman — "Halaman i dari N" di footer **setiap** halaman, dengan
> paginasi eksplisit + kapasitas baris **terukur** (lihat §5c). Pekerjaan ini
> menggantikan catatan lama "hanya untuk laporan ≤ 28 baris": laporan sekarang
> dipenggal sesuai kapasitas nyata dan bisa jauh melewati 28 baris.

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
