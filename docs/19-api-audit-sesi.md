# KASIR NOVA — API Audit Log & Manajemen Sesi (Fase 11)

> Kontrak endpoint **viewer audit log** & **pencabutan sesi bawahan**.
> Audit log bersifat **append-only** (tidak ada endpoint hapus, sesuai matriks
> hak akses §9). Pencabutan sesi = mengisi `revoked_at` pada `refresh_tokens`;
> token lama langsung ditolak `/refresh` (401) — berlaku di server.

## Ringkasan

### Audit Log

| Metode | Path | Hak | Fungsi |
|---|---|---|---|
| `GET` | `/api/platform/audit-logs` | Admin | Baca semua audit log lintas bisnis |
| `GET` | `/api/owner/businesses/:businessId/audit-logs` | Owner | Baca audit log bisnisnya (bisnis lain → 404) |

### Manajemen Sesi

| Metode | Path | Hak | Fungsi |
|---|---|---|---|
| `GET` | `/api/platform/sessions` | Admin | Daftar kasir + jumlah sesi aktif lintas bisnis |
| `POST` | `/api/platform/sessions/:cashierId/revoke` | Admin | Paksa logout semua sesi kasir |
| `GET` | `/api/owner/businesses/:businessId/cashiers/:cashierId/sessions` | Owner | Daftar sesi kasir miliknya |
| `POST` | `/api/owner/businesses/:businessId/cashiers/:cashierId/sessions/revoke` | Owner | Paksa logout semua sesi kasir miliknya |

Kasir tidak memiliki akses ke endpoint mana pun di atas (403).

## GET `/api/platform/audit-logs`

Query (semua opsional):

| Param | Arti |
|---|---|
| `actorRole` | `platform_admin` \| `owner` \| `cashier` |
| `action` | nama aksi persis, mis. `cashier.create`, `transaction.void` |
| `entityType` | tipe entitas, mis. `cashier`, `outlet`, `business` |
| `businessId` | filter per bisnis (admin saja) |
| `from` / `to` | rentang `created_at` (ISO 8601 atau tanggal `YYYY-MM-DD`) |
| `limit` | 1–200, default 50 |
| `offset` | default 0 |

**200 OK** — baris terbaru dahulu:
```json
{
  "items": [
    {
      "id": "…",
      "actor_role": "owner",
      "actor_id": "…",
      "actor_name": "Owner A",
      "actor_email": "owner-a@example.com",
      "business_id": "…",
      "action": "business.create",
      "entity_type": "business",
      "entity_id": "…",
      "before": null,
      "after": { "name": "Bisnis A" },
      "ip": "127.0.0.1",
      "created_at": "2026-10-11T13:00:00.000Z"
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

`actor_name`/`actor_email` berasal dari `LEFT JOIN` tabel peran — **null bila akun
sudah dihapus** (jejak audit tetap dipertahankan).

## GET `/api/owner/businesses/:businessId/audit-logs`

Sama seperti di atas, tetapi `businessId` **wajib dari URL** (nilai query
diabaikan) dan `requireBusinessAccess` menegakkan kepemilikan. Bisnis bukan
milik sesi → **404** (anti-enumerasi).

## GET `/api/platform/sessions`

**200 OK** — satu baris per kasir:
```json
{
  "items": [
    {
      "id": "…",
      "full_name": "Kasir 1",
      "email": "k1@example.com",
      "status": "active",
      "outlet_name": "Outlet A",
      "business_id": "…",
      "business_name": "Bisnis A",
      "active_count": 2,
      "last_active_at": "2026-10-11T12:58:00.000Z"
    }
  ],
  "total": 1,
  "limit": 100
}
```

`active_count` = refresh token tidak dicabut (`revoked_at IS NULL`) dan belum
kedaluwarsa. Kasir tanpa sesi tetap muncul dengan `active_count 0`.

## POST `/api/platform/sessions/:cashierId/revoke`

Paksa logout semua sesi kasir (admin). **200 OK:**
```json
{ "revoked": 2, "message": "Semua sesi kasir dicabut" }
```

| Status | Arti |
|---|---|
| 404 | Kasir tidak ditemukan |
| 403 | Bukan admin |

## GET `/api/owner/businesses/:businessId/cashiers/:cashierId/sessions`

**200 OK** — sesi terbaru dahulu (default 25):
```json
{
  "items": [
    {
      "id": "…",
      "created_at": "2026-10-11T12:00:00.000Z",
      "expires_at": "2026-10-11T14:00:00.000Z",
      "revoked_at": null,
      "ip": "10.0.0.8",
      "user_agent": "Mozilla/5.0 (…)"
    }
  ],
  "total": 2,
  "limit": 25
}
```

Status sesi dihitung klien: aktif bila `revoked_at` null dan `expires_at` > now.

## POST `/api/owner/businesses/:businessId/cashiers/:cashierId/sessions/revoke`

Paksa logout semua sesi kasir milik bisnis. **200 OK:** `{ "revoked": n, "message": "…" }`.

| Status | Arti |
|---|---|
| 404 | Kasir bukan milik bisnis sesi |
| 403 | Bukan owner |

## Perilaku pencabutan (server)

- Dalam **satu transaksi**: `UPDATE refresh_tokens SET revoked_at = now()
  WHERE user_role='cashier' AND user_id=$1 AND revoked_at IS NULL` + tulis audit
  `session.revoke_all` (`entity_type='cashier'`, `business_id` bisnis kasir).
- Token access JWT (15 mnt) tidak dicabut per-token (tanpa blacklist); efek
  logout penuh terjadi saat klien mencoba `/refresh` dengan token lama → 401.
- Akun tidak diblokir: kasir tetap bisa login lagi setelah pencabutan.