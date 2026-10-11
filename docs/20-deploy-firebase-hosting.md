# KASIR NOVA — Deploy Firebase Hosting (1 site: kasir-nova)

> **Status: SUDAH TER-DEPLOY** (11 Okt 2026) ke
> `https://kasir-nova.web.app` — project `kasir-nova`, site default.
>
> Keputusan pemilik: distribusi **web via Firebase Hosting**, **bukan APK**.

## 1. Arsitektur final

```
https://kasir-nova.web.app  (Firebase Hosting — statis)
   /kasir/**   → apps/kasir   (POS)
   /admin/**   → apps/admin   (Panel Admin Platform)
   /owner/**   → apps/owner   (Panel Owner)
   /           → 301 /kasir
        │  fetch window.NOVA_API_BASE (HTTPS + CORS)
        ▼
   Backend Node.js + PostgreSQL (host tetap menyusul;
   saat ini diuji via tunnel cloudflared ke localhost:4000)
```

- **1 site, 3 subpath** (site default `kasir-nova`; hemat kuota deploy harian).
- Firebase Hosting **hanya** menyajikan statis; API & DB **tidak** di sini.
- Frontend menghubungi backend via `NOVA_API_BASE`; backend mengizinkan origin
  site di `CORS_ORIGIN`.

## 2. Berkas pendukung deploy

| Berkas | Isi |
|---|---|
| `firebase.json` | public `dist/hosting` + rewrite per subpath + header keamanan + cache |
| `scripts/build-hosting.mjs` | salin 3 app ke `dist/hosting` & suntik `NOVA_API_BASE` produksi |
| `apps/<app>/config.js` | default dev (`NOVA_API_BASE` kosong = origin sama) |
| `.firebaserc` | lokal (di-`.gitignore`), berisi `kasir-nova` |

`dist/hosting` **tidak** di-commit (output build).

## 3. Build + deploy

```powershell
# A) Bangun aset dengan URL backend (wajib HTTPS)
node scripts/build-hosting.mjs https://<URL-BACKEND>

# B) Deploy (butuh login: firebase login sekali)
firebase use kasir-nova
firebase deploy --only hosting
```

Header keamanan otomatis dipasang: `X-Content-Type-Options`, `X-Frame-Options:
DENY`, `Referrer-Policy: no-referrer`; cache 1 jam untuk JS/CSS, `no-cache`
untuk `index.html`.

## 4. Tunnel backend untuk uji (cloudflared)

Backend lokal diterbitkan sementara tanpa server:

```powershell
cloudflared tunnel --url http://localhost:4000 --no-autoupdate
# ambil URL https://<nama>.trycloudflare.com, tambahkan ke CORS_ORIGIN, lalu
# build ulang dengan URL itu.
```

Catatan: URL `trycloudflare` **berubah setiap restart** — cocok untuk uji,
bukan produksi.

## 5. CORS backend

Tambahkan origin Firebase ke `server/.env`:

```ini
CORS_ORIGIN=http://localhost:5173,http://localhost:5174,http://localhost:5175,https://kasir-nova.web.app
```

Lalu restart server. Preflight (`OPTIONS`) harus membalas **204** dengan
`Access-Control-Allow-Origin` = origin site.

## 6. Batasan Firebase Hosting (Spark)

| Batas | Spark (gratis) |
|---|---|
| Storage | 10 GB |
| Transfer/bulan | 360 MB |
| Requests | 10.000/hari |
| **Deploy/hari per site** | **10** |

3 app kita total < 1 MB — sangat cukup. Yang perlu dijaga hanya
**10 deploy/hari** saat eksperimen.

## 7. Yang sudah diverifikasi (11 Okt 2026)

- `/kasir`, `/admin`, `/owner` → 200 + judul benar.
- Preflight CORS dari `https://kasir-nova.web.app` → **204**.
- Login admin via tunnel → 200 (`role=platform_admin`).
- Baca audit log via tunnel → 200 (`total=146`).

## 8. Yang masih menyusul

- **Host backend tetap** (Cloud Run / VPS) — URL `trycloudflare` sementara;
  setelah tetap, build ulang bagian A dengan URL itu.
- **Secrets produksi** (JWT & DB) — saat ini masih pakai nilai `dev_`.
- CSP ketat untuk site statis (bergantung URL backend final).
