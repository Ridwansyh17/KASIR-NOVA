# KASIR NOVA — Kontrak API: Auth & Sesi

> Basis URL dev: `http://localhost:4000/api/auth`
> Semua request/response berformat JSON (`Content-Type: application/json`).
> Error selalu berbentuk: `{ "error": { "message": "...", "details"?: ... } }`.

## Konsep token

| Token | Bentuk | Umur | Penyimpanan |
|---|---|---|---|
| **Access token** | JWT (`Authorization: Bearer ...`) | 15 menit | Di memori frontend (jangan localStorage bila bisa) |
| **Refresh token** | String hex 96 karakter (acak) | 7 hari | Disimpan aman; server hanya menyimpan hash-nya (SHA-256) |

- **Refresh bersifat sekali pakai (rotasi):** setiap `POST /refresh`
  mengembalikan refresh token **baru** dan mencabut yang lama. Simpan yang baru.
- Bila access token kedaluwarsa (401 "Token akses kedaluwarsa"), panggil
  `/refresh` untuk mendapatkan pasangan baru, lalu ulangi request semula.
- Bila `/refresh` gagal (401), sesi berakhir → arahkan pengguna ke login.

## Peran

| `role` | Area aplikasi | Status |
|---|---|---|
| `platform_admin` | `apps/admin` | ✅ aktif |
| `owner` | `apps/owner` | ✅ aktif |
| `cashier` | `apps/kasir` | ✅ aktif (email/password sejak Fase 5; juga login PIN — Fase 10b) |

> Tiap aplikasi frontend mengirim `role` tetapnya sendiri (tidak dipilih
> pengguna). Ini memisahkan area login.

---

## POST `/api/auth/login`

Login per peran. Dibatasi **10 percobaan / IP / 15 menit** (HTTP 429 bila
terlampaui).

**Request**
```json
{ "role": "owner", "email": "owner@nova.test", "password": "••••••••" }
```

**200 OK**
```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "f3a9...96_hex...",
  "user": { "id": "uuid", "email": "owner@nova.test", "fullName": "Owner Demo", "role": "owner" }
}
```

| Status | Arti |
|---|---|
| 200 | Berhasil |
| 401 | Email atau password salah (pesan seragam, anti-enumerasi) |
| 403 | Akun dinonaktifkan |
| 404 | Peran tidak dikenal/tidak didukung (mis. salah ketik `role`) |
| 422 | Validasi gagal (mis. password < 8 karakter, peran tak dikenal) |
| 429 | Terlalu banyak percobaan |

---

## POST `/api/auth/refresh`

Rotasi refresh token.

**Request**
```json
{ "refreshToken": "f3a9...96_hex..." }
```

**200 OK** — bentuk sama dengan login (access + refresh token baru + user).

| Status | Arti |
|---|---|
| 401 | Token tidak valid / sudah dicabut / kedaluwarsa |
| 422 | Format token tidak valid |

---

## POST `/api/auth/logout`

Mencabut satu sesi (refresh token terkait). **Butuh access token.**

**Header:** `Authorization: Bearer <accessToken>`

**Request**
```json
{ "refreshToken": "f3a9...96_hex..." }
```

**200 OK**
```json
{ "message": "Logout berhasil", "revoked": true }
```

> Pencabutan sesi **bawahan** (Admin/Owner memaksa logout kasir) bukan bagian
> kontrak publik ini — lihat `docs/19-api-audit-sesi.md` (endpoint `…/sessions`
> & `…/sessions/revoke` di area `/api/platform` dan `/api/owner`).

---

## GET `/api/auth/me`

Info pengguna dari access token. **Butuh access token.**

**Header:** `Authorization: Bearer <accessToken>`

**200 OK**
```json
{ "user": { "id": "uuid", "role": "owner", "email": "owner@nova.test", "fullName": "Owner Demo" } }
```

Untuk peran **kasir**, respons juga menyertakan `context` (outlet + bisnis yang
ditetapkan) yang dipakai panel Kasir — termasuk data header struk:

```json
{
  "user": { "id": "…", "email": "kasir.demo@nova.test", "fullName": "Kasir Demo", "role": "cashier" },
  "context": {
    "outlet": {
      "id": "…",
      "name": "Outlet Utama",
      "address": "Jl. Melati No. 3",
      "phone": "021-555",
      "tax_rate": 11,
      "tax_inclusive": false
    },
    "business": { "id": "…", "name": "Demo Kasir NOVA", "currency": "IDR" }
  }
}
```

Peran lain (owner/admin) mengembalikan `context: null`.

---

## GET `/api/auth/cashiers`  *(Pendukung login PIN kasir — Fase 10b)*

Kartu kasir ber-PIN untuk layar pemilih (nama saja, **tanpa email**). Publik,
scoped per outlet (UUID; tidak dapat ditebak). Hanya kasir **aktif** yang
**sudah punya PIN** yang muncul.

**Query:** `?outletId=<uuid>` (wajib)

**200 OK**
```json
{ "items": [ { "id": "uuid", "full_name": "Kasir A" } ] }
```

| Status | Arti |
|---|---|
| 422 | `outletId` hilang / bukan UUID |

---

## POST `/api/auth/cashier-pin`  *(Login PIN kasir — Fase 10b)*

Login kasir dengan PIN 4 digit (kasir dipilih dari layar pemilih). Menerbitkan
sesi normal (access + refresh, rotasi). Dibatasi `pinLimiter` (20/IP/15 mnt).

**Request**
```json
{ "cashierId": "uuid", "pin": "2468" }
```

**200 OK** — bentuk sama dengan login (access + refresh token + user
`role: "cashier"`).

| Status | Arti |
|---|---|
| 401 | Kasir tidak ditemukan / PIN salah / kasir belum ber-PIN (pesan seragam) |
| 403 | Kasir **terkunci** (10× gagal, perlu unlock Owner) / akun/bisnis nonaktif |
| 422 | `cashierId`/`pin` tidak valid (PIN harus 4 digit) |
| 429 | Kunci sementara (5× gagal, 15 menit) → `details.retryAfterSeconds` |

**Aturan lockout (server, atomik):** 5× PIN salah → kunci sementara 15 menit;
10× → status akun `locked` (semua jalur login terblokir) hingga Owner memanggil
`POST .../cashiers/:id/pin/unlock`.

---

## POST `/api/auth/change-password`  *(Ganti sandi sendiri — 20 Okt 2026)*

Ganti sandi akun **yang sedang login** untuk ketiga peran (`platform_admin`,
`owner`, `cashier`). Body:

```json
{
  "currentPassword": "SandiLama123!",
  "newPassword": "SandiBaru456!",
  "refreshToken": "opsional — refresh token perangkat INI agar sesinya dipertahankan"
}
```

**200 OK:**

```json
{ "message": "Sandi berhasil diubah. Sesi di perangkat lain telah diakhiri.", "sessionsRevoked": 2 }
```

| Status | Arti |
|---|---|
| 400 | Sandi saat ini salah / peran tidak didukung |
| 401 | Tanpa/invalid access token |
| 403 | Akun bukan `active` (dinonaktifkan) |
| 422 | `newPassword` < 8 karakter atau sama dengan `currentPassword` (juga dijaga zod `.refine`) |
| 429 | `passwordLimiter` (10 percobaan/IP/15 menit) |

**Aturan (server, atomik — satu transaksi DB):**
- Verifikasi sandi lama memakai `verifyPassword` terhadap hash tersimpan.
- `password_hash` di-*hash* ulang (scrypt).
- **Semua refresh token** peran+user itu di-revoke (`revoked_at = now()`),
  **kecuali** hash dari `refreshToken` body (perangkat yang dipakai tetap bisa
  refresh tanpa login ulang).
- Menulis `audit_logs` `auth.change_password` (tanpa sandi/hash).
- UI tersedia di ketiga panel (modal **Ganti Sandi**, tombol di area pengguna).

---

## Catatan keamanan untuk tim frontend

- **Jangan** simpan access token di `localStorage` bila memungkinkan (rentan
  XSS). Utamakan simpan di memori; refresh token pada penyimpanan yang lebih
  terlindungi.
- Setelah logout, **hapus** kedua token di klien.
- Saat menerima 401 dari endpoint bisnis: coba `/refresh` **sekali**; jika
  tetap 401, paksa login ulang.
- Jangan pernah menaruh `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` di frontend.
- Server memverifikasi ulang status akun setiap request; akun yang
  dinonaktifkan langsung kehilangan akses walau access token belum kedaluwarsa.
