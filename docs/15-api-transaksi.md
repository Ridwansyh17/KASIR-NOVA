# KASIR NOVA — Kontrak API Fase 7: Transaksi Penjualan

> Berlaku untuk build Fase 7 (migrasi `0007`). Error: `{ "error": { "message":
> "..." } }`. Referensi: `docs/10-api-owner-business.md`,
> `docs/12-api-outlet-subscription.md`, `docs/14-api-produk-stok.md`.
>
> Keputusan bisnis Fase 7 (arsip `docs/11-keputusan-menunggu.md`): pajak
> **per outlet** (`tax_inclusive`), diskon **per transaksi** (persen/nominal)
> sebelum pajak, void oleh Owner **mengembalikan stok**, pembayaran tunai +
> kartu/QR/wallet **dicatat manual** (tanpa gateway).

## Ringkasan aturan bisnis

- **Nominal dalam sen (integer)** di seluruh API. Harga/total **dihitung ulang
  server dari katalog** — kasir tidak bisa mengirim harga sendiri; input klien
  hanya `productId` + `qty` (+ diskon/pembayaran/catatan).
- Diskon **per transaksi**: `percent` (≤ 100) atau `amount` (sen), diterapkan
  **sebelum pajak**. Diskon melebihi subtotal → **409**.
- Pajak **per outlet** (snapshot disimpan di transaksi):
  - eksklusif (`tax_inclusive=false`): `total = (subtotal − diskon) × (1 + rate)`.
  - inklusif (`tax_inclusive=true`): harga sudah termasuk pajak; porsi pajak
    dipisahkan dari total, `total = subtotal − diskon`.
- **Anti-duplikasi**: `clientRef` (UUID) unik per outlet; permintaan ulang
  dengan `clientRef` sama mengembalikan transaksi yang sama (`200` +
  `idempotent: true`) tanpa mengurangi stok lagi.
- Pengurangan stok memakai `UPDATE ... WHERE quantity >= qty` di dalam **satu
  DB transaction** → stok tidak pernah negatif walau penjualan paralel.
- Void: hanya **Owner**; transaksi `completed` → `voided` + stok dikembalikan.
  Void ulang / status lain → **409**.
- Kasir: outlet diturunkan dari akun (anti-IDOR); token owner di route kasir =
  **403**; token kasir di route void owner = **403**.

---

## A. Kasir — Buat penjualan

`POST /api/cashier/transactions` — role `cashier`.

```json
{
  "items": [
    { "productId": "uuid", "qty": 2 },
    { "productId": "uuid", "qty": 1 }
  ],
  "discount": { "type": "percent", "value": 12.5 },
  "payment": { "method": "cash", "amount": 60000, "reference": null },
  "note": "opsional",
  "clientRef": "uuid (opsional, untuk anti-duplikasi)"
}
```

- `discount` opsional (boleh `null`); `value` persen boleh desimal (≤ 100),
  nominal harus integer sen.
- `payment.method`: `cash` | `card` | `qr` | `wallet`.
  - `cash`: `amount` boleh lebih besar dari total → `change_amount` dihitung.
  - non-tunai: `amount` **harus sama dengan total** → selain itu **409**.
- Validasi skema gagal → **422** `{ error: { details: { fields: [...] } } }`.

`201 { transaction, idempotent: false }` — atau `200 { …, idempotent: true }`
bila `clientRef` sudah dipakai. `transaction` berbentuk:

```json
{ "id": "uuid", "business_id": "uuid", "outlet_id": "uuid",
  "cashier_id": "uuid", "invoice_no": "INV-20261011-0001",
  "status": "completed", "subtotal": 55000, "discount_type": "percent",
  "discount_value": 1250, "discount_total": 6875, "tax_rate": "10.00",
  "tax_inclusive": false, "tax_total": 4813, "total": 52938,
  "paid_amount": 60000, "change_amount": 7062, "note": null,
  "client_ref": "uuid|null", "voided_at": null, "voided_by": null,
  "created_at": "…", "updated_at": "…", "outlet_name": "…",
  "cashier_name": "…",
  "items": [ { "id": "uuid", "product_id": "uuid", "product_name": "…",
      "sku": "…", "unit_price": 15000, "qty": 2, "discount_amount": 3125,
      "tax_amount": 2375, "line_total": 15625 } ],
  "payments": [ { "id": "uuid", "method": "cash", "amount": 60000,
      "reference": null, "provider": null, "status": "paid" } ] }
```

Error bisnis: produk tidak ditemukan **404**; produk/bisnis/outlet/kasir
nonaktif **409**; stok kurang **409** (`Stok "…" tidak mencukupi`); diskon >
subtotal **409**; uang tunai kurang **409**; produk duplikat di keranjang
**409**.

## B. Kasir — Riwayat & detail

`GET /api/cashier/transactions?status=&dateFrom=&dateTo=&page=&limit=`
— role `cashier`, outlet dari akun.

`200 { items: [ { id, invoice_no, status, subtotal, discount_total,
tax_total, total, paid_amount, change_amount, created_at, voided_at,
outlet_id, outlet_name, cashier_id, cashier_name } ], total }`

`GET /api/cashier/transactions/:transactionId` → `200 { transaction }`
(detail sama seperti A). Transaksi milik outlet lain → **404**.

## C. Owner — Riwayat, detail, void

Prefix: `/api/owner/businesses/:businessId/transactions` — role `owner` +
tenant check (bisnis/transaksi milik owner lain → **404**).

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/` | Filter: `outletId`, `cashierId`, `status`, `dateFrom`, `dateTo`, `page`, `limit` |
| GET | `/:transactionId` | Detail lengkap (item + pembayaran) |
| POST | `/:transactionId/void` | Batalkan → status `voided`, stok dikembalikan |

`void` → `200 { transaction }` (status `voided`, `voided_at`, `voided_by`
terisi). Void transaksi yang bukan `completed` → **409**.

## D. Admin Platform — baca transaksi

`GET /api/platform/businesses/:businessId/transactions` dan
`GET /api/platform/businesses/:businessId/transactions/:transactionId` —
role `platform_admin`, **baca saja** (matriks hak akses). Bentuk respons sama
dengan C.

## E. Konfigurasi pajak outlet (Owner)

`PATCH /api/owner/businesses/:businessId/outlets/:outletId`
— field `taxRate` (0–100) dan `taxInclusive` (boolean). Migrasi `0007`
menambahkan kolom `tax_inclusive` (default FALSE). Perubahan hanya berlaku
untuk transaksi berikutnya (transaksi lama menyimpan snapshot).

## F. Catatan

- `audit_logs`: `transaction.create` (actor = cashier), `transaction.void`
  (actor = owner) — ditulis di DB transaksi yang sama.
- Penomoran invoice: `outlet_invoice_counters` per (outlet, hari) dengan zona
  waktu bisnis; format `INV-YYYYMMDD-NNNN` (atomik, unik per outlet).
- Outlet yang masih punya transaksi `completed` **tidak bisa dihapus** (409).

## G. Pengujian

- `npm.cmd test` di `server/` — `tests/transactions.test.js` (16 kasus baru;
  total **126/126**).
- Kasus inti: total dihitung server + stok berkurang atomik; diskon persen
  (12.5%) & nominal sebelum pajak; pajak inklusif vs eksklusif per outlet;
  stok kurang = 409 tanpa stok negatif; **dua penjualan paralel hanya satu
  yang berhasil** (stok 4, qty 3 + 3 → 201 & 409, sisa 1); `clientRef` dua
  kali = transaksi sama tanpa stok berkurang dua kali; void Owner
  mengembalikan stok & void ulang 409; isolasi tenant (owner/kasir lintas
  bisnis = 404); peran salah (owner di route kasir = 403, kasir di route void
  = 403); admin bisa baca transaksi; outlet ber-transaksi tidak bisa dihapus;
  audit `transaction.create`/`transaction.void` tercatat.