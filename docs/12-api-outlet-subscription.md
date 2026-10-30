# KASIR NOVA — Kontrak API Fase 4: Outlet & Langganan

> Berlaku untuk build Fase 4 (migrasi `0004`). Semua endpoint di bawah
> `requireAuth` + verifikasi peran; error memakai bentuk
> `{ "error": { "message": "..." } }`. Harga dalam **sen** (`price`).
>
> Referensi terkait:
> - Autentikasi: `docs/08-api-auth.md`
> - Admin (owner, pratinjau bisnis): `docs/09-api-platform-admin.md`
> - Owner & bisnis: `docs/10-api-owner-business.md`

## Ringkasan aturan bisnis (keputusan Opsi A)

- Bisnis baru otomatis mendapat langganan plan **default "Gratis"** dalam
  transaksi pembuatan bisnis (max outlet 1, max kasir 1, harga 0, 30 hari).
- **Gerbang pembuatan outlet:** bisnis harus `active`; langganan terbaru harus
  `active` dan belum kedaluwarsa; jumlah outlet aktif (bukan soft-deleted)
  harus **< `max_outlets`** paket. Penolakan → **409** dengan pesan yang
  membedakan sebab (kuota / langganan tidak aktif / kedaluwarsa / bisnis
  nonaktif).
- Paling banyak **satu** langganan `active` per bisnis (index unik parsial).
  Riwayat langganan non-aktif tetap tersimpan.
- Status langganan **tidak menular** antar bisnis.
- Paket default hanya satu; paket default terakhir tidak dapat dinonaktifkan.

---

## A. Outlet — pemilik (role `owner`)

Prefix: `/api/owner/businesses/:businessId/outlets`
Semua route melewati `requireBusinessAccess` → business milik tenant lain = **404**.

### 1. Daftar outlet
`GET /api/owner/businesses/:businessId/outlets`

```json
200
{ "items": [ { "id": "uuid", "business_id": "uuid", "name": "Pusat",
  "address": null, "phone": null, "tax_rate": "0.00", "status": "active",
  "created_at": "…", "updated_at": "…" } ], "total": 1 }
```
Catatan: `tax_rate` dikirim pg sebagai string numerik; konversi `Number()` di
klien.

### 2. Buat outlet
`POST /api/owner/businesses/:businessId/outlets`

Body:
```json
{ "name": "Pusat", "address": "Jl. A", "phone": "0812", "taxRate": 0 }
```
`name` wajib (2–120); `address` (≤255), `phone` (≤30), `taxRate` (0–100, 2
desimal) opsional.

- `201` → `{ "outlet": { … } }`
- `409` kuota/langganan (lihat aturan di atas), pesan mis.:
  `Batas jumlah outlet untuk paket ini (1) telah tercapai`

### 3. Detail outlet
`GET /api/owner/businesses/:businessId/outlets/:outletId`
`200` → `{ "outlet": { … } }`; `404` bila bukan milik bisnis/sesi.

### 4. Ubah outlet
`PATCH /api/owner/businesses/:businessId/outlets/:outletId`
Body opsional (paling sedikit satu field): `{ "name"?, "address"?, "phone"?,
"taxRate"? }`. `200` → `{ "outlet": { … } }`.

### 5. Hapus outlet (soft delete)
`DELETE /api/owner/businesses/:businessId/outlets/:outletId`
`200` → `{ "outlet": { …, "deleted_at": "…" } }`.
> Catatan: pemeriksaan "tidak ada transaksi aktif" ditambahkan di Fase 7 saat
> tabel `transactions` dibuat.

### 6. Lihat langganan bisnis sendiri (Owner)
`GET /api/owner/businesses/:businessId/subscription`

```json
200
{ "subscription": { "id": "uuid", "business_id": "uuid", "status": "active",
    "started_at": "…", "expires_at": "…", "auto_renew": false,
    "billing_period": "monthly", "price_amount": 4900000 },
  "plan": { "id": "uuid", "name": "NOVA STARTER", "slug": "nova-starter",
    "max_outlets": 1, "max_cashiers": 2, "price_monthly": 4900000,
    "price_yearly": 49000000, "duration_days": 30, "features": {},
    "is_default": false } }
```
Mengembalikan langganan **terbaru** (termasuk status non-aktif). `404` bila
bisnis belum pernah punya langganan.

### 7. Tagihan langganan — pembayaran online (gateway)

Sejak 17 Okt 2026 Owner dapat membayar langganan sendiri lewat gateway
(uji **sandbox Duitku**). Rincian lengkap: **`docs/38-pembayaran-langganan-gateway.md`**.

Prefix tetap `/api/owner/businesses/:businessId/subscription`:

| Metode | Path | Ringkas |
|---|---|---|
| `GET` | `/plans` | `{ gateway, plans }` — paket yang dapat dibeli + kanal aktif |
| `GET` | `/invoices?status=&page=&limit=` | riwayat tagihan bisnis |
| `POST` | `/invoices` | body `{ planId, billingPeriod?, paymentMethod }` → tagihan VA/QRIS |
| `GET` | `/invoices/:invoiceId` | detail tagihan |
| `POST` | `/invoices/:invoiceId/sync` | cek status ke gateway (manual) |

Endpoint **publik** (tanpa sesi, verifikasi tanda tangan HMAC-SHA256):
`POST /api/payments/duitku/callback` dan `GET /api/payments/duitku/return`.
Harga tagihan **selalu** dihitung server dalam sen: `price_yearly` untuk
periode `yearly`, `price_monthly` untuk `monthly`, atau snapshot
`subscriptions.price_amount` bila paket+periode sama sudah disepakati. Klien
tidak pernah mengirim nominal. Tanpa konfigurasi gateway, endpoint pembayaran
menjawab **503** dan aplikasi tetap berjalan normal.

---

## B. Paket langganan — Admin Platform (role `platform_admin`)

Prefix: `/api/platform/plans`

### 1. Daftar paket
`GET /api/platform/plans` → `{ "items": [ … ], "total": n }` (default dulu).

### 2. Buat paket
`POST /api/platform/plans`

Body:
```json
{ "name": "NOVA PRO", "slug": "nova-pro", "maxOutlets": 5, "maxCashiers": 15,
  "priceMonthly": 14900000, "priceYearly": 149000000,
  "durationDays": 30, "features": {}, "isDefault": false, "isActive": true,
  "isPublic": true, "isCustomPrice": false }
```
`price` legacy tetap diterima dan disinkronkan sebagai `price_monthly`.
`201` → `{ "plan": { … } }`. `409` bila nama/slug duplikat atau sudah ada paket
default lain.

### 3. Detail paket
`GET /api/platform/plans/:id` → `{ "plan": { … } }`

### 4. Ubah paket
`PATCH /api/platform/plans/:id` (paling sedikit satu field dari objek plan;
`features` mengganti keseluruhan). `200` → `{ "plan": { … } }`.
`409` bila: nama duplikat, `isDefault:true` saat sudah ada default lain, atau
menonaktifkan/menghapus flag default dari-satu-satunya paket default.

---

## C. Bisnis & langganan — Admin Platform

Prefix: `/api/platform/businesses`

### 1. Daftar semua bisnis
`GET /api/platform/businesses?search=&status=&page=1&limit=20`

Query opsional: `search` (nama bisnis / email owner), `status`
(`active|suspended`), `page`, `limit` (≤100).

```json
200
{ "items": [ { "id": "uuid", "owner_id": "uuid", "name": "Toko A",
  "business_type": "retail", "currency": "IDR", "timezone": "Asia/Jakarta",
  "status": "active", "created_at": "…", "updated_at": "…",
  "owner_email": "…", "owner_name": "…",
  "plan_name": "Gratis", "subscription_status": "active" } ],
  "total": 1, "page": 1, "limit": 20 }
```

### 2. Detail bisnis
`GET /api/platform/businesses/:businessId` → `{ "business": { … } }` (bentuk
sama dengan satu item di atas).

### 3. Lihat langganan suatu bisnis
`GET /api/platform/businesses/:businessId/subscription` → bentuk sama dengan
A.6.

### 4. Pasang paket (ganti langganan)
`POST /api/platform/businesses/:businessId/subscription`

Body: `{ "planId": "uuid", "billingPeriod": "monthly" }`
(`billingPeriod` opsional: `monthly`/`yearly`).

`200` → `{ "subscription": { … }, "plan": { … } }`. Langganan aktif lama
diubah menjadi `expired` (riwayat tetap), langganan aktif baru dibuat mulai
hari ini, `expires_at = now() + duration_days`, serta menyimpan
`billing_period` + `price_amount` snapshot. `404` bila bisnis/paket tidak ada
atau paket nonaktif.

### 5. Ubah status langganan
`PATCH /api/platform/businesses/:businessId/subscription/status`

Body: `{ "status": "active" | "past_due" | "expired" }`

Berlaku pada langganan **terbaru**. `200` → `{ "id", "business_id",
"status" }`. `404` bila bisnis belum pernah punya langganan.

---

## D. Pengujian

- `npm.cmd test` di `server/` — termasuk `tests/outlet-subscription.test.js`
  (20 kasus baru; total 76).
- Kasus negatif inti: outlet ke-2 paket Gratis = 409; langganan bisnis A
  kedaluwarsa tidak memblokir bisnis B; akses outlet lintas tenant = 404;
  duplikat & multi-default paket = 409.