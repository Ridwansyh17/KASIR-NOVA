# KASIR NOVA — Kontrak API: Platform Admin

> Basis URL dev: `http://localhost:4000/api/platform`
> **Semua endpoint WAJIB token `platform_admin`.** Token peran lain → `403`.
> Error: `{ "error": { "message": "...", "details"?: ... } }`.
>
> **Akun Admin sendiri tidak dikelola lewat API ini** (sengaja): modul ini
> mengelola **Owner** dan langganan bisnis. Membuat/mengubah akun Admin hanya
> lewat CLI `npm run admin:create` / `admin:password` / `admin:status`
> (lihat `docs/04` § 2).

## Ringkasan endpoint

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/owners` | Daftar owner (cari, filter status, paginasi) |
| POST | `/owners` | Buat owner baru |
| GET | `/owners/:id` | Detail owner |
| PATCH | `/owners/:id` | Ubah nama/email/telepon owner |
| PATCH | `/owners/:id/status` | Suspend / aktivasi owner |
| POST | `/owners/:id/password` | Reset password owner |
| DELETE | `/owners/:id` | Soft delete owner |

Field owner yang dikembalikan (tanpa `password_hash`):
`id, email, full_name, phone, status, created_by, created_at, updated_at, deleted_at,
email_verified_at, pending_business_name, email_verification_method, firebase_linked,
registration_status`

`registration_status` berasal dari `owner_registrations` (`draft`, `pending`,
`approved`, `rejected`; `null` untuk Owner tanpa pendaftaran mandiri).

---

## GET `/owners`

Query: `search` (nama/email), `status` (`active`\|`suspended`), `page` (≥1,
default 1), `limit` (1–100, default 20).

**200 OK**
```json
{
  "items": [ { "id": "uuid", "email": "owner@nova.test", "full_name": "Owner Demo",
               "phone": null, "status": "active", "created_at": "2026-..." } ],
  "total": 1, "page": 1, "limit": 20
}
```

## POST `/owners`

**Request**
```json
{ "email": "owner@nova.test", "password": "minimal8karakter", "fullName": "Owner Demo", "phone": "+62812..." }
```
- `password` ≥ 8 karakter. `phone` opsional.
- Email **unik tanpa memandang huruf besar/kecil** (index `lower(email)`).

**201 Created** `{ "owner": { ... } }`

| Status | Arti |
|---|---|
| 201 | Dibuat |
| 409 | Email sudah terdaftar |
| 422 | Validasi gagal |

## Approval Center

Semua endpoint memerlukan token `platform_admin`.

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/approvals` | Daftar pending/riwayat + jumlah pending |
| POST | `/approvals/:id/approve` | Setujui → bisnis + paket pilihan + trial 30 hari |
| POST | `/approvals/:id/reject` | Tolak dengan alasan wajib |

### GET `/approvals`

Query: `status` (`pending` default, `history`, `all`, atau status tertentu),
`search` (nama/email Owner, nama bisnis, nomor registrasi), `page`, `limit`
(1–100, default 20).

```json
{
  "items": [
    {
      "id": "uuid", "status": "pending",
      "registration_number": "REG-20261029-AB12CD34",
      "business_name": "Toko Budi",
      "owner": { "full_name": "Budi", "email": "budi@toko.id", "phone": "62812…" },
      "plan": { "id": "uuid", "name": "Paket Bulanan", "max_outlets": 1 },
      "requested_at": "2026-…", "trial_started_at": null, "trial_ends_at": null
    }
  ],
  "total": 1, "pending": 1, "page": 1, "limit": 20, "status": "pending"
}
```

### POST `/approvals/:id/approve`

Menyetujui pendaftaran berstatus `pending`. Dalam satu transaksi: membuat bisnis,
memasang **paket pilihan selama 30 hari** mulai `now()` server, mengisi
`owners.email_verified_at`, menyimpan jejak approval/trial, dan menulis audit
`owner.registration_approved`.

- `200` → `{ registration, business, alreadyApproved: false, message }`
- `200 alreadyApproved: true` bila dipanggil ulang (idempoten).
- `409` bila pendaftaran masih draft atau sudah ditolak.
- `404` bila tidak ditemukan.

### POST `/approvals/:id/reject`

**Request** `{ "reason": "minimal 5 karakter" }`

- `200` → `{ registration, alreadyRejected: false, message }`
- `200 alreadyRejected: true` bila dipanggil ulang.
- `409` bila sudah disetujui • `422` alasan tidak valid.

Penolakan tidak membuat bisnis/langganan. Alasan disimpan dan ditampilkan saat
Owner mencoba login (`details.code = "registration_rejected"`).

### Catatan pendaftaran

- Tidak ada lagi endpoint verifikasi manual `/owners/:id/verify`; aktivasi
  pendaftaran mandiri hanya lewat Approval Center.
- Owner buatan Admin langsung aktif (`email_verified_at` terisi) dan tidak
  memerlukan approval.
- Badge daftar Owner memakai `registration_status`; akun lama tanpa baris
  pendaftaran ditandai sebagai Owner lama/terverifikasi.

## PATCH `/owners/:id`

Ubah sebagian field; minimal satu field. Body: `email` / `fullName` / `phone`.

**200 OK** `{ "owner": { ... } }` • `404` tidak ditemukan • `409` email bentrok • `422` tidak ada field.

## PATCH `/owners/:id/status`

**Request** `{ "status": "active" | "suspended" }`

Menonaktifkan owner **sekaligus mencabut seluruh sesinya** (refresh token
milik owner di-revoke), sehingga akses berhenti walau access token belum
kedaluwarsa. **200 OK** `{ "owner": { ... } }`

## POST `/owners/:id/password`

**Request** `{ "newPassword": "minimal8karakter" }`
Mengganti hash password **dan mencabut semua sesi** owner.
**200 OK** `{ "message": "Password owner berhasil direset" }`

## DELETE `/owners/:id`

**Soft delete**: mengisi `deleted_at`, mengubah status menjadi `suspended`, dan
mencabut semua sesi. Baris **tidak** dihapus fisik agar relasi (bisnis/
transaksi di fase berikutnya) tidak menjadi yatim.

**200 OK** `{ "message": "Owner berhasil dihapus (nonaktif)" }`
Owner yang terhapus: tidak muncul di daftar, `GET /owners/:id` → `404`,
login → `403`.

---

## Audit log

Setiap mutasi menulis satu baris `audit_logs` **di dalam transaksi yang sama**
(append-only, tanpa endpoint hapus):

| `action` | Kapan |
|---|---|
| `owner.create` | owner dibuat |
| `owner.update` | data owner diubah |
| `owner.status_change` | suspend/aktivasi |
| `owner.reset_password` | password direset |
| `owner.delete` | soft delete |
| `owner.registration_approved` | pendaftaran disetujui Admin |
| `owner.registration_rejected` | pendaftaran ditolak Admin |

`before`/`after` menyimpan snapshot (tanpa `password_hash`).

---

## Keamanan

- Otorisasi ditegakkan server (`requireAuth` + `requireRole('platform_admin')`);
  menyembunyikan menu di UI saja tidak cukup.
- **Tidak ada** pendaftaran publik admin/owner. Akun owner hanya dibuat oleh
  Admin Platform; akun admin hanya via seeding internal.
- Penonaktifan/penggantian password berlaku di server (sesi langsung dicabut).
- `password_hash` tidak pernah dikembalikan ke klien atau ditulis ke audit.
