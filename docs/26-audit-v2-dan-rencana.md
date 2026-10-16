# Audit KASIR NOVA V2 & Rencana Implementasi

> **Status:** Audit FASE 0 selesai. Bug 1 (Persistent Login) dan Bug 2 (tombol
> Simpan Produk) sudah diperbaiki & teruji. FASE 1–3 dan FASE 6–7 menunggu
> keputusan pemilik proyek pada bagian **Keputusan yang Dibutuhkan**.
>
> Tanggal audit: 16 Oktober 2026. Branch kerja: `feat/kasir-nova-v2`.
> Acuan: `KASIR-NOVA-V3-REFERENSI-LENGKAP/` (86 mockup + brand),
> `AGENTS.md`, `docs/01`–`docs/25`.

---

## 1. Ringkasan Audit Awal

### Arsitektur aktual (TIDAK diubah)

| Lapisan | Teknologi | Lokasi |
|---|---|---|
| Frontend Admin | SPA vanilla JS (ESM, tanpa framework) | `apps/admin/` |
| Frontend Owner | SPA vanilla JS | `apps/owner/` |
| Frontend Kasir Desktop | SPA vanilla JS | `apps/kasir/` |
| Kasir Mobile (APK) | Capacitor membungkus `apps/kasir` | `apps/kasir-mobile/` |
| Backend | Express + PostgreSQL + Zod | `server/src/` |
| Auth | JWT access (pendek) + refresh token acak (SHA-256 di DB) | `server/src/modules/auth`, `server/src/utils/token.js` |
| Frontend hosting | Firebase Hosting (`kasir-nova`) | `.firebase/`, `dist/hosting` |
| Backend uji | Vercel (`https://kasir-nova.vercel.app`) | `api/`, `docs/24-vercel-serverless.md` |
| DB | DEV `localhost:5433/nova_kasir_dev`; PROD Neon (branch `production`) | `server/.env`, `.env` |

Ukuran berkas frontend utama: `apps/kasir/src/app.js` 51 KB, `apps/owner/src/app.js`
74 KB, `apps/admin/src/app.js` 29 KB. Ketiganya memakai pola identik untuk
login/boot sehingga perbaikan harus konsisten di tiga tempat.

### Audit area yang diminta

- **Autentikasi/sesi:** refresh token **rotasi sekali pakai** di server
  (`server/src/modules/auth/service.js:279-330`); logout mencabut satu token;
  `revokeAllSessions` tersedia untuk admin.
- **Produk & gambar:** `products.photo_url` menyimpan **data URL base64**
  (maks ≈280 KB, divalidasi di `server/src/modules/product/schema.js:24-33`).
  Belum ada object storage; klien mengecilkan gambar di canvas
  (`apps/owner/src/app.js:1138-1163`).
- **Transaksi/stok:** penjualan + pengurangan stok dalam satu transaksi DB
  (V0.3, `server/src/modules/transaction/`); `inventory_movements` append-only.
- **Printer:** `apps/kasir/src/printer.js` + `escpos.js` + plugin native
  `NovaPrinterPlugin.java` (Bluetooth SPP/BLE). **Belum diuji di perangkat
  fisik** (tidak ada printer thermal di lingkungan ini).
- **Struk:** `apps/kasir/src/receipt.js` (58 mm, 32 kolom) + `print-only`
  di `apps/kasir/index.html:426`.
- **Perubahan git pengguna:** tidak dihapus. Checkpoint dibuat sebagai branch
  `feat/kasir-nova-v2`; berkas baru pemilik (`KASIR-NOVA-V3-REFERENSI-LENGKAP/`,
  `KASIR-NOVA-V2-BRAND-ASSETS/`, `STRUK-PEMBAYARAN.jpg`, 3 skrip) dibiarkan
  apa adanya (belum di-commit).

---

## 2. Akar Masalah Bug 1 — Persistent Login

### Gejala
Pengguna harus login ulang setiap aplikasi/tab ditutup, meski sebelumnya tidak
menekan Logout. Paling terasa pada APK Kasir.

### Akar masalah (terverifikasi dari kode)

1. **Kasir & Kasir Mobile — akar utama.**
   `apps/kasir/src/app.js:831` (kode lama): `if (tokenStore.access) { ... }`.
   `tokenStore.access` dibaca dari **`sessionStorage`**
   (`apps/kasir/src/api.js:16-18`), yang **selalu kosong** setelah aplikasi/tab
   ditutup. Akibatnya cabang pemulihan sesi **tidak pernah dijalankan**,
   padahal refresh token di `localStorage` masih valid. → dipaksa ke layar login.
2. **Owner & Admin — pemulihan implisit dan rawan salah layar.**
   `apps/owner/src/app.js:2196` dan `apps/admin/src/app.js:841` memanggil
   `fetchCurrentUser()` yang dibungkus `guard()`. `guard()` **menelan** 401
   (mengembalikan `undefined`) tetapi `boot()` tetap `show('app-view')`
   seolah berhasil. Pemulihan hanya "kebetulan" terjadi sebagai efek samping
   `request()`, sehingga perilakunya tidak deterministik dan dapat
   menampilkan dashboard kosong.
3. **Refresh token mudah terhapus karena galat sementara.**
   `refreshSession()` lama memanggil `tokenStore.clear()` pada **semua**
   kegagalan (termasuk galat jaringan) dan tidak me-reset state `refreshing`
   bila promise gagal → kegagalan jaringan sesaat = sesi hilang permanen.
4. **Rusak di lingkungan storage terbatas.**
   Akses `sessionStorage`/`localStorage` tanpa penjagaan; bila storage
   diblokir (mode privat/WebView), bootstrap langsung gagal.
5. **Rotasi token vs banyak instance.**
   Refresh token bersifat sekali pakai. Bila instance lain (tab/APK) sudah
   merotasi lebih dulu, instance ini memakai token lama → 401 → sesi dihapus.

### Solusi yang diterapkan

| # | Perubahan | Berkas |
|---|---|---|
| 1 | `tokenStore.hasSession` (`access || refresh`) + akses storage aman (`readStore`/`writeStore`) | `apps/{kasir,owner,admin}/src/api.js` |
| 2 | `restoreSession()` — verifikasi sesi eksplisit ke `/api/auth/me`, otomatis memakai refresh token; hanya membersihkan token saat 401/403 | idem |
| 3 | Normalisasi galat jaringan → `ApiError` **status 0** (bukan 401) di `raw()` dan di jalur refresh, agar token **tidak** dihapus karena jaringan | idem |
| 4 | `refreshSession()` tahan gagal: `finally` me-reset state; bila token tersimpan berubah (instance lain merotasi) → coba sekali lagi dengan token terbaru | idem |
| 5 | Bootstrap ketiga panel memakai `restoreSession()` sebelum menentukan layar; tidak lagi bergantung `guard()` | `apps/{kasir,owner,admin}/src/app.js` |
| 6 | Kasir: bila tanpa sesi tetapi perangkat sudah terikat outlet → tawarkan **Masuk PIN** | `apps/kasir/src/app.js` |
| 7 | `visibilitychange` → perbarui sesi diam-diam saat aplikasi kembali aktif | ketiga `app.js` |

Perilaku hasil: login sekali → tutup aplikasi → buka lagi → langsung ke
dashboard sesuai role selama sesi masih valid; bila token dicabut/kedaluwarsa
baru tampil Login. Password/PIN tetap tidak pernah disimpan di storage.

---

## 3. Akar Masalah Bug 2 — Tombol Simpan Produk

### Gejala
Form Tambah/Edit Produk tampak tidak punya tombol Simpan yang dapat dijangkau
(terutama di ponsel), sehingga produk tidak bisa disimpan.

### Akar masalah (terverifikasi)

Tombol **ada** di markup dan handler `submit`-nya **terhubung benar**
(`apps/owner/index.html:837-840`, `apps/kasir/index.html:495-498`;
handler di `apps/owner/src/app.js:1196`, `apps/kasir/src/app.js:1114`).

Masalahnya di **CSS**, bukan di markup:

```css
/* kode lama (ketiga aplikasi) */
.modal   { position: fixed; inset: 0; display: grid; place-items: center; padding: 20px; }
.modal-card { width: 100%; max-width: 440px; padding: 24px; }  /* tanpa max-height & scroll */
```

Form produk panjang (10+ field + pratinjau foto). Pada layar pendek, kartu
menjadi lebih tinggi dari viewport; karena `.modal` bersifat `fixed` dengan
`place-items: center` dan **tanpa gulir**, bagian atas **dan** bawah kartu
terpotong. Tombol Simpan/Batal yang berada paling bawah jadi **di luar
viewport dan tidak dapat dijangkau**. Keyboard Android memperparah (viewport
mengecil). Ini persis kriteria "modal terpotong oleh CSS overflow / tombol di
luar viewport" pada instruksi FASE 5.

### Solusi yang diterapkan

- `.modal-card` dibatasi `max-height: calc(100dvh - 40px)` (fallback `100vh`)
  dan `overflow-y: auto` → kartu menggulir di dalamnya.
- `.modal-actions` menjadi `position: sticky; bottom: -24px` dengan latar
  `var(--card)` dan padding `env(safe-area-inset-bottom)` → tombol **selalu
  terlihat** di desktop maupun mobile/keyboard.
- Tombol submit diberi `id` + label eksplisit **"Simpan Produk"**
  (`#product-submit`, `#mprod-submit`) berdampingan dengan **Batal**.
- Handler submit (Owner & Kasir) diperbaiki:
  validasi (nama wajib, harga ≥ 0, stok bulat ≥ 0) dengan pesan jelas;
  tombol dinonaktifkan + label **"Menyimpan…"** (cegah klik ganda);
  form **tidak** dikosongkan saat gagal; dan **tidak** menampilkan notifikasi
  berhasil bila `guard()` mengembalikan `undefined` (sesi berakhir 401) —
  sebelumnya kasus 401 tetap memunculkan "Produk ditambahkan." dan menutup
  modal padahal server tidak menyimpan.

---

## 4. Hasil Pengujian

| Uji | Perintah | Hasil |
|---|---|---|
| Regresi persistent login (10 kasus) | `node --test scripts/test-auth-restore.mjs` | **10/10 lulus** |
| Integritas UI + guard regresi 2 bug | `node scripts/verify-ui.mjs` | **SEMUA OK** |
| Syntax (ESM) 6 berkas JS + 2 skrip | `node --check` (via salinan `.mjs`) | **8/8 OK** |
| Suite backend | `npm run test:server` | **tidak dapat dijalankan** — PostgreSQL dev (`localhost:5433`) crash `0xC0000142` di lingkungan ini. Perubahan hanya di frontend sehingga tidak menyentuh backend. |

Kasus yang dikunci tes `test-auth-restore.mjs`:

1. access token hilang + refresh valid → sesi dipulihkan (urutan `me(401) → refresh → me(200)`).
2. tanpa sesi → `null`, tanpa memanggil server.
3. access token valid → `/me` 200 tanpa `/refresh`.
4. refresh ditolak definitif (401) → token dibersihkan.
5. gagal jaringan saat refresh → token **tidak** dihapus.
6. token sudah dirotasi instance lain → coba ulang dengan token terbaru.
7. `/me` 401 & `/refresh` gagal jaringan → token tetap tersimpan.
8. storage diblokir → `tokenStore` aman (tidak melempar).
9. & 10. perilaku sama untuk panel Owner dan Admin.

`verify-ui.mjs` juga menegakkan: tombol `#product-submit`/`#mprod-submit`
berlabel "Simpan Produk" di dalam form-nya; `.modal-card` punya `max-height` +
`overflow-y: auto`; `.modal-actions` sticky; dan `app.js` memakai
`restoreSession()` + `tokenStore.hasSession` (tidak lagi hanya `tokenStore.access`).

---

## 5. Token Desain dari Aset Brand yang Disetujui

> **Keterbatasan penting yang harus diketahui pemilik proyek:**
> (a) Model AI yang bekerja di sesi ini **tidak dapat membaca gambar**, sehingga
> 86 mockup PNG di `KASIR-NOVA-V3-REFERENSI-LENGKAP/` tidak dapat saya lihat
> secara visual; (b) `KASIR-NOVA-V2-BRAND-ASSETS/README.md` menyatakan aset
> logo adalah **potongan raster hasil AI brand sheet**, **bukan** aset
> vektor/PNG transparan (terverifikasi: 0% piksel transparan), dan meminta
> **persetujuan pemilik** sebelum dipakai produksi.
> Karena itu token di bawah **diekstrak secara programatik** (System.Drawing)
> dari `00-brand-guideline.png` dan `08-master-approved-ui.png`; angka/huruf
> tidak dapat diverifikasi dan tetap menunggu persetujuan.

Hasil ekstraksi (piksel dominan, disampling):

| Peran | Nilai terukur | Catatan |
|---|---|---|
| Sidebar / navy utama | `#062A66` (UI), `#042650`/`#042651` (guideline) | arah “navy sidebar" |
| Aksen biru (logo) | `#0072F6`, `#0050D2`, puncak `#00B0F0` | dari `03-app-icon-light` & `02-logo-horizontal` |
| Latar konten | `#FEFEFE`, `#FCFDFF`, `#F7FAFD` | **tema terang**, bukan gelap |
| Ikon latar terang | `#FEFEFE` dominan (21%) | — |

**Implikasi arsitektural:** tema produksi saat ini **gelap**
(`apps/*/styles/styles.css: :root { --bg:#060e22; --primary:#00b4ff; ... }`).
Desain V2 yang disetujui berbasis **latar terang + sidebar navy**. Jadi
FASE 1 bukan sekadar penyetelan warna, melainkan perombakan token + tata
letak. Itu perlu keputusan karena menyentuh seluruh halaman.

Aset brand yang tersedia bersifat **raster tanpa transparansi** — belum
memenuhi syarat "PNG transparan" untuk logo di UI/splash. Perlu aset final
(atau persetujuan memakai raster yang ada apa adanya).

---

## 6. Rencana Implementasi (bertahap)

| Fase | Isi | Prasyarat | Status |
|---|---|---|---|
| 0 | Audit, checkpoint, akar 2 bug | — | **selesai** |
| 4 | Bug 1 Persistent Login | — | **selesai** |
| 5 | Bug 2 Simpan Produk | — | **selesai** |
| 7a | Tes regresi + guard otomatis | — | **selesai** (10/10, verify-ui OK) |
| 1 | Desain final V2 (tema terang + topbar navy; token & komponen) | aset/deskripsi desain final | **selesai** (docs/27 — menunggu tinjauan visual pemilik) |
| 1b | Aset brand transparan (logo Login/topbar + ikon PWA) | aset pemilik | **selesai** (docs/29 — ikon launcher Android menunggu build APK) |
| 2 | Smart Product Image (otomatis dari nama/kategori; pustaka SVG internal) | — | **selesai** (docs/28) |
| 3 | Smart Receipt Preview + alur cetak | — (dapat dikerjakan) | siap dikerjakan |
| 6 | Verifikasi fitur 13 Okt (laporan, Excel, laba) | — | siap diverifikasi |
| 7b | QA menyeluruh (auth/produk/transaksi/UI) | FASE 1–3 | menunggu |
| 8 | Laporan akhir + screenshot before/after | FASE 1–3 | menunggu |

Urutan teknis yang saya usulkan: **3 → 2 → 1 → 6 → 7 → 8**, karena Smart
Receipt hanya menyentuh Kasir dan tidak bergantung object storage, sedangkan
perombakan desain (1) sebaiknya dilakukan setelah keputusan gambar (2) agar
komponen `product-card`/form tidak dikerjakan dua kali.

---

## 7. Keputusan yang Dibutuhkan Pemilik Proyek

1. **Penyimpanan gambar produk (FASE 2).** Pilihan: (a) pertahankan data URL
   base64 di Postgres (sudah jalan, tanpa biaya baru, tetapi membengkakkan DB
   & payload API); (b) object storage S3-compatible (perlu bucket + kredensial);
   (c) Firebase Storage (Firebase sudah dipakai, perlu aturan keamanan).
   Pilihan (b)/(c) menambah biaya/kredensial → butuh persetujuan.
2. **Pustaka gambar Smart Product Image.** Perlu pustaka dengan lisensi jelas.
   Bila tidak tersedia, saya usulkan **placeholder KASIR NOVA + pemetaan
   kategori** (tanpa mengambil gambar dari Google Images), lalu pemilik
   menyuplai pustaka berlisensi.
3. **Aset logo final V2.** Saat ini hanya raster tanpa transparansi
   (`KASIR-NOVA-V2-BRAND-ASSETS/`). Perlu PNG transparan/SVG final, atau
   persetujuan memakai raster apa adanya (termasuk batasannya).
4. **Cakupan FASE 1.** 86 mockup tidak dapat saya lihat. Opsi: (a) pemilik
   menyediakan spesifikasi tekstual/halaman prioritas; (b) saya kerjakan
   kerangka token + komponen (tema terang, sidebar navy, kartu putih, tabel,
   modal) pada semua panel lalu pemilik meninjau; (c) fokus halaman prioritas
   (Login, Dashboard Owner, Produk & Stok, Kasir POS, Struk).
5. **Gateway pembayaran digital & perpanjangan langganan otomatis** — masih
   tertunda dari catatan sebelumnya (keputusan bisnis).
6. **Rotasi kredensial** (`dist/apk/keystore-credentials.txt`, token yang
   pernah terekspos) — tindakan pemilik.

---

## 8. Risiko & Keterbatasan Tersisa

- Cetak printer thermal **belum diuji di perangkat fisik** (simulasi/ESC-POS
  saja). Hasil uji simulasi tidak boleh diklaim sebagai uji perangkat nyata.
- Suite backend tidak dapat dijalankan di sesi ini (PostgreSQL dev crash di
  lingkungan ini); perlu dijalankan ulang di mesin pemilik.
- Uji browser nyata (klik, scroll modal di ponsel, sesi lintas restart APK)
  belum dijalankan otomatis — perlu pengujian manual/perangkat.
- Hardening cookie HttpOnly untuk refresh token masih item lanjutan
  (`docs/08-api-auth.md`).
