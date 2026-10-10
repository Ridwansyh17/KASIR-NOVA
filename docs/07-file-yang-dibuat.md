# KASIR NOVA — Daftar File yang Akan Dibuat (Fase 0)

> **Hanya Fase 0** yang dijabarkan di sini. Fase berikutnya akan
> dijabarkan kembali saat mencapainya. Tidak ada kode aplikasi yang ditulis
> sebelum rencana ini disetujui.

## File yang akan dibuat di Fase 0

### Konfigurasi root monorepo
| File | Alasan |
|---|---|
| `package.json` (overwrite, saat ini hanya template npm) | Mengubah jadi **npm workspaces** agar `server/`, `apps/*`, `packages/` saling terhubung sebagai satu repo |
| `.gitignore` | Mencegah `node_modules`, `.env`, `dist`, dan log masuk ke git — **kritikal keamanan #2** |
| `.env.example` | Template variabel lingkungan **tanpa nilai rahasia** sebagai dokumentasi |
| `README.md` | Cara setup & menjalankan agar siapapun bisa mulai |

### Backend fondasi
| File | Alasan |
|---|---|
| `server/package.json` | Dependensi backend: `express`, `pg`, `zod`, `helmet`, `jsonwebtoken`, dll. |
| `server/src/config/env.js` | Memvalidasi keberadaan variabel lingkungan **wajib** saat start (fail-fast, bukan runtime error) |
| `server/src/config/db.js` | Konfigurasi pool PostgreSQL (pool kecil untuk RAM 2 GB) |
| `server/src/db/pool.js` | Singleton `pg.Pool` — satu pool dipakai semua modul |
| `server/src/db/migrations/0001_init.sql` | Skema awal: `platform_admins`, `refresh_tokens`, `audit_logs` |
| `server/src/db/seed.js` | Membuat **admin platform pertama** lewat seeding internal (bukan pendaftaran publik) |
| `server/src/app.js` | Express + middleware dasar (helmet, cors, json, error handler) |
| `server/src/server.js` | Entry point: bind port dari env |
| `server/src/utils/hash.js` | Hash password `scrypt` (tanpa dependency native, aman Windows) |
| `server/src/utils/token.js` | Generate/sign JWT (access + refresh) |
| `server/src/middleware/error.js` | Penanganan error terpusat agar response konsisten |
| `server/.env.example` | Template khusus backend (DB URL, JWT secret, port) |

### Skrip operasional
| File | Alasan |
|---|---|
| `scripts/install-postgresql.md` | Panduan instalasi PostgreSQL native di Windows (versi, lokasi, service) |
| `scripts/verify-db.ps1` | Verifikasi `psql` & koneksi ke database dev setelah install |

### Test
| File | Alasan |
|---|---|
| `server/tests/health.test.js` | Tes pertama: endpoint health + koneksi DB (memastikan fondasi jalan sebelum fitur) |

## File yang TIDAK akan dibuat di Fase 0

- **Aplikasi frontend** (`apps/*`) — belum, sampai autentikasi stabil.
- **Modul fitur** (product, transaction, dll.) — menyusul per roadmap.
- **Data demo** — dilarang dibuat seolah-olah data produksi; seed hanya
  membuat akun admin awal.

## Validasi akhir Fase 0 (kriteria selesai)
1. `npm install` selesai di root tanpa error.
2. PostgreSQL terinstall, `psql` merespons.
3. Migrasi berjalan & bisa dijalankan ulang (idempoten).
4. Server start dan endpoint `/health` merespons dengan status DB.
5. Seeding membuat satu akun admin platform; login admin mengembalikan token.

---

## ⏸ Menunggu Persetujuan

Sesuai **Tugas F poin 6**: rencana sudah selesai. Saya **berhenti di sini** dan
menunggu persetujuan sebelum memulai implementasi besar.

Konfirmasi dengan: **"lanjut"** (mulai Fase 0) atau beri catatan perbaikan.
