# KASIR NOVA — Kontrak API Fase 6: Produk, Kategori, Harga & Stok

> Berlaku untuk build Fase 6 (migrasi `0006`) dan **diperluas V0.3 (migrasi
> `0009`)** — HPP, satuan, foto, HABIS manual, pengelolaan oleh Kasir. Semua
> endpoint Owner di bawah `requireAuth` + `requireRole('owner')` +
> `requireBusinessAccess`. Error: `{ "error": { "message": "..." } }`.
> Referensi: `docs/10-api-owner-business.md`, `docs/12-api-outlet-subscription.md`,
> `docs/13-api-cashier.md`, `docs/18-api-pengeluaran-inventori.md`.

## Ringkasan aturan bisnis

- **Harga dalam sen** (integer ≥ 0) pada seluruh API. UI mengonversi
  Rp → sen (×100). Harga negatif / bukan bilangan bulat → **422**.
- **HPP (`costPrice`)** juga dalam sen (≥ 0). **Dibatasi izin di server:**
  Owner selalu boleh; Kasir hanya bila `can_view_profit`. Field `cost_price`
  **dihapus** dari respons tanpa izin; mengirim `costPrice` tanpa izin → **403**.
- **Stok per outlet**: satu saldo untuk setiap pasangan produk×outlet.
  `CHECK (quantity >= 0)` di skema + validasi Zod mencegah stok negatif.
- Produk **track_stock=true** otomatis mendapat baris stok 0 di setiap outlet
  aktif saat dibuat. Produk **track_stock=false** (mis. jasa) tidak punya baris
  stok; `setStock` untuk produk itu → **409**.
- **Ketersediaan (HABIS) bersifat turunan:**
  `manual_out_of_stock = true` **ATAU** (`track_stock = true` DAN
  `Σ total_stock ≤ 0`). Field respons `out_of_stock` memakai definisi ini dan
  **diblokir server** saat penjualan (409). Menandai HABIS tidak mengubah saldo;
  **aktivasi kembali mensyaratkan stok > 0** (409 bila stok 0).
- **Unik per bisnis**: nama kategori, nama produk, SKU, dan barcode
  (case-insensitive). Konflik → **409**. Nama produk/kategori boleh dipakai
  lagi setelah produk soft-deleted.
- Kategori yang masih dipakai produk aktif tidak bisa dihapus → **409**.
- Isolasi tenant: kategori/produk/outlet bisnis lain → **404**.
- Kasir dapat **membuat/mengubah** produk & mengatur stok **outletnya**;
  **tidak ada** endpoint hapus produk di area kasir (hapus = Owner).

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
`GET /?search=&categoryId=&status=&availability=&sort=&page=&limit=`
(default `page=1`, `limit=20`; `limit` maks 100)

`200 { items: [ { id, category_id, category_name, name, sku, barcode, price,
cost_price, unit, photo_url, track_stock, status, manual_out_of_stock,
out_of_stock, total_stock, created_at, updated_at } ], total }`
— `total_stock` = Σ stok seluruh outlet.

V0.3: `availability` = `all` | `available` | `out_of_stock`;
`sort` = `name` | `stock_asc` | `stock_desc` | `recent`.
`cost_price` **dihapus** dari respons bila pemanggil tidak berizin HPP (kasir
`can_view_profit = false`).

### 2. Buat produk
`POST /`

```json
{ "name": "Nasi Goreng", "price": 15000, "sku": "NG-001",
  "barcode": null, "categoryId": "uuid|null", "trackStock": true,
  "costPrice": 9000, "unit": "porsi", "photoUrl": null,
  "manualOutOfStock": false, "initialStock": 20, "outletId": "uuid" }
```

`201 { product }`. `409` bila nama/SKU/barcode duplikat atau bisnis nonaktif.
- `costPrice`/`unit`/`photoUrl`/`manualOutOfStock` opsional (V0.3). Tanpa izin
  HPP, mengirim `costPrice` → **403**.
- `initialStock` **wajib** disertai `outletId` dan hanya bila `trackStock=true`;
  menulis saldo outlet + satu baris `inventory_movements` bertipe `initial`.
- `photoUrl`: URL http(s) atau data URL gambar (png/jpeg/webp), maks 400.000
  karakter (~300 KB).

### 3. Detail produk
`GET /:productId` → `200 { product, stocks: [ { outlet_id, outlet_name, quantity } ] }`

### 4. Ubah produk
`PATCH /:productId` — minimal satu field dari: `name`, `sku`, `barcode`,
`price`, `costPrice`, `unit`, `photoUrl`, `categoryId`, `trackStock`, `status`,
`manualOutOfStock`, `stockNote`. → `200 { product }`.
Bila `trackStock` diubah ke `false`, baris stok dihapus. Mengirim `costPrice`
tanpa izin HPP → **403**.

### 4b. Tandai HABIS / aktifkan kembali (V0.3, Fase 2)
`PATCH /:productId/stock-status` — `{ "outOfStock": true, "note": "opsional" }`

`200 { product }`. `outOfStock=true` menandai HABIS manual (tanpa mengubah
saldo). `outOfStock=false` mengaktifkan kembali — **409** bila `trackStock=true`
dan saldo outlet 0. Setiap pemanggilan menulis `inventory_movements`
(`mark_out` / `restore`).

### 5. Hapus produk (soft delete)
`DELETE /:productId` → `200 { id, deleted: true }`. Produk hilang dari daftar
dan detail → **404**.

### 6. Atur stok per outlet
`PATCH /:productId/stocks/:outletId` — `{ "quantity": 25 }`

`200 { product_id, product_name, outlet_id, outlet_name, quantity }`.
`404` bila produk/outlet bukan milik bisnis sesi; `409` bila produk
`track_stock=false`; `422` bila `quantity` negatif.

---

## C. Area kasir — Produk & Stok

Prefix: `/api/cashier` (role `cashier`; outlet **diturunkan dari akun** —
tidak ada parameter untuk membajak outlet lain).

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/products` | Katalog + `quantity` (stok outlet kasir), filter & `sort` sama dengan Owner |
| GET | `/categories` | Daftar kategori bisnis |
| POST | `/products` | Buat produk (field sama dengan pembuatan Owner) |
| PATCH | `/products/:productId` | Ubah produk |
| PATCH | `/products/:productId/stock` | Set stok outlet kasir `{ quantity, reason? }` |
| PATCH | `/products/:productId/stock-status` | Tandai HABIS / aktifkan kembali |

- `quantity` = stok **outlet kasir tersebut**; `null` bila `track_stock=false`.
- **Tidak ada** endpoint `DELETE` di area kasir (hapus = Owner, soft delete).
- HPP: `cost_price` disertakan bila `can_view_profit`, dan hanya itu yang
  boleh dikirim; selebihnya `403` (lihat §"Ringkasan aturan bisnis").
- Token owner pada route ini → **403**. Tanpa/kedaluwarsa → **401**.

---

## D. Catatan

- `audit_logs`: `category.create`, `category.update`, `category.delete`,
  `product.create`, `product.update`, `product.delete`, `stock.set`,
  `product.mark_out_of_stock`, `product.restore_stock` dan (V0.3)
  `expense.create`, `expense.void` — `business_id` terisi, ditulis di
  transaksi DB yang sama. Pelaku bisa Owner **atau** Kasir (area kasir).
- Semua mutasi diverifikasi ulang terhadap `business_id` (defense-in-depth),
  selain middleware tenant.

## E. Pengujian

- `npm.cmd test` di `server/` — `tests/products.test.js` (15 kasus Fase 6) dan
  `tests/v03-features.test.js` (V0.3: HPP, stok habis, snapshot HPP & fee).
- Kasus inti: harga/stok negatif = 422; nama/SKU/barcode duplikat (beda
  kapital) = 409; produk/stok bisnis lain = 404; kasir hanya melihat produk
  outletnya + stok miliknya; token kasir di route owner = 403; owner di route
  kasir = 403; produk `track_stock=false` tanpa baris stok & `setStock` = 409;
  soft delete menghilangkan produk dari daftar/detail/kasir.
- V0.3: HPP tidak bocor ke kasir tanpa izin (UI + server, 403 saat mengisi);
  stok 0 ⇒ HABIS otomatis & penjualan diblokir (409); tandai HABIS manual
  memblokir penjualan & aktivasi kembali butuh stok; void mengembalikan stok
  dengan jejak `sale`/`void`; HPP di-snapshot pada item & biaya tersimpan.
