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
| `amount` | BIGINT | sen, `CHECK (amount >= 0)` (0 bila tidak ada setoran tunai) |
| `method` | `cash_deposit_method` | untuk sekarang `cash` saja |
| `note` | TEXT | opsional, maks 300 |
| `receipt_url` | TEXT | URL http(s) atau data URL gambar |
| `status` | `cash_deposit_status` | `draft` \| `completed` \| `recorded` (legacy) \| `voided` |
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

## Setoran berbasis periode (migrasi `0012_cashier_settlements.sql`)

Sejak 19 Okt 2026 setoran tidak lagi nominal manual: sistem **menghitung
otomatis** uang yang harus disetor dari transaksi periode tertentu.

- Kolom baru `cash_deposits`: `settlement_no` (`STR-YYYYMMDD-NNN`, unik per
  bisnis), `period_start`/`period_end`, `shift_label`, `cash_revenue`,
  `qris_revenue`, `total_revenue`, `total_expense`, `cash_expense`,
  `noncash_expense`, `required_cash`, `actual_cash`, `difference`, `shortfall`,
  `cashier_note`, `recipient_name`, `snapshot` (JSONB), `completed_at`.
- Enum status bertambah `draft` & `completed`; `recorded` (legacy) diperlakukan
  sebagai **SELESAI**, `voided` untuk koreksi append-only.
- Tabel relasi `cash_deposit_transactions` & `cash_deposit_expenses` (index unik
  parsial `WHERE is_active`) mencegah satu transaksi/pengeluaran dihitung dua
  kali. Void menonaktifkan relasi agar bisa disetor ulang pada setoran koreksi.
- Shift: `full` (00:00–24:00), `pagi` (08:00–15:00), `sore` (15:00–21:00),
  `malam` (21:00–08:00) dihitung pada zona waktu bisnis.
- Perhitungan: `total_revenue = tunai + QRIS`; **QRIS tidak dihitung fisik**;
  `required_cash = max(0, tunai - pengeluaran_kas)`; `shortfall =
  max(0, pengeluaran_kas - tunai)`; `difference = actual_cash - required_cash`.
  Selisih ≠ 0 wajib beralasan (≥ 3 karakter).
- Anti-duplikat: advisory lock per `bisnis:outlet:tanggal` + deteksi periode
  tumpang tindih (409).

### API tambahan

| Method | Path | Keterangan |
|---|---|---|
| GET | `.../cash-deposits/settlement/preview?date&shift[&outletId]` | pratinjau (read-only, tanpa simpan) |
| POST | `.../cash-deposits/settlement` | simpan `draft`/`completed` |
| GET | `.../cash-deposits/report?group=day\|week\|month` | rekap Owner |
| GET | `.../cash-deposits/export` | berkas `.xlsx` (Owner) |
| GET | `.../cash-deposits/:depositId` | detail + snapshot |
| PATCH | `.../cash-deposits/:depositId/complete` | selesaikan draft |
| DELETE | `.../cash-deposits/:depositId` | hapus draft |
| GET | `/api/platform/cash-settlements` | monitoring lintas bisnis (Admin) |

### Frontend & struk

- Panel Kasir: buat setoran (pratinjau live, pilih shift, draft/selesai),
  riwayat + filter, detail, void, hapus draft, dan **cetak struk**.
- Struk mengikuti `assets/references/Contoh_Struk_Setoran_KASIR_NOVA.png`
  (58mm/80mm, PDF, ESC/POS, pratinjau, cetak ulang, penanda DIBATALKAN).
- Panel Owner: **Laporan Setoran** (filter outlet/kasir/tanggal/status, rekap
  harian/mingguan/bulanan, ekspor Excel).
- Panel Admin Platform: monitoring setoran lintas bisnis (read-only).

## Batas lingkup (belum dikerjakan)

- Integrasi ke laporan laba/rugi tidak dilakukan karena setoran bukan pos
  laba/rugi (hanya perpindahan kas).

## Pengujian

`server/tests/cash-deposits.test.js` (7 kasus): scope outlet kasir & anti-IDOR,
validasi Owner wajib outlet, daftar + total per bisnis, isolasi outlet kasir,
validasi nominal/metode/tanggal, void append-only + wewenang, isolasi tenant &
peran.

`server/tests/cash-settlements.test.js` (12 kasus): perhitungan tunai/QRIS/
pengeluaran kas & non-tunai, setoran sesuai (selisih 0) + nomor unik, penolakan
periode tumpang tindih/duplikat, kewajiban alasan selisih, snapshot setelah
void (reprint), kekurangan kas (wajib 0), periode tanpa transaksi, alur
draft→selesai, isolasi outlet/tenant, rekap laporan, ekspor Excel, dan
monitoring Platform Admin.
