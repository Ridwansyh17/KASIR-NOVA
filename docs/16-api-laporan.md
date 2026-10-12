# KASIR NOVA — API Laporan Penjualan (Fase 9 + Fase 15 ekspor Excel + Fase 16 perbandingan)

> Kontrak API modul `report`. Semua angka sen (integer)/BIGINT dikonversi
> `Number()` oleh server; UI/test tidak perlu `Number()` lagi pada respons
> laporan. Semua laporan **dihitung server** dengan SQL agregat dan selalu
> difilter `business_id` (cakupan tenant).

## Ringkasan endpoint

| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| GET | `/api/owner/businesses/:businessId/reports` | owner | Agregat per periode (day/week/month/year) |
| GET | `/api/owner/businesses/:businessId/reports/summary` | owner | Ringkasan rentang + top 5 produk |
| GET | `/api/owner/businesses/:businessId/reports/export` | owner | Ekspor CSV (default) / JSON / **XLSX** |
| GET | `/api/owner/businesses/:businessId/reports/outlets` | owner | **Perbandingan tiap outlet** dalam bisnis (Fase 16) |
| GET | `/api/owner/businesses/:businessId/reports/outlets/export` | owner | Ekspor perbandingan outlet (JSON / **XLSX**) |
| GET | `/api/owner/reports/businesses` | owner | **Perbandingan lintas-bisnis** milik Owner (Fase 16) |
| GET | `/api/owner/reports/businesses/export` | owner | Ekspor perbandingan lintas-bisnis (JSON / **XLSX**) |
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
| `status` | `completed` \| `voided` \| `refunded` | Batasi status transaksi |
| `paymentMethod` | `cash` \| `card` \| `qr` \| `wallet` | Batasi metode pembayaran |
| `paymentStatus` | `paid` \| `pending` \| `failed` \| `refunded` | Batasi status pembayaran |
| `search` | string (≤100) | Cari `invoice_no` **atau** `note` (ILIKE, wildcard di-escape) |
| `format` | `csv` \| `json` \| `xlsx` | Hanya pada `/export`; default `csv` |

- `to` sebelum `from` → **422**.
- Nilai `from`/`to` diinterpretasikan dalam **zona waktu bisnis**
  (`businesses.timezone`).
- Filter `outletId`/`cashierId`/`status`/`paymentMethod`/`paymentStatus`/`search`
  dipakai **bersama** oleh agregat, ringkasan, dan ekspor sehingga angkanya
  konsisten satu sama lain. `paymentMethod`/`paymentStatus` memakai `EXISTS`
  (tidak menggandakan baris bila transaksi punya >1 pembayaran).
- Frontend **wajib** membuang parameter bernilai kosong (mis. `outletId=`)
  sebelum mengirim; enum kosong memicu 422.

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
- `format=xlsx` → berkas Microsoft Excel (Open XML) dengan header
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `Content-Disposition: attachment; filename="…"` (juga di-*expose* via CORS
  `exposedHeaders` agar nama file terbaca klien), dan `Content-Length`.
  Nama berkas: `KASIR_NOVA_Rekapan_Transaksi_<from>_sampai_<to>.xlsx`
  (tanggal efektif zona bisnis). Lihat bagian **Ekspor Excel**.
- Format tidak dikenal → **422**.

## Ekspor Excel (`format=xlsx`)

Berkas dibuat server dengan **ExcelJS** (`server/src/modules/report/xlsx.js`)
dan berisi **4 sheet**:

1. **Ringkasan** — identitas bisnis (nama, jenis usaha, mata uang, zona waktu),
   periode & filter terpakai, ringkasan transaksi (jumlah selesai/void/refund,
   total pendapatan, rata-rata), pemisahan pembayaran (lunas/pending/gagal,
   dihitung pada transaksi **selesai**), dan rekap metode pembayaran.
2. **Detail Transaksi** — satu baris per transaksi pada rentang terfilter:
   nomor, tanggal & waktu **lokal bisnis**, outlet, kasir, subtotal, diskon,
   pajak, total, dibayar, kembalian, metode, status pembayaran, status
   transaksi, catatan. Header beku + autofilter.
3. **Rekap Harian** — per tanggal lokal: jumlah transaksi, omzet (selesai),
   void, refund, pending, gagal.
4. **Rekap Metode Pembayaran** — per metode: jumlah transaksi & total omzet
   (hanya transaksi selesai).

Aturan penting:

- **Nominal** disimpan **sen** di DB, dikonversi ke **rupiah** pada berkas dan
  diformat `"Rp"#,##0`.
- **Hanya transaksi nyata** (tanpa data contoh/dummy) yang diekspor; total
  "pendapatan" memakai definisi yang **sama** dengan dashboard
  (`REPORTS/summary`: `status = completed`), sehingga angka Excel = dashboard.
- **Proteksi formula injection**: nilai teks yang diawali `=`, `+`, `-`, `@`,
  TAB, atau CR diberi awalan apostrof sehingga tidak dieksekusi Excel.
- Data besar diproses di server (satu query terurut per rentang); tidak ada
  perulangan request dari klien.

## Perbandingan outlet & lintas-bisnis (Fase 16)

Dua laporan perbandingan **khusus peran Owner** (tetap owner-scoped).

### GET /reports/outlets — perbandingan outlet (satu bisnis)

Membandingkan tiap outlet **milik bisnis** tersebut pada rentang & filter yang
sama dengan laporan per-bisnis. Query = filter laporan biasa (tanpa `groupBy`).
**Outlet tanpa transaksi tetap tampil** (LEFT JOIN) bernilai nol.

```jsonc
{
  "items": [
    { "outlet_id": "…", "outlet_name": "Outlet Utama", "outlet_status": "active",
      "transactions": 3, "items_sold": 6,
      "subtotal": 3000000, "discount_total": 0, "tax_total": 290000,
      "total": 3190000, "voided_total": 50000, "refunded_total": 0 }
  ],
  "totals": { "transactions": 3, "items_sold": 6, "total": 3190000,
              "voided_total": 50000, "refunded_total": 0, "outlets": 1 }
}
```

### GET /api/owner/reports/businesses — lintas-bisnis

Membandingkan **seluruh bisnis milik Owner** pada rentang yang sama. Filter:
`from`, `to`, `status`, `paymentMethod`, `paymentStatus`, `search` (tanpa
`outletId`/`cashierId`).

- Batas rentang `from`/`to` (`YYYY-MM-DD`) diinterpretasikan **per zona waktu
  masing-masing bisnis** (`businesses.timezone`), sehingga hari lokal setiap
  bisnis dihitung dengan benar.
- Bisnis tanpa transaksi tetap tampil bernilai nol.

```jsonc
{
  "items": [
    { "business_id": "…", "name": "Demo Kasir NOVA", "business_type": "Retail",
      "currency": "IDR", "timezone": "Asia/Jakarta", "active_outlets": 1,
      "transactions": 3, "items_sold": 6, "total": 3190000,
      "voided_total": 50000, "refunded_total": 0 }
  ],
  "totals": { "transactions": 3, "items_sold": 6, "total": 3190000,
              "voided_total": 50000, "refunded_total": 0, "businesses": 1 }
}
```

### Ekspor perbandingan

`/reports/outlets/export` dan `/api/owner/reports/businesses/export` menerima
`format=xlsx` (default) atau `format=json`, dengan filter yang sama seperti
endpoint JSON-nya. Berkas XLSX berisi **2 sheet**: `Ringkasan` dan
`Perbandingan Outlet` / `Perbandingan Bisnis`. Nominal sen → rupiah,
`"Rp"#,##0`, proteksi formula injection, dan **omzet hanya transaksi
`completed`** — definisi yang sama dengan dashboard.

> Catatan perbaikan (Fase 16): agregat omzet memakai subquery korelatif untuk
> `items_sold` sehingga **tidak** ada fan-out dari JOIN `transaction_items`
> (sebelumnya `SUM(t.total)` berlipat sejumlah baris item). Berlaku untuk
> `groupedReport`, `outletComparison`, dan `businessComparison`.

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
- `node --test tests/report-xlsx.test.js` — 7 kasus (Fase 15): berkas XLSX valid
  + 4 sheet, ringkasan = `/summary`, tiap filter (status/metode/status
  pembayaran/pencarian), konsistensi total, bisnis tanpa transaksi, proteksi
  formula injection, akses (kasir 403 / owner lain 404), validasi 422, dan CSV
  tetap berfungsi. Berkas hasil di-*parse balik* dengan ExcelJS, bukan sekadar
  dicek status HTTP.
- `node --test tests/report-comparison.test.js` — 7 kasus (Fase 16):
  1. perbandingan outlet (agregat per outlet, outlet kosong ikut tampil);
  2. rentang tanggal mempersempit (transaksi lampau keluar);
  3. `groupedReport` tidak berlipat untuk transaksi multi-item (perbaikan
     fan-out: `SUM(total)` dihitung sekali per transaksi, bukan per item);
  4. perbandingan lintas-bisnis + isolasi tenant (owner B tidak bocor);
  5. ekspor XLSX perbandingan outlet (2 sheet, sanitasi formula, total rupiah);
  6. ekspor XLSX lintas-bisnis (2 sheet) + nama bisnis berbahaya disanitasi;
  7. akses & validasi: kasir 403, owner lain 404, format/rentang buruk 422,
     `format=json`.
- Total suite server: **173/173** (Fase 9 = 133; Fase 15 menambah 7 dari 159;
  Fase 16 menambah 7 dari 166).