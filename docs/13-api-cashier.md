# KASIR NOVA — Kontrak API Fase 5: Kasir

> Berlaku untuk build Fase 5 (migrasi `0005`). Semua endpoint di bawah
> `requireAuth` + verifikasi peran; error: `{ "error": { "message": "..." } }`.
> Referensi: `docs/08-api-auth.md`, `docs/10-api-owner-business.md`,
> `docs/12-api-outlet-subscription.md`.

## Ringkasan aturan bisnis

- **1 kasir = 1 outlet**: `outlet_id` NOT NULL (FK). Satu baris kasir hanya
  punya satu outlet; email TIDAK bisa dipakai akun kedua (index UNIQUE
  `lower(email)`).
- Membuat kasir melewati gerbang kuota **`max_cashiers`** paket langganan
  (bisnis aktif + langganan aktif & belum kedaluwarsa + jumlah kasir aktif
  < kuota). Penolakan → **409**.
- Kasir login & beraktivitas lewat peran `cashier` saja; access token kasir
  ditolak pada route owner (403). Peran `cashier` diaktifkan dengan membalik
  satu komentar di `USER_STORES` (`auth/service.js`) — mesin otorisasi yang
  sama (requireAuth/requireRole) berlaku utuh.
- Daftar kasir = kasir milik bisnis sesi (via `outlets.business_id`).
- Suspend / reset password **mencabut seluruh sesi** kasir di server.

---

## A. Kelola kasir — Owner (role `owner`)

Prefix: `/api/owner/businesses/:businessId/cashiers`, semua melewati
`requireBusinessAccess` (bisnis milik tenant lain = **404**).

### 1. Daftar kasir
`GET /api/owner/businesses/:businessId/cashiers`

```json
200
{ "items": [ { "id": "uuid", "outlet_id": "uuid", "outlet_name": "Pusat",
  "email": "kasir1@nova.test", "full_name": "Kasir Satu", "status": "active",
  "created_by": "uuid", "created_at": "…", "updated_at": "…" } ], "total": 1 }
```

### 2. Buat kasir
`POST /api/owner/businesses/:businessId/cashiers`

```json
{ "fullName": "Kasir Satu", "email": "kasir1@nova.test",
  "password": "minimal-8", "pin": "123456", "outletId": "uuid" }
```

- `fullName` wajib (2–120), `email` valid & (opsional) `pin` **4–6 digit**.
- `201` → `{ "cashier": { … } }` (status awal `active`, `created_by` = owner).
- `409` bila kuota `max_cashiers` penuh (mis. paket Gratis setelah 1 kasir)
  **atau** email sudah dipakai kasir lain (tidak memandang kapital).
- `404` bila bisnis/outlet tidak ditemukan atau outlet milik bisnis lain.

### 3. Detail kasir
`GET /api/owner/businesses/:businessId/cashiers/:cashierId` → `200`
`{ "cashier": { … } }`; `404` bila bukan milik bisnis sesi.

### 4. Ubah kasir (nama / PIN)
`PATCH /api/owner/businesses/:businessId/cashiers/:cashierId`

Body opsional (≥1 field): `{ "fullName"?, "pin"? }`. `200` → `{ "cashier": { … } }`.

### 5. Ubah status (suspend / aktifkan)
`PATCH /api/owner/businesses/:businessId/cashiers/:cashierId/status`

```json
{ "status": "active" | "suspended" }
```
`200` → `{ "cashier": { … } }`. **Suspend mencabut semua sesi kasir**: token
lama langsung 401 di request berikutnya (requireAuth memeriksa ulang status
di DB tiap request).

### 6. Reset password
`POST /api/owner/businesses/:businessId/cashiers/:cashierId/password`

```json
{ "password": "baru-minimal-8" }
```
`200` → `{ "id": "uuid", "password_changed": true }`; semua sesi lama dicabut.

---

## B. Sesi kasir — common (`/api/auth`)

- `POST /api/auth/login { "role":"cashier", "email", "password" }` → `200`
  `{ accessToken, refreshToken, user:{ id, email, fullName, role } }`;
  `401` kredensial salah; `403` akun `suspended`.
- `GET /api/auth/me` (Bearer) → `200`
  `{ user: { … }, context: { outlet:{id,name}, business:{id,name,currency} } }`
  — konteks outlet+bisnis khusus peran kasir.
- `POST /api/auth/refresh` & `POST /api/auth/logout` sama seperti peran lain.

---

## C. Catatan

- `audit_logs`: aksi `cashier.create`, `cashier.update`,
  `cashier.status_change`, `cashier.password_reset` (actor = owner, transaksi
  sama, `business_id` terisi).
- `pin_hash` tersimpan scrypt (`pin:N:r:p:salt:hash`); nilai PIN tidak
  pernah ditulis ke log. Login PIN diaktifkan saat area kasir memakainya.

## D. Pengujian

- `npm.cmd test` di `server/` — `tests/cashier.test.js` (19 kasus baru;
  total **95/95**).
- Kasus negatif inti: email yang sama di outlet kedua = **409** (diuji pula
  beda kapital `C1@NOVA.test`); kasir/outlet bisnis lain = **404**; quota
  Gratis 1 kasir = **409**; access token kasir di route owner = **403**;
  token sebelum suspend = **401**.