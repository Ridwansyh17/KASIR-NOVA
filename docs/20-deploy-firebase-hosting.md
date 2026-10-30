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
>
> **Perbaikan 17 Okt 2026:** pernah ter-deploy dengan `NOVA_API_BASE` **kosong**
> sehingga panel Admin/Owner web menembak `/api/**` di origin Hosting → **404**.
> Default `scripts/build-hosting.mjs` kini URL backend produksi; root `/` menjadi
> beranda pemilih panel + halaman 404 bergaya KASIR NOVA. Rincian di §7.

## 1. Arsitektur

```
https://kasir-nova.web.app  (Firebase Hosting — statis)
   /kasir/**   → apps/kasir   (POS)
   /admin/**   → apps/admin   (Panel Admin Platform)
   /owner/**   → apps/owner   (Panel Owner)
   /           → index.html   (beranda: pemilih panel)
   path lain   → 404.html     (halaman 404 KASIR NOVA, status 404)
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
| `scripts/build-hosting.mjs` | salin 3 app ke `dist/hosting`, tulis beranda + 404, dan suntik `NOVA_API_BASE` (**default URL backend produksi**; `--same-origin` untuk base kosong) |
| `scripts/hosting-landing.html` | sumber beranda root (`/`) — panel login Kasir/Owner/Admin, CTA **Daftar Gratis** (`/owner/?daftar=1`), harga paket (bulanan/tahunan → WhatsApp), fitur unggulan, dan kontak |
| `scripts/hosting-404.html` | sumber halaman 404 (disajikan Firebase untuk path tak dikenal, status 404) |
| `apps/<app>/config.js` | default dev (`NOVA_API_BASE` kosong = origin sama) |
| `.firebaserc` | lokal (di-`.gitignore`), berisi `kasir-nova` |

`dist/hosting` **tidak** di-commit (output build).

## 3. Build + deploy

```powershell
# A) Bangun aset statis (default: base API = backend produksi Vercel)
node scripts/build-hosting.mjs

#    (opsional) backend HTTPS lain:
#    node scripts/build-hosting.mjs https://<URL-BACKEND>

#    (khusus dev) base kosong = same-origin; origin HARUS melayani /api/**
#    node scripts/build-hosting.mjs --same-origin

# B) Deploy (butuh login: firebase login sekali)
firebase use kasir-nova
firebase deploy --only hosting
```

> ⚠️ **Jangan deploy Hosting dengan `NOVA_API_BASE` kosong.** `firebase.json`
> tidak memuat rewrite `/api/**` (butuh paket Blaze), sehingga base kosong
> membuat seluruh panel web menembak `https://kasir-nova.web.app/api/**` →
> **404 "Page Not Found"**. Karena itu default `build-hosting.mjs` adalah URL
> backend produksi; same-origin harus diminta eksplisit dan memicu peringatan.
> Dijaga otomatis oleh `scripts/verify-ui.mjs` (menolak base kosong) dan langkah
> **26b** `scripts/e2e-online.mjs` di produksi.

Pendaftaran Owner kini memakai persetujuan Admin (bukan halaman verifikasi
email), sehingga tidak ada rewrite khusus `/owner/verify-email`. Semua path
`/owner/**` dilayani panel Owner utama.

## 3b. Beranda root & halaman 404

- `/` menyajikan `dist/hosting/index.html` — **beranda publik** dengan aset
  brand di `/assets/**` (disalin dari `apps/kasir/assets`): panel login Kasir,
  Owner, dan Admin Platform + CTA pendaftaran Owner; daftar harga paket yang dapat diganti
  bulanan/tahunan (tombol membuka WhatsApp); delapan fitur unggulan; serta
  panel kontak. Halaman ini **hanya tampilan** — tidak memanggil API dan tidak
  mengubah autentikasi. Tidak ada lagi redirect `301 → /kasir`.
- Halaman beranda diuji otomatis oleh `scripts/test-landing.mjs`
  (`npm run test:landing`, 173 pemeriksaan: struktur, routing tiga panel, cara mendaftar,
  pesan WhatsApp tiap paket/periode, tanpa panggilan jaringan, dan audit tata
  letak responsif).
- Path yang tidak ada disajikan `dist/hosting/404.html` dengan **status 404**
  (bukan halaman "Page Not Found" bawaan Firebase). Halaman ini menampilkan path
  yang salah dan menautkan ketiga panel.
- Kedua halaman sengaja mandiri (CSS inline, tanpa dependensi) dan memakai path
  **absolut** `/assets/...` agar tetap benar walau disajikan pada path lain.

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

**17 Okt 2026 (perbaikan 404 panel web — regresi base API):**
- Gejala: panel **Admin/Owner** web terbuka tetapi login/data gagal (**HTTP 404**).
- Akar masalah: `dist/hosting` di-build **tanpa argumen** sehingga `NOVA_API_BASE`
  ter-deploy **kosong** → `kasir-nova.web.app/api/**` → 404 "Page Not Found".
- Perbaikan: default build = URL backend produksi; beranda root + halaman 404;
  kunci regresi di `verify-ui.mjs` (base wajib absolut) & `e2e-online.mjs` langkah 26b.
- Verifikasi produksi setelah deploy: `/` **200** (judul "KASIR NOVA — Pilih Panel",
  menautkan ketiga panel); `/admin/`, `/owner/`, `/kasir/` **200**;
  `config.js` ketiga app = `https://kasir-nova.vercel.app`;
  `/Admin`, `/dashboard`, `/login` → **404** halaman KASIR NOVA
  (judul "Halaman tidak ditemukan — KASIR NOVA"); `/assets/logo-kasir-nova.png` **200**;
  preflight CORS dari origin Hosting **204**; login owner & admin cross-origin **200**.
- Suite: `qa:local` semua tahap **LULUS** (server 248/248, UI `SEMUA OK`,
  auth 10/10, image 9/9); `e2e:online` **34/34 PASS**.

**17 Okt 2026 (hosting: ekspor Excel + nomor halaman cetak laporan Owner):**
- Deploy **hosting saja** (backend tidak berubah): `node scripts/build-hosting.mjs
  https://kasir-nova.vercel.app` lalu `firebase deploy --only hosting --project
  kasir-nova` → 49 berkas, unggahan baru 3 berkas (modul `report-print.js`,
  `app.js`, `styles.css`).
- Verifikasi produksi: `/owner/src/report-print.js` **200** (13.350 byte, memuat
  `planPrintPages` + `rowsFirstPage: 21`); `/owner/styles/styles.css` **200**
  (memuat `break-before: page`); `/owner/src/app.js` **200** (impor
  `./report-print.js`); `/owner/` **200** (tombol `#rep-print-btn` + `#print-report`);
  JS/CSS `cache-control: no-cache`; Chrome headless `/owner/` menampilkan
  `#login-view` **tanpa** `hidden` (berarti seluruh modul ES termuat, panel tidak
  blank). Rincian fitur & pengujian: `docs/35` §5b/§5c/§7.

**17 Okt 2026 (hosting: Laporan Transaksi untuk Kasir):**
- Izin pemilik: deploy **backend + hosting**. Backend dari **root repo**
  (`npx.cmd vercel deploy --prod --yes`) karena ada rute baru; rincian di `docs/24`.
- Hosting: `node scripts/build-hosting.mjs https://kasir-nova.vercel.app` lalu
  `firebase deploy --only hosting --project kasir-nova` → 49 berkas, unggahan baru
  **4 berkas** (`apps/kasir/index.html`, `src/app.js`, `src/api.js`,
  `src/struk-share.js`).
- Verifikasi produksi: `/kasir/` **200** (34.422 byte; memuat `data-pane="laporan"`,
  `data-tab="laporan"`, `#lap-export-btn`, `#lap-body`); `/kasir/src/app.js` **200**
  (81.678 byte; `loadReportTransactions`, `strukShare.saveXlsx(`,
  `laporan: ['Laporan Transaksi'`); `/kasir/src/api.js` **200** (12.582 byte;
  `transactionsReportFile`, path `/reports/transactions/export`); `/kasir/src/struk-share.js`
  **200** (8.995 byte; `saveXlsx`, `downloadFile`, `XLSX_MIME`, dan pola rusak
  `new root().` **sudah tidak ada**); semua JS/HTML `cache-control: no-cache`;
  Chrome headless `/kasir/` menampilkan `#login-view` **tanpa** `hidden`.
- Backend produksi: `/api/health` **200** (`database: up`); rute baru
  `/api/cashier/reports/transactions` dan `/reports/transactions/export` → **401**
  (ada, hanya butuh sesi) sedangkan rute **tidak ada** → **404**
  (`/api/cashier/zzz-tidak-ada`) — jadi keberadaan rute terbukti walau tanpa token.
- Rincian fitur & pengujian: `docs/37-laporan-transaksi-kasir.md`.

### Rilis 17 Okt 2026 (lanjutan 3) — Pembayaran langganan + kode QR QRIS

Izin pemilik: hosting di-deploy agar panel Owner memuat tombol **Bayar /
Perpanjang** dan **gambar QR QRIS**. `firebase.cmd deploy --only hosting
--project kasir-nova` → **51 berkas**, unggahan baru **6 berkas** (termasuk
`owner/src/qr-code.js` 5.402 byte dan `owner/src/vendor/qrcode-generator.js`
56.694 byte).

| Uji | Hasil |
|---|---|
| `/owner/` | **200** (46.772 byte) memuat `id="pay-modal"`, `id="pay-qr-img"`, `id="sub-pay-btn"`, `id="sub-invoice-body"`, `src="./src/qr-code.js"`, `src="./src/vendor/qrcode-generator.js"` |
| `/owner/src/qr-code.js` | **200**, **byte-identik** dengan `shared/qr-code.js` |
| `/owner/src/vendor/qrcode-generator.js` | **200**, **byte-identik** dengan sumber kanonik; header **MIT** (`Kazuhiko Arase`) utuh |
| `/owner/_qr-check.html` | bukan berkas ter-deploy — jalur tak dikenal dilayani `rewrites /owner/** → /owner/index.html` (harness sementara tidak pernah diunggah) |
| Rute backend baru | `/api/payments/duitku/callback` → **503** (`gateway_belum_dikonfigurasi`, aman) dan `/api/owner/.../subscription/plans` → **401** |
| E2E online produksi | **29/29 PASS** |

> Rincian fitur & hasil uji: `docs/38-pembayaran-langganan-gateway.md`
> (termasuk bukti QR dapat dipindai: decoder independen jsQR 5/5).

## 8. Yang masih menyusul

- **Keputusan 12 Okt 2026: tetap paket Spark — tanpa backend publik.**
  Karena itu `firebase.json` **tidak** memuat rewrite `/api/**` (integrasi
  `run`/`function` butuh Blaze). Frontend live tetap statis seperti sekarang.
- Bila kelak memilih Blaze: ikuti `docs/21-deploy-backend-cloud-run.md`, lalu
  tambahkan rewrite `run` (bagian 4 di atas).
- **Secrets produksi** (JWT & DB) — pakai Secret Manager, bukan nilai `dev_`.
- CSP ketat untuk site statis (bergantung URL backend final).
