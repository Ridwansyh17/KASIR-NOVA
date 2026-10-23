# KASIR NOVA — Cara Pelanggan Baru Mendaftar & Berlangganan

> Alur operasional (17 Okt 2026). Menjelaskan langkah **pelanggan baru** (pemilik
> bisnis) mulai dari punya akun sampai punya **langganan aktif**, lengkap dengan
> endpoint yang dipakai panel.
>
> Rujukan terkait: `docs/08-api-auth.md` (login), `docs/09-api-platform-admin.md`
> (akun Owner), `docs/10-api-owner-business.md` (bisnis), `docs/12-api-outlet-subscription.md`
> (outlet & langganan), `docs/38-pembayaran-langganan-gateway.md` (pembayaran).

---

## 1. Yang perlu diketahui lebih dulu

Sejak **23 Oktober 2026** pendaftaran Owner mandiri diverifikasi melalui
**tautan email Firebase Authentication** (Firebase Email Verification Link).
Calon pelanggan membuat akun sendiri dari panel Owner atau tautan **Daftar
Gratis** di beranda publik, lalu mengklik tautan verifikasi yang dikirim
Firebase. Tidak diperlukan WhatsApp untuk alur normal, SMTP, atau domain email
berbayar.

| Pihak | Peran |
| --- | --- |
| **Calon Owner** | Mendaftar di `/owner/?daftar=1`, membuka email, lalu mengklik tautan verifikasi Firebase |
| **Firebase Authentication** | Membuat identitas email/UID dan mengirim tautan verifikasi; **tidak** menyimpan password Owner |
| **Sistem KASIR NOVA** | Menyimpan password (scrypt), memeriksa `emailVerified` via Admin SDK, lalu membuat **bisnis + langganan Gratis 30 hari** secara atomik |
| **Owner** | Menyiapkan outlet/kasir/produk, lalu **berlangganan sendiri** (self-service) |
| **Admin Platform** | Cadangan/bantuan akun & langganan; memverifikasi manual hanya akun pending **lama** (WhatsApp) |

> Pendaftaran **tidak langsung memberi sesi**. Akun baru berstatus pending;
> login sebelum verifikasi dijawab **403** dengan
> `details.code = "email_not_verified"` dan `details.verificationState`.
> Akun pending lama (alur WhatsApp) tetap memakai
> `details.code = "account_not_verified"` + `details.whatsappUrl`.

Akun Admin Platform tetap hanya lahir dari **seeding internal**
(`server/src/db/seed.js`), bukan lewat pendaftaran publik.

---

## 2. Ringkasan alur (6 langkah)

| # | Siapa | Aksi | Hasil |
| --- | --- | --- | --- |
| 1 | Calon Owner | Buka **Daftar Gratis** (`/owner/?daftar=1`) dan isi form | Akun pending + email verifikasi Firebase diminta |
| 2 | Calon Owner | Buka email lalu klik tautan verifikasi | Firebase menandai email terverifikasi dan kembali ke halaman verifikasi KASIR NOVA |
| 3 | Calon Owner | Klik **Saya Sudah Verifikasi** (atau langsung login) | Server memeriksa Firebase; **bisnis pertama + Gratis 30 hari** dibuat atomik |
| 4 | Owner | Login di panel Owner (`/owner`) | Sesi Owner |
| 5 | Owner | Buat outlet, kasir, kategori, produk | Berjalan selama langganan aktif |
| 6 | Owner | **Bayar / Perpanjang** → pilih paket + kanal → bayar | Langganan baru **aktif** (callback otomatis atau tombol **Cek status**) |

Ringkas: **daftar sendiri → verifikasi email Firebase → bisnis + Gratis
otomatis → upgrade/perpanjang self-service**.

---

## 3. Langkah 1–3 — Daftar, verifikasi email, bisnis otomatis

### 3.1 Form pendaftaran

Panel Owner → tautan **Daftar gratis**, atau langsung:
`https://kasir-nova.web.app/owner/?daftar=1`.

```http
POST /api/auth/register-owner
Content-Type: application/json

{
  "fullName": "Budi Santoso",
  "businessName": "Toko Budi",
  "email": "pemilik@toko.id",
  "phone": "0812xxxxxxx",
  "password": "rahasia-min-8"
}
```

| Field | Aturan |
| --- | --- |
| `fullName` | wajib, 2–120 karakter |
| `businessName` | wajib, 2–120 karakter; disimpan sementara |
| `email` | wajib, format email, ≤ 320 karakter, **dinormalisasi huruf kecil**; duplikat → **409** |
| `phone` | **wajib**, nomor WhatsApp; dinormalisasi ke format `62…` |
| `password` | wajib, **minimal 8** karakter, ≤ 200; di-hash scrypt di server |

- `201` → `{ owner, email, emailSent, verificationMethod: "email",
  verificationState, message }` — **tanpa** `accessToken`/`refreshToken`.
- `409` → email sudah terdaftar (di PostgreSQL atau Firebase).
- `422` → validasi gagal (termasuk nomor WhatsApp kosong/tidak valid).
- `429` → dibatasi **5 pendaftaran / jam / IP**.
- `503` → Firebase belum dikonfigurasi di server.

Panel langsung membuka `/owner/verify-email?state=…`. Halaman menampilkan email
terdaftar, tombol **Buka Gmail**, **Saya Sudah Verifikasi**, dan **Kirim Ulang
Email**. Bila pengiriman email gagal, akun tetap tersimpan dan halaman
menampilkan peringatan + tombol kirim ulang (tanpa membuat akun ganda).

### 3.2 Verifikasi email Firebase

Firebase mengirim tautan ke email pendaftar. Setelah diklik, Firebase menandai
`emailVerified = true` dan mengarahkan kembali ke
`/owner/verify-email?state=…` (continue URL).

Halaman memanggil:

```http
GET /api/auth/firebase/verification-status?state=<state>
```

Tombol **Saya Sudah Verifikasi** memanggil:

```http
POST /api/auth/firebase/verify-owner
Content-Type: application/json

{ "state": "<state>" }
```

Server **tidak mempercayai klaim browser**: ia memanggil Firebase Admin SDK
`getUser(uid)` (dan memverifikasi `idToken` bila dikirim), lalu memastikan email
cocok. Bila `emailVerified = true`, dalam **satu transaksi** server:

1. Mengisi `owners.email_verified_at = now()` dan mengosongkan
   `pending_business_name`.
2. Membuat **bisnis pertama** dari `pending_business_name`.
3. Membuat **langganan default Gratis 30 hari** (`is_default=true`,
   `auto_renew=false`).
4. Menulis audit `owner.email_verified` + `business.create`.

Proses idempoten: klik/percobaan berulang tidak membuat bisnis kedua. Owner juga
bisa langsung login setelah verifikasi; server memeriksa Firebase saat login
dan menyelesaikan aktivasi otomatis.

### 3.3 Kirim ulang email

```http
POST /api/auth/firebase/resend-verification
Content-Type: application/json

{ "state": "<state>" }
```

Dibatasi **3 permintaan / 15 menit / IP** + cooldown per akun
(`FIREBASE_RESEND_COOLDOWN_SECONDS`, default 60 detik). Respons `429`
menyertakan `details.retryAfterSeconds`; halaman menampilkan hitung mundur.

### 3.4 Bantuan Admin & akun pending lama

Admin tetap dapat membuat akun Owner lewat panel Admin/API. Akun yang dibuat
Admin langsung dianggap terverifikasi (kolom `email_verified_at` terisi
`now()`, metode `manual`), sehingga bisa login tanpa email verifikasi.

Akun pending **lama** (dibuat sebelum Firebase) tetap dapat diverifikasi manual
via WhatsApp. Endpoint ini **menolak** akun yang terhubung Firebase:

```http
POST /api/platform/owners/:id/verify
Authorization: Bearer <access token admin>
```

Bila akun pending lama memiliki `pending_business_name`, server dalam satu
transaksi membuat bisnis pertama + langganan Gratis dan audit
`owner.whatsapp_verified`.

```http
POST /api/platform/owners
Authorization: Bearer <access token admin>

{ "email": "pemilik@toko.id", "password": "rahasia-min-8", "fullName": "Budi Santoso" }
```

| Kebutuhan | Endpoint |
| --- | --- |
| Lihat/cari Owner | `GET /api/platform/owners?search=&status=&page=&limit=` |
| Ubah data Owner | `PATCH /api/platform/owners/:id` |
| Verifikasi akun pending lama (WhatsApp) | `POST /api/platform/owners/:id/verify` |
| Aktifkan/nonaktifkan akun | `PATCH /api/platform/owners/:id/status` (`active` \| `suspended`) |
| Reset kata sandi | `POST /api/platform/owners/:id/password` |
| Hapus (soft delete) | `DELETE /api/platform/owners/:id` |

> Email Owner yang terhubung Firebase tidak dapat diubah dari panel Admin;
> verifikasi manual juga ditolak. Reset kata sandi mandiri oleh Owner **belum
> tersedia**; masih lewat Admin.

---

## 4. Langkah 2 — Owner login di panel Owner

Panel Owner: `/owner` (lokal: `http://localhost:4000/owner`, produksi:
`https://kasir-nova.web.app/owner`).

```http
POST /api/auth/login
{ "role": "owner", "email": "pemilik@toko.id", "password": "rahasia-min-8" }
```

Login **wajib menyertakan `role`** yang cocok dengan panelnya: `owner` (panel
Owner), `platform_admin` (panel Admin), atau `cashier` (panel Kasir memakai PIN
lewat `POST /api/auth/cashier-pin`). Sesi memakai access token + refresh token
yang dirotasi; pencabutan berlaku di server.

Owner pendaftaran mandiri yang **belum** memverifikasi email ditolak **403**:

```json
{ "error": { "message": "Akun menunggu verifikasi email…", "details": { "code": "email_not_verified", "verificationMethod": "email", "verificationState": "…" } } }
```

Panel Owner otomatis membuka halaman verifikasi email. Sebelum menolak, server
memeriksa Firebase; bila pemilik sudah mengklik tautan, aktivasi diselesaikan
dan login dilanjutkan.

Akun pending lama tetap mendapat `account_not_verified` +
`details.whatsappUrl`, dan panel menampilkan tautan **Hubungi Admin via
WhatsApp**.

## 5. Langkah 4 — Bisnis & langganan Gratis otomatis

Bisnis **pertama** sudah dibuat otomatis saat email terverifikasi (§3.2), lengkap
dengan langganan **Gratis 30 hari**. Owner dapat menambah bisnis lain lewat
panel Owner → kartu **Bisnis Saya** → **+ Bisnis Baru**, atau API:

```http
POST /api/owner/businesses
Authorization: Bearer <access token owner>

{ "name": "Toko Budi", "businessType": "retail", "currency": "IDR", "timezone": "Asia/Jakarta" }
```

`201` → `{ "business": { … } }`.

Dalam **transaksi database yang sama**, server membuat langganan default
(`createDefaultSubscription`) memakai paket `is_default = true`, yaitu paket
**"Gratis"** yang di-seed migrasi `0004`:

| Paket | Max outlet | Max kasir | Harga | Masa berlaku |
| --- | --- | --- | --- | --- |
| Gratis (default) | 1 | 1 | Rp 0 | 30 hari |

Jadi pelanggan baru **langsung bisa berjualan** dengan 1 outlet dan 1 kasir
selama 30 hari tanpa membayar. Satu Owner boleh punya banyak bisnis; setiap
bisnis punya langganan sendiri (status **tidak menular** antar bisnis).

---

## 6. Langkah 5 — Menyiapkan usaha (butuh langganan aktif)

Semua langkah ini otomatis lolos selama langganan `active` dan belum
kedaluwarsa:

1. **Outlet** — `POST /api/owner/businesses/:businessId/outlets`
   (dibatasi `max_outlets` paket).
2. **Kasir** — satu akun Kasir hanya untuk **satu outlet**; outlet selalu diambil
   dari akun kasir, bukan dari data yang dikirim perangkat.
   Dibuat/hapus di `…/cashiers`, dibatasi `max_cashiers`.
3. **Kategori & produk** — `…/categories`, `…/products` (+ stok per outlet).
4. **Mulai berjualan** — transaksi kasir di `…/transactions`.

---

## 7. Langkah 6 — Berlangganan/upgrade secara self-service

Pembayaran langganan adalah **satu-satunya** alur pembayaran daring; pembayaran
penjualan di kasir tetap dicatat manual. Detail teknis: `docs/38`.

Panel Owner → bagian **Langganan** → tombol **Bayar / Perpanjang**.

### 7.1 Pilih paket & metode pembayaran

Panel menampilkan paket yang bisa dibeli beserta status gateway:

```http
GET /api/owner/businesses/:businessId/subscription/plans
```

```json
{
  "gateway": {
    "enabled": true, "provider": "duitku", "mode": "sandbox", "reason": null,
    "min_amount_idr": 10000,
    "channels": [ { "code": "BC", "label": "BCA Virtual Account", "kind": "va" } ]
  },
  "plans": [ { "id": "uuid", "name": "Paket Bulanan", "price": 9900000, "duration_days": 30, "purchasable": true } ]
}
```

- `price` dalam **sen** (Rp 99.000 ditulis `9900000`).
- `purchasable=false` untuk paket gratis/nonaktif — tidak bisa ditagih.
- `gateway.enabled=false` ⇒ tombol bayar dinonaktifkan dan alasannya ditampilkan
  (mis. `gateway_belum_dikonfigurasi`). Aplikasi tetap berjalan normal.
- Metode tersedia dari `PAYMENT_CHANNELS` (default `BC,I1,M2,BR` = Virtual
  Account; `NQ`/`SP`/`SQ` = QRIS bila diaktifkan).

### 7.2 Buat tagihan

```http
POST /api/owner/businesses/:businessId/subscription/invoices
{ "planId": "<uuid paket>", "paymentMethod": "BC" }
```

- `201` → `{ "invoice": { … }, "reused": false }`
  - VA: `invoice.va_number`
  - QRIS: `invoice.qr_string` (panel menggambarnya menjadi **kode QR**)
  - ada juga `payment_url` (halaman pembayaran gateway) dan `expires_at`.
- `reused: true` bila masih ada **tagihan pending untuk paket + kanal yang sama**
  dan belum kedaluwarsa (mencegah dua nomor VA untuk tagihan yang sama).
- Nominal **selalu** diambil dari `subscription_plans.price` di server — angka
  dari browser tidak dipercaya. Di bawah `PAYMENT_MIN_AMOUNT_IDR`
  (default Rp 10.000) ditolak **422**.

### 7.3 Owner membayar

Buka `payment_url` / bayar VA, atau pindai kode QR QRIS dari layar.

### 7.4 Aktivasi langganan

Aktivasi terjadi **hanya** setelah server tahu pembayaran berhasil:

1. **Otomatis** — gateway memanggil `POST /api/payments/duitku/callback`
   (diverifikasi tanda tangan **HMAC-SHA256**, bukan sekadar percaya payload).
2. **Manual** — tombol **Cek status** pada baris tagihan (atau
   `POST …/invoices/:invoiceId/sync`). Dipakai bila callback belum masuk
   (mis. backend belum dikonfigurasi).

### 7.5 Hasil aktivasi

Dalam satu transaksi: tagihan menjadi `paid`, langganan aktif lama diubah
menjadi `expired` (riwayat tetap tersimpan), lalu langganan baru dibuat:

- `status = active`
- `started_at = waktu aktivasi`, `expires_at = waktu aktivasi + duration_days`
  paket — **dihitung dari waktu bayar**, bukan ditambahkan ke sisa masa berlaku
  sebelumnya (pola sama dengan pemasangan paket oleh Admin)
- `auto_renew = false` (belum ada penagihan otomatis)

Paling banyak **satu** langganan `active` per bisnis. Setelah itu, batas outlet
dan kasir mengikuti paket baru.

---

## 8. Kalau langganan tidak aktif / kedaluwarsa

Operasi berikut ditolak **409** dengan pesan yang membedakan sebabnya (kuota,
langganan tidak aktif, kedaluwarsa, atau bisnis nonaktif):

| Operasi | Penjaga |
| --- | --- |
| Buat outlet | `enforceOutletQuota` (aktif + `max_outlets`) |
| Buat kasir | `enforceCashierQuota` (aktif + `max_cashiers`) |
| Buat kategori produk | `enforceSubscriptionActive` |
| Buat produk | `enforceSubscriptionActive` |
| Transaksi penjualan baru | `enforceSubscriptionActive` |

Yang **tetap bisa** dilakukan saat langganan habis: login, melihat data, dan
**membuat tagihan baru untuk memperpanjang** (`POST …/invoices`) — supaya
pelanggan bisa mengaktifkan kembali tanpa bantuan Admin.

---

## 9. Jalur khusus Admin (bantuan/uji coba)

Admin dapat memasang paket tanpa pembayaran daring — berguna saat demo atau
komplain pelanggan:

| Aksi | Endpoint |
| --- | --- |
| Pasang paket | `POST /api/platform/businesses/:businessId/subscription` body `{ "planId": "<uuid>" }` |
| Ubah status langganan terbaru | `PATCH /api/platform/businesses/:businessId/subscription/status` body `{ "status": "active" \| "past_due" \| "expired" }` |
| Lihat langganan | `GET /api/platform/businesses/:businessId/subscription` |

Jalur ini **bukan** alur normal pelanggan; gunakan hanya untuk bantuan/uji coba.

---

## 10. Status & yang belum tersedia (per 23 Okt 2026)

- **Pendaftaran mandiri + verifikasi email Firebase** — **tersedia** (kode &
  tes otomatis dengan adapter Firebase palsu). Pengiriman email sungguhan baru
  aktif setelah `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
  `FIREBASE_PRIVATE_KEY` (atau `FIREBASE_SERVICE_ACCOUNT_JSON`) dan
  `FIREBASE_WEB_API_KEY` diisi + Firebase Console dikonfigurasi. Tanpa itu,
  pendaftaran menjawab **503** `firebase_not_configured`. Alur email lama
  (Resend/SMTP) hanya untuk akun pending legacy.
- **Reset kata sandi mandiri** oleh Owner — belum ada; masih lewat Admin.
- **Penagihan otomatis/**`auto_renew` — masih `false` (modul ditangguhkan).
- **Callback produksi** — backend sudah dideploy ulang dan kredensial Duitku
  sandbox sudah diisi di Vercel (23 Okt 2026); callback tanpa tanda tangan sah
  menjawab **401** (gateway aktif). Mode produksi (uang nyata) tetap terkunci
  `PAYMENT_ALLOW_PRODUCTION=false`.
- Uji sandbox sudah jalan untuk pembuatan tagihan + cek status; **aktivasi
  setelah pembayaran penuh** masih menunggu pengujian pemilik (`docs/38` §10).

---

## 11. Uji cepat alur ini tanpa panel

Harness sandbox menjalankan persis langkah 7.1–7.4 (login Owner → daftar paket →
buat tagihan → cek status) lewat API KASIR NOVA sendiri:

```powershell
# terminal 1
cd server ; npm.cmd run dev
# terminal 2 (dari root repo)
npm.cmd run sandbox:duitku                     # kanal VA pertama yang aktif
node scripts/sandbox-duitku-e2e.mjs --channel NQ   # uji kanal QRIS
```

Bila kredensial gateway belum diisi, skrip berhenti rapi (exit 0) sambil
menampilkan alasannya dan **tidak** membuat tagihan.

## 12. Berkas yang menegakkan aturan ini

| Berkas | Perannya |
| --- | --- |
| `server/src/db/migrations/0013_owner_self_registration.sql` | Kolom verifikasi + `pending_business_name`; `0014` membuat `email_verified_at` NULL-able |
| `server/src/db/migrations/0015_owner_firebase_verification.sql` | `firebase_uid`, metode verifikasi, cooldown, index unik |
| `server/src/modules/auth/{service,controller,routes,schema}.js` | Daftar Owner (pending), state verifikasi, gate login |
| `server/src/utils/firebase.js` | Adapter Firebase Admin/REST + verifikasi ID token + kirim email |
| `server/src/modules/platform-admin/{service,controller,routes}.js` | Verifikasi akun pending lama + larangan verifikasi manual Firebase |
| `server/src/utils/mailer.js` | Alur email legacy (Resend/SMTP/development log) |
| `server/src/db/migrations/0004_outlets_subscriptions.sql` | Tabel `subscription_plans`/`subscriptions` + seed paket default "Gratis" |
| `server/src/modules/subscription/service.js` | `createDefaultSubscription`, gerbang kuota & langganan aktif |
| `server/src/modules/owner/service.js` | `createBusinessInTransaction` (bisnis + langganan default dalam satu transaksi) |
| `server/src/modules/subscription-invoice/service.js` | Tagihan, pakai ulang pending, aktivasi setelah pembayaran |
| `server/src/modules/platform-admin/{routes,service}.js` | Akun Owner, pasang/ubah langganan manual |
| `apps/owner/index.html`, `apps/owner/verify-email.html`, `apps/owner/src/{app,api,verify-email}.js` | Form **Daftar**, halaman verifikasi email, **+ Bisnis Baru** & **Bayar / Perpanjang** (Owner) |
| `apps/admin/index.html` | Form **+ Owner Baru** (jalur bantuan Admin) |
