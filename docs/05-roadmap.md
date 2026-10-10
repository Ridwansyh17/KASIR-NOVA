# KASIR NOVA — Roadmap Fase

> Urutan disusun untuk **Windows 10/11 dengan RAM bebas ~2 GB**: fase-fase awal
> hanya butuh Node + PostgreSQL native (tanpa Docker, tanpa IDE berat), lalu
> naik bertahap. Satu fase pada satu waktu; setiap fase punya kriteria selesai
> yang bisa diuji sebelum lanjut.

## Fase 0 — Fondasi & Lingkungan (estimasi 1–2 hari) ✅ SELESAI
- Setup monorepo: root `package.json` (npm workspaces), `.gitignore`,
  `README.md`.
- Install PostgreSQL native (panduan di `scripts/`), konfirmasi `psql` jalan.
- Skema env & template `.env.example` (tanpa rahasia).
- Migrasi pertama: buat skema awal (tabel sesi & platform admin).
- **Selesai jika:** `server` start, koneksi DB sukses, migrasi bisa
  dijalankan ulang (idempoten), dan sesi admin pertama terbuat lewat seeding
  internal.

> **Hasil aktual:** PostgreSQL 16.1 port 5433; 5 tabel + 2 enum; 1 admin
> platform (`admin@nova.test`); server merespons di `:4000`;
> 5/5 tes integrasi lulus.

### Catatan deviasi dari rencana (dengan alasan teknis)
1. **Zip "binaries" EDB ternyata hanya client tools** (tidak ada `share/`
   & `postgres.bki`), sehingga server tidak bisa start. Diganti dengan zip
   **full** PostgreSQL Portable 16.1 yang menyertakan server lengkap.
2. **Installer `.exe` EDB butuh hak admin**; shell berjalan non-admin. Zip
   full dijalankan tanpa admin (proses user biasa, bukan Windows service).
3. **scrypt N=2^16 gagal** di Node 24 (limit memori OpenSSL ~32MB). Parameter
   diturunkan & `maxmem` dinaikkan eksplisit ke 128MB.

## Fase 1 — Autentikasi & Sesi (estimasi 3–4 hari)
- Modul `auth`: login 3 peran, access + refresh token, rotasi refresh.
- Tabel `refresh_tokens` (hash), logout = pencabutan (revoked_at).
- Middleware `auth.js` + `rateLimit.js` di endpoint login.
- **Selesai jika:** login tiap peran hanya berhasil di areanya; token kedaluwarsa
  memicu refresh; logout membuat token lama ditolak; brute force dibatasi.

## Fase 2 — Platform Admin (estimasi 3 hari)
- Modul `platform-admin`: CRUD owner, suspend/aktivasi.
- Panel `apps/admin` (HTML/CSS/JS) — daftar owner, detail, status.
- Audit log mulai aktif (buku tamu semua aksi admin).
- **Selesai jika:** admin bisa membuat owner baru; owner terdaftar bisa login
  di `/owner`; admin tidak bisa masuk lewat pendaftaran publik.

## Fase 3 — Owner & Multi-Bisnis (estimasi 4 hari)
- Modul `owner` + `business`: owner membuat beberapa bisnis.
- Panel `apps/owner`: daftar bisnis, buat bisnis, ganti konteks aktif.
- Tenant middleware aktif: `business_id` dari sesi, filter semua query.
- **Selesai jika:** owner memiliki ≥2 bisnis dan **tidak bisa** melihat data
  bisnis lain (uji negatif).

## Fase 4 — Outlet & Batas Langganan (estimasi 3 hari)
- Modul `outlet` + `subscription`: buat outlet, cek `max_outlets`.
- Status langganan dibaca untuk gerbang pembuatan outlet.
- **Selesai jika:** membuat outlet melebihi batas plan **ditolak** server;
  status langganan satu bisnis tidak mempengaruhi bisnis lain.

## Fase 5 — Manajemen Kasir (estimasi 2–3 hari)
- Modul `cashier`: Owner membuat kasir, **terkunci 1 outlet**.
- Verifikasi: email UNIQUE + outlet milik business_id sesi.
- **Selesai jika:** upaya mendaftarkan satu email ke 2 outlet **gagal**;
  kasir hanya bisa login di `/kasir`.

## Fase 6 — Produk, Kategori, Harga, Stok (estimasi 4 hari)
- Modul `product` + `stock`: CRUD, harga dalam sen, stok per outlet.
- Tampilan pilihan produk untuk kasir (read-only).
- **Selesai jika:** harga & stok tersimpan persisten; kasir hanya bisa
  **melihat** produk outletnya.

## Fase 7 — Transaksi Penjualan (estimasi 5–7 hari) — inti
- Modul `transaction`: keranjang, diskon, pajak per outlet, pembayaran tunai.
- **DB transaction (BEGIN/COMMIT)** + row lock untuk pengurangan stok.
- Pembatalan (void) oleh Owner; audit log transaksi.
- **Selesai jika:** satu penjualan mengurangi stok, mencatat item, pajak, dan
  total secara atomik; penjualan konkuren tidak menyebabkan stok negatif.

## Fase 8 — Struk & Riwayat (estimasi 3 hari)
- Cetak struk (thermal/ukuran 58mm/80mm via CSS @page), nomor invoice per outlet.
- Riwayat transaksi dengan filter (tanggal, outlet, kasir).
- **Selesai jika:** struk tercetak dan nomor invoice unik per outlet.

## Fase 9 — Laporan (estimasi 4 hari)
- Laporan harian/mingguan/bulanan/tahunan (agregat SQL, dijamin cakupan tenant).
- Export CSV/JSON.
- **Selesai jika:** angkat laporan untuk 2 business_id terisolasi, hasilnya
  tidak bocor.

## Fase 10 — Langganan & Pembatasan Akses (estimasi 3 hari)
- Modul `subscription`: masa aktif, status pembayaran, gerbang fitur.
- Akses diblokir saat kedaluwarsa (middleware level server).
- **Selesai jika:** bisnis kedaluwarsa tidak bisa transaksi; bisnis aktif
  tetap normal.

## Fase 11 — Audit Log & Manajemen Sesi (estimasi 2–3 hari)
- Viewer audit log untuk Admin & Owner (scoped), pencabutan sesi bawahan.
- **Selesai jika:** semua operasi penting tercatat; admin bisa memaksa logout
  kasir.

## Fase 12 — Pengujian, Backup, Monitoring, Persiapan APK (estimasi 5–7 hari)
- Tes unit + integrasi + otorisasi (kasus negatif tiap matriks) + e2e.
- Skrip backup/restore PostgreSQL terjadwal (`pg_dump`/`pg_restore`).
- Endpoint health check + dasbor monitoring minimal.
- Bungkus `apps/kasir` dengan **Capacitor** untuk APK.
- **Selesai jika:** seluruh suite lulus, backup teruji bisa direstore, APK
   terbuild dan bisa login ke backend.

## Modul Ditangguhkan (di luar roadmap di atas)
- **Gateway pembayaran digital**: setelah penyedia & kebutuhan ditetapkan —
  tambah provider di tabel `payments.provider`.
- **Perpanjangan langganan otomatis**: job penagihan terpisah — sementara
  dicatat manual oleh Admin Platform.

## Urutan untuk RAM ~2 GB
- Jalankan **satu server** + **satu app** + satu PostgreSQL. Hindari
  menjalankan 3 apps sekaligus saat dev.
- Gunakan pnpm/npm biasa; **tanpa Docker**.
- Test runner (Vitest) dijalankan per berkas/modul bila memori menipis.
