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
    "started_at": "…", "expires_at": "…", "auto_renew": false },
  "plan": { "id": "uuid", "name": "Gratis", "max_outlets": 1,
    "max_cashiers": 1, "price": 0, "duration_days": 30, "features": {},
    "is_default": true } }
```
Mengembalikan langganan **terbaru** (termasuk status non-aktif). `404` bila
bisnis belum pernah punya langganan.

---

## B. Paket langganan — Admin Platform (role `platform_admin`)

Prefix: `/api/platform/plans`

### 1. Daftar paket
`GET /api/platform/plans` → `{ "items": [ … ], "total": n }` (default dulu).

### 2. Buat paket
`POST /api/platform/plans`

Body:
```json
{ "name": "Pro", "maxOutlets": 2, "maxCashiers": 3, "price": 150000,
  "durationDays": 30, "features": {}, "isDefault": false, "isActive": true }
```
`201` → `{ "plan": { … } }`. `409` bila nama duplikat atau sudah ada paket
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

Body: `{ "planId": "uuid" }`

`200` → `{ "subscription": { … }, "plan": { … } }`. Langganan aktif lama
diubah menjadi `expired` (riwayat tetap), langganan aktif baru dibuat mulai
hari ini, `expires_at = now() + duration_days`. `404` bila bisnis/paket tidak
ada atau paket nonaktif.

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