# KASIR NOVA — Cara Pelanggan Baru Mendaftar & Berlangganan

> Alur operasional (29 Okt 2026). Menjelaskan langkah **pelanggan baru** (pemilik
> bisnis) mulai dari punya akun sampai punya **langganan aktif**, lengkap dengan
> endpoint yang dipakai panel.
>
> Rujukan terkait: `docs/08-api-auth.md` (login), `docs/09-api-platform-admin.md`
> (akun Owner), `docs/10-api-owner-business.md` (bisnis), `docs/12-api-outlet-subscription.md`
> (outlet & langganan), `docs/38-pembayaran-langganan-gateway.md` (pembayaran).

---

## 1. Yang perlu diketahui lebih dulu

Sejak **29 Oktober 2026** pendaftaran Owner mandiri **tidak memungut biaya** dan
**tidak memakai verifikasi email**. Calon pelanggan mengisi form, memilih paket,
lalu menekan **MINTA APPROVE ADMIN** yang menyimpan permintaan dan membuka chat
WhatsApp Admin. Admin menyetujui atau menolak dari **Approval Center**; masa
gratis **30 hari dimulai saat Admin menyetujui**.

| Pihak | Peran |
| --- | --- |
| **Calon Owner** | Mendaftar di `/owner/?daftar=1`, memilih paket, meminta approval via WhatsApp |
| **Admin Platform** | Menyetujui/menolak pendaftaran di **Approval Center** panel Admin |
| **Sistem KASIR NOVA** | Menyimpan password (scrypt), membuat bisnis + langganan paket pilihan + trial 30 hari secara atomik saat disetujui |
| **Owner** | Menyiapkan outlet/kasir/produk, lalu memperpanjang langganan (self-service atau WhatsApp + approval Admin) |

> Pendaftaran **tidak langsung memberi sesi**. Akun baru berstatus pending;
> login sebelum disetujui dijawab **403** dengan
> `details.code = "pending_approval"` + `details.registrationState`.
> Pendaftaran yang ditolak dijawab **403** dengan
> `details.code = "registration_rejected"` + `details.reason`.

Akun Admin Platform tetap hanya lahir dari **seeding internal**
(`server/src/db/seed.js`), bukan lewat pendaftaran publik. Owner tidak dapat
mengaktifkan akunnya sendiri.

---

## 2. Ringkasan alur

| # | Siapa | Aksi | Hasil |
| --- | --- | --- | --- |
| 1 | Calon Owner | Buka **Daftar Gratis** (`/owner/?daftar=1`), isi form + pilih paket | Akun + pendaftaran status `draft`; belum ada bisnis/langganan |
| 2 | Calon Owner | Tekan **MINTA APPROVE ADMIN** | Status `pending`, pesan WhatsApp Admin terbuka |
| 3 | Admin Platform | Buka **Approval Center** → **Setujui** | Bisnis + paket pilihan + trial **30 hari** dibuat; Owner aktif |
| 4 | Owner | Login di panel Owner (`/owner`) | Sesi Owner |
| 5 | Owner | Buat outlet, kasir, kategori, produk | Berjalan selama langganan aktif |
| 6 | Owner | **Bayar / Perpanjang** atau minta approval perpanjangan via WhatsApp | Langganan baru **aktif** |

Tidak ada tagihan, bukti pembayaran, atau status "menunggu pembayaran" pada
alur pendaftaran.

---

## 3. Langkah 1–3 — Daftar, minta approval, aktivasi Admin

### 3.1 Paket pendaftaran (publik)

```http
GET /api/auth/registration-plans
```

Mengembalikan paket aktif (`id`, `name`, `max_outlets`, `max_cashiers`,
`duration_days`, `features`). Harga langganan tidak ditampilkan pada alur
pendaftaran karena tidak ada biaya pendaftaran.

### 3.2 Form pendaftaran

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
  "password": "rahasia-min-8",
  "planId": "<uuid paket>"
}
```

| Field | Aturan |
| --- | --- |
| `fullName` | wajib, 2–120 karakter |
| `businessName` | wajib, 2–120 karakter |
| `email` | wajib, format email, ≤ 320 karakter, **dinormalisasi huruf kecil**; duplikat → **409** |
| `phone` | **wajib**, nomor WhatsApp; dinormalisasi ke format `62…` |
| `password` | wajib, **minimal 8** karakter, ≤ 200; di-hash scrypt di server |
| `planId` | wajib, UUID paket aktif; tidak valid → **422** |

- `201` → `{ owner, registration, registrationState, message }` —
  **tanpa** `accessToken`/`refreshToken`.
  - `registration.status = "draft"`
  - `registration.registration_number` = nomor tetap `REG-YYYYMMDD-XXXXXXXX`
- `409` → email sudah terdaftar.
- `422` → validasi gagal (termasuk paket/WhatsApp tidak valid).
- `429` → dibatasi **5 pendaftaran / jam / IP**.

Satu Owner hanya punya **satu baris** `owner_registrations`
(`UNIQUE owner_id`), sehingga permintaan approval berulang tidak membuat data
ganda.

### 3.3 Minta approval Admin (idempoten)

Panel menampilkan halaman **Pendaftaran Berhasil — Menunggu Persetujuan Admin**
dengan tombol **MINTA APPROVE ADMIN**. Tombol memanggil:

```http
POST /api/auth/request-approval
Content-Type: application/json

{ "registrationState": "<state>" }
```

Respons `200`:

```json
{
  "registration": { "status": "pending", "registration_number": "REG-20261029-AB12CD34" },
  "alreadyRequested": false,
  "whatsappUrl": "https://wa.me/62…?text=…",
  "message": "Permintaan approval berhasil disimpan…"
}
```

- Permintaan berulang **tidak** membuat pendaftaran baru; `alreadyRequested`
  menjadi `true` dan `request_count` bertambah.
- `whatsappUrl` memakai template tetap: nama Owner, nama bisnis, nomor
  registrasi, dan paket pilihan; nomor Admin berasal dari `SUPPORT_WHATSAPP`.
- Status dapat dicek dengan
  `GET /api/auth/registration-status?state=<state>`.

### 3.4 Approval Center (Admin Platform)

Endpoint (semua wajib `platform_admin`):

| Aksi | Endpoint |
| --- | --- |
| Daftar pending/riwayat | `GET /api/platform/approvals?status=pending\|history\|all&search=&page=&limit=` |
| Setujui | `POST /api/platform/approvals/:id/approve` |
| Tolak + alasan wajib | `POST /api/platform/approvals/:id/reject` body `{ "reason": "…" }` |

Saat **disetujui**, dalam satu transaksi server:

1. Membuat bisnis pertama dari `business_name`.
2. Memasang **paket pilihan** dengan masa aktif **30 hari** mulai `now()` server.
3. Mengisi `owners.email_verified_at = now()` (penanda aktivasi yang juga
   dipakai akun lama, demi kompatibilitas).
4. Menyimpan `approved_at`, `approved_by`, `business_id`, `trial_started_at`,
   `trial_ends_at` dan menulis audit `owner.registration_approved`.

Persetujuan berulang bersifat idempoten (`alreadyApproved: true`). Penolakan
tidak membuat bisnis/langganan dan menyimpan `rejection_reason` untuk ditampilkan
saat Owner mencoba login.

### 3.5 Akun Owner buatan Admin

Admin tetap dapat membuat akun Owner lewat panel Admin/API. Akun yang dibuat
Admin langsung terverifikasi (`email_verified_at` terisi) dan tidak memerlukan
approval. Tidak ada lagi endpoint verifikasi manual akun pending lama.

```http
POST /api/platform/owners
Authorization: Bearer <access token admin>

{ "email": "pemilik@toko.id", "password": "rahasia-min-8", "fullName": "Budi Santoso" }
```

| Kebutuhan | Endpoint |
| --- | --- |
| Lihat/cari Owner | `GET /api/platform/owners?search=&status=&page=&limit=` |
| Ubah data Owner | `PATCH /api/platform/owners/:id` |
| Aktifkan/nonaktifkan akun | `PATCH /api/platform/owners/:id/status` (`active` \| `suspended`) |
| Reset kata sandi | `POST /api/platform/owners/:id/password` |
| Hapus (soft delete) | `DELETE /api/platform/owners/:id` |

---

## 4. Owner login di panel Owner

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

Owner yang pendaftarannya **belum disetujui** ditolak **403**:

```json
{ "error": { "message": "Pendaftaran Anda sedang menunggu persetujuan Admin.", "details": { "code": "pending_approval", "registrationState": "…", "registration": { … } } } }
```

Panel Owner membuka kembali halaman **Menunggu Persetujuan Admin**; tombol
WhatsApp tetap dapat dipakai (permintaan approval idempoten).

Pendaftaran yang **ditolak** ditolak **403** dengan
`details.code = "registration_rejected"` dan `details.reason`; panel
menampilkan alasannya.

## 5. Langkah 4 — Bisnis tambahan & langganan default

Bisnis **pertama** sudah dibuat otomatis saat Admin menyetujui pendaftaran
(§3.4), lengkap dengan langganan **paket pilihan selama 30 hari**. Owner dapat menambah bisnis lain lewat
panel Owner → kartu **Bisnis Saya** → **+ Bisnis Baru**, atau API:

```http
POST /api/owner/businesses
Authorization: Bearer <access token owner>

{ "name": "Toko Budi", "businessType": "retail", "currency": "IDR", "timezone": "Asia/Jakarta" }
```

`201` → `{ "business": { … } }`.

Bisnis pertama hasil approval memakai **paket yang dipilih saat mendaftar**
(selama 30 hari). Untuk **bisnis tambahan**, server membuat langganan default
(`createDefaultSubscription`) memakai paket `is_default = true`, yaitu paket
**"Gratis"** yang di-seed migrasi `0004`:

| Paket | Max outlet | Max kasir | Harga | Masa berlaku |
| --- | --- | --- | --- | --- |
| Gratis (default) | 1 | 1 | Rp 0 | 30 hari |

Jadi bisnis tambahan tetap bisa dipakai dengan 1 outlet dan 1 kasir selama 30
hari tanpa membayar; bisnis pertama mengikuti paket pilihan saat approval. Satu Owner boleh punya banyak bisnis; setiap
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

## 10. Status & yang belum tersedia (per 29 Okt 2026)

- **Pendaftaran mandiri + Approval Center + trial 30 hari** — **tersedia** dan
  diuji otomatis (`server/tests/self-registration.test.js`): draft, permintaan
  approval idempoten, persetujuan/penolakan, gate login, dan trial dari waktu
  approval.
- **Pembayaran pendaftaran** — **tidak ada** (dihapus dari alur). Pembayaran
  hanya untuk perpanjangan langganan (`docs/38`).
- **Verifikasi email/Firebase** — **tidak dipakai lagi**; kode, halaman, dan
  dependensi Firebase/mailer telah dihapus. Kolom lama dibiarkan untuk histori.
- **Reset kata sandi mandiri** oleh Owner — belum ada; masih lewat Admin.
- **Penagihan otomatis/`auto_renew`** — masih `false` (modul ditangguhkan).
- **Callback produksi** — backend sudah dideploy ulang dan kredensial Duitku
  sandbox sudah diisi di Vercel (23 Okt 2026); callback tanpa tanda tangan sah
  menjawab **401** (gateway aktif). Mode produksi (uang nyata) tetap terkunci
  `PAYMENT_ALLOW_PRODUCTION=false`.

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
| `server/src/db/migrations/0016_owner_approval_center.sql` | Tabel `owner_registrations` (satu baris per Owner), status, nomor registrasi, jejak approval/trial |
| `server/src/modules/auth/{service,controller,routes,schema}.js` | Daftar Owner (draft), paket publik, permintaan approval, gate login pending/rejected |
| `server/src/modules/owner-approval/{service,controller,routes,schema}.js` | Approval Center: daftar pending/riwayat, setujui, tolak, template WhatsApp |
| `server/src/modules/platform-admin/{service,controller,routes}.js` | Akun Owner, pasang/ubah langganan manual, status pendaftaran pada daftar Owner |
| `server/src/modules/subscription/service.js` | `createDefaultSubscription`, `createTrialSubscription`, gerbang kuota & langganan aktif |
| `server/src/modules/owner/service.js` | `createBusinessInTransaction` (bisnis + paket pilihan/trial dalam satu transaksi) |
| `server/src/modules/subscription-invoice/service.js` | Tagihan perpanjangan, pakai ulang pending, aktivasi setelah pembayaran |
| `apps/owner/index.html`, `apps/owner/src/{app,api}.js` | Form **Daftar** + pilih paket, halaman menunggu approval, tombol **MINTA APPROVE ADMIN**, **+ Bisnis Baru** & **Bayar / Perpanjang** |
| `apps/admin/index.html`, `apps/admin/src/{app,api}.js` | Tab **Approval Center**, badge pending, aksi setujui/tolak, daftar Owner |
