# KASIR NOVA — Kontrak API V0.3: Pengeluaran & Pergerakan Stok

> Berlaku untuk build **V0.3 (migrasi `0009`)**. Error:
> `{ "error": { "message": "..." } }`. Prefix Owner:
> `/api/owner/businesses/:businessId/...` (melewati `requireBusinessAccess`;
> bisnis tenant lain → **404**). Area Kasir memakai prefix `/api/cashier`,
> dan **outlet diturunkan dari akun** — bukan dari URL/bodi, sehingga tidak ada
> permukaan IDOR. Referensi: `docs/13-api-cashier.md`, `docs/14-api-produk-stok.md`,
> `docs/16-api-laporan.md`.

## Ringkasan aturan bisnis

- **Nominal dalam sen** (integer > 0) pada seluruh API. UI mengonversi
  Rp → sen (×100).
- **Tidak ada penghapusan data finansial.**
  - Pengeluaran dibatalkan dengan `void` (`recorded` → `voided` + alasan),
    bukan dihapus.
  - `inventory_movements` bersifat **append-only** (tanpa endpoint ubah/hapus).
- **`inventory_purchase` dikecualikan dari laba.** Pembelian persediaan dagang
  sudah terwakili lewat HPP item yang terjual; menghitungnya lagi sebagai biaya
  operasional akan menghitung ganda. Semua kategori lain masuk sebagai biaya
  operasional.
- `spent_on` (DATE) dihitung di **zona waktu bisnis** dan **tidak boleh
  melebihi hari ini** → **422** untuk format salah, **409** untuk tanggal
  melebihi hari ini.
- **Kasir** hanya melihat/mengelola pengeluaran **outletnya**, dan hanya boleh
  membatalkan catatan **yang ia buat sendiri** (→ **403**). Owner bebas pada
  bisnisnya.
- Isolasi tenant: outlet/bisnis milik tenant lain → **404**.

---

## A. Pengeluaran (Expenses)

Kategori (`category`): `operational`, `utilities`, `supplies`, `transport`,
`maintenance`, `inventory_purchase`, `other`.
Metode (`method`): `cash`, `transfer`, `qr`.

### A.1 Owner

Prefix: `/api/owner/businesses/:businessId/expenses`

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/` | Daftar + total (filter outlet/kasir/kategori/status/tanggal) |
| POST | `/` | Catat pengeluaran → `201 { expense, outlet_name }` |
| POST | `/:expenseId/void` | Batalkan `{ reason }` → `200 { expense }` |

**GET** `?outletId=&cashierId=&category=&status=&from=&to=&page=&limit=`
(`status` default `recorded`; `page=1`; `limit` default 20, maks 100).

```json
200
{ "items": [ { "id": "uuid", "outlet_id": "uuid", "outlet_name": "Pusat",
  "category": "utilities", "amount": 150000, "method": "transfer",
  "note": "Token listrik", "receipt_url": null, "status": "recorded",
  "spent_on": "2026-10-13", "cashier_id": null, "created_by_role": "owner",
  "created_by_id": "uuid", "voided_at": null, "voided_by_role": null,
  "voided_by_id": null, "void_reason": null, "officer_name": "Owner Satu",
  "created_at": "…", "updated_at": "…" } ],
  "total": 1,
  "totals": { "operating_total": 150000, "inventory_total": 0, "total": 150000 },
  "business": { "id": "uuid", "timezone": "Asia/Jakarta" } }
```

**POST** body (semua nominal dalam **sen**):

```json
{ "outletId": "uuid", "category": "utilities", "amount": 150000,
  "method": "transfer", "note": "Token listrik", "receiptUrl": null,
  "date": "2026-10-13" }
```

- `outletId` **wajib** di area Owner; harus outlet bisnis sesi (`404` bila bukan).
- `date` opsional (default: hari ini di zona bisnis). Tidak boleh masa depan → `422`/`409`.
- `receiptUrl`: URL http(s) atau data URL gambar, maks 400.000 karakter.
- Validasi gagal → **422**; kategori/metode tak dikenal → **422**.

**POST `/:expenseId/void`** — `{ "reason": "salah input" }` (≥ 3, ≤ 200).
Void dua kali → **409** ("sudah dibatalkan"). Pengeluaran bisnis lain → **404**.

### A.2 Kasir

Prefix: `/api/cashier/expenses` (outlet dari akun kasir).

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/` | Daftar pengeluaran **outletnya** (filter sama) |
| POST | `/` | Catat pengeluaran di outletnya → `201 { expense, outlet_name }` |
| POST | `/:expenseId/void` | Batalkan **hanya catatannya sendiri** |

- Body **tanpa** `outletId` — outlet diturunkan dari akun (anti-IDOR).
- `method` default `cash`.
- Batalkan catatan kasir lain → **403**.
- `GET /` juga mengembalikan `totals` & `business.timezone`.

---

## B. Pergerakan Stok (`inventory_movements`)

Histori **append-only**: setiap mutasi saldo (stok awal, opname, penjualan,
refund, void, tandai HABIS/aktifkan) menulis satu baris di transaksi DB yang
sama dengan mutasi `product_stocks` — tidak ada mutasi tanpa jejak.

`type`: `initial` | `adjustment` | `sale` | `void` | `refund` | `mark_out` |
`restore`. `qty_delta = qty_after − qty_before`; aksi `mark_out`/`restore`
tanpa perubahan jumlah bernilai `0` tetapi tetap tercatat sebagai kejadian.

### B.1 Owner

`GET /api/owner/businesses/:businessId/inventory-movements`
`?outletId=&productId=&type=&from=&to=&page=&limit=`
(`page=1`; `limit` default 20, maks 100).

```json
200
{ "items": [ { "id": "uuid", "product_id": "uuid", "product_name": "Kopi",
  "type": "sale", "qty_delta": -2, "qty_before": 10, "qty_after": 8,
  "reason": null, "ref_type": "transaction", "ref_id": "uuid",
  "actor_role": "cashier", "actor_id": "uuid", "actor_name": "Kasir Satu",
  "outlet_id": "uuid", "outlet_name": "Pusat", "created_at": "…" } ],
  "total": 1 }
```

- Rentang `from`/`to` dihitung pada **zona waktu bisnis**.
- `business_id` non-tenant → **404**.

### B.2 Kasir

`GET /api/cashier/inventory-movements?productId=&type=&from=&to=&page=&limit=`

- Outlet diturunkan dari akun; `business_id`/`outlet_id` bisnis lain tidak
  pernah terlihat.
- Token owner pada route ini → **403**; kasir pada route Owner → **403**.

---

## C. Catatan audit

Ditulis pada transaksi yang sama: `expense.create`, `expense.void`
(entity `expense`). Pergerakan stok sendiri adalah jejak permanen
(`inventory_movements`). Semua mutasi diverifikasi ulang terhadap `business_id`
(defense-in-depth) selain middleware tenant.

## D. Pengujian

`npm.cmd test` di `server/` — `tests/v03-features.test.js`:

- Fase 5: kasir mencatat pengeluaran outletnya; Owner melihat semua outlet —
  isolasi tenant (404 lintas bisnis).
- Fase 5: koreksi = **void** dua kali ditolak (409); kasir hanya boleh
  membatalkan catatannya sendiri (403).
- Fase 2: penjualan & void mencatat pergerakan stok (`sale`/`void`) dengan
  `qty_before`/`qty_after` konsisten.
- Kategori `inventory_purchase` dikecualikan dari laba bersih pada
  `GET /reports/finance`.

Suite penuh server saat rilis V0.3: **220/220 lulus**.
