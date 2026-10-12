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
`docs/22-backup-restore.md`.

## Struktur

```
server/      Backend Node.js + Express + PostgreSQL
apps/admin   Panel Admin Platform
apps/owner   Panel Owner (multi-bisnis)
apps/kasir   Aplikasi Kasir (POS)
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

- Fase **0–13 selesai**; suite tes integrasi **159/159**, E2E online **26/26 PASS**.
- Backend produksi **online** (Vercel + Neon, gratis tanpa kartu); frontend di
  Firebase Hosting (`kasir-nova.web.app`). Detail: `docs/24-vercel-serverless.md`,
  roadmap: `docs/05-roadmap.md`.
