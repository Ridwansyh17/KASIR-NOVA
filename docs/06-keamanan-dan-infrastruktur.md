# KASIR NOVA — Risiko Keamanan & Kebutuhan Infrastruktur

## A. Risiko Keamanan (dengan mitigasi)

| # | Risiko | Tingkat | Mitigasi |
|---|---|---|---|
| 1 | **Akses lintas tenant (IDOR)** — user melihat data bisnis lain via ID di URL/body | Tinggi | `business_id` selalu dari **sesi server**, bukan input klien; RLS PostgreSQL; tes negatif per matriks |
| 2 | **Password/kredensial bocor ke repo** | Tinggi | `.gitignore` untuk `.env`; template `.env.example` tanpa rahasia; cek pre-commit; **tidak ada** rahasia di frontend |
| 3 | **Brute force login** | Sedang | `express-rate-limit` di endpoint login; lockout sementara |
| 4 | **Token dicuri & dipakai ulang** | Sedang | Access token umur pendek; refresh **dirotasi**; refresh disimpan **hash**; `revoked_at` untuk pencabutan |
| 5 | **Pembuatan Admin Platform publik** | Tinggi | Tidak ada endpoint pendaftaran admin; hanya seeding internal terkontrol |
| 6 | **Race condition pada stok/saldo** | Tinggi | DB transaction + `SELECT ... FOR UPDATE`; constraint stok ≥ 0 |
| 7 | **SQL injection** | Sedang | Query berparameter (pg), **tidak ada** string interpolation SQL |
| 8 | **XSS di struk/laporan** | Sedang | Escape output; `helmet`; CSP ketat |
| 9 | **Manipulasi harga di sisi klien** | Tinggi | Harga & total **dihitung ulang di server** dari data produk, tidak percaya input klien |
| 10 | **Audit log dimanipulasi** | Sedang | Kolom audit hanya append; tidak ada endpoint hapus (matriks: ❌ semua peran) |
| 11 | **Bypass langganan** | Sedang | Cek status di middleware server untuk setiap operasi penting |
| 12 | **Kasir mengakses outlet lain** | Tinggi | `outlet_id` dari sesi; filter query; uji negatif |

## B. Kebutuhan Infrastruktur

### Backend & Database (sekarang)
- **PostgreSQL native** di Windows (server lokal dev) — sesuai keputusan Anda.
- **Node.js v24** sudah tersedia.
- Kelola koneksi via **pool** (batas kecil, mis. max 10 untuk RAM 2 GB).
- Migrasi via `node-pg-migrate` (SQL terlacak di git).

### Produksi (nanti, bukan sekarang)
- Layanan yang mendukung Node + PostgreSQL (mis. VPS/containers) —
  **detail ditentukan mendekati deploy**.
- **HTTPS wajib** (reverse proxy/LB terminate TLS).
- Backup terjadwal `pg_dump` + uji restore rutin.
- Monitoring minimal: health check + log terstruktur.

### Frontend (Firebase Hosting)
- Firebase Hosting untuk **3 site** dalam 1 project (admin, owner, kasir) —
  lihat `docs/20-deploy-firebase-hosting.md`.
- Variabel API URL per environment (`window.NOVA_API_BASE`) — **bukan** rahasia.
- Backend wajib HTTPS dan mengizinkan origin site Firebase di `CORS_ORIGIN`.

### Distribusi klien
- Keputusan pemilik (11 Okt 2026): **web via Firebase Hosting**, **bukan APK**.
- Capacitor/APK **dibatalkan** dan tidak termasuk lingkup Fase 12+.

## C. Batasan Lingkungan Saat Ini (penting)

- **RAM bebas ~1.87 GB** → hindari Docker & IDE berat; jalankan satu app
  + satu server + PostgreSQL saja.
- **Windows PowerShell ExecutionPolicy** memblokir skrip `.ps1` (npm).
  Solusi: panggil `npm.cmd` langsung, atau ubah policy untuk CurrentUser.
- **PostgreSQL belum terinstall** → perlu instalasi native di Fase 0.
- **Python belum terinstall** (hanya perlu jika nanti pakai tool tertentu).

## D. Aksi yang Membutuhkan Persetujuan Eksplisit

Sesuai aturan kerja, saya **tidak** akan melakukan tanpa konfirmasi:
- Deploy ke lingkungan manapun
- Menghapus data produksi
- Mengubah billing/langganan
- Mengakses/mengekspos rahasia
- Menghapus/menimpa file hasil kerjaan penting
