# KASIR NOVA — API PIN Login Kasir (Fase 10b)

> Kontrak endpoint untuk **PIN login kasir**. Keputusan pemilik 11 Okt 2026:
> PIN **4 digit**, **opsional** (password tetap ada), **boleh sama** antar kasir
> (alur: pilih kartu kasir → verifikasi PIN). Lockout: **5× salah → kunci
> sementara 15 menit; 10× salah → status `locked`** (hanya Owner yang membuka).

Endpoint login PIN & kartu pemilih sudah tercatat juga di `docs/08-api-auth.md`;
dokumen ini menambah sisi pengelolaan oleh **Owner**.

## Ringkasan

| Metode | Path (di bawah `/api/owner/businesses/:businessId`) | Fungsi |
|---|---|---|
| `GET`  | `/cashiers` | Daftar kasir (termasuk `pin_set_at`, status `locked`) |
| `POST` | `/cashiers` | Buat kasir (field `pin` opsional, 4 digit) |
| `POST` | `/cashiers/:cashierId/pin` | Pasang / ganti PIN kasir |
| `DELETE` | `/cashiers/:cashierId/pin` | Hapus PIN → kembali password-only |
| `POST` | `/cashiers/:cashierId/pin/unlock` | Buka kunci kasir `locked` |

Semua route di bawah ini: **butuh access token Owner**, terisolasi per
`business_id` (bisnis bukan milik sesi → 404), dan mencatat audit
(`cashier.pin_set`, `cashier.pin_remove`, `cashier.pin_unlock`).

## POST `/api/owner/businesses/:businessId/cashiers/:cashierId/pin`

**Request**
```json
{ "pin": "2468" }
```

**200 OK**
```json
{ "cashier": { "id": "…", "status": "active", "pin_set_at": "2026-10-11T…" } }
```

**Perilaku:** menyetel PIN baru = intervensi Owner —
`pin_set_at` diisi, penghitung gagal & kunci sementara direset, status `locked`
dikembalikan ke `active`, lalu **semua sesi kasir dicabut** (berlaku server).

| Status | Arti |
|---|---|
| 404 | Kasir bukan milik bisnis sesi |
| 422 | `pin` bukan 4 digit |

## DELETE `/api/owner/businesses/:businessId/cashiers/:cashierId/pin`

Hapus PIN (dan reset lockout; status `locked` ikut dibuka). Kasir kembali login
hanya via email/password. **200 OK** mengembalikan `{ cashier }`.

## POST `/api/owner/businesses/:businessId/cashiers/:cashierId/pin/unlock`

Buka kunci kasir yang `locked`: `pin_failed_attempts = 0`,
`pin_locked_until = NULL`, status `active` (hanya bila `locked`). **200 OK**
mengembalikan `{ cashier }`.

## Alur klien (apps/kasir)

1. Perangkat terikat outlet (disimpan `localStorage`, diisi saat login apa pun).
2. Layar PIN: `GET /api/auth/cashiers?outletId=…` → kartu kasir ber-PIN.
3. Kasir pilih kartu → ketik PIN → `POST /api/auth/cashier-pin`.
4. Sesi normal: access + refresh; alur refresh/logout tidak berubah.

## Keamanan

- `pin_hash` memakai **scrypt** (parameter sama dengan password, prefix `pin:`);
  PIN tidak pernah disimpan mentah / di-log / dikembalikan API.
- Lockout dihitung **atomik** (`UPDATE … pin_failed_attempts + 1 … RETURNING`)
  agar percobaan serentak tidak lolos.
- Pesan gagal **seragam** (anti-enumerasi). `GET /api/auth/cashiers` hanya
  mengembalikan nama, scoped outlet UUID.
- Status `locked` memblokir **semua** jalur login kasir, termasuk
  email/password, sampai Owner membuka.