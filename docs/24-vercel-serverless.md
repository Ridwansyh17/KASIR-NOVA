# KASIR NOVA — Online Gratis di Vercel (Serverless, tanpa kartu)

> Alternatif Render. Render kini **mewajibkan kartu** bahkan untuk paket Free
> (HTTP 402), jadi backend dijalankan sebagai **fungsi serverless di Vercel**
> (paket Hobby gratis, **tanpa kartu**). Database tetap **Neon** (gratis).
>
> Frontend tetap boleh di Firebase Hosting, dan/atau diakses same-origin dari
> URL Vercel (`SERVE_STATIC=true`).

---

## Arsitektur

```
GitHub repo ──► Vercel (Hobby)
                  └── api/index.mjs  (mengekspor server/src/app.js — Express yang sama)
                       ├── /api/*         → endpoint API
                       └── /kasir,/admin,/owner → app statis (SERVE_STATIC=true)
Neon Postgres  ←── DATABASE_URL (pooler, sslmode=require)
```

Berkas yang menambahkan dukungan Vercel:
- `api/index.mjs` — entry serverless (tanpa `app.listen`).
- `vercel.json` — rewrite semua path ke fungsi + `includeFiles: apps/**`
  (agar app statis ikut ter-bundle untuk penyajian same-origin).
- `.vercelignore` — agar `.env`, `node_modules`, `backups`, dll **tidak** diunggah.
- `server/src/config/env.js` — izinkan origin same-origin Vercel
  (`VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL`) otomatis.

---

## Variabel lingkungan (set di Vercel, Production)

| Key | Nilai |
|---|---|
| `NODE_ENV` | `production` |
| `SERVE_STATIC` | `true` (app+API same-origin) / `false` (API saja) |
| `DATABASE_URL` | connection string Neon (sertakan `?sslmode=require`) |
| `JWT_ACCESS_SECRET` | acak, ≥16 karakter |
| `JWT_REFRESH_SECRET` | acak, ≥16 karakter |
| `CORS_ORIGIN` | `https://kasir-nova.web.app` (bila frontend Firebase cross-origin) |

> Rahasia tidak pernah disimpan di repo — hanya di dashboard Vercel.

---

## Deploy (CLI)

```powershell
# sekali: token dari https://vercel.com/account/tokens
$env:VERCEL_TOKEN = '<token>'

# dari root repo:
npx vercel deploy --prod --yes --token $env:VERCEL_TOKEN
```

Set variabel (contoh, ulangi per key) — atau lewat dashboard Vercel → Project → Settings → Environment Variables:

```powershell
"DATABASE_URL-nilai" | npx vercel env add DATABASE_URL production --token $env:VERCEL_TOKEN
```

---

## Verifikasi

```powershell
# ganti <APP> dengan nama project Vercel
Invoke-RestMethod https://<APP>.vercel.app/api/health      # { status="ok"; services.database="up" }
Invoke-WebRequest https://<APP>.vercel.app/kasir           # 200 (bila SERVE_STATIC=true)
```

Login (contoh admin):

```powershell
$body = @{ role='platform_admin'; email='admin@nova.test'; password='<password .env>' } | ConvertTo-Json
Invoke-RestMethod https://<APP>.vercel.app/api/auth/login -Method Post -ContentType 'application/json' -Body $body
```

---

## Catatan serverless

- **Cold start**: instance pertama setelah idle lebih lambat (beberapa detik).
- **Pool `pg`**: tiap instance membuat pool kecil; Neon *pooler* menangani
  pembatasan koneksi. Untuk trafik uji coba ini cukup.
- **Batas waktu fungsi**: paket Hobby Vercel membatasi durasi eksekusi; endpoint
  kita pendek sehingga aman.

---

## Rollback

| Skenario | Tindakan |
|---|---|
| Deploy rusak | Vercel → Project → Deployments → **Promote/Rollback** ke deploy sebelumnya |
| Tak ingin publik | Vercel → Project → Settings → **Pause** / hapus project |
| Frontend | Firebase Hosting tetap independen |

---

## Frontend (Firebase Hosting → API Vercel)

Frontend tetap di **Firebase Hosting** (`kasir-nova.web.app`, paket Spark),
tetapi kini memanggil API **cross-origin** ke Vercel. Base API di-*inject* saat build:

```powershell
node scripts/build-hosting.mjs https://kasir-nova.vercel.app
firebase deploy --only hosting
```

- `config.js` tiap app berisi `window.NOVA_API_BASE = 'https://kasir-nova.vercel.app'`.
- `CORS_ORIGIN` di Vercel = `https://kasir-nova.web.app` → preflight **204**,
  login cross-origin admin & owner **200**.
- Kembali ke same-origin (base kosong): `node scripts/build-hosting.mjs` lalu
  `firebase deploy --only hosting`.

> `/api/**` **tidak** di-rewrite di `firebase.json` (butuh paket Blaze), sehingga
> frontend memakai panggilan absolut ke origin Vercel.

---

## Status (12 Okt 2026)

- ✅ Adaptasi serverless disiapkan & **diuji lokal**: health OK, `/kasir` `/admin`
  `/owner` 200, login admin **200** (same-origin diizinkan).
- ✅ Suite tes **159/159** lulus.
- ✅ **DEPLOY PRODUKSI BERHASIL** — https://kasir-nova.vercel.app
  (project `prj_lJ1uTBaLKSOThkF4QqMgbus4XDjm`, team *KASIR NOVA*, plan **hobby**, **tanpa kartu**).
  Vercel Authentication (Deployment Protection) **dimatikan** agar publik & API dapat diakses.
- ✅ Verifikasi publik: `/api/health` → `database: up` (Neon); `/kasir` `/admin` `/owner` → 200;
  login `admin@nova.test` (platform_admin) → 200.
- ℹ️ Render **ditolak** (HTTP 402 butuh kartu) — `render.yaml` tetap disimpan sebagai alternatif.
- ✅ **Frontend Firebase dialihkan** ke API Vercel (cross-origin): `kasir-nova.web.app`
  `/kasir` `/admin` `/owner` → 200; login admin & owner cross-origin → 200; preflight CORS 204.
- ✅ Skill Neon di-commit ke repo (`.agents/skills/` + `skills-lock.json`).
- ✅ **Fase 13**: E2E online **26/26 PASS** (`scripts/e2e-online.mjs`, idempoten;
  dengan `E2E_PLATFORM_FLOW=1` menguji alur Admin Platform: buat owner →
  login → isolasi tenant 404 → soft-delete → login ditolak 403) + data demo di
  Neon (bisnis/outlet/produk/kasir-PIN) — kredensial di
  `akun kasir-nova-test.txt` (gitignored).

### Cara memperbarui (deploy ulang)
```powershell
npx vercel deploy --prod --yes --token <VERCEL_TOKEN>
```
(Database Neon tidak berubah; connection string tersimpan sebagai env `DATABASE_URL` di Vercel.)
