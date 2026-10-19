# KASIR NOVA — Setoran Kas (Cash Deposit)

> Modul ini menuntaskan migrasi `0011_cash_deposits.sql` yang sebelumnya
> menggantung. Dokumen ini adalah acuan API, aturan, dan batas lingkup.

## Latar belakang

`0011_cash_deposits.sql` awalnya sudah diterapkan di database dev dan tersedia
di disk, tetapi **belum masuk Git** dan **tanpa kode**. Atas persetujuan pemilik
proyek (19 Okt 2026), migrasi ini dijadikan **fitur nyata**.

## Definisi

**Setoran kas** mencatat uang tunai yang disetorkan oleh kasir/outlet kepada
Owner. Ini **perpindahan kas**, **bukan** pendapatan maupun beban, sehingga
**tidak** memengaruhi laba/rugi pada laporan keuangan.

## Model data (`cash_deposits`)

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | UUID | PK |
| `business_id` | UUID | tenant (OWN CASCADE) |
| `outlet_id` | UUID | outlet asal (ON CASCADE) |
| `amount` | BIGINT | sen, `CHECK (amount > 0)` |
| `method` | `cash_deposit_method` | untuk sekarang `cash` saja |
| `note` | TEXT | opsional, maks 300 |
| `receipt_url` | TEXT | URL http(s) atau data URL gambar |
| `status` | `cash_deposit_status` | `recorded` \| `voided` |
| `deposited_on` | DATE | tanggal di zona waktu bisnis |
| `cashier_id` | UUID | terisi bila dicatat kasir |
| `created_by_role` / `created_by_id` | `user_role` / UUID | pelaku |
| `voided_at` / `voided_by_role` / `voided_by_id` / `void_reason` | — | koreksi |

Indeks: `(business_id, deposited_on DESC, created_at DESC)` dan
`(outlet_id, deposited_on DESC, created_at DESC)`. Trigger `set_updated_at`.

## API

### Owner (`requireRole('owner')` + tenant-check)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/owner/businesses/:businessId/cash-deposits` | daftar + total |
| POST | `/api/owner/businesses/:businessId/cash-deposits` | catat (wajib `outletId`) |
| POST | `/api/owner/businesses/:businessId/cash-deposits/:depositId/void` | batalkan |

### Kasir (`requireRole('cashier')` + scope akun)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/cashier/cash-deposits` | daftar outlet akun |
| POST | `/api/cashier/cash-deposits` | catat untuk outlet akun |
| POST | `/api/cashier/cash-deposits/:depositId/void` | batalkan milik sendiri |

> Area kasir **mengabaikan** `outletId` yang dikirim klien: outlet diambil dari
> akun (`req.cashierScope`). Tidak ada permukaan IDOR.

### Body `POST` (catat)

```json
{
  "amount": 125000,
  "method": "cash",
  "note": "Setoran pagi",
  "receiptUrl": "https://... atau data:image/png;base64,...",
  "date": "2026-10-19",
  "outletId": "<uuid, wajib untuk Owner>"
}
```

### Query `GET` (daftar)

`outletId`, `cashierId`, `status` (`recorded` default), `from`, `to`, `page`,
`limit` (maks 100).

Respons daftar:

```json
{
  "items": [ ... ],
  "total": 2,
  "totals": { "recorded_total": 325000, "voided_total": 0 },
  "business": { "id": "...", "timezone": "Asia/Jakarta" }
}
```

## Aturan & validasi

- `amount` bilangan bulat sen, `> 0`, maks `100_000_000_000`.
- `method` hanya `cash` (422 bila lain).
- `date` format `YYYY-MM-DD`; tidak boleh melebihi hari ini di zona bisnis (409).
- Bisnis harus `active` (409 bila nonaktif).
- Koreksi **append-only**: `void` mengubah status + alasan + pelaku; baris tidak
  pernah dihapus. Void ganda → 409.
- **Kasir hanya boleh void catatannya sendiri** (403); Owner boleh semua.
- Audit: `cash_deposit.create`, `cash_deposit.void`.

## Batas lingkup (belum dikerjakan)

- **UI frontend** (panel Owner/Kasir) belum dibuat — backend saja pada tahap ini.
- Metode selain `cash` (transfer/QR) menunggu migrasi enum baru.
- Integrasi ke laporan keuangan (mis. ringkasan setoran per periode) belum
  ditambahkan karena setoran bukan pos laba/rugi.

## Pengujian

`server/tests/cash-deposits.test.js` (7 kasus): scope outlet kasir & anti-IDOR,
validasi Owner wajib outlet, daftar + total per bisnis, isolasi outlet kasir,
validasi nominal/metode/tanggal, void append-only + wewenang, isolasi tenant &
peran.
