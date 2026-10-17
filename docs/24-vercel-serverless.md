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

> ⚠️ **Jangan deploy Hosting dengan `NOVA_API_BASE` kosong.** Karena `/api/**`
> tidak di-rewrite, base kosong membuat frontend memanggil
> `https://kasir-nova.web.app/api/**` → **404**. Ini sempat terjadi (produksi
> keliru same-origin) dan **diperbaiki 13 Okt 2026** dengan men-deploy ulang
> memakai `node scripts/build-hosting.mjs https://kasir-nova.vercel.app`.
>
> **Terulang & ditutup permanen 17 Okt 2026.** Penyebab: build dijalankan
> `node scripts/build-hosting.mjs` **tanpa argumen** (default lama = base kosong),
> lalu di-deploy → panel Admin/Owner web 404. Pencegahan sekarang **tiga lapis**:
> 1. Default `scripts/build-hosting.mjs` = `https://kasir-nova.vercel.app`;
>    same-origin harus eksplisit `--same-origin` (memunculkan peringatan).
> 2. `scripts/verify-ui.mjs` **GAGAL** bila `NOVA_API_BASE` bundel Hosting
>    kosong/relatif (dicek untuk ketiga app).
> 3. `scripts/e2e-online.mjs` langkah **26b** memeriksa di produksi bahwa base
>    absolut dan beranda `/` menyajikan pemilih panel.
>
> Jalur aman: `node scripts/build-hosting.mjs` → `firebase deploy --only hosting`.

---

## Status pembaruan (16 Okt 2026) — penting

**Gejala yang dilaporkan pemilik:** tombol **Simpan Produk** dan **Tambah
Pengeluaran** di aplikasi Kasir tidak menyimpan apa pun.

**Akar masalah (bukan bug kode):** backend produksi Vercel **masih versi lama**.
Hasil pemeriksaan rute produksi sebelum deploy:

| Permintaan | Sebelum | Sesudah deploy |
|---|---|---|
| `GET /api/cashier/products` | 401 | 401 |
| `POST /api/cashier/products` | **404** | 401 → **201** (terverifikasi) |
| `GET/POST /api/cashier/expenses` | **404** | 401 → **201** (terverifikasi) |
| `GET /api/cashier/me` | 404 | 401 |
| `GET /api/cashier/reports/daily` | 404 | 401 |

Artinya: kode `server/` sudah benar (rute ada), tetapi **belum pernah
di-deploy** ke Vercel setelah Fase 1/2 & 5 ditambahkan. Karena itu tombol
menembak alamat yang belum ada → 404 → data tidak tersimpan.

**Tindakan:** `npx vercel deploy --prod --yes` (16 Okt 2026, CLI login akun
pemilik). Produksi: https://kasir-nova.vercel.app

**Verifikasi setelah deploy:**
- E2E online produksi `scripts/e2e-online.mjs` → **28/28 PASS** (termasuk 2
  langkah regresi baru: Kasir menyimpan produk & menambah pengeluaran, lalu
  dibersihkan).
- `/api/health` → `database: up`.
- CORS: `Origin: https://localhost` (APK) & `https://kasir-nova.web.app` → 200;
  preflight `OPTIONS` POST → 204.

> **Pelajaran operasional:** setiap perubahan `server/` **wajib** diikuti
> `vercel deploy --prod` sebelum dinyatakan selesai. Fitur yang hanya lulus tes
> lokal belum tentu aktif di produksi.

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
# WAJIB dijalankan dari ROOT repo (proyek Vercel `kasir-nova`), bukan dari server/
npx.cmd vercel deploy --prod --yes --token <VERCEL_TOKEN>
```
(Database Neon tidak berubah; connection string tersimpan sebagai env `DATABASE_URL` di Vercel.)

## Deploy 17 Okt 2026 — Laporan Transaksi + perbaikan omzet tunai (izin pemilik)

Dijalankan berturut-turut (izin pemilik: "Deploy backend + hosting sekarang"):

```powershell
# 1. Backend (server/) -> https://kasir-nova.vercel.app
npx.cmd vercel deploy --prod --yes
# 2. Frontend panel -> Firebase Hosting
node scripts/build-hosting.mjs https://kasir-nova.vercel.app
node <firebase-tools>/lib/bin/firebase.js deploy --only hosting --project kasir-nova
```

**Isi rilis:**

- Endpoint baru `GET /api/owner/businesses/:id/reports/transactions` (Laporan
  Transaksi siap-cetak) + halaman cetak di panel Owner (`#print-report`).
- Tombol **struk PDF** (kirim/simpan/cetak) di panel web Kasir
  (`apps/kasir/src/{receipt-pdf,struk-share}.js` — sebelumnya hanya ada di APK).
- **Perbaikan omzet tunai** pada laporan keuangan: agregat per metode & per outlet
  memakai `SUM(transactions.total)` (omzet), bukan `payments.amount` (uang
  diterima termasuk kembalian) — lihat `docs/35` §9.

**Verifikasi setelah deploy (17 Okt 2026):**

| Uji | Hasil |
|---|---|
| `GET /api/health` produksi | ✅ `status: ok`, `services.database: up` |
| Rute baru `…/reports/transactions` tanpa token | ✅ **401** (rute ada & menuntut autentikasi; sebelumnya 404 belum dirilis) |
| `GET …/reports/finance` tanpa token | ✅ 401 |
| CORS APK `Origin: https://localhost` | ✅ 200 + `Access-Control-Allow-Origin: https://localhost` |
| Preflight web `OPTIONS` rute baru (Origin `https://kasir-nova.web.app`) | ✅ 204 + allow-origin sesuai |
| Hosting: `/` `/kasir/` `/owner/` `/admin/` | ✅ 200 |
| Hosting memuat berkas baru `kasir/src/{struk-share,receipt-pdf}.js` | ✅ 200 |
| `owner/src/api.js` di hosting memuat `reports/transactions` | ✅ ada |
| `scripts/qa-local.ps1` (lokal, sebelum deploy) | ✅ **SEMUA TAHAP LULUS** — backend **266/266**, verify-ui OK |

> Catatan: uji fungsional laporan **dengan sesi Owner nyata** di produksi belum
> dijalankan agen (tidak memegang kredensial produksi) — cukup bukti rute hidup
> (401) + halaman tersaji (200) + suite lokal 266/266. Uji cetak di peramban =
> pekerjaan pemilik.

### Insiden 17 Okt 2026 — panel Owner **blank putih** (dilaporkan pemilik)

**Gejala:** pemilik melaporkan panel Owner tampil **blank putih** setelah deploy.

**Penyebab (terverifikasi):** `apps/owner/src/app.js` memuat **blok duplikat**
(3 baris `renderReport(...)` + `loadOutletComparison(...)` + `};` tersalin dua
kali) sehingga ada **kurung kurawal berlebih** → `SyntaxError: Unexpected token '}'` (baris
1707) → **seluruh modul gagal dimuat** → `#login-view` tetap ber-class `hidden`
(HTML-nya sendiri valid, jadi halaman tampak putih polos).
Pemeriksa statis lama (`verify-ui`) hanya memeriksa rujukan aset/id, sehingga
**tidak menangkap** galat sintaks seperti ini.

**Bukti diagnosis:** berkas `app.js` yang tersaji di Hosting diunduh lalu
`node --check` → **GAGAL** (baris 1707), sementara panel Kasir & Admin **OK**.
DOM nyata diperiksa dengan Chrome headless `--dump-dom`:
`/kasir/` & `/admin/` → `#login-view` **tanpa** `hidden` (JS jalan);
`/owner/` → masih `hidden` (JS gagal).

**Perbaikan:** blok duplikat dihapus (modul kembali ukuran wajar), lalu
`build-hosting` + `firebase deploy --only hosting` diulang.

**Pencegahan (kunci regresi baru):** `scripts/verify-ui.mjs` kini memeriksa
**sintaks setiap berkas `apps/<panel>/src/*.js`** dengan `node --check` (disalin
ke `.mjs` agar memakai semantik modul) — 14 berkas. Dibuktikan bekerja: menambah
`}` liar pada `apps/admin/src/app.js` membuat pemeriksa **GAGAL** menyebut
`apps/admin/src/app.js` + barisnya, dan kembali `SEMUA OK` setelah dikembalikan.
`scripts/qa-local.ps1` menjalankan pemeriksa ini pada tahap 3.

**Verifikasi setelah deploy ulang (17 Okt 2026):**

| Uji | Hasil |
|---|---|
| Chrome headless `--dump-dom /owner/` (profil baru, tanpa cache) | ✅ `#login-view` **tampil** (JS jalan) |
| Chrome headless `/kasir/` & `/admin/` | ✅ tampil |
| `node --check` atas `owner/src/app.js` yang tersaji di Hosting | ✅ OK |
| `scripts/verify-ui.mjs` (termasuk cek sintaks 14 berkas) | ✅ SEMUA OK |
| `scripts/qa-local.ps1` | ✅ SEMUA TAHAP LULUS (backend 266/266) |
| **Konfirmasi pemilik** | ✅ **"sudah bisa"** (17 Okt 2026) — panel Owner tampil normal di perangkat pemilik |

> **Catatan cache (sudah diperbaiki 17 Okt 2026, izin pemilik):** sebelumnya
> `firebase.json` menyajikan `*.js`/`*.css` dengan
> `Cache-Control: public, max-age=3600`, sehingga peramban bisa masih memakai
> berkas lama **sampai ±1 jam** setelah deploy (inilah yang membuat panel Owner
> tetap putih walau sudah dideploy ulang). Kini `**/*.@(js|css)` di
> `firebase.json` memakai **`Cache-Control: no-cache`** — peramban tetap
> merevalidasi lewat ETag (jawaban `304` murah), jadi setelah setiap deploy
> pengguna **langsung** mendapat kode terbaru. Dokumen HTML (`/`, `/kasir/`,
> `/owner/`, `/admin/`, `**/index.html`, `/404.html`) sudah `no-cache` sejak
> sebelumnya. Verifikasi: `GET /owner/src/app.js` & `/owner/styles/styles.css`
> → `cache-control: no-cache`; Chrome headless profil baru →
> `/owner/` `/kasir/` `/admin/` tampil.

## Deploy 17 Okt 2026 (lanjutan) — Ekspor Excel Laporan Transaksi (izin pemilik)

Pemilik menyetujui deploy setelah fitur "Ekspor Excel Laporan Transaksi" lulus
tes lokal (`server/tests/report-transactions.test.js` 8/8, suite penuh 268/268).

### Perintah yang BENAR (backend WAJIB dari ROOT repo)

```powershell
# dari ROOT repo (JANGAN dari folder server/)
npx.cmd vercel deploy --prod --yes              # -> https://kasir-nova.vercel.app
node scripts/build-hosting.mjs https://kasir-nova.vercel.app
node <firebase-tools>/lib/bin/firebase.js deploy --only hosting --project kasir-nova
```

Proyek Vercel produksi adalah **`kasir-nova`** (tautan `.vercel/` di **root
repo**; `vercel.json` root memakai `api/index.mjs`). Folder `server/` **tidak**
memiliki tautan produksi.

### Insiden 17 Okt 2026 — backend terdeploy ke proyek Vercel yang SALAH

Agen menjalankan `vercel deploy` **dari dalam `server/`** (tanpa tautan di situ),
sehingga CLI **membuat proyek baru bernama `server`** dan mendeploy ke sana.
Akibatnya **alias produksi tidak berubah** (masih build lama) walau CLI
melaporkan `READY`. Terdeteksi dari `vercel inspect kasir-nova.vercel.app`
(masih menunjuk deployment 56 menit sebelumnya) dan tidak adanya baris
`Aliased https://kasir-nova.vercel.app` pada keluaran deploy.

Perbaikan: deploy ulang **dari root repo** -> `Aliased https://kasir-nova.vercel.app`,
`readyState READY`, `target production` (`dpl_5fEYFLLm…`). Tautan salah
`server/.vercel` (lokal, gitignored) sudah **dihapus** agar tidak terulang.
**Proyek Vercel `server` yang tidak sengaja terbentuk masih ada** — penghapusan
(destruktif) menunggu persetujuan pemilik.

### Verifikasi sesudah deploy (17 Okt 2026)

| Uji | Hasil |
|---|---|
| `vercel inspect kasir-nova.vercel.app` | OK menunjuk `dpl_5fEYFLLm…` (baru dibuat) |
| `GET /api/health` produksi | OK `status: ok`, `services.database: up` |
| Hosting `/owner/index.html` memuat `id="rep-transactions-xlsx"` | OK ada |
| Hosting `/owner/src/app.js` memuat `downloadTransactionReportExcel` | OK ada |
| Hosting `/owner/src/api.js` memuat `/reports/transactions/export` | OK ada |
| Cache `owner/src/{app,api}.js` di Hosting | OK `cache-control: no-cache` |
| Chrome headless `--dump-dom /owner/` (profil baru) | OK `#login-view` tampil (tanpa `hidden`) + tombol ekspor ada di DOM |
| Suite lokal sebelum deploy | OK backend **268/268**, `verify:ui` **SEMUA OK** |

> **Batas verifikasi:** seluruh rute Owner dilindungi autentikasi sehingga
> permintaan **tanpa token selalu 401** (rute ada maupun tidak), dan agen tidak
> memegang kredensial produksi. Bukti yang tersedia: alias produksi menunjuk
> build baru dari *tree* yang lulus **268/268** tes HTTP nyata (termasuk ekspor
> Excel yang di-*parse* ulang dengan ExcelJS) + berkas Hosting memuat tombol/API
> barunya. **Uji klik tombol di panel Owner = pekerjaan pemilik.**
>
> **Koreksi 17 Okt 2026 (lihat bagian terakhir):** pernyataan "rute ada maupun
> tidak selalu 401" **keliru**. Router Express dipasang **sebelum** middleware
> autentikasi, jadi jalur yang **tidak dikenal** menghasilkan **404**, sedangkan
> jalur yang dikenal menghasilkan **401**. Keberadaan rute baru kini **dapat**
> dibuktikan tanpa token.

---

## Deploy 17 Okt 2026 (lanjutan 2) — Laporan Transaksi Kasir (izin pemilik)

Pemilik menyetujui deploy setelah fitur "Laporan untuk Kasir (A5a)" lulus tes
lokal (`server/tests/cashier-report-transactions.test.js` **10/10**, suite penuh
**291/291**, `verify:ui` SEMUA OK, `qa-local.ps1` semua tahap LULUS). Rebuild APK
(beta.9) oleh pemilik **ditunda** ("nanti saja").

### Perintah yang dijalankan (backend dari ROOT repo)

```powershell
# dari ROOT repo (bukan folder server/) — ada RUTE BARU di backend
npx.cmd vercel deploy --prod --yes              # -> https://kasir-nova.vercel.app
node scripts/build-hosting.mjs https://kasir-nova.vercel.app
node <firebase-tools>/lib/bin/firebase.js deploy --only hosting --project kasir-nova
```

CLI melaporkan `Deployment kasir-nova-i9m0qnrd5-kasir-nova.vercel.app ready.
Production URL: https://kasir-nova.vercel.app` (akses root repo ini membuat
pipeline PowerShell menampilkan *exit code 1* palsu; status sebenarnya sukses).
Hosting: 49 berkas, unggahan baru **4 berkas** (`apps/kasir/index.html`,
`src/app.js`, `src/api.js`, `src/struk-share.js`).

### Verifikasi sesudah deploy

| Uji | Hasil |
|---|---|
| `GET /api/health` produksi | OK `status: ok`, `services.database: up`, `uptime` ~20 s (build baru) |
| `GET /api/cashier/reports/transactions` (tanpa token) | **401** → rute **ada** |
| `GET /api/cashier/reports/transactions/export` (tanpa token) | **401** → rute **ada** |
| `GET /api/cashier/reports/daily` (rute lama, pembanding) | **401** → ada |
| `GET /api/cashier/zzz-tidak-ada` (kontrol negatif) | **404** → jalur tak dikenal memang 404 |
| Hosting `/kasir/` | OK 200 (34.422 byte) memuat `data-pane="laporan"`, `data-tab="laporan"`, `#lap-export-btn`, `#lap-body` |
| Hosting `/kasir/src/app.js` | OK 200 (81.678 byte) memuat `loadReportTransactions`, `strukShare.saveXlsx(`, `laporan: ['Laporan Transaksi'` |
| Hosting `/kasir/src/api.js` | OK 200 (12.582 byte) memuat `transactionsReportFile`, `/reports/transactions/export` |
| Hosting `/kasir/src/struk-share.js` | OK 200 (8.995 byte) memuat `saveXlsx`/`downloadFile`/`XLSX_MIME`; pola rusak `new root().` **sudah tidak ada** |
| Cache JS/HTML Hosting | OK `cache-control: no-cache` |
| Chrome headless `--dump-dom /kasir/` (profil baru) | OK `#login-view` tampil (tanpa `hidden`) → seluruh modul ES termuat, panel tidak blank |
| Suite lokal sebelum deploy | OK backend **291/291**, `verify:ui` SEMUA OK, `qa-local` 1/7–6/7 LULUS |

> **Yang masih pekerjaan pemilik:** klik tab **Laporan Transaksi** (rentang,
> filter status, pencarian), tekan **Ekspor Excel** lalu buka berkas `.xlsx`
> (3 sheet), dan — bila ingin di perangkat — setujui rebuild APK beta.9 agar
> panel kasir memuat JS baru.



