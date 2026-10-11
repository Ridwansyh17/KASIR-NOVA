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

## Fase 1 — Autentikasi & Sesi (estimasi 3–4 hari) ✅ SELESAI
- Modul `auth`: login 3 peran, access + refresh token, rotasi refresh.
- Tabel `refresh_tokens` (hash), logout = pencabutan (revoked_at).
- Middleware `auth.js` + `rateLimit.js` di endpoint login.
- **Selesai jika:** login tiap peran hanya berhasil di areanya; token kedaluwarsa
  memicu refresh; logout membuat token lama ditolak; brute force dibatasi.

> **Hasil aktual:** endpoint `POST /api/auth/login | refresh | logout`,
> `GET /api/auth/me`. Access token JWT (15m) + refresh token acak 48 byte
> (disimpan sebagai SHA-256 di DB, umur 7 hari, **rotasi sekali pakai** dalam
> satu DB transaction). Login dibatasi 10 percobaan/IP/15 menit (429).
> `requireAuth` memverifikasi ulang status akun di DB tiap request, sehingga
> akun nonaktif langsung kehilangan akses. Owner demo `owner@nova.test`
> di-seed untuk dev. **28/28 tes lulus** (23 auth + 5 fondasi).
> Kontrak API: `docs/08-api-auth.md`.

### Catatan deviasi dari rencana (dengan alasan)
1. **Login `cashier` diaktifkan di Fase 5 (lihat Hasil aktual Fase 5).** Saat
   Fase 1, tabel `cashiers` belum ada sehingga peran itu sengaja dikomentari
   di `USER_STORES`; kontrak API tiga peran sudah final sejak saat itu, dan
   Fase 5 cukup membalik satu komentar tanpa mengubah alur auth.
2. **Rotasi refresh memakai `SELECT ... FOR UPDATE`** agar balapan (race)
   dua permintaan refresh bersamaan tidak menghasilkan dua token valid.

## Fase 2 — Platform Admin (estimasi 3 hari) ✅ SELESAI
- Modul `platform-admin`: CRUD owner, suspend/aktivasi.
- Panel `apps/admin` (HTML/CSS/JS) — daftar owner, detail, status.
- Audit log mulai aktif (buku tamu semua aksi admin).
- **Selesai jika:** admin bisa membuat owner baru; owner terdaftar bisa login
  di `/owner`; admin tidak bisa masuk lewat pendaftaran publik.

> **Hasil aktual:** 7 endpoint `/api/platform/owners*` (daftar/buat/detail/
> ubah/status/reset-password/soft-delete); panel `apps/admin` (login terkunci
> `platform_admin`, daftar + cari + filter + paginasi, buat/ubah/suspend/
> reset/hapus) disajikan di `/admin` saat dev. Migrasi `0002` menambah index
> unik `lower(email)` (anti akun duplikat beda kapital) + kolom `deleted_at`.
> Setiap mutasi menulis `audit_logs` di transaksi yang sama. Suspend/reset/
> hapus **mencabut semua sesi owner** di server. **43/43 tes lulus** (15 baru
> platform-admin). Kontrak API: `docs/09-api-platform-admin.md`.

### Catatan deviasi dari rencana (dengan alasan)
1. **"Owner terdaftar bisa login di `/owner`"** diverifikasi lewat modul auth
   (login owner → `200`), karena `apps/owner` baru dibangun di Fase 3. Kriteria
   otorisasi (admin hanya via seeding, tanpa pendaftaran publik) sudah diuji.
2. **Hapus owner = SOFT delete** (`deleted_at` + suspend), bukan hapus fisik.
   Hard delete akan membuat FK bisnis/transaksi (fase berikutnya) menjadi yatim
   atau terhapus berantai. Ini keputusan teknis yang menjaga integritas data.
3. **Email unik case-insensitive** ditambahkan pada migrasi ini karena login
   membandingkan `lower(email)` — tanpa index ini, dua akun bisa terlihat sama.
4. Panel admin disajikan Express pada dev; **produksi tetap Firebase Hosting**
   (backend tidak melayani file statis saat `NODE_ENV=production`).

## Fase 3 — Owner & Multi-Bisnis (estimasi 4 hari) ✅ SELESAI
- Modul `owner` + `business`: owner membuat beberapa bisnis.
- Panel `apps/owner`: daftar bisnis, buat bisnis, ganti konteks aktif.
- Tenant middleware aktif: `business_id` dari sesi, filter semua query.
- **Selesai jika:** owner memiliki ≥2 bisnis dan **tidak bisa** melihat data
  bisnis lain (uji negatif).

> **Keputusan pemilik proyek (sebelum implementasi):**
> 1. Bisnis dibuat **bebas tanpa langganan otomatis** — langganan/plan diatur
>    kemudian (Fase 4 & 10).
> 2. `business_type` = **teks bebas** (tanpa daftar pilihan kaku).

> **Hasil aktual:** tabel `businesses` (migrasi `0003`, akar tenant dengan FK
> `owner_id`, default `currency=IDR`, `timezone=Asia/Jakarta`, kolom
> `deleted_at`). 5 endpoint `/api/owner/businesses*` (list/buat/detail/ubah/
> status) — seluruhnya terkunci peran `owner` + **middleware tenant**
> (`requireBusinessAccess`) yang mengembalikan **404** untuk bisnis milik
> tenant lain (anti-IDOR, mencegah enumerasi). Setiap mutasi menulis
> `audit_logs` (dengan `business_id`) di transaksi yang sama. Panel
> `apps/owner` (login terkunci `owner`, daftar → pilih konteks bisnis aktif →
> detail/ubah/aktif-nonaktif, disajikan di `/owner` saat dev). Owner bisa
> memiliki ≥2 bisnis. **56/56 tes lulus** (13 baru; termasuk uji negatif
> isolasi: Owner A → bisnis Owner B = 404). Kontrak API:
> `docs/10-api-owner-business.md`.

### Catatan deviasi dari rencana (dengan alasan)
1. **Tidak ada endpoint hapus bisnis** di fase ini. Matriks hak akses owner
   hanya mencantumkan buat/lihat/ubah/status; kolom `deleted_at` sudah disiapkan
   untuk soft-delete bila keputusan hapus tiba. Hard delete bisnis juga akan
   menghancurkan seluruh data outlet/transaksinya secara berantai.
2. **"Ganti konteks aktif"** adalah urusan frontend murni: id bisnis aktif
   disimpan di `localStorage`; server tetap memverifikasi kepemilikan tiap
   request sehingga berpindah konteks tidak pernah menjadi celah isolasi.
3. **Admin belum punya daftar semua bisnis** (`GET /api/platform/businesses`)
   sampai **Fase 4**, ketika endpoint tersebut dibuat karena Fase 4
   membutuhkan admin mencari bisnis untuk memasang langganan (lihat Fase 4).
   Isolasi tenant sudah diuji di sisi modul `owner`.

## Fase 4 — Outlet & Batas Langganan (estimasi 3 hari) ✅ SELESAI
- Modul `outlet` + `subscription`: buat outlet, cek `max_outlets`.
- Status langganan dibaca untuk gerbang pembuatan outlet.
- **Selesai jika:** membuat outlet melebihi batas plan **ditolak** server;
  status langganan satu bisnis tidak mempengaruhi bisnis lain.

> **Keputusan pemilik proyek (11 Okt 2026, Opsi A):** setiap bisnis BARU
> otomatis mendapat langganan plan default **"Gratis"** (max outlet 1, max
> kasir 1, harga 0, durasi 30 hari) di dalam transaksi pembuatan bisnis yang
> sama. Arsip: `docs/11-keputusan-menunggu.md`.

> **Hasil aktual:** migrasi `0004` membuat `subscription_plans` (kuota
> outlet/kasir, harga dalam sen, durasi hari, flag `is_default`/`is_active`,
> paling banyak satu default lewat index unik parsial — plan "Gratis" disemai
> sebagai data referensi operasional), `subscriptions` (satu `active` per bisnis
> lewat index unik parsial; riwayat non-aktif tetap tersimpan), dan `outlets`
> (tenant `business_id`, `tax_rate NUMERIC(5,2)`, soft delete).
>
> Backend modul `outlet` (list/buat/detail/ubah/hapus) di bawah
> `/api/owner/businesses/:businessId/outlets` + Owner melihat langganan
> bisnisnya. Gerbang pembuatan outlet = transaksi yang mengunci baris bisnis
> `FOR UPDATE` + `enforceOutletQuota` (bisnis aktif; langganan ada, aktif, dan
> belum kedaluwarsa; jumlah outlet aktif < `max_outlets`) → **409** bila
> menolak. Admin: CRUD paket (`/api/platform/plans`), daftar semua bisnis
> (`/api/platform/businesses`), pasang/ubah status langganan bisnis
> (`/api/platform/businesses/:id/subscription*`). Setiap mutasi menulis audit
> log di transaksi yang sama.
>
> Panel: `apps/owner` + seksi **Langganan** (paket, batas, harga, berlaku
> sampai) dan CRUD **Outlet**; `apps/admin` + tab **Paket** (CRUD
> kuota/harga/default) dan tab **Bisnis & Langganan** (cari bisnis, pasang
> paket, ubah status). **76/76 tes lulus** (20 baru; termasuk uji negatif:
> outlet ke-2 paket Gratis = 409, langganan bisnis A kedaluwarsa tidak
> memblokir bisnis B, anti-IDOR outlet lintas tenant = 404, hanya satu paket
> default). Kontrak API: `docs/12-api-outlet-subscription.md`.

### Catatan deviasi dari rencana (dengan alasan)
1. **Gerbang langganan sudah aktif untuk pembuatan outlet di fase ini**
   (roadmap menaruh pembatasan akses penuh di Fase 10). Batas yang aktif di
   sini: kuota pembuatan outlet (`max_outlets`). Fase 10 akan memperluas
   gerbang ke transaksi/akses lain sesuai keputusan Fase 4.
2. **Admin kini punya `GET /api/platform/businesses`** (semula dijadwalkan
   Fase 9/11) karena Fase 4 membutuhkan admin mencari bisnis untuk memasang
   langganan. Catatan Fase 3 yang menunda endpoint ini diperbarui di bawah.
3. **Hapus outlet = soft delete** tanpa pemeriksaan "tidak ada transaksi
   aktif" — tabel `transactions` belum ada (Fase 7); pemeriksaan itu
   ditambahkan saat tabel transaksi dibuat.
4. **`setSubscriptionStatus` bekerja pada langganan TERBARU** (bukan hanya
   yang `active`), agar Admin bisa mengembalikan langganan `expired` ke
   `active` tanpa membuat baris baru.

## Fase 5 — Manajemen Kasir (estimasi 2–3 hari) ✅ SELESAI
- Modul `cashier`: Owner membuat kasir, **terkunci 1 outlet**.
- Verifikasi: email UNIQUE + outlet milik business_id sesi.
- **Selesai jika:** upaya mendaftarkan satu email ke 2 outlet **gagal**;
  kasir hanya bisa login di `/kasir`.

> **Hasil aktual:** migrasi `0005` membuat tabel `cashiers` — `outlet_id`
> NOT NULL FK → outlets (1 kasir = 1 outlet), email UNIQUE case-insensitive
> (index `lower(email)`), `password_hash` (scrypt), `pin_hash` (opsional,
> format `pin:N:r:p:salt:hash`; login PIN dipakai saat area kasir tumbuh),
> `status account_status`, `created_by` FK → owners.
>
> Modul `cashier` + endpoint Owner di bawah
> `/api/owner/businesses/:businessId/cashiers` (list/buat/detail/ubah/
> status/reset-password). Membuat kasir melewati gerbang kuota
> `enforceCashierQuota` (`max_cashiers` plan) di transaksi yang mengunci
> bisnis `FOR UPDATE`; outlet diverifikasi milik bisnis sesi (anti-IDOR).
> Suspend & reset password **mencabut semua sesi kasir** di server dalam
> transaksi yang sama. `auth` cukup mengaktifkan entri peran `cashier` di
> `USER_STORES` → login/refresh/`/me` (konteks outlet+bisnis) langsung
> berlaku; access token kasir tak bisa menyentuh route owner (403).
>
> Panel `apps/kasir` disajikan di `/kasir` saat dev: login terkunci peran
> `cashier`, dashboard profil + outlet/bisnis/mata uang, muat ulang, keluar.
> **95/95 tes lulus** (19 baru; termasuk uji inti: email sama di outlet kedua
> = 409 walau beda kapital; kuota Gratis 1 kasir = 409; kasir login 200 via
> peran cashier; akses route owner = 403; isolasi tenant kasir/outlet = 404;
> suspend mencabut sesi; reset menonaktifkan password lama). Kontrak API:
> `docs/13-api-cashier.md`.

## Fase 6 — Produk, Kategori, Harga, Stok (estimasi 4 hari) ✅ SELESAI
- Modul `product` + `stock`: CRUD, harga dalam sen, stok per outlet.
- Tampilan pilihan produk untuk kasir (read-only).
- **Selesai jika:** harga & stok tersimpan persisten; kasir hanya bisa
  **melihat** produk outletnya.

> **Hasil aktual:** migrasi `0006` membuat `product_categories`, `products`,
> `product_stocks` (UNIQUE produk×outlet, `CHECK quantity >= 0`; nama/SKU/
> barcode unik per bisnis). Modul `product` untuk Owner di bawah
> `/api/owner/businesses/:businessId/{categories,products}`: CRUD kategori &
> produk + `PATCH .../products/:id/stocks/:outletId`. Membuat produk
> `track_stock=true` otomatis membuat baris stok 0 di setiap outlet aktif.
> Modul baru `cashier-area` menyediakan `GET /api/cashier/products`
> (read-only) yang **menurunkan outlet dari akun kasir** — tanpa parameter
> tenant di URL, jadi tidak ada permukaan IDOR. Panel Owner mendapat bagian
> "Produk & Stok" (kategori, filter, CRUD, atur stok per outlet); panel Kasir
> menampilkan katalog outletnya. **110/110 tes lulus** (15 baru): harga/stok
> negatif = 422; nama/SKU/barcode duplikat = 409; isolasi tenant = 404;
> token kasir di route owner = 403; owner di route kasir = 403; kasir hanya
> melihat produk outletnya. Kontrak API: `docs/14-api-produk-stok.md`.

## Fase 7 — Transaksi Penjualan (estimasi 5–7 hari) ✅ SELESAI
- Modul `transaction`: keranjang, diskon, pajak per outlet, pembayaran tunai.
- **DB transaction (BEGIN/COMMIT)** + row lock untuk pengurangan stok.
- Pembatalan (void) oleh Owner; audit log transaksi.
- **Selesai jika:** satu penjualan mengurangi stok, mencatat item, pajak, dan
  total secara atomik; penjualan konkuren tidak menyebabkan stok negatif.

> **Keputusan pemilik proyek (11 Okt 2026):** pajak **per outlet**
> (`tax_inclusive` + `tax_rate`); diskon **per transaksi** (persen/nominal)
> sebelum pajak; void oleh Owner **mengembalikan stok**; pembayaran tunai +
> kartu/QR/wallet **dicatat manual** (tanpa gateway, satu pembayaran per
> transaksi). Arsip: `docs/11-keputusan-menunggu.md`.

> **Hasil aktual:** migrasi `0007` menambah `outlets.tax_inclusive` dan
> membuat `transactions`, `transaction_items`, `payments`,
> `outlet_invoice_counters` (penomoran `INV-YYYYMMDD-NNNN` atomik per
> outlet×hari, zona waktu bisnis). Nominal seluruhnya sen (BIGINT) dengan
> snapshot nama/harga/tarif pajak; `client_ref` unik per outlet untuk
> anti-duplikasi. Server **menghitung ulang** harga/total dari katalog.
> Pengurangan stok memakai `UPDATE product_stocks SET quantity = quantity - qty
> WHERE quantity >= qty` di dalam satu DB transaction — penjualan konkuren
> tidak pernah membuat stok negatif (diuji paralel). Void mengembalikan stok +
> menulis audit; outlet ber-transaksi aktif tidak bisa dihapus (409).
>
> Backend: modul `transaction` untuk Owner
> (`/api/owner/businesses/:businessId/transactions` + `POST .../void`),
> endpoint kasir di modul `cashier-area` (`POST/GET /api/cashier/transactions`,
> outlet diturunkan dari akun — anti-IDOR), Admin dapat daftar/detail transaksi
> (baca). Panel `apps/kasir` menjadi **Titik Penjualan** (katalog klik →
> keranjang → diskon → pembayaran → struk ringkas + riwayat 10 terakhir);
> panel `apps/owner` mendapat bagian **Transaksi Penjualan** (filter status,
> detail item/pembayaran, tombol void) dan pengaturan `tax_inclusive` per
> outlet. **126/126 tes lulus** (16 baru). Kontrak API:
> `docs/15-api-transaksi.md`.

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
