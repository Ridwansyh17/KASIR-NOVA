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

**Belum ada pendaftaran mandiri di aplikasi.** Tidak ada form "Daftar" dan tidak
ada endpoint pendaftaran publik — baik untuk Admin Platform maupun Owner. Ini
keputusan keamanan yang sudah ditetapkan (`docs/01`, `docs/03`, `docs/06`).

Konsekuensinya, memulai sebagai pelanggan baru selalu lewat **dua pihak**:

| Pihak | Peran |
| --- | --- |
| **Admin Platform** | Membuat/mengaktifkan **akun Owner** (dan mereset kata sandi bila lupa) |
| **Owner** | Membuat **bisnis**, menyiapkan usaha, lalu **berlangganan sendiri** (self-service) |

Akun Admin Platform sendiri hanya lahir dari **seeding internal**
(`server/src/db/seed.js`), bukan lewat pendaftaran.

---

## 2. Ringkasan alur (5 langkah)

| # | Siapa | Aksi | Hasil |
| --- | --- | --- | --- |
| 1 | Admin Platform | Buat akun Owner (nama, email, telepon, kata sandi) | Owner bisa login |
| 2 | Owner | Login di panel Owner (`/owner`) | Sesi Owner |
| 3 | Owner | **+ Bisnis Baru** | Bisnis aktif **+ langganan "Gratis" 30 hari** (1 outlet, 1 kasir) |
| 4 | Owner | Buat outlet, kasir, kategori, produk | Berjalan selama langganan aktif |
| 5 | Owner | **Bayar / Perpanjang** → pilih paket + kanal → bayar | Langganan baru **aktif** (callback otomatis atau tombol **Cek status**) |

Ringkas: **akun oleh Admin → bisnis bebas oleh Owner (langganan Gratis otomatis)
→ upgrade/perpanjang self-service**.

---

## 3. Langkah 1 — Admin Platform membuat akun Owner

Panel Admin (`/admin`) → menu **Owner** → **+ Owner Baru**, atau langsung ke API:

```http
POST /api/platform/owners
Authorization: Bearer <access token admin>
Content-Type: application/json

{ "email": "pemilik@toko.id", "password": "rahasia-min-8", "fullName": "Budi Santoso", "phone": "+62812xxxxxxx" }
```

| Field | Aturan |
| --- | --- |
| `email` | wajib, format email, ≤ 320 karakter, **harus belum terpakai** (kalau sudah → **409**) |
| `password` | wajib, **minimal 8** karakter, ≤ 200 |
| `fullName` | wajib, 2–120 karakter |
| `phone` | opsional, ≤ 30 karakter (`0-9 + - spasi ( )`) |

- `201` → `{ "owner": { … } }`
- `409` → `Email sudah terdaftar`

Hal terkait yang hanya bisa dilakukan Admin:

| Kebutuhan | Endpoint |
| --- | --- |
| Lihat/cari Owner | `GET /api/platform/owners?search=&status=&page=&limit=` |
| Ubah data Owner | `PATCH /api/platform/owners/:id` |
| Aktifkan/nonaktifkan akun | `PATCH /api/platform/owners/:id/status` (`active` \| `suspended`) |
| Reset kata sandi | `POST /api/platform/owners/:id/password` |
| Hapus (soft delete) | `DELETE /api/platform/owners/:id` |

> Belum ada verifikasi email dan belum ada reset kata sandi mandiri oleh Owner —
> keduanya dilakukan Admin.

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

---

## 5. Langkah 3 — Owner membuat bisnis: langganan Gratis otomatis

Panel Owner → kartu **Bisnis Saya** → **+ Bisnis Baru** (tampilan kosong memakai
tombol **+ Buat Bisnis Pertama**), atau API:

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

## 6. Langkah 4 — Menyiapkan usaha (butuh langganan aktif)

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

## 7. Langkah 5 — Berlangganan/upgrade secara self-service

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

## 10. Belum tersedia (jujur, per 17 Okt 2026)

- **Pendaftaran mandiri** (form daftar publik) dan verifikasi email — belum ada.
- **Reset kata sandi mandiri** oleh Owner — masih lewat Admin.
- **Halaman harga/pendaftaran publik** (landing page) — belum ada.
- **Penagihan otomatis/**`auto_renew` — masih `false` (modul ditangguhkan).
- **Callback produksi** — backend sudah dideploy, tetapi kredensial gateway di
  Vercel belum diisi; endpoint callback masih menjawab **503** dan mode
  produksi terkunci `PAYMENT_ALLOW_PRODUCTION`.
- Uji sandbox sudah jalan untuk pembuatan tagihan + cek status; **aktivasi
  setelah pembayaran penuh** masih menunggu pengujian pemilik
  (`docs/38` §10).

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
| `server/src/db/migrations/0004_outlets_subscriptions.sql` | Tabel `subscription_plans`/`subscriptions` + seed paket default "Gratis" |
| `server/src/modules/subscription/service.js` | `createDefaultSubscription`, gerbang kuota & langganan aktif |
| `server/src/modules/owner/service.js` | `createBusiness` (bisnis + langganan default dalam satu transaksi) |
| `server/src/modules/subscription-invoice/service.js` | Tagihan, pakai ulang pending, aktivasi setelah pembayaran |
| `server/src/modules/platform-admin/{routes,service}.js` | Akun Owner, pasang/ubah langganan manual |
| `apps/admin/index.html`, `apps/owner/index.html` | Form **+ Owner Baru** (Admin), **+ Bisnis Baru** & **Bayar / Perpanjang** (Owner) |
