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
| POST | `/owners/:id/verify` | Verifikasi manual akun pending **lama** (WhatsApp) + buat bisnis/trial |
| PATCH | `/owners/:id` | Ubah nama/email/telepon owner |
| PATCH | `/owners/:id/status` | Suspend / aktivasi owner |
| POST | `/owners/:id/password` | Reset password owner |
| DELETE | `/owners/:id` | Soft delete owner |

Field owner yang dikembalikan (tanpa `password_hash`):
`id, email, full_name, phone, status, created_by, created_at, updated_at, deleted_at,
email_verified_at, pending_business_name, email_verification_method, firebase_linked`

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

## POST `/owners/:id/verify`

Verifikasi manual akun Owner pending **lama** (alur WhatsApp). Akun yang
terhubung Firebase **ditolak 409** karena wajib menyelesaikan verifikasi email
sendiri. Dalam satu transaksi: mengisi
`email_verified_at`, mengosongkan `pending_business_name`, membuat **bisnis
pertama** + langganan default **Gratis 30 hari**, dan menulis audit
`owner.whatsapp_verified` + `business.create`.

**200 OK**
```json
{
  "owner": { "id": "uuid", "email_verified_at": "…", "pending_business_name": null },
  "business": { "id": "uuid", "name": "Toko Budi", "status": "active" },
  "message": "Owner terverifikasi. Bisnis dan langganan Gratis berhasil dibuat."
}
```

`404` owner tidak ditemukan • `409` owner sudah terverifikasi atau terhubung
Firebase (`firebase_linked = true`).

### Catatan Firebase

- Owner hasil pendaftaran mandiri memiliki `email_verification_method =
  'firebase'` dan `firebase_linked = true`.
- Perubahan `email` untuk Owner Firebase ditolak **409** dari panel Admin.
- Badge panel Admin membedakan **terverifikasi**, **menunggu email** (Firebase),
  dan **menunggu** (akun lama). Tombol verifikasi/WA hanya muncul untuk akun
  lama yang belum terverifikasi.

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

`before`/`after` menyimpan snapshot (tanpa `password_hash`).

---

## Keamanan

- Otorisasi ditegakkan server (`requireAuth` + `requireRole('platform_admin')`);
  menyembunyikan menu di UI saja tidak cukup.
- **Tidak ada** pendaftaran publik admin/owner. Akun owner hanya dibuat oleh
  Admin Platform; akun admin hanya via seeding internal.
- Penonaktifan/penggantian password berlaku di server (sesi langsung dicabut).
- `password_hash` tidak pernah dikembalikan ke klien atau ditulis ke audit.
