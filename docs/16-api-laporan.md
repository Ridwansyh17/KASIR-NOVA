# KASIR NOVA — API Laporan Penjualan (Fase 9)

> Kontrak API modul `report`. Semua angka sen (integer)/BIGINT dikonversi
> `Number()` oleh server; UI/test tidak perlu `Number()` lagi pada respons
> laporan. Semua laporan **dihitung server** dengan SQL agregat dan selalu
> difilter `business_id` (cakupan tenant).

## Ringkasan endpoint

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| GET | `/api/owner/businesses/:businessId/reports` | owner | Agregat per periode (day/week/month/year) |
| GET | `/api/owner/businesses/:businessId/reports/summary` | owner | Ringkasan rentang + top 5 produk |
| GET | `/api/owner/businesses/:businessId/reports/export` | owner | Ekspor CSV (default) / JSON |
| GET | `/api/platform/businesses/:businessId/reports[...]` | platform_admin | Sama persis, **baca saja** lintas platform |

Kasir **tidak** memiliki endpoint laporan (403).

## Query bersama (opsional)

| Parameter | Tipe | Keterangan |
|---|---|---|
| `groupBy` | `day` \| `week` \| `month` \| `year` | Hanya pada `/reports`; default `day` |
| `from` | `YYYY-MM-DD` | Awal rentang (default: awal bulan berjalan, zona bisnis) |
| `to` | `YYYY-MM-DD` | Akhir rentang (default: hari ini, zona bisnis) |
| `outletId` | UUID | Batasi ke satu outlet |
| `cashierId` | UUID | Batasi ke satu kasir |
| `format` | `csv` \| `json` | Hanya pada `/export`; default `csv` |

- `to` sebelum `from` → **422**.
- Nilai `from`/`to` diinterpretasikan dalam **zona waktu bisnis**
  (`businesses.timezone`).

## GET /reports — agregat per periode

```jsonc
[
  {
    "period_start": "2026-10-05",   // awal periode (Senin untuk week)
    "transactions": 3,              // jumlah transaksi completed
    "items_sold": 6,                // jumlah baris item (completed)
    "subtotal": 3000000,
    "discount_total": 100000,
    "tax_total": 290000,
    "total": 3190000,               // pendapatan completed
    "voided_total": 50000           // total transaksi voided (terpisah)
  }
]
```

Agregasi memakai `DATE_TRUNC(group, created_at AT TIME ZONE timezone)`.
Hanya `completed` dihitung sebagai pendapatan; `voided` di kolom terpisah.

## GET /reports/summary

```jsonc
{
  "summary": {
    "transactions": 3,
    "total": 3190000,
    "avg_total": 1063333,      // dibulatkan
    "voided_total": 50000,
    "active_outlets": 1
  },
  "top_products": [
    { "product_name": "Nasi Goreng", "qty": 4, "revenue": 2000000 }
  ]
}
```

`top_products` = 5 produk teratas menurut `revenue` (SUM line_total) pada
rentang yang sama.

## GET /reports/export

- `format=csv` → `Content-Type: text/csv; charset=utf-8`, kolom:
  `invoice_no,status,outlet_name,cashier_name,subtotal,discount_total,
  tax_total,total,paid_amount,change_amount,created_at` (RFC 4180).
- `format=json` → `{ "items": [ { …transaksi } ] }` (nilai numerik sudah
  `Number()`).
- Format tidak dikenal → **422**.

## Aturan & keamanan

- Seluruh agregat dilarang dihitung klien; server membaca langsung dari
  tabel `transactions`/`transaction_items`/`payments`.
- Cakupan tenant dijamin `WHERE business_id = $1` + `requireBusinessAccess`
  (owner → 404 untuk bisnis orang lain; platform_admin → semua bisnis).
- Tidak ada migrasi baru: laporan murni agregat SQL di atas skema Fase 7.

## Pengujian

- `node --test tests/reports.test.js` di `server/` — 6 kasus:
  1. grouped == agregasi SQL langsung yang sama (day/week/month/year).
  2. ringkasan rentang sempit = angka yang diketahui; void dipisah; top produk.
  3. filter outlet & rentang; UUID tidak valid & rentang terbalik → 422.
  4. isolasi tenant: owner B → 404; admin lintas platform → 200; dua bisnis
     tidak bocor.
  5. peran salah: kasir → 403 (owner & platform).
  6. ekspor CSV/JSON owner + admin; format tidak dikenal → 422.
- Total suites: **133/133** (Fase 9 menambah 6 kasus dari 127).