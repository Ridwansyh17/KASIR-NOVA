# KASIR NOVA — Kontrak API Fase 6: Produk, Kategori, Harga & Stok

> Berlaku untuk build Fase 6 (migrasi `0006`). Semua endpoint Owner di bawah
> `requireAuth` + `requireRole('owner')` + `requireBusinessAccess`. Error:
> `{ "error": { "message": "..." } }`. Referensi: `docs/10-api-owner-business.md`,
> `docs/12-api-outlet-subscription.md`, `docs/13-api-cashier.md`.

## Ringkasan aturan bisnis

- **Harga dalam sen** (integer ≥ 0) pada seluruh API. UI mengonversi
  Rp → sen (×100). Harga negatif / bukan bilangan bulat → **422**.
- **Stok per outlet**: satu saldo untuk setiap pasangan produk×outlet.
  `CHECK (quantity >= 0)` di skema + validasi Zod mencegah stok negatif.
- Produk **track_stock=true** otomatis mendapat baris stok 0 di setiap outlet
  aktif saat dibuat. Produk **track_stock=false** (mis. jasa) tidak punya baris
  stok; `setStock` untuk produk itu → **409**.
- **Unik per bisnis**: nama kategori, nama produk, SKU, dan barcode
  (case-insensitive). Konflik → **409**. Nama produk/kategori boleh dipakai
  lagi setelah produk soft-deleted.
- Kategori yang masih dipakai produk aktif tidak bisa dihapus → **409**.
- Isolasi tenant: kategori/produk/outlet bisnis lain → **404**.
- Kasir **hanya membaca** produk outletnya; outlet diturunkan dari akun kasir.

---

## A. Kategori — Owner

Prefix: `/api/owner/businesses/:businessId/categories`

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/` | Daftar kategori + jumlah produk aktif (`product_count`) |
| POST | `/` | Buat kategori `{ "name": "Makanan" }` → `201 { category }` |
| PATCH | `/:categoryId` | Ubah nama `{ "name": "…" }` → `200 { category }` |
| DELETE | `/:categoryId` | Hapus (diblokir `409` bila dipakai) → `200 { id, deleted }` |

`GET` → `200 { items: [ { id, name, created_at, product_count } ], total }`

---

## B. Produk — Owner

Prefix: `/api/owner/businesses/:businessId/products`

### 1. Daftar produk
`GET /?search=&categoryId=&status=&page=&limit=` (default `page=1`, `limit=20`)

`200 { items: [ { id, category_id, category_name, name, sku, barcode, price,
track_stock, status, total_stock, created_at, updated_at } ], total }`
— `total_stock` = Σ stok seluruh outlet.

### 2. Buat produk
`POST /`

```json
{ "name": "Nasi Goreng", "price": 15000, "sku": "NG-001",
  "barcode": null, "categoryId": "uuid|null", "trackStock": true }
```

`201 { product }`. `409` bila nama/SKU/barcode duplikat atau bisnis nonaktif.

### 3. Detail produk
`GET /:productId` → `200 { product, stocks: [ { outlet_id, outlet_name, quantity } ] }`

### 4. Ubah produk
`PATCH /:productId` — field opsional ≥ 1: `name`, `sku`, `barcode`, `price`,
`categoryId`, `trackStock`, `status`. → `200 { product }`.
Bila `trackStock` diubah ke `false`, baris stok dihapus.

### 5. Hapus produk (soft delete)
`DELETE /:productId` → `200 { id, deleted: true }`. Produk hilang dari daftar
dan detail → **404**.

### 6. Atur stok per outlet
`PATCH /:productId/stocks/:outletId` — `{ "quantity": 25 }`

`200 { product_id, product_name, outlet_id, outlet_name, quantity }`.
`404` bila produk/outlet bukan milik bisnis sesi; `409` bila produk
`track_stock=false`; `422` bila `quantity` negatif.

---

## C. Area kasir — Produk (read-only)

`GET /api/cashier/products?search=&page=&limit=` — role `cashier`.

`200 { items: [ { id, name, sku, barcode, price, track_stock,
category_name, quantity } ], total, outlet: { id } }`

- `quantity` = stok **outlet kasir tersebut**; `null` bila `track_stock=false`.
- Outlet **diturunkan dari akun kasir** (`cashiers.outlet_id`), bukan input
  klien — tidak ada parameter untuk membajak outlet lain.
- Token owner pada route ini → **403**. Tanpa/masa token salah → **401**.

---

## D. Catatan

- `audit_logs`: `category.create`, `category.update`, `category.delete`,
  `product.create`, `product.update`, `product.delete`, `stock.set`
  (actor = owner, `business_id` terisi, transaksi sama).
- Semua mutasi diverifikasi ulang terhadap `business_id` (defense-in-depth),
  selain middleware tenant.

## E. Pengujian

- `npm.cmd test` di `server/` — `tests/products.test.js` (15 kasus baru;
  total **110/110**).
- Kasus inti: harga/stok negatif = 422; nama/SKU/barcode duplikat (beda
  kapital) = 409; produk/stok bisnis lain = 404; kasir hanya melihat produk
  outletnya + stok miliknya; token kasir di route owner = 403; owner di route
  kasir = 403; produk `track_stock=false` tanpa baris stok & `setStock` = 409;
  soft delete menghilangkan produk dari daftar/detail/kasir.
