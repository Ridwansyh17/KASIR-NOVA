# KASIR NOVA — Kontrak API: Owner & Bisnis

> Basis URL dev: `http://localhost:4000/api/owner`
> **Semua endpoint WAJIB token `owner`.** Token peran lain → `403`; tanpa
> token → `401`.
> Error: `{ "error": { "message": "...", "details"?: ... } }`.

## Isolasi tenant (penting)

Setiap endpoint dengan `:businessId` melewati middleware tenant
(`requireBusinessAccess`). Bila bisnis **tidak ada**, sudah di-*soft delete*,
**atau milik owner lain**, respons selalu **404** — bukan 403 — supaya
keberadaan data tenant lain tidak bisa ditebak (anti-IDOR / anti-enumerasi).
`business_id` yang bukan UUID ditolak validasi dengan **422**.

## Ringkasan endpoint

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/businesses` | Daftar semua bisnis milik owner |
| POST | `/businesses` | Buat bisnis baru (bebas, tanpa langganan otomatis) |
| GET | `/businesses/:businessId` | Detail bisnis (tenant-checked) |
| PATCH | `/businesses/:businessId` | Ubah nama/jenis/mata uang/zona waktu |
| PATCH | `/businesses/:businessId/status` | Aktifkan / nonaktifkan bisnis |

Field bisnis yang dikembalikan (tanpa kolom internal):
`id, owner_id, name, business_type, currency, timezone, status, created_at, updated_at`

> Catatan: `business_type` adalah **teks bebas** (keputusan pemilik proyek).

---

## GET `/businesses`

Daftar bisnis milik owner (pemanggil), diurutkan terbaru dulu.

**200 OK**
```json
{
  "items": [ { "id": "uuid", "owner_id": "uuid", "name": "Warung Nova",
               "business_type": "F&B", "currency": "IDR",
               "timezone": "Asia/Jakarta", "status": "active",
               "created_at": "2026-..." } ],
  "total": 2
}
```

## POST `/businesses`

**Request**
```json
{
  "name": "Warung Nova",
  "businessType": "F&B",        // opsional, teks bebas
  "currency": "IDR",            // opsional, default IDR (3 huruf, dikapitalkan)
  "timezone": "Asia/Jakarta"    // opsional, default Asia/Jakarta
}
```
- `name` wajib (2–120 karakter).
- Bisnis dibuat **tanpa langganan** (langganan diatur pada fase subscription).

**201 Created** `{ "business": { ... } }` • status awal selalu `active`.
**422** validasi gagal (nama kosong, currency bukan 3 huruf, dsb).

## GET `/businesses/:businessId`

**200 OK** `{ "business": { ... } }`
**404** bila bukan milik owner / tidak ada • **422** id bukan UUID.

## PATCH `/businesses/:businessId`

Ubah sebagian field; minimal satu field. Body: `name` / `businessType` /
`currency` / `timezone` (semua opsional).

**200 OK** `{ "business": { ... } }`
**404** bukan milik owner • **422** tanpa field / validasi gagal.

## PATCH `/businesses/:businessId/status`

**Request** `{ "status": "active" | "suspended" }`

Menonaktifkan bisnis **tidak** mencabut sesi owner (owner tetap bisa masuk;
hanya bisnis itu yang berstatus nonaktif — nanti menjadi input gerbang fitur di
fase langganan). **200 OK** `{ "business": { ... } }`

---

## Catatan implementasi

- **Audit:** `business.create`, `business.update`, `business.status_change`
  ditulis ke `audit_logs` di **transaksi database yang sama** dengan mutasi,
  lengkap dengan `business_id`.
- **Konteks aktif** (bisnis yang sedang dikerjakan owner) hanya disimpan di
  `localStorage` panel; server selalu memverifikasi kepemilikan dari `owner_id`
  token, sehingga pemalsuan konteks tidak berdampak.
- **Deletions:** belum ada endpoint hapus bisnis (matriks hak akses); kolom
  `deleted_at` sudah tersedia untuk soft-delete di fase mendatang.