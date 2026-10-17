# KASIR NOVA

Aplikasi Point of Sale (POS) berbasis web untuk berbagai jenis usaha.
Tiga area aplikasi (Admin Platform, Owner, Kasir) berbagi **satu backend dan
satu database PostgreSQL terpusat**.

## Prasyarat

| Tool | Versi | Catatan |
|---|---|---|
| Node.js | >= 20 (v24.20.0 di mesin ini) | |
| npm | >= 10 (11.19.0) | npm workspaces |
| PostgreSQL | 16.1 | Terinstall di `D:\postgresql-16.1-1-windows-x64-full` |

## Setup Lingkungan Dev (satu kali)

### 1. Jalankan PostgreSQL

Server dev berjalan di port **5433** (non-default agar tidak bentrok).

```cmd
D:\postgresql-16.1-1-windows-x64-full\pg-server.cmd start
```

Cek status:

```cmd
D:\postgresql-16.1-1-windows-x64-full\pg-server.cmd status
```

### 2. Konfigurasi environment

```cmd
copy .env.example server\.env
```

Edit `server\.env` bila perlu (DATABASE_URL sudah sesuai untuk dev).

> **Opsional — gateway pembayaran langganan (uji sandbox).** Isi
> `PAYMENT_PROVIDER=duitku`, `PAYMENT_MODE=sandbox`, `DUITKU_MERCHANT_CODE`,
> `DUITKU_API_KEY` (+ `PAYMENT_API_BASE_URL`/`PAYMENT_OWNER_PANEL_URL`) hanya bila
> ingin menguji pembayaran langganan. Biarkan kosong untuk menonaktifkannya —
> server tetap berjalan dan endpoint pembayaran menjawab 503. Kredensial
> **tidak boleh** di-commit. Rincian: `docs/38-pembayaran-langganan-gateway.md`.

### 3. Install dependency & migrasi

```cmd
npm install
npm run db:migrate
npm run db:seed
```

Akun **Admin Platform tambahan** (mis. akun "paten" pemilik) dibuat lewat CLI —
sengaja tidak ada di aplikasi. Sandi dibaca dari variabel lingkungan/berkas,
**tidak** lewat argumen:

```cmd
set NOVA_ADMIN_EMAIL=admin.ridwan@nova.test
set NOVA_ADMIN_NAME=Admin Ridwan
set NOVA_ADMIN_PASSWORD_FILE=C:\path\ke\sandi.txt
npm run admin:create
npm run admin:list
```

Perintah lain: `admin:password` (ganti sandi), `admin:status`
(`NOVA_ADMIN_STATUS=active|suspended`). Untuk basis data non-lokal (produksi)
wajib tambahkan `-- --allow-production`. Rincian: `docs/04` § 2.

### 4. Jalankan backend

```cmd
npm run dev:server
```

Backend tersedia di `http://localhost:4000`.

## Uji Coba Online (produksi)

- Frontend (Firebase Hosting): **https://kasir-nova.web.app** (Kasir / Admin / Owner)
- Backend + API same-origin (Vercel Hobby, gratis, tanpa kartu): **https://kasir-nova.vercel.app**
- Database: **Neon PostgreSQL** (project *KASIR NOVA*).

Smoke test E2E (idempoten — aman dijalankan ulang). **31/31 langkah**: login
owner & admin, langganan, katalog, login PIN kasir, penjualan tunai + stok,
idempotensi `clientRef`, void, laporan komparasi, ekspor Excel, isolasi tenant,
audit, dan soft-delete.

Lokal (satu perintah — menyalakan server, menunggu `/api/health`, menjalankan
E2E, lalu mematikan server; kredensial seed dibaca dari `server/.env`):

```powershell
npm run e2e:local                   # 31/31 langkah, port 4000
```

Daring (produksi — perlu kredensial yang di-set manual):

```powershell
$env:OWNER_EMAIL  = <email owner>
$env:OWNER_PASSWORD = <password owner>
$env:ADMIN_EMAIL  = <email admin platform>
$env:ADMIN_PASSWORD = <password admin>
npm run e2e:online                  # 31/31 langkah
$env:E2E_PLATFORM_FLOW = '1'        # (opsional) sertakan alur Admin Platform
npm run e2e:online
```

> Bila PowerShell menolak `npm` (execution policy), jalankan skrip lokalnya
> langsung: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-local.ps1`.

Seluruh matriks verifikasi lokal (backend 246, UI statis, sesi, produk, + E2E)
dalam satu perintah — butuh PostgreSQL dev port 5433:

```powershell
npm run qa:local                    # ringkasan LULUS/GAGAL per tahap
npm run qa:local -- -WithE2E        # ikut E2E 31 langkah
```

Kredensial uji tersedia di `akun kasir-nova-test.txt` (tidak di-commit).
Runbook deploy/rollback: `docs/24-vercel-serverless.md`; backup/restore:
`docs/22-backup-restore.md`; APK Android & cetak Bluetooth:
`docs/25-apk-android-cetak-bluetooth.md`.

## APK Android (panel Kasir)

Kemasan Android ada di `apps/kasir-mobile` (Capacitor 7). Prasyarat: **JDK 21**
dan **Android SDK** (di mesin ini: `C:\Android`, tercatat di
`apps/kasir-mobile/android/local.properties`).

```powershell
cd apps\kasir-mobile
npm install
npm run sync              # salin apps/kasir -> www, lalu cap sync android
npm run android:prepare   # plugin printer, izin Bluetooth, versi, signing
npm run apk:release       # APK rilis (butuh android/key.properties)
npm run distribute -- ..\..\dist\apk\KASIR-NOVA-1.0.0-beta.9.apk
```

Versi aplikasi bersumber dari `apps/kasir-mobile/package.json`; naikkan
`versionCode` lewat `$env:NOVA_APP_VERSION_CODE='9'` sebelum
`npm run android:prepare`. Keystore & kredensial rilis **tidak di-commit**
(`nova-release.jks`, `key.properties`, `keystore-credentials.txt`). Runbook
lengkap: `docs/25-apk-android-cetak-bluetooth.md`.

## Struktur

```
server/      Backend Node.js + Express + PostgreSQL
apps/admin   Panel Admin Platform
apps/owner   Panel Owner (multi-bisnis)
apps/kasir   Aplikasi Kasir (POS)
apps/kasir-mobile  Kemasan Capacitor -> APK Android (printer Bluetooth)
packages/    Kode bersama (validasi, konstanta, format IDR)
shared/      Modul frontend kanonik (disalin ke apps/* oleh scripts/sync-shared.mjs)
             + shared/vendor/ untuk pustaka pihak ketiga apa adanya (encoder QR, MIT)
docs/        Dokumentasi arsitektur & roadmap
```

Lihat `docs/` untuk arsitektur lengkap, model data, matriks hak akses, dan
roadmap fase.

## Catatan Keamanan

- File `.env` **dilarang** di-commit (sudah ada di `.gitignore`).
- Password DB dev hanya untuk pengembangan lokal, disimpan di `server/.env`
  (diabaikan git).
- Admin Platform **tidak** dibuat lewat pendaftaran publik, hanya seeding
  internal yang terkontrol.

## Status

- Fase **0–18 selesai** (termasuk penyempurnaan struk thermal **16b**, APK
  Android **17**, dan **V0.3** HPP/stok/pengeluaran/laporan **18**); suite tes
  integrasi **291/291**; E2E alur produksi **26/26** (dijalankan terhadap server
  lokal sebelum deploy; langkah 20–23 menguji perbandingan outlet &
  lintas-bisnis JSON + XLSX).
- Backend produksi **online** (Vercel + Neon, gratis tanpa kartu); frontend
  **V0.3** ter-deploy di Firebase Hosting (`kasir-nova.web.app`, API cross-origin
  ke `kasir-nova.vercel.app`); APK Kasir **`1.0.0-beta.9`** dibangun & dikirim
  ke penguji beta via Firebase App Distribution (grup `kasir-beta`, 17 Okt 2026 —
  memuat **Laporan Transaksi** + **ekspor Excel** di HP). Deploy ulang 17 Okt 2026
  membawa **laporan transaksi Owner**, **laporan transaksi Kasir (A5a)**, dan
  tombol **struk PDF** di panel web.
- **Redesign frontend (Fase 14)**: identitas visual mengikuti logo resmi
  `Logo KASIR NOVA.jpeg` (latar navy gelap + aksen cyan). Logo di login & topbar
  ketiga panel (Admin/Kasir/Owner). Detail: `docs/05-roadmap.md`.
- **Ekspor Excel (Fase 15)**: halaman Owner dapat mengunduh rekapan transaksi
  `.xlsx` (4 sheet: Ringkasan, Detail, Rekap Harian, Rekap Metode) dengan filter
  rentang/outlet/status/metode/status pembayaran/pencarian; konsisten dengan
  dashboard, hanya transaksi nyata. Detail: `docs/16-api-laporan.md`.
- **Perbandingan laporan (Fase 16)**: halaman Owner menambahkan tabel
  **Perbandingan Outlet** dan section **Perbandingan Lintas-Bisnis** (ekspor Excel
  2 sheet), tetap owner-scoped; agregat diperbaiki (anti fan-out) untuk
  transaksi multi-item.
- **Struk thermal (Fase 16b)**: panel Kasir mencetak struk gaya POS klasik
  (monospace, garis putus-putus) berisi header toko (nama/outlet/alamat/telepon),
  info transaksi, item + harga rata kanan, ringkasan TOTAL, dan status pembayaran
  aktual (LUNAS / BELUM LUNAS / DIBATALKAN / DIKEMBALIKAN / GAGAL); kembalian
  hanya untuk tunai yang benar-benar lunas. Builder struk murni:
  `apps/kasir/src/receipt.js`.
- **Struk PDF Kasir (17 Okt 2026)**: setelah menekan **Bayar**, struk langsung
  tersedia sebagai **berkas PDF** dan dapat **DIKIRIM**, **DISIMPAN**, atau
  **DICETAK** lewat tombol di kartu struk — **tanpa menunggu printer thermal
  tersambung** (cetak thermal tetap tersedia sebagai opsi). Berkas PDF dibentuk di
  JS (`apps/kasir/src/receipt-pdf.js`, penulis PDF minimal tanpa pustaka pihak
  ketiga; susunan baris sama dengan struk thermal, lebar 58/80 mm, multi-halaman)
  dan dikirim lewat `apps/kasir/src/struk-share.js` (Web Share/unduhan di peramban;
  plugin native **`NovaReceipt`** kirim/simpan/cetak di APK). Rincian:
  `docs/36-struk-pdf-kasir.md`.
- **V0.3 — HPP, stok habis, pengeluaran & laporan keuangan**: modal/HPP produk
  (satuan, foto, HABIS manual) dengan **pembatasan izin di server** (kasir hanya
  bila `can_view_profit`); aturan **HABIS turunan** memblokir penjualan di server
  (bukan hanya UI); **pergerakan stok append-only**; **pengeluaran outlet**
  (koreksi lewat **void**, bukan hapus); **laporan keuangan & laba** (kotor/bersih)
  + ekspor Excel, serta laporan harian Kasir. Panel Owner & Kasir; kontrak di
  `docs/18-api-pengeluaran-inventori.md`. Omzet per metode dihitung dari
  **`transactions.total`** (omzet), bukan `payments.amount` (uang diterima yang
  memuat kembalian) — perbaikan 17 Okt 2026, `docs/35` §9.
- **Laporan Transaksi siap-cetak (Owner, 17 Okt 2026, sudah live)**: endpoint
  `GET /api/owner/businesses/:id/reports/transactions` (**satu baris per item**,
  hanya Owner; kasir `403`) + halaman cetak A4 di panel Owner (`#print-report`,
  disembunyikan di layar) dengan ringkasan, rekap metode, dan produk terlaris.
  Tersedia juga **Ekspor Excel** (`/reports/transactions/export`, 4 sheet, satu
  baris per item) lewat tombol *Ekspor Laporan Transaksi (.xlsx)*, dan cetak
  **multi-halaman bernomor** ("Halaman i dari N" di setiap halaman; paginasi +
  kapasitas baris diukur dengan Chrome headless — `scripts/print-report-check.mjs`).
  Kode & tes: `docs/35-laporan-transaksi-cetak.md`.
- **Laporan Transaksi untuk Kasir (17 Okt 2026, sudah live)**: tab baru **Laporan
  Transaksi** di panel Kasir — **satu baris per transaksi** (keputusan pemilik
  B1) pada outlet akun kasir (semua kasir outlet itu, A5a), rentang bawaan
  **hari ini** (B3), filter status & pencarian nomor transaksi, kartu ringkasan
  + rekap metode, dan **Ekspor Excel** (B2; 3 sheet: Ringkasan, Daftar
  Transaksi + TOTAL, Rekap Metode — tanpa Produk Terlaris). Endpoint
  `GET /api/cashier/reports/transactions[/export]`; `outletId` **selalu** dari
  akun (`outletId` pada query dibuang), angka identik dengan laporan Owner.
  Ekspor memakai plugin `NovaReceipt` di APK / unduhan di web. Rincian:
  `docs/37-laporan-transaksi-kasir.md`.
- **Sitemap & deploy**: backend di Vercel (`https://kasir-nova.vercel.app`),
  panel di Firebase Hosting (`https://kasir-nova.web.app`) — deploy ulang
  17 Okt 2026 membawa laporan transaksi + tombol struk PDF di web; catatan lengkap
  di `docs/24-vercel-serverless.md`.
- **APK Android panel Kasir (Fase 17, diperbarui 17 Okt 2026)**: panel Kasir
  dikemas sebagai APK Capacitor (`apps/kasir-mobile`, `id.kasirnova.kasir`,
  `1.0.0-beta.9`) dengan ikon launcher **KASIR NOVA** (adaptive), cetak struk
  thermal langsung via **Bluetooth Classic (SPP) & BLE** (plugin `NovaPrinter` +
  ESC/POS murni `apps/kasir/src/escpos.js`), serta **struk PDF** — kirim/simpan/
  cetak lewat plugin `NovaReceipt`. APK ditandatangani keystore rilis dan
  dibagikan lewat **Firebase App Distribution** (grup `kasir-beta`); berkas siap
  pasang di `dist/apk/`. Runbook:
  `docs/25-apk-android-cetak-bluetooth.md`. **Sudah terverifikasi:** **struk PDF
  (kirim/simpan/cetak) sukses diuji pemilik di perangkat** (17 Okt 2026).
  **Belum terverifikasi:** cetak ke printer fisik (tidak ada perangkat di
  lingkungan pengembangan).
- **Pembayaran Langganan via Payment Gateway (17 Okt 2026)**: Owner membayar
  langganan sendiri dari panel Owner (tombol **Bayar / Perpanjang**) memakai
  **API inti per kanal Duitku SANDBOX** (Virtual Account / QRIS): server membuat
  tagihan (`subscription_invoices`, migrasi `0010`), menampilkan nomor VA /
  **kode QR QRIS** (gambar QR dari encoder MIT yang di-vendor + string yang
  dapat disalin), lalu mengaktifkan langganan **setelah callback bertanda tangan
  (HMAC-SHA256) menyatakan berhasil** — pola sama dengan Admin memasang paket,
  `auto_renew` tetap `false`. Nominal **selalu** dari `subscription_plans.price`
  (sen) di server; tanpa kredensial, endpoint menjawab **503** dan aplikasi tetap
  jalan; mode produksi terkunci kunci pengaman `PAYMENT_ALLOW_PRODUCTION`.
  Lingkup **hanya langganan** — pembayaran penjualan kasir tetap manual.
  Rincian & cara uji sandbox: `docs/38-pembayaran-langganan-gateway.md`.
  Alur pelanggan baru dari akun sampai langganan aktif (akun Owner dibuat Admin
  Platform, bisnis baru otomatis dapat paket **Gratis** 30 hari, lalu upgrade
  self-service): `docs/39-cara-pelanggan-baru-mendaftar-langganan.md`.
- **Modul tertunda** (butuh keputusan pemilik): kanal gateway untuk **penjualan
  kasir** (kartu/QR/wallet tetap dicatat manual) dan perpanjangan langganan
  otomatis — lihat *Modul Ditangguhkan* di `docs/05-roadmap.md`.
