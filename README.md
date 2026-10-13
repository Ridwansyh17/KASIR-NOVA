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

### 3. Install dependency & migrasi

```cmd
npm install
npm run db:migrate
npm run db:seed
```

### 4. Jalankan backend

```cmd
npm run dev:server
```

Backend tersedia di `http://localhost:4000`.

## Uji Coba Online (produksi)

- Frontend (Firebase Hosting): **https://kasir-nova.web.app** (Kasir / Admin / Owner)
- Backend + API same-origin (Vercel Hobby, gratis, tanpa kartu): **https://kasir-nova.vercel.app**
- Database: **Neon PostgreSQL** (project *KASIR NOVA*).

Smoke test E2E online (idempoten — aman dijalankan ulang):

```powershell
$env:OWNER_EMAIL  = <email owner>
$env:OWNER_PASSWORD = <password owner>
$env:ADMIN_EMAIL  = <email admin platform>
$env:ADMIN_PASSWORD = <password admin>
npm run e2e:online                  # 26/26 langkah
$env:E2E_PLATFORM_FLOW = '1'        # (opsional) sertakan alur Admin Platform
npm run e2e:online
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
npm run distribute -- ..\..\dist\apk\KASIR-NOVA-1.0.0-beta.3.apk
```

Versi aplikasi bersumber dari `apps/kasir-mobile/package.json`; naikkan
`versionCode` lewat `$env:NOVA_APP_VERSION_CODE='3'` sebelum
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

- Fase **0–17 selesai** (termasuk penyempurnaan struk thermal **16b** dan APK
  Android **17**); suite tes integrasi **206/206**; E2E alur produksi
  **26/26** (dijalankan terhadap server lokal sebelum deploy; langkah 20–23
  menguji perbandingan outlet & lintas-bisnis JSON + XLSX).
- Backend produksi **online** (Vercel + Neon, gratis tanpa kartu); frontend di
  Firebase Hosting (`kasir-nova.web.app`).
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
  aktual (LUNAS / BELUM LUNAS / DIBATALKAN / DIKEMBALIKAN / GAGAL). Tersedia
  tombol **Cetak 58mm** & **80mm** (`@page` dinamis); kembalian hanya untuk tunai
  yang benar-benar lunas. Builder struk murni: `apps/kasir/src/receipt.js`.
- **V0.3 — HPP, stok habis, pengeluaran & laporan keuangan**: modal/HPP produk
  (satuan, foto, HABIS manual) dengan **pembatasan izin di server** (kasir hanya
  bila `can_view_profit`); aturan **HABIS turunan** memblokir penjualan di server
  (bukan hanya UI); **pergerakan stok append-only**; **pengeluaran outlet**
  (koreksi lewat **void**, bukan hapus); **laporan keuangan & laba** (kotor/bersih)
  + ekspor Excel, serta laporan harian Kasir. Panel Owner & Kasir; kontrak di
  `docs/18-api-pengeluaran-inventori.md`.
- **APK Android panel Kasir (Fase 17, diperbarui V0.3)**: panel Kasir dikemas
  sebagai APK Capacitor (`apps/kasir-mobile`, `id.kasirnova.kasir`,
  `1.0.0-beta.3`) dengan ikon launcher **KASIR NOVA** (adaptive) dan
  cetak struk thermal langsung via **Bluetooth Classic (SPP) & BLE** — plugin
  `NovaPrinter` + ESC/POS murni (`apps/kasir/src/escpos.js`). APK ditandatangani
  keystore rilis dan dibagikan lewat **Firebase App Distribution** (grup
  `kasir-beta`); berkas siap pasang di `dist/apk/`. Runbook:
  `docs/25-apk-android-cetak-bluetooth.md`. **Belum terverifikasi:** cetak ke
  printer fisik (tidak ada perangkat di lingkungan pengembangan).
- **Modul tertunda** (butuh keputusan pemilik): gateway pembayaran digital dan
  perpanjangan langganan otomatis — lihat *Modul Ditangguhkan* di
  `docs/05-roadmap.md`.
