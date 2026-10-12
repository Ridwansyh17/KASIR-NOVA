# KASIR NOVA — Deploy Firebase Hosting (1 site: kasir-nova)

> **Status frontend: SUDAH TER-DEPLOY** (11 Okt 2026) ke `https://kasir-nova.web.app`
> — project `kasir-nova`, site `kasir-nova`.
>
> **Status integrasi backend: 12 Okt 2026** — Keputusan pemilik: **tetap gratis
> (Spark), tanpa backend publik**. Jalur same-origin sudah diuji **lokal**
> (159/159 tes lulus); `firebase.json` **tidak** memuat rewrite `/api/**` agar
> hosting tetap valid di Spark. Cloudflare **dinonaktifkan**.
>
> Keputusan pemilik: distribusi **web via Firebase Hosting**, **bukan APK**.

## 1. Arsitektur

```
https://kasir-nova.web.app  (Firebase Hosting — statis)
   /kasir/**   → apps/kasir   (POS)
   /admin/**   → apps/admin   (Panel Admin Platform)
   /owner/**   → apps/owner   (Panel Owner)
   /           → 301 /kasir
```

- **1 site, 3 subpath** (site `kasir-nova`; hemat kuota deploy harian).
- Saat ini **tanpa backend publik** (paket Spark). Hosting hanya menyajikan statis.
- **Rencana same-origin (bila backend ditambahkan, butuh paket Blaze):**
  `window.NOVA_API_BASE = ''` → frontend memanggil `/api/...` di origin yang
  sama → Firebase Hosting meneruskan ke **Cloud Run** lewat blok `run`
  (lihat bagian 4). Kelebihan: **tanpa CORS**, tanpa URL backend di frontend.
- **Alternatif (cross-origin, tanpa Blaze):** isi `NOVA_API_BASE` dengan URL
  backend HTTPS absolut + tambahkan origin site ke `CORS_ORIGIN`. Didukung
  `build-hosting.mjs` (lihat `docs/21`).
- **Cloudflare TIDAK dipakai** (bukan proxy/hosting/DNS/dependency deploy).

> ⚠️ **Penting (jebakan):** `rewrites[].destination` di Firebase Hosting **hanya**
> boleh berupa **berkas lokal yang ada** — **bukan URL eksternal**. Menulis
> `"destination": "https://..."` adalah **salah**. Untuk backend gunakan blok
> `"run"` (Cloud Run) atau `"function"` (Cloud Functions).

## 2. Berkas pendukung deploy

| Berkas | Isi |
|---|---|
| `firebase.json` | `site: kasir-nova`, public `dist/hosting`, rewrite subpath SPA, header keamanan + cache (tanpa `/api/**` saat ini) |
| `scripts/build-hosting.mjs` | salin 3 app ke `dist/hosting` & suntik `NOVA_API_BASE` (kosong = same-origin) |
| `apps/<app>/config.js` | default dev (`NOVA_API_BASE` kosong = origin sama) |
| `.firebaserc` | lokal (di-`.gitignore`), berisi `kasir-nova` |

`dist/hosting` **tidak** di-commit (output build).

## 3. Build + deploy

```powershell
# A) Bangun aset statis
node scripts/build-hosting.mjs

#    (opsional) Cross-origin ke backend HTTPS absolut:
#    node scripts/build-hosting.mjs https://<URL-BACKEND>

# B) Deploy (butuh login: firebase login sekali)
firebase use kasir-nova
firebase deploy --only hosting
```

> `build-hosting.mjs` tanpa argumen menghasilkan `NOVA_API_BASE = ''`
> (same-origin). Ini hanya berguna bila ada backend yang menerima `/api/**`.

Header keamanan otomatis dipasang: `X-Content-Type-Options`, `X-Frame-Options:
DENY`, `Referrer-Policy: no-referrer`; cache 1 jam untuk JS/CSS, `no-cache`
untuk `index.html`.

## 4. Backend HTTPS (Cloud Run) — bukan Cloudflare

Backend Express + PostgreSQL dapat di-deploy ke **Cloud Run + Cloud SQL**
(runbook: `docs/21-deploy-backend-cloud-run.md`). **Wajib paket Blaze**
(Cloud Run berbayar + integrasi Hosting).

Hubungkan Hosting → Cloud Run dengan blok `run` (same-origin, **bukan** URL
eksternal di `destination`):

```json
"rewrites": [
  { "source": "/api/**", "run": { "serviceId": "nova-server", "region": "us-central1" } },
  { "source": "/admin/**", "destination": "/admin/index.html" },
  { "source": "/owner/**", "destination": "/owner/index.html" },
  { "source": "/kasir/**", "destination": "/kasir/index.html" }
]
```

- `source: /api/**` **harus di urutan pertama** (aturan pertama yang cocok menang).
- Service Cloud Run harus berada di **project yang sama** dengan Hosting.
- Metode yang didukung: `GET/POST/HEAD/PUT/DELETE/PATCH/OPTIONS`.
- Lalu: `node scripts/build-hosting.mjs` dan `firebase deploy --only hosting`.

> ❌ **Jangan** memakai Cloudflare (tunnel/`trycloudflare`) sebagai proxy, DNS,
> hosting, atau dependency deploy. Keputusan pemilik: Cloudflare tidak dipakai.
>
> ❌ **Jangan** menaruh URL eksternal di `rewrites[].destination` — tidak didukung.

## 5. CORS backend

Dengan integrasi `run` (**same-origin**) browser memanggil origin yang sama
(`kasir-nova.web.app`) sehingga **CORS tidak wajib**. Tetap isi `CORS_ORIGIN`
untuk skenario cross-origin / dev:

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

> ⚠️ Integrasi Hosting → **Cloud Run** (`run`) dan **Cloud Functions**
> (`function`) **memerlukan paket Blaze**. Paket **Spark tidak mendukung**
> backend dinamis dari Hosting. Karena itu, pada mode **Spark (keputusan saat
> ini) tidak ada rewrite `/api/**`** dan backend diuji **lokal** saja.

## 7. Yang sudah diverifikasi

**11 Okt 2026 (hosting, via tunnel sementara):**
- `/kasir`, `/admin`, `/owner` → 200 + judul benar.
- Preflight CORS dari `https://kasir-nova.web.app` → **204**.
- Login admin → 200 (`role=platform_admin`); baca audit log → 200 (`total=146`).

**12 Okt 2026 (integrasi same-origin lokal, Cloudflare dinonaktifkan):**
- Suite tes backend **159/159 lulus** (`npm test`, PostgreSQL 16.1 port 5433).
- `GET /api/health` same-origin → `{status:"ok", db:"up"}`.
- `GET /admin/` disajikan dari origin yang sama → **200** (membuktikan jalur
  same-origin `/api` + statis).
- `firebase.json` tidak lagi memuat dependency Cloudflare; `scripts/build-hosting.mjs`
  mendukung base kosong (same-origin) & URL absolut (cross-origin).

## 8. Yang masih menyusul

- **Keputusan 12 Okt 2026: tetap paket Spark — tanpa backend publik.**
  Karena itu `firebase.json` **tidak** memuat rewrite `/api/**` (integrasi
  `run`/`function` butuh Blaze). Frontend live tetap statis seperti sekarang.
- Bila kelak memilih Blaze: ikuti `docs/21-deploy-backend-cloud-run.md`, lalu
  tambahkan rewrite `run` (bagian 4 di atas).
- **Secrets produksi** (JWT & DB) — pakai Secret Manager, bukan nilai `dev_`.
- CSP ketat untuk site statis (bergantung URL backend final).
