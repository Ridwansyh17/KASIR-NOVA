# KASIR NOVA — Online Gratis Permanen (Render + Neon)

> Tujuan: server backend dapat diakses **online** untuk uji coba, **tanpa biaya**.
>
> Kombinasi: **Render** (web service Node, paket Free) + **Neon** (PostgreSQL
> gratis permanen). Railway tak punya free tier permanen; Render+Neon dipilih.
>
> Frontend tetap boleh di Firebase Hosting (keputusan arsitektur). Service Render
> dapat menyajikan **API saja** atau **API + app sekaligus (same-origin)**.

---

## 0. Ringkasan hasil akhir

| Skenario | URL yang dibuka untuk uji |
|---|---|
| `SERVE_STATIC=true` (rekomendasi uji) | `https://<service>.onrender.com/kasir` (juga `/admin`, `/owner`) — satu URL, same-origin |
| `SERVE_STATIC=false` + frontend Firebase | `https://kasir-nova.web.app/kasir` → memanggil API Render (cross-origin) |

---

## 1. Prasyarat (tindakan pengguna)

| # | Prasyarat | Catatan |
|---|---|---|
| 1 | Akun **GitHub** + repo berisi proyek ini | Render men-deploy dari repo Git |
| 2 | Akun **Render** (gratis) | https://render.com |
| 3 | Akun **Neon** (gratis) | https://neon.tech |
| 4 | `git` lokal | sudah ada |

Tidak perlu kartu kredit untuk Render Free & Neon Free.

---

## 2. Unggah kode ke GitHub (sekali)

Repo ini belum punya remote. Setelah membuat repo kosong di GitHub (mis.
`kasir-nova`), jalankan:

```powershell
git remote add origin https://github.com/<USER>/kasir-nova.git
git branch -M main
git push -u origin main
```

> Pastikan `.env` **tidak** ikut ter-push (sudah di `.gitignore`). Cek:
> `git status` sebelum push.

---

## 3. Buat database Neon

1. Daftar di https://neon.tech → **Create project** (pilih region terdekat,
   mis. Singapore).
2. Salin **Connection string** (mode **Pooled**). Bentuknya:
   ```
   postgresql://<user>:<pass>@<host>/<db>?sslmode=require
   ```
3. Simpan — ini `DATABASE_URL`.

> `pg` (8.23) otomatis mengaktifkan SSL dari `sslmode=require`. Bila muncul
> error sertifikat, ganti `sslmode=require` → `sslmode=no-verify`.

---

## 4. Deploy ke Render

1. Render Dashboard → **New → Blueprint** → hubungkan repo GitHub.
2. Render membaca `render.yaml` di root (service `nova-server`).
3. Isi variabel yang **sync: false** saat diminta:
   - `DATABASE_URL` = connection string Neon (langkah 3).
   - (`JWT_ACCESS_SECRET` & `JWT_REFRESH_SECRET` dibuat otomatis oleh Render.)
4. **Create / Apply**. Tunggu build & deploy.
5. Salin URL service: `https://nova-server-xxxx.onrender.com`.

### Variabel lingkungan (render.yaml)

| Key | Nilai |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |
| `SERVE_STATIC` | `true` (sajikan app+API same-origin) / `false` (API saja) |
| `DATABASE_URL` | (manual) Neon, sertakan `?sslmode=require` |
| `JWT_ACCESS_SECRET` | otomatis (Render) |
| `JWT_REFRESH_SECRET` | otomatis (Render) |
| `CORS_ORIGIN` | `https://kasir-nova.web.app` |
| `RENDER_EXTERNAL_URL` | otomatis (Render) — same-origin diizinkan |

---

## 5. Migrasi & seed database Neon (sekali, dari lokal)

Cloud/Render tidak menjalankan seed otomatis. Jalankan dari mesin lokal
(Neon dapat diakses publik):

```powershell
$env:DATABASE_URL = "postgresql://<user>:<pass>@<host>/<db>?sslmode=require"

# dari root repo:
npm run db:migrate

# seed admin (wajib). Set juga email/password yang diinginkan:
$env:SEED_ADMIN_EMAIL = "admin@email-anda.com"
$env:SEED_ADMIN_PASSWORD = "<password-kuat>"
$env:SEED_ADMIN_NAME = "Platform Admin"
npm run db:seed

# Akun admin TAMBAHAN (mis. akun "paten" pemilik) — tanpa mengubah env seed.
# Sandi dibaca dari BERKAS (bukan argumen CLI, agar tidak terlihat di daftar proses):
$env:NOVA_ADMIN_EMAIL = "admin.ridwan@nova.test"
$env:NOVA_ADMIN_NAME = "Admin Ridwan"
$env:NOVA_ADMIN_PASSWORD_FILE = "C:\path\ke\sandi.txt"
npm run admin:create -- --allow-production   # non-lokal wajib --allow-production
npm run admin:list -- --allow-production     # verifikasi daftar akun admin
```

> `admin:create` **idempoten**: bila emailnya sudah ada, akun tidak diubah
> (tambahkan `--force` untuk mengganti sandi + nama). Ganti sandi:
> `admin:password`; suspend/aktifkan: `admin:status`
> (`NOVA_ADMIN_STATUS=active|suspended`). Lihat `docs/04` § 2.

> Owner & kasir dibuat lewat Panel Admin setelah login. Untuk data uji cepat,
> lihat `npm run db:seed` (owner demo opsional via `SEED_OWNER_*`).

---

## 6. Verifikasi

```powershell
# health publik
Invoke-RestMethod https://nova-server-xxxx.onrender.com/api/health
# -> { status = "ok"; services = @{ database = "up" } }

# bila SERVE_STATIC=true, app tersaji same-origin:
Invoke-WebRequest https://nova-server-xxxx.onrender.com/kasir   # 200
```

Lalu buka `https://nova-server-xxxx.onrender.com/kasir` (atau `/admin`,
`/owner`) di browser dan login.

> ⚠️ **Paket gratis Render** menidurkan service setelah ~15 menit idle.
> Permintaan pertama setelah tidur lambat (cold start ~30–60 detik). Buka
> `/api/health` dulu untuk "membangunkan".

---

## 7. (Opsional) Arahkan frontend Firebase ke API Render

Bila ingin tetap memakai `https://kasir-nova.web.app` sebagai frontend:

```powershell
node scripts/build-hosting.mjs https://nova-server-xxxx.onrender.com
firebase deploy --only hosting
```

`CORS_ORIGIN` sudah memuat `https://kasir-nova.web.app` sehingga cross-origin
diizinkan. (Paket Spark cukup — tak perlu rewrite `/api/**`.)

---

## 8. Rollback

| Skenario | Tindakan |
|---|---|
| Backend bermasalah | Render → service → **Rollback** ke deploy sebelumnya |
| Tidak ingin publik | Render → **Suspend** service |
| Frontend keliru | `node scripts/build-hosting.mjs` (base kosong) lalu deploy ulang |
| DB | Neon → restore dari branch/history; atau `scripts/restore-db.ps1` |

---

## 9. Status kesiapan (12 Okt 2026)

| Item | Status |
|---|---|
| Neon CLI | ✅ `neon` 8.3.5 + MCP Neon (remote) + 8 agent skills di `.agents/skills/` |
| Proyek Neon | ✅ **KASIR NOVA** — id `tiny-rain-72150501`, org *Ridwan* (free) |
| Branch / DB | ✅ `production` (`br-silent-truth-b517f5sp`) / database `neondb`, region `us-east-2` |
| Migrasi | ✅ 8/8 diterapkan (17 tabel) |
| Seed | ✅ `admin@nova.test` (platform_admin) & `owner@nova.test` (owner), status active |
| Uji end-to-end | ✅ Server dijalankan menunjuk Neon: `/api/health` OK, login admin & owner → **200** (accessToken + refreshToken) |
| Sisa langkah | ⏳ Buat **web service Render** dari repo GitHub, isi `DATABASE_URL` = connection string Neon (dashboard Render), lalu verifikasi URL publik |

> Rahasia (connection string Neon) **tidak** disimpan di repo — diisi manual di
> dashboard Render saat membuat service.
