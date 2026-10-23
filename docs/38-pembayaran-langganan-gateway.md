# KASIR NOVA — Pembayaran Langganan via Payment Gateway (Duitku SANDBOX)

> Status: **implementasi selesai & teruji (17 Okt 2026)**; **kredensial sandbox
> diisi 23 Okt 2026** (hanya di `server/.env` dan Vercel Environment Variables,
> tidak di-commit). Inquiry + cek status nyata ke sandbox Duitku **lulus**
> (lihat *Bukti uji sandbox*). Backend produksi sudah di-deploy ulang; callback
> publik kini menjawab **401** untuk tanda tangan tidak sah (bukan 503), yang
> berarti gateway aktif. Penyelesaian pembayaran penuh (aktivasi langganan via
> callback asli) masih menunggu transaksi uji pemilik.
>
> Ruang lingkup: **hanya pembayaran LANGGANAN**. Pembayaran transaksi penjualan
> kasir tetap **manual** (tunai/kartu/QR/wallet dicatat kasir) dan **tidak**
> memakai gateway ini.
>
> Referensi terkait: `docs/12-api-outlet-subscription.md` (langganan & kuota),
> `docs/24-vercel-serverless.md` (env produksi), `docs/01-arsitektur.md`
> (modul ditangguhkan).

---

## 1. Keputusan yang dipakai

| Aspek | Keputusan pemilik proyek |
|---|---|
| Penyedia | **Duitku**, mode **SANDBOX** |
| Cara bayar | **API inti per kanal** (`/v2/inquiry` → nomor VA / string QRIS), bukan halaman Snap |
| Siapa yang bayar | **Owner self-service**: Owner memilih paket & kanal di panel Owner |
| Aktivasi | Setelah pembayaran **berhasil** (callback bertanda tangan), langganan diperpanjang/dipasang seperti Admin memasang paket |
| `auto_renew` | Tetap **`false`** — belum ada penagihan otomatis |
| Kredensial | Diisi **pemilik proyek** di `server/.env` / Vercel; **tidak pernah** di-commit atau ditempel di chat |
| Produksi | **Belum** — endpoint produksi terkunci kunci pengaman (`PAYMENT_ALLOW_PRODUCTION`) |

---

## 2. Konfigurasi (variabel lingkungan)

Semua **opsional**. Bila kosong/`disabled`: server tetap berjalan normal dan
endpoint pembayaran langganan menjawab **503** dengan pesan yang jelas.

| Key | Default | Keterangan |
|---|---|---|
| `PAYMENT_PROVIDER` | `disabled` | `disabled` \| `duitku` |
| `PAYMENT_MODE` | `sandbox` | `sandbox` \| `production` |
| `PAYMENT_ALLOW_PRODUCTION` | `false` | **Kunci pengaman**: wajib `true` agar endpoint produksi (uang nyata) dipakai |
| `DUITKU_MERCHANT_CODE` | — | dari dashboard Duitku (rahasia) |
| `DUITKU_API_KEY` | — | dari dashboard Duitku (rahasia) |
| `DUITKU_BASE_URL` | — | opsional; menimpa dasar URL sesuai `PAYMENT_MODE` |
| `PAYMENT_CHANNELS` | `BC,I1,M2,BR` | daftar kode kanal Duitku yang aktif (dipisah koma) |
| `PAYMENT_EXPIRY_MINUTES` | `1440` | masa berlaku tagihan (menit); dibatasi `maxExpiry` kanal |
| `PAYMENT_MIN_AMOUNT_IDR` | `10000` | minimum tagihan (rupiah) |
| `PAYMENT_API_BASE_URL` | `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL` | dasar penyusunan `callbackUrl`/`returnUrl` |
| `PAYMENT_OWNER_PANEL_URL` | — | URL panel Owner untuk `returnUrl`/redirect |
| `PAYMENT_CALLBACK_URL` | — | menimpa `callbackUrl` |
| `PAYMENT_RETURN_URL` | — | menimpa `returnUrl` |
| `PAYMENT_CALLBACK_IP_ALLOWLIST` | kosong | opsional; bila diisi, callback dari IP lain ditolak **403** |

Contoh (sandbox, di `server/.env` — **jangan di-commit**):

```
PAYMENT_PROVIDER=duitku
PAYMENT_MODE=sandbox
DUITKU_MERCHANT_CODE=DXXXX
DUITKU_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PAYMENT_CHANNELS=BC,I1,M2,BR
PAYMENT_API_BASE_URL=https://kasir-nova.vercel.app
PAYMENT_OWNER_PANEL_URL=https://kasir-nova.web.app/owner
```

---

## 3. Model data (`0010_subscription_invoices.sql`)

Tabel **baru** `subscription_invoices` (bukan memakai `payments` — tabel itu
terikat penjualan: `payments.transaction_id` NOT NULL + FK ke `transactions`).

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | UUID PK | |
| `business_id` | UUID FK → businesses (cascade) | tenant pemilik tagihan |
| `plan_id` | UUID FK → subscription_plans (restrict) | paket yang dibeli |
| `subscription_id` | UUID FK → subscriptions (set null) | langganan hasil pembayaran |
| `order_id` | TEXT UNIQUE | nomor pesanan kita (`SINV-<utc14>-<hex8>`, ≤50 char) |
| `amount` | BIGINT (sen) | **snapshot** `plan.price` saat tagihan dibuat |
| `status` | enum `subscription_invoice_status` | `pending\|paid\|failed\|expired\|canceled` |
| `provider` | TEXT | `duitku` |
| `payment_method` | TEXT | kode kanal (`BC`, `NQ`, …) |
| `provider_reference`, `va_number`, `qr_string`, `payment_url` | TEXT | data dari gateway |
| `expires_at`, `paid_at`, `failed_at` | TIMESTAMPTZ | |
| `attempts` | INT | jumlah pemeriksaan/panggilan gateway |
| `inquiry_payload`, `callback_payload` | JSONB | respons inquiry gateway & payload callback (**tanpa** `signature`) |
| `created_by` | UUID FK → owners (set null) | Owner yang memulai tagihan |

Index: `(business_id, created_at DESC)`, `(status, expires_at) WHERE status='pending'`,
dan **index unik parsial** `(business_id) WHERE status='pending'` → *satu tagihan
pending per bisnis*. Trigger `trg_subscription_invoices_updated` menjaga
`updated_at`.

---

## 4. Rumus tanda tangan (HMAC-SHA256, heksadesimal huruf kecil)

| Keperluan | String yang ditandatangani |
|---|---|
| Inquiry | `merchantCode + merchantOrderId + paymentAmount` |
| Cek status | `merchantCode + merchantOrderId` |
| Callback | `merchantCode + amount + merchantOrderId` |

Perbandingan tanda tangan memakai **`timingSafeEqual`** (aman-waktu). Tanda
tangan callback **tidak pernah** disimpan ke basis data (`stripSignature`).

Endpoint Duitku yang dipakai:

| Mode | Dasar URL |
|---|---|
| sandbox | `https://sandbox.duitku.com/webapi/api/merchant` |
| production | `https://passport.duitku.com/webapi/api/merchant` |

`POST {base}/v2/inquiry`, `POST {base}/transactionStatus`.

---

## 5. Alur

```
Owner (panel)                                      Server KASIR NOVA                 Duitku
     |  1. GET  /subscription/plans  ──────────────>  (paket + kanal + status)             |
     |  2. POST /subscription/invoices ─────────────>  nominal = plan.price (sen)          |
     |                                                |  simpan baris `pending`           |
     |                                                |  --- POST /v2/inquiry ----------> |
     |                                                |  <-- vaNumber / qrString ---------|
     |  <-- nomor VA / string QRIS -------------------|                                   |
     |                                                                                     |
     |  3. Owner bayar VA/QRIS  ────────────────────────────────────────────────────────> |
     |                                                |  <--- POST /api/payments/duitku/callback (form-urlencoded)
     |                                                |  verifikasi HMAC + nominal        |
     |                                                |  (transaksi DB) lunas + langganan aktif
     |                                                |  --- 200 OK ---------------------> |
     |  4. (opsional) POST /invoices/:id/sync ──────>  POST /transactionStatus --------> |
```

Langkah 3 adalah **satu-satunya** jalur yang mengaktifkan langganan; `returnUrl`
hanya halaman informasi (dokumentasi Duitku memperingatkan `resultCode` pada
redirect dapat diubah manual).

---

## 6. Endpoint

### A. Owner (role `owner`, prefix `/api/owner/businesses/:businessId/subscription`)

Semua route memakai `requireBusinessAccess()` → bisnis tenant lain = **404**.

| Metode | Path | Keterangan |
|---|---|---|
| `GET` | `/plans` | `{ gateway, plans }` — daftar paket + status gateway + kanal aktif |
| `GET` | `/invoices?status=&page=&limit=` | riwayat tagihan (terbaru dulu, `limit` ≤100) |
| `POST` | `/invoices` | body `{ planId, paymentMethod }` → `201 { invoice, reused:false }` / `200 { invoice, reused:true }` |
| `GET` | `/invoices/:invoiceId` | detail satu tagihan |
| `POST` | `/invoices/:invoiceId/sync` | cek status ke gateway (limiter 20/5 menit/IP) |

Contoh respons tagihan:

```json
{
  "invoice": {
    "id": "uuid", "order_id": "SINV-20261017093000-1A2B3C4D", "status": "pending",
    "amount": 1500000, "provider": "duitku", "payment_method": "BC",
    "payment_method_label": "BCA Virtual Account", "payment_kind": "va",
    "va_number": "8808123456789", "qr_string": null,
    "payment_url": "https://sandbox.duitku.com/topup/…",
    "expires_at": "2026-10-18T09:30:00.000Z", "paid_at": null,
    "plan": { "id": "uuid", "name": "Pro", "price": 1500000,
              "duration_days": 30, "max_outlets": 2, "max_cashiers": 3 }
  },
  "reused": false
}
```

Penolakan yang teruji: kanal tidak aktif **422**, paket gratis **422**, harga di
bawah minimum gateway **422**, paket tidak ada/nonaktif **404**, gateway belum
dikonfigurasi **503**, tagihan bisnis lain **404**.

### B. Publik (tanpa sesi, prefix `/api/payments`)

| Metode | Path | Keterangan |
|---|---|---|
| `POST` | `/duitku/callback` | callback Duitku (`x-www-form-urlencoded`), limiter 120/5 menit/IP |
| `GET` | `/duitku/return` | redirect ke panel Owner (`PAYMENT_OWNER_PANEL_URL`) — **hanya informasi** |

Callback:

| Kondisi | Respons | Akibat |
|---|---|---|
| Tanda tangan tidak sah / parameter kurang | **401** | tidak ada perubahan status |
| Nomor pesanan tak dikenal (tanda tangan sah) | **200** `{status:"ignored"}` | tidak ada perubahan (agar Duitku tidak mengulang) |
| Nominal ≠ nominal tagihan | **400** | tidak ada perubahan; payload dicatat |
| `resultCode=00` | **200** `{status:"lunas"}` | tagihan `paid` + langganan aktif |
| `resultCode=00` (ulangan) | **200** `{status:"sudah_lunas"}` | idempoten (tidak mengaktifkan dua kali) |
| `resultCode=01` | **200** `{status:"gagal"}` | tagihan `failed`/`expired` |
| Gateway belum dikonfigurasi | **503** | — |

> Duitku mewajibkan **HTTP 200**; kegagalan membuat Duitku mengirim ulang
> maksimal 5 kali.

---

## 7. Aturan yang ditegakkan server

1. **Nominal tidak pernah dari klien.** `plan.price` (sen) → rupiah bulat
   (`sen % 100 === 0`) → dikirim ke gateway sebagai `paymentAmount`.
2. **Idempoten.** Tagihan `pending` dengan paket+kanal sama & belum kedaluwarsa
   dipakai ulang (tanpa memanggil gateway lagi). Satu tagihan pending per bisnis
   (index unik parsial); tagihan pending lain dibatalkan saat membuat yang baru.
3. **Aktivasi** memakai pola `assignSubscription`: langganan aktif lama →
   `expired`, lalu baris aktif baru `expires_at = now() + duration_days`,
   `auto_renew = false` — semuanya **dalam satu transaksi DB** dengan
   `SELECT … FOR UPDATE` pada bisnis, tagihan, dan langganan aktif.
4. **Uang yang sudah masuk tetap dihormati**: bila Owner membuat tagihan baru
   (tagihan lama `canceled`) lalu membayar tagihan lama, callback tetap
   melunasi + mengaktifkan.
5. **Audit** (`audit_logs`, `actor_role='owner'`, `actor_id` = Owner pembuat
   tagihan): `subscription.invoice_created`, `subscription.invoice_paid`
   (callback), `subscription.invoice_paid_sync` (cek manual),
   `subscription.invoice_unpaid`.
6. **Tanpa polling otomatis** — cek status hanya atas tindakan Owner + dibatasi
   rate limiter (Duitku membatasi hit rate).
7. **Rahasia tidak pernah keluar dari server**: respons API hanya memuat status
   gateway (tanpa kredensial); `apiKey`/`merchantCode` tidak ada di panel.

---

## 8. Kanal & batas

Katalog kanal + label ada di `server/src/payments/channels.js` (kode resmi
Duitku). **Default: hanya Virtual Account** (`BC`, `I1`, `M2`, `BR`) karena kanal
VA di sandbox dapat diselesaikan lewat halaman demo Duitku tanpa aplikasi
staging, sedangkan QRIS sandbox membutuhkan aplikasi staging
(ShopeePay/Nusapay).

`PAYMENT_CHANNELS` dapat memuat QRIS (`NQ`, `SP`, `SQ`) dan kanal lain
(`IR`, `FT`, `OV`, `DA`, `SA`, `VC`, …). Masa berlaku dibatasi `maxExpiry` kanal
(mis. QRIS ShopeePay **maks 60 menit**, VA **maks 1440 menit**).

Batas lain dari dokumentasi Duitku yang ditegakkan kode: `merchantOrderId` ≤50,
`email` ≤50 (email Owner >50 ditolak **422**), `customerVaName` ≤20,
`itemDetails[].price × quantity` = `paymentAmount` (mencegah HTTP 409),
minimum Rp 10.000.

---

## 9. Pengujian (otomatis)

| Berkas | Cakupan |
|---|---|
| `server/tests/duitku-client.test.js` (12 kasus) | rumus tanda tangan (dihitung ulang independen di tes), bentuk permintaan inquiry, batas panjang, pemetaan error 400/401/409/503 → 502, kegagalan jaringan/waktu habis, verifikasi callback (sah/palsu/merchant lain/parameter kurang/nominal tak valid/**anti-tamper nominal**), katalog kanal & batas expiry |
| `server/tests/subscription-invoice.test.js` (18 kasus) | opsi checkout, kanal/paket/batas harga ditolak, pembuatan tagihan + audit, pakai ulang tagihan, pembatalan tagihan lama, callback palsu (401), nominal berbeda (400), `resultCode=01`, pelunasan + aktivasi + audit, idempoten callback ganda, order tak dikenal, sync manual, riwayat & filter, isolasi tenant (404), gateway belum dikonfigurasi (503) |

Transport gateway **disuntikkan** (`setProviderForTests`) sehingga tes tidak
membutuhkan kredensial/jaringan, tetapi **verifikasi tanda tangan memakai
implementasi asli** `createDuitkuClient().verifyCallback` dengan kunci uji.
Bootstrap env tes: `server/tests/helpers/payment-env.js` (dimuat sebelum
`src/config/env.js`, menang atas `server/.env` → deterministik).

Hasil terakhir: **374/374** tes backend lulus, `scripts/verify-ui.mjs` →
**SEMUA OK** (memuat kunci statis fitur ini), `scripts/qa-local.ps1` →
**SEMUA TAHAP LULUS** (7/7).

---

## 10. Uji sandbox lokal (langkah pemilik proyek)

1. Isi `PAYMENT_*`/`DUITKU_*` di `server/.env` (lihat §2). **Jangan** commit.
2. Jalankan harness uji (memakai API KASIR NOVA sendiri; **tidak mencetak**
   kredensial, nomor VA ditampilkan bertopeng):

   ```powershell
   # terminal 1: server lokal
   cd server ; npm.cmd run dev
   # terminal 2: dari root repo
   npm.cmd run sandbox:duitku          # tambahkan --show-va bila ingin nomor VA penuh
   node scripts/sandbox-duitku-e2e.mjs --channel NQ   # uji kanal tertentu (mis. QRIS)
   ```

   Sebelum kredensial diisi, harness berhenti rapi dengan pesan
   *"gateway BELUM dikonfigurasi"* (status keluar 0) dan **tidak** membuat
   tagihan apa pun. Bila kredensial baru sebagian, harness menampilkan
   `alasan` dari server (mis. `kredensial_duitku_belum_lengkap`).
   Harness memilih paket berbayar termurah yang **memenuhi**
   `PAYMENT_MIN_AMOUNT_IDR` (default Rp 10.000); paket di bawah minimum
   dilewati karena server menolaknya dengan 422 (aturan internal kami, bukan
   aturan Duitku).
3. Atau lewat panel: login Owner → **Langganan** → **Bayar / Perpanjang** →
   pilih paket & kanal `BC`.
4. Bayar VA sandbox lewat halaman demo Duitku
   (`https://sandbox.duitku.com/payment/demo/demosuccesstransaction.aspx`),
   lalu tekan **Cek Status** di panel (atau jalankan `npm run sandbox:duitku`
   lagi) — tagihan pending dipakai ulang, jadi tidak ada tagihan ganda.
5. Untuk callback sungguhan: URL callback produksi
   `https://kasir-nova.vercel.app/api/payments/duitku/callback`.
   **Sudah aktif (23 Okt 2026):** `PAYMENT_PROVIDER`, `PAYMENT_MODE`,
   `PAYMENT_ALLOW_PRODUCTION=false`, `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`,
   `PAYMENT_CHANNELS`, `PAYMENT_API_BASE_URL`, dan `PAYMENT_OWNER_PANEL_URL`
   ditambahkan ke **Vercel → Environment Variables (Production)**, lalu backend
   di-deploy ulang. Verifikasi: callback tanpa tanda tangan sah menjawab
   **401** (sebelumnya 503), `/api/health` **200** `database: up`.

### Bukti uji sandbox (17 Okt 2026, server lokal)

Kredensial sandbox diisi pemilik di `server/.env` (tidak masuk repo). Harness
`npm.cmd run sandbox:duitku` dijalankan dari root repo:

| Langkah | Hasil |
| --- | --- |
| 1. Health server lokal | PASS (`db=up`) |
| 2. Login Owner | PASS (`role=owner`) |
| 3. Bisnis milik Owner | PASS ("Demo Kasir NOVA") |
| 4. Status gateway | PASS `provider=duitku mode=sandbox enabled=true kanal=BC,I1,M2,BR` |
| 5. Paket berbayar | PASS "Paket Uji 10rb" (1 paket Rp 5.000 dilewati: < minimum) |
| 6. Buat tagihan | PASS `201 order=SINV-20261017075100-221B9DFB status=pending kanal=BCA Virtual Account` |
| 7. Cek status ke gateway | PASS `status=200 tagihan=pending diperiksa=true` |

Artinya **inquiry** dan **cek status** sudah benar-benar berbicara dengan sandbox
Duitku (bukan tiruan). Yang belum: menyelesaikan pembayaran sampai langganan
teraktivasi, dan callback asli dari Duitku ke produksi.

Uji kanal **QRIS** (`node scripts/sandbox-duitku-e2e.mjs --channel NQ`; kode `NQ`
= QRIS (Nobu) ditambahkan pada `PAYMENT_CHANNELS`):

| Langkah | Hasil |
| --- | --- |
| 6. Buat tagihan | PASS `201 order=SINV-20261017075246-B99D29DB status=pending kanal=QRIS (Nobu)` |
| 6. `qrString` dari gateway | **294 karakter** (inilah yang digambar panel Owner — §12) |
| 7. Cek status ke gateway | PASS `status=200 tagihan=pending` |

Tagihan uji memakai paket yang sama tetapi kanal berbeda, sehingga tagihan VA
yang masih pending **tidak** terpakai ulang (aturan pakai-ulang: bisnis + paket
+ kanal). Menyelesaikan pembayaran QRIS sandbox tetap perlu aplikasi staging
(ShopeePay/Nusapay) — lihat §8.

---

### Bukti uji sandbox (23 Okt 2026, kredensial baru)

Kredensial sandbox (Merchant Code + API Key) diisi pemilik; nilai rahasia hanya
disimpan di `server/.env` (gitignored) dan Vercel Environment Variables.
`npm run sandbox:duitku` dijalankan terhadap server lokal + DB dev:

| Langkah | Hasil |
| --- | --- |
| 1. Health server lokal | PASS (`db=up`) |
| 2. Login Owner | PASS (`role=owner`) |
| 3. Bisnis milik Owner | PASS ("Demo Kasir NOVA") |
| 4. Status gateway | PASS `provider=duitku mode=sandbox enabled=true kanal=BC,I1,M2,BR` |
| 5. Paket berbayar | PASS ("Paket Uji 10rb", Rp 10.000) |
| 6. Buat tagihan | PASS `201 order=SINV-20261023021121-4CE2050F status=pending` (VA BCA) |
| 7. Cek status ke gateway | PASS `200 tagihan=pending diperiksa=true` |

Produksi sesudah backend di-deploy ulang: `POST /api/payments/duitku/callback`
tanpa parameter → **401** `Callback gateway tidak sah` (gateway terkonfigurasi;
bukan 503), dan `GET /api/health` → **200** `database: up`.

## 11. Batasan & tindak lanjut

- **Gambar QR QRIS** sudah dirender di panel Owner (17 Okt 2026) memakai encoder
  yang di-**vendor** apa adanya — lihat §12.
- **Inquiry + cek status gateway sudah diuji nyata** ke sandbox Duitku
  (17 Okt 2026 dan 23 Okt 2026 dengan kredensial baru) — lihat §10
  "Bukti uji sandbox".
- **Pembayaran penuh (aktivasi langganan) & callback asli belum diuji**
  (butuh menyelesaikan pembayaran di halaman demo Duitku + URL publik).
- `auto_renew` masih `false`; penagihan otomatis (tabel
  `subscription_payments` + job) tetap modul ditangguhkan.
- Mode **production** belum diaktifkan; kunci pengaman
  `PAYMENT_ALLOW_PRODUCTION` mencegah tagihan nyata tanpa persetujuan.

---

## 12. Kode QR QRIS (encoder yang di-vendor)

Owner memindai QRIS dari layar, jadi `qrString` dari gateway perlu digambar
sebagai **kode QR**, bukan hanya ditampilkan sebagai teks.

| Berkas | Isi |
|---|---|
| `shared/vendor/qrcode-generator.js` | pustaka pihak ketiga, **apa adanya** (verbatim) |
| `shared/qr-code.js` | modul bersama KASIR NOVA: `encode` / `toSvg` / `toDataUrl` / `isAvailable` |
| `apps/owner/src/{qr-code.js,vendor/qrcode-generator.js}` | salinan (dijaga identik oleh `scripts/sync-shared.mjs` + `verify-ui.mjs`) |
| `scripts/test-qr-code.mjs` | 9 uji (struktur QR, quiet zone, BCH format-info, kapasitas, galat) |

- **Pustaka:** *QR Code Generator for JavaScript* — Copyright (c) 2009
  Kazuhiko Arase, **lisensi MIT** (header asli dipertahankan di berkas vendor).
  Sumber: `https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js`
  (SHA-256 `18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780`,
  56.694 byte). Pembaruan = salin berkas rilis baru apa adanya, lalu
  `node scripts/sync-shared.mjs`.
- **Keluaran:** SVG **data URL** (tanpa canvas) → cukup `<img src="…">`,
  tidak menambah dependensi DOM/runtime apa pun.
- **Quiet zone 4 modul** (syarat EMVCo/QRIS), ECC default **M**; bila isi
  melampaui kapasitas ECC M (2.331 byte) otomatis turun ke **L**, dan bila
  tetap tidak muat dipakai pesan galat yang jelas (panel kembali ke string
  QRIS + tautan gateway).
- **Keamanan:** isi QR **tidak pernah** masuk ke markup SVG — hanya koordinat
  modul (angka) hasil hitungan pustaka, jadi tidak ada jalur injeksi
  HTML/SVG dari data gateway. Pengunci negatif di
  `scripts/verify-ui.mjs` menolak `<text>`/`<foreignObject>` di modul ini dan
  menolak `qr_string` dipasang mentah sebagai `src` gambar.
- **Bukti dapat dipindai (17 Okt 2026):** encoder diuji dengan **decoder
  independen (jsQR)** di luar repo — **5/5 terbaca identik**: `HELLO WORLD`
  (v1), QRIS ~230 karakter (v10), 700 karakter (v21), 1.200 karakter (v29),
  1.800 karakter ECC L (v31). Selain itu, dirender di **Chrome headless**
  (`/owner/`): `window.NovaQr.isAvailable() = true`,
  `img` QR **berhasil dimuat** dengan ukuran 390×390 px (65 modul × 6 px,
  termasuk quiet zone 4 modul).
- **Bukti dengan data gateway nyata (17 Okt 2026):** `qrString` **asli** dari
  sandbox Duitku (tagihan `SINV-20261017075246-B99D29DB`, kanal `NQ` QRIS Nobu,
  **294 karakter**, awalan `00020101021226670016COM.NO…`) dirender dengan
  `NovaQr.encode/toDataUrl` → **v13 (69×69 modul), ECC M, quiet zone 4,
  gambar 308×308 px** → decode jsQR menghasilkan **string yang identik**
  (`cocok: YA`). Jadi jalur "gateway → modul QR kami → gambar" sudah utuh.
- **Uji pindai nyata** dengan aplikasi e-wallet tetap disarankan sekali saat
  uji sandbox (manual, oleh pemilik proyek).

