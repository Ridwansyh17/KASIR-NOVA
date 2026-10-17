# 34 - Desain Kasir Mobile V2 (ekstraksi dari referensi V3)

> **Status:** tata letak HP **diterapkan** pada 16 Okt 2026; menunggu **tinjauan
> visual pemilik pada APK**. Agen **tidak dapat melihat gambar**, jadi seluruh
> spesifikasi di bawah diambil dengan **pengukuran programatik** (OCR + peta
> warna) atas berkas PNG milik pemilik. Angka grafis/contoh produk di mockup
> adalah ilustrasi.
>
> **Sumber:** `KASIR-NOVA-V3-REFERENSI-LENGKAP/05-KASIR-MOBILE/` (16 berkas PNG
> 510x1040 px) + `00-BRAND-APPROVED/` + `README-OPENCODE.md` +
> `DAFTAR-HALAMAN.md`.

---

## 1. Aturan yang dipatuhi (dari `README-OPENCODE.md`)

1. Gambar referensi = **panduan tata letak & status**, bukan tangkapan layar
   aplikasi asli dan bukan aset frontend siap pakai.
2. Logo memakai **berkas brand yang sudah disetujui** (`docs/29`), tidak
   menggambar ulang dari ingatan.
3. Angka, grafik, nama produk, dan status di dalam mockup adalah **ilustrasi**;
   sumber kebenaran tetap **backend + konfigurasi outlet**.
4. Alur: baca gambar → audit kode → tulis spesifikasi → terapkan → tangkapan
   layar → QA → **minta persetujuan sebelum deploy**.
5. Karena agen tidak dapat melihat gambar, pembacaan dilakukan secara
   programatik (OCR + warna) dan hasilnya didokumentasikan di berkas ini.

### Cara ekstraksi (dapat diulang)

| Berkas | Peran |
|---|---|
| `scripts/mockup-ocr.ps1` | OCR (Windows.Media.Ocr, Windows PowerShell 5.1) → teks + kotak batas ternormalisasi |
| `scripts/mockup-bands.ps1` | warna rata-rata per pita horizontal (mencari bilah atas/bawah) |
| `scripts/mockup-region.ps1` | palet warna sebuah wilayah (mencari warna elemen) |

Contoh:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mockup-ocr.ps1 `
  -Root 'KASIR-NOVA-V3-REFERENSI-LENGKAP' -Out 'mockup-ocr.txt'
```

Hasil OCR mentah disimpan di luar git
(`KASIR-NOVA-V3-REFERENSI-LENGKAP/hasil-ekstraksi/mockup-ocr.txt`) karena
foldernya sudah diabaikan git.

> Catatan batas alat: paket bahasa OCR hanya en-GB/en-US (tidak ada bahasa
> Indonesia), sehingga kata Indonesia kadang terpecah ("Pro duk",
> "Transa ks i"). Emoji/ikon tidak terbaca sama sekali; bentuk ikon tidak dapat
> dipastikan dan pada penerapan dipakai ikon garis sederhana (SVG inline).

---

## 2. Temuan terukur

### 2.1 Kerangka layar (16 halaman, 510×1040 px)

Semua halaman `05-KASIR-MOBILE` memakai kerangka yang sama:

| Bagian | Posisi terukur | Isi terukur |
|---|---|---|
| Bilah atas | y ≈ 0,02–0,08 | logo di kiri (x ≈ 0,05–0,17), "KASIR NOVA" (y ≈ 0,032, x ≈ 0,184) + subjudul "Kasir • Outlet Utama" (y ≈ 0,059, x ≈ 0,182) |
| Judul halaman | y ≈ 0,115 | mis. "Katalog Produk Mobile", "Keranjang Mobile" |
| Subjudul halaman | y ≈ 0,147 | "Referensi tampilan Android" (anotasi mockup) |
| Badan halaman | y ≈ 0,20–0,88 | kartu, daftar, formulir |
| Anotasi mockup | y ≈ 0,907 | "KONSEP UI • DATA ILUSTRASI • LOGO V2 SESUAI PANDUAN BRAND" (watermark) |
| Bilah navigasi bawah | y ≈ 0,93–1,00 | 5 butir: **Beranda, Produk, Transaksi, Laporan, Lainnya** (y = 0,946) |

### 2.2 Warna

Diukur dengan `mockup-bands.ps1` dan `mockup-region.ps1`:

| Elemen | Warna terukur | Keterangan |
|---|---|---|
| Bilah atas | `#FFFFFF` 57,9 % + logo biru (`#002060`/`#004080`/`#2060E0`/`#0080FF`) | **bilah atas versi HP berwarna PUTIH** dengan logo varian latar terang |
| Bilah navigasi bawah | `#FFFFFF` 92 % + aksen `#2060E0` (butir aktif) + abu `#E0E0FF` | butir aktif biru, sisanya abu |
| Latar konten | `#F3F7FD` (rata-rata pita y 0,65–0,88) | kartu putih di atas latar biru sangat muda |
| Tombol utama | `#2060E0` 28,7 % pada kotak tombol | tombol penuh lebar, teks putih |
| Kartu statistik | putih (`#FFFFFF` 92,4 %) | kartu dalam grid 2 kolom |
| Batang grafik | `#96B6F5`…`#ABC5F7` | batang grafik omzet |

Pemetaan ke token aplikasi (`apps/kasir/styles/styles.css`):

| Referensi | Token |
|---|---|
| aksen biru | `--blue-500: #0072f6` (terang `--blue-400`, tua `--blue-600`) |
| latar halaman | `--bg: #f4f7fc` (setara `#F3F7FD`) |
| permukaan | `--card: #ffffff`, `--card-2: #f2f6fc`, `--card-3: #e8eef8` |
| navy (desktop) | `--navy-700: #062a66` (tetap dipakai bilah atas desktop) |

### 2.3 Isi per halaman

| # | Mockup | Struktur terukur |
|---|---|---|
| 01 | Login Kasir Mobile | "Selamat Datang" / "Masuk ke akun Kasir", segmented **Admin | Owner | Kasir**, "Email / Username", "Password / PIN", tombol "Masuk", catatan "Lupa password? • Hak akses sesuai akun" |
| 02 | Dashboard Kasir Mobile | 4 kartu: Omzet Hari Ini, Transaksi, Tunai/QRIS, Laba Bersih + "Grafik Penjualan / 7 hari terakhir" |
| 03 | Katalog Produk Mobile | grid 2 kolom: nama, harga, "Stok n", label `HABIS` |
| 04 | Pencarian dan Kategori | sama seperti 03 (mockup tidak menampilkan kolom pencarian secara eksplisit) |
| 05 | Keranjang | baris item (nama, `2 x Rp15.000`), Subtotal/Pajak/TOTAL, "Metode Pembayaran" (Tunai/QRIS/Transfer), tombol "Konfirmasi Pembayaran" |
| 06 | Preview Sementara | struk 58/80 mm, status **BELUM DIBAYAR**, tombol "Lanjut Bayar" + "Selesai" |
| 07 | Pembayaran Tunai | keranjang + metode Tunai + "Konfirmasi Pembayaran" |
| 08 | Pembayaran QRIS | keranjang + metode QRIS + "Konfirmasi Pembayaran" |
| 09 | Pembayaran Berhasil | struk, status **LUNAS**, tombol "Cetak Struk" + "Selesai" |
| 10 | Struk Final | sama dengan 09 |
| 11 | Riwayat Transaksi | header "Data & Aktivitas / Cari • filter • Urutkan", tabel Item / Nilai / Status |
| 12 | Pendapatan Harian | 4 kartu (Omzet Hari Ini, Transaksi, Tunai/QRIS, Laba Bersih) + "Grafik Penjualan / 7 hari terakhir" |
| 13 | Pengeluaran | tabel "Data & Aktivitas" yang sama dengan 11 |
| 14 | Tambah Produk | formulir: Nama/Judul, Kategori/Tipe, Harga/Nominal, Status, tombol "Simpan Perubahan" |
| 15 | Stok Habis | katalog 2 kolom + label **HABIS** |
| 16 | Pengaturan Printer | formulir generik yang **sama persis** dengan 14 (placeholder) |

**Temuan penting:** halaman 11, 12, 13, 14, dan 16 memakai isi placeholder
(baris tabel berisi nama-nama halaman mockup sendiri; formulir 16 identik
dengan 14). Artinya paket referensi ini **tidak** mendefinisikan tata letak
khusus untuk riwayat transaksi, pengeluaran, dan pengaturan printer. Yang
benar-benar terdefinisi adalah: kerangka (bilah atas + judul + bilah bawah
5 butir) dan halaman kasir inti (Dashboard, Katalog, Keranjang, Pembayaran,
Struk, Tambah Produk).

---

## 3. Yang diterapkan pada aplikasi Kasir

Tetap mematuhi keputusan arsitektur yang sudah disetujui (satu akun kasir =
satu outlet; tiga aplikasi terpisah Admin/Owner/Kasir; validasi di server).

| Referensi (mockup) | Penerapan di `apps/kasir` |
|---|---|
| Bilah atas putih + logo + "Kasir • Outlet" | `header.topbar` + `#brand-context` (diisi dari konteks server, bukan dari browser) — **hanya pada layar ≤ 900 px**; desktop tetap bilah atas navy tema V2 |
| Judul + subjudul halaman | `#page-title` / `#page-subtitle` (berubah per halaman, tanpa akhiran "Mobile") |
| Bilah bawah 5 butir | `#bottom-nav`: Beranda, Produk, Transaksi, Laporan, Lainnya (pane lain diwakili "Lainnya") |
| Dashboard (kartu + grafik) | pane **Beranda**: 4 kartu ringkasan + grafik omzet 7 hari (`#home-chart`) dari `/api/cashier/reports/daily` + `/daily-series` |
| Katalog 2 kolom + HABIS | tab Produk (sudah ada) — grid 2 kolom di HP sudah ada sejak awal |
| Keranjang + metode + tombol konfirmasi | tab Transaksi (sudah ada): keranjang, diskon, metode, "Bayar" |
| Preview BELUM DIBAYAR / LUNAS | alur struk (`sale-flow.js`) sudah memisahkan pratinjau (BELUM DIBAYAR) dan struk final (LUNAS) |
| Riwayat + Pendapatan + Pengeluaran | tab Pendapatan, Pengeluaran, dan riwayat transaksi (sudah ada) |
| Tambah Produk | modal produk pada tab Produk (sudah ada) |
| Pengaturan Printer | kartu printer dipindah ke pane **Lainnya** (agar tidak menutupi keranjang di HP) |
| Profil kasir + konteks outlet | dipindah ke pane **Lainnya** |

### Berkas yang berubah

| Berkas | Perubahan |
|---|---|
| `apps/kasir/index.html` | bilah atas dua logo + `#brand-context`; `#page-title`/`#page-subtitle`; tab Beranda + Lainnya; pane Beranda; pane Lainnya (menu + printer + profil); `#bottom-nav` 5 butir |
| `apps/kasir/styles/styles.css` | bilah bawah, kartu menu, grafik, aturan HP ≤ 900 px (bilah atas putih, tab disembunyikan) |
| `apps/kasir/src/app.js` | `TABS` + `PAGE_INFO` + `bottomNavKey`; pemuatan Beranda (`loadHome`, `renderHomeSummary`, `renderHomeChart`); satu penanganan klik `data-tab`; konteks outlet di bilah atas |
| `apps/kasir/src/api.js` | `api.dailySeries()` |
| `server/src/modules/cashier-area/controller.js` + `routes.js` | `GET /api/cashier/reports/daily-series` (seri omzet per hari, outlet dari akun kasir) |
| `server/tests/v03-features.test.js` | 2 tes baru (akurasi seri + penolakan tanpa sesi/period salah) |
| `scripts/verify-ui.mjs` | bagian **FASE 12**: mengunci elemen kerangka HP agar tidak hilang |

### Endpoint baru

```
GET /api/cashier/reports/daily-series?period=week
→ { period: { from, to, preset }, outlet: { id, name },
    points: [{ date, transactions, total }] }
```

- Hanya peran `cashier`; **outlet diturunkan dari akun** (`req.cashierScope`),
  tidak ada parameter outlet di URL (tidak ada permukaan IDOR).
- Memakai agregasi laporan yang sudah teruji (`groupedReport`) sehingga angka
  Beranda **selalu sama** dengan tab Laporan.
- Hanya memuat omzet & jumlah transaksi (tanpa HPP/laba), sehingga aman untuk
  kasir tanpa izin `can_view_profit`.

---

## 4. Penyimpangan yang disengaja (butuh konfirmasi pemilik)

1. **Bilah atas putih hanya di HP.** Mockup desktop juga berlatar terang, tetapi
   tema V2 yang sudah disetujui memakai bilah atas navy dan dikunci
   `scripts/verify-ui.mjs`. Mengubah desktop = keputusan desain baru →
   menunggu persetujuan.
2. **Login tanpa pemilih peran Admin/Owner/Kasir.** Arsitektur yang disetujui
   memakai tiga aplikasi terpisah (Admin Platform, Owner, Kasir); menambahkan
   pemilih peran di aplikasi Kasir akan melanggar pemisahan itu. Login kasir
   tetap email/password + PIN.
3. **Akhiran "Mobile" pada judul tidak dipakai** ("Dashboard Kasir Mobile" →
   judul asli halaman). Akhiran itu penanda berkas mockup, bukan judul produk.
4. **Watermark/anotasi mockup tidak dipakai** ("KONSEP UI • DATA ILUSTRASI",
   "Referensi tampilan Android").
5. **Isi placeholder tidak ditiru.** Halaman 11/13/14/16 memakai baris/kolom
   contoh dari nama halaman mockup; penerapan memakai **data nyata** dari
   backend.
6. **Angka & grafik memakai data nyata**, bukan ilustrasi `Rp 4.850.000`.
7. **Grafik Beranda** memakai omzet harian (`total`) outlet kasir untuk 7 hari
   terakhir; label hari memakai singkatan Indonesia (Min…Sab).
8. **Ikon bilah bawah** digambar sebagai SVG garis sederhana karena bentuk ikon
   di mockup tidak dapat dibaca OCR.
9. **Pane "Lainnya" menerima Pengeluaran & Riwayat Stok** (mockup tidak
   menampilkan halamannya), agar 5 butir bilah bawah tetap sesuai referensi.

---

## 5. Belum dikerjakan / pekerjaan berikutnya

- Tata letak khusus (bukan placeholder) untuk **Riwayat Transaksi**,
  **Pengeluaran**, dan **Pengaturan Printer** sesuai referensi.
- Halaman **Stok Habis** sebagai layar tersendiri (saat ini lewat daftar
  produk + aksi "Tandai habis").
- **Pencarian & kategori** yang lebih menonjol di katalog HP (mockup 04).
- Penyesuaian desktop bila pemilik menyetujui bilah samping/nav ala mockup
  desktop (`04-KASIR-DESKTOP`).
- Tangkapan layar perangkat untuk verifikasi visual (agen tidak punya
  perangkat/emulator) — menunggu pemilik.

## 6. Pertanyaan untuk pemilik

1. Apakah bilah atas **putih** juga diinginkan di **desktop** (mockup desktop
   juga terang), atau desktop tetap navy seperti tema V2?
2. Apakah susunan bilah bawah **Beranda • Produk • Transaksi • Laporan •
   Lainnya** sudah tepat, termasuk isi menu "Lainnya"?
3. Apakah tiga halaman yang bersifat placeholder (Riwayat Transaksi,
   Pengeluaran, Pengaturan Printer) punya rancangan rinci tersendiri? Jika ya,
   mohon kirimkan spesifikasi teks/gambar tambahan.

## 7. Cara memverifikasi

```powershell
npm.cmd run test:server   # termasuk 2 tes baru endpoint daily-series
npm.cmd run verify:ui     # termasuk bagian [desain kasir mobile V2 (FASE 12)]
node scripts/build-hosting.mjs
npm.cmd run e2e:online    # produksi (perlu OWNER_*/ADMIN_* env)
```

---

## 8. Hasil verifikasi & penerapan (16 Okt 2026)

### 8.1 Pengujian

| Perintah | Hasil |
|---|---|
| `npm run test:server` | **248/248 lulus** (2 tes baru: akurasi seri + penolakan tanpa sesi/`period` salah) |
| `npm run verify:ui` | **SEMUA OK** — bagian `[desain kasir mobile V2 (FASE 12)]` lulus; smoke bundel `dist/hosting` 200 |
| `npm run test:auth` | 10/10 lulus |
| `npm run test:image` | 9/9 lulus |
| `npm run e2e:local` | **33/33 lulus** |
| `npm run qa:local` | **SEMUA TAHAP LULUS** (1–5; E2E lokal terpisah) |
| `npm run e2e:online` (produksi) | **28/28 lulus** |

### 8.2 Pemeriksaan produksi (setelah deploy)

Dengan akun kasir demo (`kasir.demo@nova.test`, outlet **Outlet Utama**):

```
GET /api/cashier/reports/daily-series?period=week   → 200
  periode 10–16 Okt 2026, outlet "Outlet Utama",
  titik: 12 Okt (5 trx), 13 Okt (5 trx), 16 Okt (3 trx)   ← hari tanpa penjualan = 0
GET /api/cashier/reports/daily?period=today          → 200
  omzet Rp 120.000, 3 transaksi, tunai Rp 120.000, qris Rp 0,
  can_view_profit=false (Laba Bersih tidak dikirim)      ← benar
GET /api/cashier/reports/daily-series (tanpa token)   → 401  (rute ada, bukan 404)
```

### 8.3 Yang dideploy

| Sasaran | Perintah | Hasil |
|---|---|---|
| Backend produksi | `npx.cmd vercel deploy --prod --yes` | `https://kasir-nova.vercel.app` — endpoint baru `200`/`401` sesuai harapan |
| Web (Firebase Hosting) | `node scripts/build-hosting.mjs` + `firebase.cmd deploy --only hosting` | `https://kasir-nova.web.app/kasir/` memuat `#bottom-nav`, `#home-chart`, `#brand-context` |
| APK beta | `npm run sync` → `setup-android.mjs` (beta.9/code 9) → `apk:release` → `npm run distribute` | `dist/apk/KASIR-NOVA-1.0.0-beta.9.apk` (5,03 MB; tab **Laporan Transaksi** + ekspor Excel kasir + perbaikan unduh berkas), sertifikat sama seperti beta.8, isi berkas panel kasir **identik** dengan repo (diperiksa dengan membongkar APK). **Terkirim ke grup `kasir-beta`** (17 Okt 2026, release `4sllfgq44brq8`) |

> ⚠️ Pada deploy 17 Okt 2026, langkah Hosting di atas dijalankan **tanpa argumen**
> saat default script masih "base kosong", sehingga `NOVA_API_BASE` ter-deploy
> `''` → panel web menembak `kasir-nova.web.app/api/**` → **404**. Sudah
> diperbaiki (build ulang + deploy) dan ditutup tiga lapis: default build = URL
> backend produksi, kunci di `verify-ui.mjs`, serta langkah **26b** `e2e-online.mjs`.
> Rincian: `docs/20` §3/§3b/§7 dan `docs/24`.

> Persetujuan pemilik untuk deploy backend + hosting + distribusi beta.6
> diminta dan diberikan sebelum tindakan dilakukan (lihat laporan fase).

