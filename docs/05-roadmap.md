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

## Fase 8 — Struk & Riwayat (estimasi 3 hari) ✅ SELESAI
- Cetak struk (thermal/ukuran 58mm/80mm via CSS @page), nomor invoice per outlet.
- Riwayat transaksi dengan filter (tanggal, outlet, kasir).
- **Selesai jika:** struk tercetak dan nomor invoice unik per outlet.

> **Hasil aktual:** nomor invoice `INV-YYYYMMDD-NNNN` unik per outlet
> (realisasi utama, diuji di Fase 7). Panel Kasir mendapat tombol **Cetak
> Struk** — template struk 58mm (`@media print` + `@page size: 58mm`) berisi
> nama outlet/bisnis, kasir, nomor invoice, item, subtotal/disk/pajak/total,
> dibayar/kembalian, plus ucapan terima kasih. Panel Owner bagian Transaksi
> Penjualan kini memfilter riwayat berdasarkan **rentang tanggal**, **outlet**,
> dan **status** (API sudah mendukung `outletId`, `cashierId`, `status`,
> `dateFrom`, `dateTo` sejak Fase 7). **127/127 tes lulus** (1 baru: filter
> riwayat outlet/tanggal/status).

## Fase 9 — Laporan (estimasi 4 hari) ✅ SELESAI
- Laporan harian/mingguan/bulanan/tahunan (agregat SQL, dijamin cakupan tenant).
- Export CSV/JSON.
- **Selesai jika:** angkat laporan untuk 2 business_id terisolasi, hasilnya
  tidak bocor.

> **Hasil aktual:** modul `report` (Owner + Admin baca-saja). Agregat per
> periode (`day`/`week`/`month`/`year`) via `DATE_TRUNC`, ringkasan rentang,
> top 5 produk, dan ekspor **CSV/JSON** — semua dihitung server memakai zona
> waktu bisnis; hanya `completed` dihitung sebagai pendapatan, `voided`
> tampil terpisah (`voided_total`). Isolasi tenant diuji dengan 2 business_id
> (owner B → 404; admin lintas platform → 200; kasir → 403). UI Owner
> mendapat seksi **Laporan Penjualan** (filter rentang/outlet, kartu
> ringkasan, tabel agregat, top produk, tombol ekspor); UI Admin mendapat
> aksi **Laporan** di tabs Bisnis (modal baca-saja). **133/133 tes lulus**
> (6 baru). Kontrak API: `docs/16-api-laporan.md`.

## Fase 10 — Langganan & Pembatasan Akses (estimasi 3 hari) ✅ SELESAI
- Modul `subscription`: masa aktif, status pembayaran, gerbang fitur.
- Akses diblokir saat kedaluwarsa (middleware level server).
- **Selesai jika:** bisnis kedaluwarsa tidak bisa transaksi; bisnis aktif
  tetap normal.

> **Hasil aktual:** gerbang langganan server `enforceSubscriptionActive`
> (status `active` DAN belum `expires_at`) dipanggil **di dalam transaksi DB**
> pada operasi yang menambah nilai: pembuatan transaksi penjualan (`createSale`,
> kunci baris `businesses` ikut `FOR UPDATE`), pembuatan produk, pembuatan
> kategori, dan tetap dipakai kuota outlet/kasir (dipakai ulang di
> `enforceOutletQuota`/`enforceCashierQuota`). Void TIDAK diblokir agar Owner
> bisa membereskan data. Idempotensi dijaga: permintaan ulang transaksi yang
> sudah jadi tetap dikembalikan (200) meski langganan kedaluwarsa sesudahnya.
> **138/138 tes lulus** (5 baru: aktif normal; kedaluwarsa blokir
> transaksi/produk/kategori + void tetap jalan; `past_due` blokir; idempotensi
> pasca-kedaluwarsa; aktif kembali → normal).

## Fase 10b — PIN Login Kasir (dikerjakan sebelum Fase 11 atas permintaan pemilik) ✅ SELESAI
- Login kasir via PIN 4 digit: pilih kartu kasir → verifikasi PIN → sesi normal.
- Lockout di server: 5x salah → kunci 15 menit; 10x salah → status `locked`
  (Owner membuka via endpoint unlock).
- **Selesai jika:** kasir ber-PIN bisa login & transaksi normal; PIN salah
  terkunci; kasir `locked` terblokir (termasuk email/password) sampai dibuka
  Owner.

> **Hasil aktual:** migrasi `0008_cashier_pin.sql` (enum `account_status` +
> `'locked'`; kolom `pin_set_at`, `pin_failed_attempts`, `pin_locked_until`
> — `pin_hash` sudah ada sejak 0005). `verifyPin` di `utils/hash.js` (prefix
> `pin:`). Endpoint publik: `GET /api/auth/cashiers?outletId=` (kartu pemilih,
> nama saja) & `POST /api/auth/cashier-pin` (`pinLimiter` 20/IP/15 mnt;
> pelindung utama lockout per-kasir). Endpoint Owner: `POST/DELETE
> /api/owner/.../cashiers/:id/pin` & `POST .../pin/unlock` (tenant-check,
> audit `cashier.pin_set|pin_remove|pin_unlock`). Sesi lama dicabut saat PIN
> diubah. UI: layar PIN kasir (apps/kasir) + seksi "Kasir" & modal PIN
> (apps/owner). **145/145 tes lulus** (7 baru di `cashier-pin.test.js`).
> Kontrak API: `docs/17-api-pin-kasir.md`.

## Fase 11 — Audit Log & Manajemen Sesi (estimasi 2–3 hari) ✅ SELESAI
- Viewer audit log untuk Admin & Owner (scoped), pencabutan sesi bawahan.
- **Selesai jika:** semua operasi penting tercatat; admin bisa memaksa logout
  kasir.

> **Hasil aktual:** modul `audit/{schema,controller,routes}.js` menambah
> `listAuditLogs` (join nama/email aktor per peran; filter `actorRole`,
> `action`, `entityType`, `businessId`, `from`/`to`, pagination) —
> `GET /api/platform/audit-logs` (semua bisnis, admin) dan
> `GET /api/owner/businesses/:businessId/audit-logs` (scoped
> `requireBusinessAccess`; bisnis lain → 404 anti-enumerasi). Modul baru
> `session/`: `GET /api/platform/sessions` (daftar kasir + jumlah sesi aktif
> lintas bisnis), `POST /api/platform/sessions/:cashierId/revoke` (admin),
> `GET/POST /api/owner/businesses/:businessId/cashiers/:cashierId/sessions[/revoke]`
> (owner, tenant-check). Pencabutan mengisi `revoked_at` pada `refresh_tokens`
> dalam satu transaksi + audit `session.revoke_all`; token lama langsung
> ditolak `/refresh` (401) — efek "paksa logout" berlaku penuh di server saat
> request berikutnya (access JWT pendek 15 mnt tanpa blacklist). UI Admin:
> tab "Audit Log" (filter + pagination) & "Sesi Kasir" (list + tombol Paksa
> Logout). UI Owner: seksi "Audit Log" + tombol "Sesi" per kasir (modal
> daftar sesi + Paksa Logout Semua). **157/157 tes lulus** (12 baru:
> `audit-log.test.js` 6, `session-revoke.test.js` 6). API:
> `docs/19-api-audit-sesi.md`.

## Fase 12 — Pengujian, Backup, Monitoring, Persiapan Firebase Hosting (estimasi 5–7 hari) ✅ SELESAI (12 Okt 2026)
- Tes unit + integrasi + otorisasi (kasus negatif tiap matriks) + e2e.
- Skrip backup/restore PostgreSQL terjadwal (`pg_dump`/`pg_restore`).
  **✅ Selesai 12 Okt 2026** — `scripts/backup-db.ps1`,
  `scripts/restore-db.ps1`, `scripts/lib-nova-db.ps1`; uji restore 17/17 tabel
  cocok. Runbook: `docs/22-backup-restore.md`.
- Endpoint health check + dasbor monitoring minimal.
- Persiapan **Firebase Hosting** (site `kasir-nova`, subpath `/admin` `/owner`
  `/kasir`) — scaffold `firebase.json` + `scripts/build-hosting.mjs` +
  `NOVA_API_BASE` per app; **sudah di-deploy** 11 Okt 2026 dan terverifikasi
  end-to-end (3 app 200, CORS 204, login + audit via tunnel cloudflared).
  **APK/Capacitor dibatalkan** atas keputusan pemilik. *(Dibalik pada Fase 17 —
  panel Kasir kini dibungkus APK Capacitor; lihat Fase 17 di bawah.)*
- **Selesai jika:** seluruh suite lulus, backup teruji bisa direstore, dan
  ketiga app dapat disajikan lewat Firebase Hosting serta terhubung ke backend.

> **Keputusan 11 Okt 2026:** distribusi klien = **web via Firebase Hosting**,
> **bukan APK**. Backend Node+PostgreSQL di-host terpisah (belum ditetapkan;
> sementara diuji via tunnel cloudflared). Runbook:
> `docs/20-deploy-firebase-hosting.md`.
>
> **Update 12 Okt 2026:** **Cloudflare dinonaktifkan** (bukan proxy/hosting/DNS/
> dependency deploy). **Keputusan pemilik: tetap paket Spark (gratis) — tanpa
> backend publik.** Karena integrasi Hosting→Cloud Run (blok `rewrites[].run`)
> / Functions memerlukan **Blaze**, `firebase.json` **tidak** memuat rewrite
> `/api/**`; frontend live tetap statis. Backend tetap diuji **lokal**
> (same-origin): `GET /api/health` = ok (db up), `/admin/` = 200,
> **159/159 tes lulus**. Suite tes idempoten (pra-tes
> `scripts/clean-test-fixtures.mjs`). Artefak deploy backend disiapkan untuk
> masa depan (`server/Dockerfile`, `cloudbuild.yaml`, `scripts/deploy-gcp.ps1`).
> Backup/restore PostgreSQL (`scripts/backup-db.ps1`/`restore-db.ps1`) sudah
> dibuat & diuji (17/17 tabel). Runbook: `docs/20`, `docs/21`, `docs/22`.
>
> **Online gratis (uji coba) 12 Okt 2026:** Render (free) kini **butuh kartu**
> (HTTP 402) — dialihkan ke **Vercel serverless (Hobby, tanpa kartu)** +
> **Neon** (Postgres gratis). Lihat `docs/24-vercel-serverless.md`.
> (`render.yaml` + `docs/23` disimpan sebagai alternatif.)
>
> ⚠️ Catatan arsitektur: `rewrites[].destination` Firebase Hosting **hanya**
> menerima berkas lokal — **bukan URL eksternal**. Backend dinamis = blok
> `run`/`function` (perlu Blaze).

## Fase 13 — Uji Coba Menyeluruh Online + Data Demo (12 Okt 2026) ✅ SELESAI
- Menutup **Fase 12**: suite 159/159; backup/restore 17/17; hosting Firebase
  online; backend **Vercel (Hobby, tanpa kartu)** + **Neon** (lihat `docs/24`).
- Skrip **`scripts/e2e-online.mjs`** (idempoten) menguji **produksi** end-to-end:
  health → login owner/admin → bisnis → outlet → langganan → kategori → produk
  → stok → kasir + PIN → login PIN → katalog → penjualan tunai (total dihitung
  server) → idempotensi `clientRef` → void (stok balik) → laporan
  agregat/ringkasan/ekspor → audit log → admin platform → halaman statis.
- **Hasil: 26/26 PASS** terhadap `https://kasir-nova.vercel.app`
  (dijalankan 3× — idempotensi terbukti; exit 0). Dengan `E2E_PLATFORM_FLOW=1`
  ikut teruji alur Admin Platform: buat owner uji → login → isolasi tenant
  (bisnis demo → **404**) → soft-delete → login ditolak (**403**, dicabut di
  server). Owner uji dihapus di akhir tes (self-cleaning).
- **Data demo** dibuat di Neon: bisnis *Demo Kasir NOVA*, outlet *Outlet Utama*
  (PPN 11%), 4 produk (Nasi Goreng/Mie Goreng/Es Teh/Jasa Antar), kasir
  *Kasir Demo* (PIN 0248). Kredensial pengetesan dicatat (tidak di-commit) di
  `akun kasir-nova-test.txt`.
- Frontend Firebase `kasir-nova.web.app` kini memanggil API Vercel
  **cross-origin** (preflight 204; login admin/owner/kasir 200).

## Fase 14 - Redesign Frontend sesuai Logo Resmi (12 Okt 2026) - SELESAI
- Sumber logo: berkas asli di root repo `Logo KASIR NOVA.jpeg` (1092x1440, JPEG).
  Disalin **byte-identik** (SHA256 sama) ke
  `apps/{admin,kasir,owner}/assets/logo-kasir-nova.jpeg`. Tidak ada logo yang
  digambar ulang/diganti; latar JPEG dipertahankan apa adanya.
- Palet identitas diekstrak dari piksel logo: latar navy gelap (#010F2A /
  #001030), aksen cyan-biru (#00B0FF), putih. Ketiga panel (Admin, Kasir, Owner)
  di-restyle: latar, topbar, kartu, tabel, tombol, input, badge, modal, tab.
- Logo dipasang di **halaman Login** (`brand-logo-lg`) dan **topbar** tiap app
  (`brand-logo`, `object-fit: contain`, proporsi terjaga, tidak diregangkan).
- Verifikasi live: aset logo `200 image/jpeg 63750 byte` SHA256 **sama** pada
  `kasir-nova.web.app` dan `kasir-nova.vercel.app`; HTML memuat `brand-logo`.
- Build: `node scripts/build-hosting.mjs https://kasir-nova.vercel.app`;
  Tes: suite server 159/159; E2E online 21/21 PASS.

## Fase 15 — Ekspor Rekapan Transaksi ke Microsoft Excel (13 Okt 2026) — SELESAI
- **Tujuan:** Owner dapat mengunduh rekapan transaksi pada rentang & filter
  terpilih sebagai berkas **.xlsx** profesional (4 sheet), konsisten dengan
  dashboard, hanya dari transaksi nyata.
- **Backend:** `format=xlsx` pada `/reports/export` (lihat `docs/16`). Modul
  baru `server/src/modules/report/xlsx.js` (ExcelJS) membangun sheet
  **Ringkasan**, **Detail Transaksi**, **Rekap Harian**, dan **Rekap Metode
  Pembayaran**; nominal sen → rupiah (`"Rp"#,##0`), tanggal/jam zona bisnis,
  proteksi formula injection (awalan apostrof untuk `= + - @`), header beku +
  autofilter. Filter baru dipakai bersama agregat/ringkasan/ekspor:
  `status`, `paymentMethod`, `paymentStatus`, `search` (invoice/catatan).
  CORS kini meng-*expose* `Content-Disposition` agar klien membaca nama file
  (`KASIR_NOVA_Rekapan_Transaksi_<from>_sampai_<to>.xlsx`).
- **Frontend `apps/owner`:** tombol **Ekspor Excel (.xlsx)** + ikon, status
  “Menyiapkan…”, notifikasi hasil; filter rentang cepat (hari ini / 7 hari /
  bulan ini / kustom), status transaksi, metode, status pembayaran, dan
  pencarian; parameter kosong tidak lagi dikirim (memperbaiki potensi 422 pada
  ekspor CSV/JSON lama).
- **Ketergantungan:** `exceljs@^4.4.0`; `overrides.uuid@^11.1.1` agar
  `npm audit` tetap **0 kerentanan** (ExcelJS hanya memakai `uuid` v4, advisory
  menyasar v3/v5/v6).
- **Pengujian:** `server/tests/report-xlsx.test.js` (7 kasus, berkas di-parse
  balik dengan ExcelJS) — suite server **166/166**; `scripts/e2e-online.mjs`
  menambah langkah **19. Ekspor rekap transaksi Excel (.xlsx)** → E2E **22/22**
  (versi tanpa `E2E_PLATFORM_FLOW`).
- **Perbaikan menyertaan:** test `transactions.test.js` “Filter riwayat” kini
  mengambil tanggal “hari ini” dari DB (`CURRENT_DATE`) agar tidak gagal pada
  pukul 00:00–07:00 WIB (perbedaan tanggal UTC vs zona DB).

## Fase 16 — Laporan Lintas-Bisnis & Perbandingan Outlet (13 Okt 2026) — SELESAI
- **Tujuan:** Owner dapat membandingkan **outlet dalam satu bisnis** dan
  **seluruh bisnis miliknya** pada rentang terpilih — tetap owner-scoped dan
  konsisten dengan dashboard.
- **Backend (modul `report`):**
  - `GET /api/owner/businesses/:id/reports/outlets` + `/outlets/export` —
    perbandingan tiap outlet (LEFT JOIN: outlet tanpa transaksi tetap tampil
    bernilai nol).
  - `GET /api/owner/reports/businesses` + `/businesses/export` — perbandingan
    lintas-bisnis; batas rentang `from`/`to` diinterpretasikan **per zona waktu
    masing-masing bisnis**.
  - `server/src/modules/report/xlsx.js`: `buildComparisonWorkbook` (2 sheet:
    `Ringkasan` + `Perbandingan Outlet`/`Perbandingan Bisnis`).
- **Perbaikan bug (fan-out):** `groupedReport` sebelumnya JOIN
  `transaction_items` sehingga `SUM(t.total)` **berlipat** sejumlah baris item.
  Kini `items_sold` dihitung lewat **subquery korelatif**; omzet dihitung sekali
  per transaksi. Diverifikasi empiris (multi-item: 50.000 benar vs 100.000 saat
  JOIN) dan dijaga tes baru.
- **Frontend `apps/owner`:** tabel **Perbandingan Outlet** + tombol ekspor di
  bagian Laporan; **section baru Perbandingan Lintas-Bisnis** (rentang cepat +
  tanggal, kartu ringkasan, tabel, tombol Ekspor Excel). Helper unduh .xlsx
  dengan status tombol + notifikasi dipakai bersama.
- **Pengujian:** `server/tests/report-comparison.test.js` (7 kasus) → suite
  server **173/173**; `scripts/e2e-online.mjs` menambah langkah **20–23**
  (perbandingan outlet & lintas-bisnis JSON + XLSX, 2 sheet) → E2E **26/26**
  (versi tanpa `E2E_PLATFORM_FLOW`).

## Fase 17 — APK Android Panel Kasir + Cetak Struk Thermal Bluetooth (13 Okt 2026) ✅ SELESAI
- **Revisi keputusan Fase 12:** distribusi klien tetap **web (Firebase Hosting)**
  untuk Admin & Owner, tetapi panel **Kasir** kini juga dibungkus menjadi **APK
  Android** agar dapat mencetak struk ke **printer thermal Bluetooth**
  (Classic SPP/RFCOMM **dan** BLE) langsung dari perangkat.
  Runbook lengkap: **`docs/25-apk-android-cetak-bluetooth.md`**.
- **Identitas app:** `appId = id.kasirnova.kasir`, nama **KASIR NOVA**,
  versi **`1.0.0-beta.2`** (versionCode 2); minSdk 23, compile/target 35.
  Versi bersumber dari `apps/kasir-mobile/package.json`.
- **Pembungkus:** Capacitor 7 (`@capacitor/core|cli|android@^7`),
  `webDir=www`, `androidScheme=https` → origin WebView `https://localhost`.
  CORS backend (`server/src/config/env.js`) **selalu** mengizinkan
  `https://localhost`, `capacitor://localhost`, `http://localhost`.
- **ESC/POS murni di JS:** `apps/kasir/src/escpos.js` (58 mm = 32 kolom,
  80 mm = 48 kolom; init/bold/center/tinggi-ganda TOTAL/potong; ASCII-only).
- **Transport di JS:** `apps/kasir/src/printer.js` (plugin `NovaPrinter`,
  preferensi lokal perangkat & pengaturan, `PrinterError` `not_native` di web).
- **UI Kasir:** kartu *Printer Thermal* (pindai → sambung → simpan → uji cetak →
  cetak struk), tombol cetak thermal, opsi cetak otomatis; tetap mendukung
  cetak browser/PDF/e-receipt lama; responsif ponsel & tablet.
- **Plugin Android kustom** `apps/kasir-mobile/android-templates/NovaPrinterPlugin.java`
  (SPP via `BluetoothSocket` RFCOMM, BLE via `BluetoothGatt` + pemilihan
  karakteristik writable), izin Bluetooth Classic+BLE di `AndroidManifest.xml`,
  didaftarkan di `MainActivity.java`. Penerapan otomatis (idempoten):
  `apps/kasir-mobile/scripts/setup-android.mjs`.
- **Pengujian:**
  - `server/tests/printer-escpos.test.js` (encoder ESC/POS) +
    `server/tests/cors.test.js` (allowlist WebView) → suite server lulus (0 gagal).
  - **Build APK debug** `gradlew assembleDebug` → **BERHASIL**:
    `apps/kasir-mobile/android/app/build/outputs/apk/debug/app-debug.apk`
    (~3,97 MB). Terverifikasi via `aapt2 dump badging`: package
    `id.kasirnova.kasir`, minSdk 23 / targetSdk 35,
    izin Bluetooth (BLUETOOTH, BLUETOOTH_ADMIN, BLUETOOTH_CONNECT,
    BLUETOOTH_SCAN, ACCESS_FINE_LOCATION) ada; kelas `NovaPrinterPlugin`
    ter-*dex*; aset web (`assets/public/src/escpos.js`, `printer.js`) terpaket.
  - **Build APK rilis bertanda tangan resmi** `gradlew assembleRelease` →
    `app-release.apk` (~3,10 MB), `versionName 1.0.0-beta.2` / versionCode 2,
    sertifikat **KASIR NOVA** (`CN=KASIR NOVA, O=KASIR NOVA, C=ID`, bukan
    *Android Debug*), skema v1+v2 terverifikasi (`apksigner verify`).
  - **Tanda tangan rilis:** keystore resmi `apps/kasir-mobile/android/nova-release.jks`
    (alias `nova-kasir`, RSA 2048, valid s/d 2054) + `key.properties`
    (dibuat dari `key.properties.example`), konfigurasi `signingConfigs.release`
    disuntik `setup-android.mjs` (idempoten). Kredensial di
    `keystore-credentials.txt`; rahasia (`*.jks`, `key.properties`,
    `keystore-credentials.txt`, `google-services.json`) diabaikan git.
  - **Firebase App Distribution (project `kasir-nova`):** aplikasi Android
    `id.kasirnova.kasir` terdaftar (App ID
    `1:1057858530498:android:7091503841af1c892a9f5b`), grup penguji
    `kasir-beta` (1 penguji: `ridwansyarifuddin110@gmail.com`), dan APK
    **`1.0.0-beta.2` (bertanda tangan rilis) sudah didistribusikan**.
    Berkas siap pasang: `dist/apk/KASIR-NOVA-1.0.0-beta.2.apk`.
  - **Backend produksi di-deploy ulang** (Vercel) agar allowlist CORS memuat
    origin WebView APK (`https://localhost`, `capacitor://localhost`,
    `http://localhost`). Verifikasi: `GET /api/health` dengan
    `Origin: https://localhost` → `200` + `Access-Control-Allow-Origin:
    https://localhost`; origin web `https://kasir-nova.web.app` tetap `200`.
  - **Frontend di-deploy ulang** ke Firebase Hosting (13 Okt 2026) agar panel
    Kasir web memuat modul Fase 17. Verifikasi: `GET /kasir/src/printer.js` →
    `200` `text/javascript`; `index.html` memuat `printer-card`; header
    keamanan (`nosniff`, `X-Frame-Options: DENY`, `no-referrer`) tetap;
    panel **Owner & Admin tidak berubah** (byte identik dengan sebelum deploy).
- **Belum terverifikasi:** cetak **runtime ke printer fisik** (SPP/BLE) —
  tidak ada perangkat printer pada lingkungan pengembangan.
- **Selesai jika:** sebagai aplikasi Android, panel Kasir berjalan pada perangkat
  (ponsel/tablet) dan fitur cetak thermal tersedia.

## Fase 18 — V0.3: HPP, Stok Habis, Pengeluaran Outlet & Laporan Keuangan (13 Okt 2026) ✅ SELESAI
- **Tujuan:** melengkapi operasional harian — modal (HPP) & satuan, foto
  produk, aturan HABIS turunan, pencatatan pengeluaran outlet, serta laporan
  keuangan/laba (kotor & bersih) **lintas Owner & Kasir** dengan akses yang
  dibatasi server.
- **Migrasi `0009`** (`server/src/db/migrations/0009_product_inventory_expenses.sql`):
  - `products`: `cost_price`, `unit`, `photo_url`, `manual_out_of_stock`,
    `stock_note`, jejak `created_by_*`/`updated_by_*`, `status` produk aktif.
  - `cashiers.can_view_profit` (opt-in Owner untuk membuka HPP/laba).
  - `transaction_items.cost_price` (**snapshot HPP** saat penjualan) dan
    `payments.fee_amount` (biaya transaksi/gateway).
  - Tabel **`inventory_movements`** (append-only, enum `inventory_movement_type`)
    dan **`expenses`** (+ enum kategori/metode/status).
  - Semua kolom baru ber-`DEFAULT` sehingga aman untuk data lama.
- **HPP (`cost_price`) dibatasi izin di server:** Owner selalu; Kasir hanya bila
  `can_view_profit`. Field dihapus dari respons tanpa izin; memasukkan HPP dari
  Area Kasir tanpa izin → **403**. UI hanya menyesuaikan tampilan.
- **HABIS turunan:** `manual_out_of_stock = true` **ATAU**
  (`track_stock` dan `total_stock ≤ 0`). Server **memblokir penjualan** produk
  HABIS (bukan hanya UI); aktivasi kembali mensyaratkan stok `> 0`.
- **Inventori append-only:** setiap mutasi saldo (stok awal, opname, penjualan,
  refund, void, tandai habis/aktifkan) menulis satu baris
  `inventory_movements` dalam **transaksi DB yang sama**; tidak ada endpoint
  hapus. `product_name` disimpan sebagai snapshot.
- **Pengeluaran outlet** (`expenses`): kategori `operational`/`utilities`/
  `supplies`/`transport`/`maintenance`/`inventory_purchase`/`other`, metode
  `cash`/`transfer`/`qr`, `spent_on` berbasis **zona waktu bisnis**. Koreksi
  memakai **void** (bukan hapus); kasir hanya boleh membatalkan catatannya
  sendiri (403). Kategori `inventory_purchase` **dikecualikan** dari laba agar
  HPP tidak dihitung dua kali.
- **Laporan keuangan** `GET .../reports/finance` (+ ekspor xlsx 3 sheet
  `Ringkasan Keuangan`/`Per Outlet`/`Pengeluaran Outlet`): pendapatan per
  metode, HPP (dari snapshot), biaya transaksi, pengeluaran operasional, laba
  kotor (pendapatan − HPP) & laba bersih (laba kotor − operasional − fee) +
  baris per outlet. Kasir memakai `GET /api/cashier/reports/daily`
  (bentuk sama, satu outlet); server **menghapus** field laba bila kasir tidak
  berizin.
- **Frontend `apps/owner`:** kolom **Laba** pada daftar kasir (toggle izin),
  form produk (HPP, satuan, stok awal, HABIS, foto dengan pengecilan JPEG),
  badge status + tombol Tandai HABIS/Hapus, section **Laporan Keuangan**
  (rentang cepat/kustom + ekspor .xlsx), **Pengeluaran** (catat → void via
  modal), dan **Pergerakan Stok**.
- **Frontend `apps/kasir`:** navigasi **5 tab** (Kasir, Produk, Pendapatan,
  Pengeluaran, Stok); Kelola Produk (CRUD kecuali hapus + HPP bila berizin +
  foto + stok awal), laporan pendapatan harian (HPP/laba hanya bila berizin),
  catat/void pengeluaran, dan riwayat pergerakan stok outlet. Aset
  `apps/kasir-mobile/www` disinkronkan (`build-www.mjs`).
- **Dokumentasi:** `docs/18-api-pengeluaran-inventori.md` (baru) serta
  pembaruan `docs/03-model-data.md`, `docs/04-matriks-hak-akses.md`,
  `docs/14-api-produk-stok.md`, `docs/16-api-laporan.md`.
- **Pengujian:** `server/tests/v03-features.test.js` (HPP per peran, HABIS
  otomatis/manual + blokir, void mengembalikan stok + jejak pergerakan,
  snapshot HPP & biaya, pengeluaran bisnis/outlet, isolasi tenant) — **seluruh
  suite server 220/220 lulus**.
- **Aset & ikon:** favicon/apple-touch/ikon PWA (`site.webmanifest`) untuk
  Admin/Owner/Kasir serta ikon launcher Android (adaptive, latar navy `#02102B`)
  dihasilkan dari logo sumber via `scripts/generate-icons.ps1`.
- **APK Android:** versi dinaikkan ke `1.0.0-beta.3` (versionCode `3`); ikon
  launcher diganti dengan ikon **KASIR NOVA**. APK rilis terbangun & terverifikasi
  (`assembleRelease`; `aapt2`/`apksigner`: `id.kasirnova.kasir`, `v1+v2`, DN
  *KASIR NOVA*) dan **didistribusikan** ke grup penguji `kasir-beta` via Firebase
  App Distribution (13 Okt 2026).
- **Deploy frontend:** `dist/hosting` dibangun dengan
  `NOVA_API_BASE=https://kasir-nova.vercel.app` lalu **di-deploy** ke Firebase
  Hosting (`kasir-nova.web.app`). Sebelumnya config produksi keliru same-origin
  (`''`) sehingga `/api/**` **404** di domain Hosting — kini **diperbaiki**
  (halaman Kasir/Owner/Admin `200`, preflight `OPTIONS` → `204`). Verifikasi UI
  statis (3 panel) + smoke bundel Hosting: `npm run verify:ui`.
- **Tertunda:** verifikasi cetak ke printer fisik, dan keputusan gateway
  pembayaran & perpanjangan otomatis.

## 17 Okt 2026 — Perbaikan 404 panel web (regresi base API Hosting)

**Gejala dilaporkan pemilik:** panel **Admin** dan **Owner** di
`kasir-nova.web.app` terbuka, tetapi login/pengambilan data gagal — tampak
sebagai **HTTP 404**.

**Akar masalah (regresi build, bukan bug kode server):** `dist/hosting` di-build
dengan `node scripts/build-hosting.mjs` **tanpa argumen**, sedangkan default lama
script tersebut adalah base **kosong** (same-origin). Karena `firebase.json`
tidak memuat rewrite `/api/**` (paket Spark), frontend web menembak
`https://kasir-nova.web.app/api/**` → **404 "Page Not Found"** milik Firebase.
Kesalahan identik pernah terjadi 13 Okt 2026 (lihat `docs/24`) lalu terulang.

**Perbaikan:**
- Default `scripts/build-hosting.mjs` kini **URL backend produksi**
  (`https://kasir-nova.vercel.app`). Same-origin harus diminta eksplisit
  (`--same-origin`) dan memunculkan peringatan.
- **Beranda root** `https://kasir-nova.web.app/` (pemilih panel Kasir/Owner/Admin)
  menggantikan redirect `301 → /kasir`, ditambah halaman **404** bergaya KASIR
  NOVA (`dist/hosting/404.html`) sehingga alamat salah tidak lagi menampilkan
  halaman bawaan Firebase. Sumber: `scripts/hosting-landing.html`,
  `scripts/hosting-404.html` (disalin saat build).
- **Kunci regresi otomatis:** `scripts/verify-ui.mjs` menolak bundel Hosting yang
  `NOVA_API_BASE`-nya kosong/relatif dan memeriksa beranda + 404; langkah baru
  **26b** di `scripts/e2e-online.mjs` memeriksa base absolut & beranda di
  produksi.
- **Verifikasi:** `qa:local` **semua tahap LULUS** (server 248/248, UI `SEMUA OK`,
  auth 10/10, image 9/9); `e2e:online` **34/34 PASS** (termasuk 26b); produksi:
  `config.js` ketiga app = `https://kasir-nova.vercel.app`, beranda `200`,
  `/Admin` `/dashboard` `/login` → `404` halaman KASIR NOVA, preflight & login
  cross-origin dari origin Hosting `204`/`200`.

## 17 Okt 2026 — Laporan Transaksi Siap-Cetak (Owner)

**Permintaan pemilik:** halaman laporan transaksi siap-cetak (PDF) sesuai contoh
`contoh laporan transaksi.png`, bukan hanya ekspor tabel.

**Keputusan pemilik (dijawab dalam checklist):** A1a (HTML → PDF peramban),
A2b (**hanya Owner**; kasir tetap 403), A3a (**satu baris per item**), A4a
(nomor transaksi tetap **`INV-`**, contoh memakai `TRX-`), A5a (cakupan kasir =
semua transaksi outlet — dicatat, belum dibuat).

**Dikerjakan:**
- Endpoint baru `GET /api/owner/businesses/:businessId/reports/transactions`
  (schema + service + controller + route) — hanya Owner/admin platform, tenant
  ditegakkan; baris per item, ringkasan, rekap metode, top produk, `limit` 1…5000.
- Panel Owner: tombol **Cetak Laporan** + halaman cetak `#print-report`
  (kop, 5 KPI, tabel detail, Ringkasan/Produk Terlaris/Catatan, footer) dan blok
  `@media print` A4 hemat tinta.
- Perbaikan: omzet per metode diambil dari `transactions.total` (bukan
  `payments.amount` yang memuat kembalian) sehingga persentasenya 100%.

**Berkas:** `docs/35-laporan-transaksi-cetak.md` (spesifikasi + penyimpangan),
`server/tests/report-transactions.test.js`, `apps/owner/{index.html,src/app.js,src/styles/styles.css,src/api.js}`,
`server/src/modules/report/{schema,service,controller,routes}.js`,
`scripts/verify-ui.mjs` (bagian pengunci baru), `scripts/qa-local.ps1` (label 253).

**Pengujian lokal:** server **266/266** (6 tes laporan), `verify:ui` **SEMUA OK**.

**DEPLOY (17 Okt 2026, izin pemilik):** backend → Vercel
(`npx.cmd vercel deploy --prod --yes`) dan frontend → Firebase Hosting
(`node scripts/build-hosting.mjs https://kasir-nova.vercel.app` +
`firebase deploy --only hosting`). Verifikasi: `/api/health` **ok** (DB up),
rute baru `…/reports/transactions` **401** tanpa token (hidup di produksi),
halaman `/` `/kasir/` `/owner/` `/admin/` **200**, CORS APK & preflight web OK.
Catatan lengkap: `docs/24` (bagian "Deploy 17 Okt 2026"). Uji cetak nyata di
peramban tetap pekerjaan pemilik.

**Insiden sesudah deploy (17 Okt 2026):** pemilik melaporkan panel **Owner blank
putih**. Penyebab: blok duplikat di `apps/owner/src/app.js` → `SyntaxError` →
modul gagal dimuat (HTML valid, `#login-view` tetap `hidden`). Perbaikan
diterapkan & hosting dideploy ulang; diverifikasi dengan **Chrome headless**
(`#login-view` tampil di `/owner/`, `/kasir/`, `/admin/`) dan **dikonfirmasi
pemilik** ("sudah bisa", 17 Okt 2026). Pencegahan: `verify-ui`
kini menjalankan `node --check` atas seluruh berkas `apps/*/src/*.js` (14 berkas).
Detail + bukti: `docs/24` bagian "Insiden 17 Okt 2026".
**Tindak lanjut (izin pemilik):** header cache aset di `firebase.json` diubah dari
`max-age=3600` menjadi **`no-cache`** (revalidasi ETag) agar perbaikan langsung
terlihat tanpa hard refresh; hosting dideploy ulang & diverifikasi.

**Temuan omzet tunai — SUDAH DIPERBAIKI (17 Okt 2026, dengan izin pemilik):**
`incomeByMethod` pada laporan keuangan memakai `payments.amount` (uang **diterima**,
termasuk kembalian) sehingga pendapatan tunai — dan ikutannya laba kotor/bersih —
terlihat lebih tinggi. Kini laporan keuangan memakai `SUM(transactions.total)`
(omzet) untuk agregat **per metode** dan **per outlet**; `payments` hanya dipakai
untuk `fee_amount` + status `paid`. Detail + bukti: `docs/35` §9.

## 17 Okt 2026 — Struk PDF Kasir (kirim / simpan / cetak)

**Permintaan pemilik:** *"saat klik bayar harus tampil struk pdfnya dan dari situ
pdfnya bisa di share/kirim dan di cetak, jadi tidak perlu menunggu printer
tersambung terlebih dahulu untuk menampilkan struk pdfnya."*

**Alur baru:** `Bayar` → transaksi tercatat server → **struk langsung tersedia
sebagai berkas PDF** (tanpa printer) → tombol **[Kirim] [Simpan PDF] [Cetak]**,
plus **[Cetak Thermal]** sebagai opsi. Tombol `Cetak 58mm`/`Cetak 80mm` lama
digantikan tombol **Cetak** (lebar kertas tetap dapat diatur di kartu Printer).

**Dikerjakan:**
- `apps/kasir/src/receipt-pdf.js` — pembentuk struk PDF **murni** dengan penulis
  PDF minimal (tanpa pustaka pihak ketiga): Courier base-14, ASCII, 58/80 mm,
  tinggi mengikuti isi, pemecahan multi-halaman, susunan baris sama dengan
  `escpos.js`.
- `apps/kasir/src/struk-share.js` — **simpan/kirim/cetak** (peramban: Web Share +
  unduhan; APK: plugin native).
- `apps/kasir/{index.html,src/app.js,styles/styles.css}` — tombol PDF + catatan
  `#struk-pdf-note`; PDF dibentuk di `showFinalReceipt()` (setelah pembayaran).
- **APK:** plugin Capacitor **`NovaReceipt`** (`share`/`save`/`print`, FileProvider
  + `PrintManager`) + pendaftaran di `MainActivity`; `setup-android.mjs` menyalin
  `NovaReceiptPlugin.java` dari `android-templates/`.

**Berkas:** `docs/36-struk-pdf-kasir.md` (spesifikasi + penyimpangan),
`server/tests/struk-pdf.test.js`, `apps/kasir-mobile/android-templates/NovaReceiptPlugin.java`,
`apps/kasir-mobile/{package.json,scripts/setup-android.mjs}`, `scripts/verify-ui.mjs`
(bagian **"struk pdf kasir (17 Okt 2026)"**), `scripts/qa-local.ps1` (label **266**),
`docs/25` (§3.4/§4.2 + riwayat beta.7/beta.8), `docs/30` (tabel tombol).

**Pengujian lokal:** server **266/266** (12 tes struk PDF + 6 tes laporan), `verify:ui` **SEMUA OK**.

**Rilis:** APK **`1.0.0-beta.7`** (versionCode `7`) dibangun
(`gradlew assembleRelease` → BUILD SUCCESSFUL) & **didistribusikan** ke grup
`kasir-beta` (Firebase App Distribution, 17 Okt 2026). **Tidak memerlukan deploy
backend** (struk dibentuk di perangkat).

**Perbaikan 17 Okt 2026 (laporan pemilik — PDF kosong):** pada beta.7 berkas struk
PDF tampil **kosong** karena `/Kids` pohon halaman menunjuk objek *stream isi*
(5+2i) alih-alih objek *halaman* (6+2i). Ditemukan dengan menguji berkas memakai
mesin PDF bawaan Windows (gagal dimuat) + pembanding PDF acuan Chrome (berhasil),
lalu diperbaiki & diverifikasi dengan **merender struk ke PNG** (tampil utuh,
termasuk struk 120 item → 2 halaman). Tes baru `assertPageTreeValid` menjaga
pohon halaman (Kids/Count/Parent/Contents/Length). APK **`1.0.0-beta.8`**
(versionCode `8`) dibangun & didistribusikan ke grup `kasir-beta`; sertifikat rilis
sama sehingga dapat dipasang langsung di atas beta.7. Rincian: `docs/36` §6.1.

**Hasil uji perangkat (17 Okt 2026):** pemilik melaporkan **"uji struk pdf sukses"**
pada APK `1.0.0-beta.8` — struk PDF tampil & dapat dipakai (kirim/simpan/cetak)
tanpa menunggu printer thermal tersambung. APK juga dikirim ke penguji
`arshakacoffe@gmail.com` (grup `kasir-beta`). Cetak ke printer thermal fisik tetap
belum terverifikasi (tidak ada printer di lingkungan pengembangan).

**Belum dikerjakan:** logo outlet di dalam PDF (dikecualikan pemilik).

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
