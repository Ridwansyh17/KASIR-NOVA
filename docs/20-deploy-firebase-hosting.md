# KASIR NOVA — Deploy Firebase Hosting (1 site: kasir-nova)

> **Status frontend: SUDAH TER-DEPLOY** (11 Okt 2026) ke `https://kasir-nova.web.app`
> — project `kasir-nova`, site `kasir-nova`.
>
> **Status integrasi backend: 12 Okt 2026** — jalur **same-origin `/api/**`**
> disiapkan & diuji lokal (157/157 tes lulus); backend publik (Cloud Run)
> **belum di-deploy** (butuh billing GCP). Cloudflare **dinonaktifkan**.
>
> Keputusan pemilik: distribusi **web via Firebase Hosting**, **bukan APK**.

## 1. Arsitektur final

```
https://kasir-nova.web.app  (Firebase Hosting — statis + proxy /api)
   /kasir/**   → apps/kasir   (POS)
   /admin/**   → apps/admin   (Panel Admin Platform)
   /owner/**   → apps/owner   (Panel Owner)
   /api/**     → rewrite ke backend HTTPS (Cloud Run)   ← SAME-ORIGIN
   /           → 301 /kasir
        │  rewrite same-origin (tanpa CORS, tanpa tunnel)
        ▼
   Backend Node.js/Express + PostgreSQL (Cloud Run + Cloud SQL)
```

- **1 site, 3 subpath** (site `kasir-nova`; hemat kuota deploy harian).
- Firebase Hosting menyajikan statis **dan** mem-proxy `/api/**` ke backend.
- **Strategi terpilih = same-origin:** `window.NOVA_API_BASE = ''` sehingga
  frontend memanggil `/api/...` di origin yang sama; Firebase Hosting menulis
  ulang ke backend HTTPS. Kelebihan: **tanpa CORS**, tanpa URL backend
  ter-hardcode di frontend.
- **Alternatif (cross-origin):** isi `NOVA_API_BASE` dengan URL backend absolut
  + tambahkan origin site ke `CORS_ORIGIN`. Tetap didukung `build-hosting.mjs`.
- **Cloudflare TIDAK dipakai** (bukan proxy/hosting/DNS/dependency deploy).

## 2. Berkas pendukung deploy

| Berkas | Isi |
|---|---|
| `firebase.json` | `site: kasir-nova`, public `dist/hosting`, rewrite `/api/**` **sebelum** fallback SPA, header keamanan + cache |
| `scripts/build-hosting.mjs` | salin 3 app ke `dist/hosting` & suntik `NOVA_API_BASE` (kosong = same-origin) |
| `apps/<app>/config.js` | default dev (`NOVA_API_BASE` kosong = origin sama) |
| `.firebaserc` | lokal (di-`.gitignore`), berisi `kasir-nova` |

`dist/hosting` **tidak** di-commit (output build).

## 3. Build + deploy

```powershell
# A) Bangun aset (same-origin — rekomendasi: /api/** di-rewrite oleh Hosting)
node scripts/build-hosting.mjs

#    A-alt) Cross-origin (backend HTTPS absolut) — opsional:
#    node scripts/build-hosting.mjs https://<URL-BACKEND>

# B) Deploy (butuh login: firebase login sekali)
firebase use kasir-nova
firebase deploy --only hosting
```

> **Penting:** sebelum deploy dengan `firebase.json` yang memakai rewrite
> `/api/**`, ganti nilai `destination` placeholder
> (`https://GANTI-DENGAN-CLOUD-RUN-URL/api/**`) dengan URL backend final.
> Bila URL backend belum ada, buang dulu rewrite `/api/**` agar tidak mem-proxy
> ke host tak dikenal.

Header keamanan otomatis dipasang: `X-Content-Type-Options`, `X-Frame-Options:
DENY`, `Referrer-Policy: no-referrer`; cache 1 jam untuk JS/CSS, `no-cache`
untuk `index.html`.

## 4. Backend HTTPS (Cloud Run) — bukan Cloudflare

Backend Express + PostgreSQL di-deploy ke **Cloud Run + Cloud SQL** (lihat
`docs/21-deploy-backend-cloud-run.md`). Setelah URL Cloud Run didapat:

```powershell
# arahkan rewrite /api/** ke URL Cloud Run
#   "destination": "https://<service>-<hash>-uc.a.run.app/api/**"
node scripts/build-hosting.mjs
firebase deploy --only hosting
```

> ❌ **Jangan** memakai Cloudflare (tunnel/`trycloudflare`) sebagai proxy, DNS,
> hosting, atau dependency deploy. Keputusan pemilik: Cloudflare tidak dipakai.

## 5. CORS backend

Dengan strategi **same-origin** (`/api/**` di-rewrite oleh Hosting), browser
memanggil origin yang sama (`kasir-nova.web.app`) sehingga **CORS tidak wajib**.
Tetap isi `CORS_ORIGIN` untuk skenario cross-origin / dev:

```ini
CORS_ORIGIN=http://localhost:5173,http://localhost:5174,http://localhost:5175,https://kasir-nova.web.app
```

Lalu restart server. Preflight (`OPTIONS`) harus membalas **204** dengan
`Access-Control-Allow-Origin` = origin site.

## 6. Batasan Firebase Hosting (Spark vs Blaze)

| Batas | Spark (gratis) |
|---|---|
| Storage | 10 GB |
| Transfer/bulan | 360 MB |
| Requests | 10.000/hari |
| **Deploy/hari per site** | **10** |

3 app kita total < 1 MB — sangat cukup. Yang perlu dijaga hanya
**10 deploy/hari** saat eksperimen.

> ⚠️ **Perlu verifikasi:** rewrite `/api/**` ke **URL eksternal** (di luar
> Firebase/Google Cloud) dapat dibatasi pada paket **Spark** dan umumnya
> **memerlukan paket Blaze**. Sebelum mengandalkan jalur ini untuk produksi,
> konfirmasi status paket project `kasir-nova` di Firebase Console → Usage & billing.

## 7. Yang sudah diverifikasi

**11 Okt 2026 (hosting, via tunnel sementara):**
- `/kasir`, `/admin`, `/owner` → 200 + judul benar.
- Preflight CORS dari `https://kasir-nova.web.app` → **204**.
- Login admin → 200 (`role=platform_admin`); baca audit log → 200 (`total=146`).

**12 Okt 2026 (integrasi same-origin lokal, Cloudflare dinonaktifkan):**
- Suite tes backend **157/157 lulus** (`npm test`, PostgreSQL 16.1 port 5433).
- `GET /api/health` same-origin → `{status:"ok", db:"up"}`.
- `GET /admin/` disajikan dari origin yang sama → **200** (membuktikan jalur
  same-origin `/api` + statis).
- `firebase.json` tidak lagi memuat dependency Cloudflare; `scripts/build-hosting.mjs`
  mendukung base kosong (same-origin) & URL absolut (cross-origin).

## 8. Yang masih menyusul

- **Deploy backend tetap** (Cloud Run + Cloud SQL) → lihat `docs/21-deploy-backend-cloud-run.md`.
  Saat ini **BLOCKED**: butuh `gcloud` + **billing GCP aktif** (persetujuan pemilik).
- **Ganti placeholder** `https://GANTI-DENGAN-CLOUD-RUN-URL/api/**` dengan URL Cloud Run final.
- **Secrets produksi** (JWT & DB) — pakai Secret Manager, bukan nilai `dev_`.
- CSP ketat untuk site statis (bergantung URL backend final).
