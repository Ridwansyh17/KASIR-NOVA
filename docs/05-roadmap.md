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

**Rilis `1.0.0-beta.9` (17 Okt 2026):** APK dibangun ulang (versionCode `9`)
karena berkas panel kasir di dalam beta.8 (dibangun 08:53) sudah **tertinggal**
pekerjaan kasir 13:23 — tab **Laporan Transaksi**, **ekspor Excel** `.xlsx`, dan
perbaikan unduh berkas web. Dibuktikan dengan **membongkar APK**: `src/app.js`,
`src/api.js`, `src/struk-share.js`, `index.html` kini **identik** dengan repo
(pada beta.8 keempatnya berbeda). Berkas
`dist/apk/KASIR-NOVA-1.0.0-beta.9.apk` (5,03 MB, SHA-256 `24a1e740…babf`),
sertifikat rilis sama seperti beta.8; `aapt dump badging` →
`versionCode='9'` / `versionName='1.0.0-beta.9'`. **Sudah diunggah &
didistribusikan** ke grup `kasir-beta` (Firebase App Distribution, 17 Okt 2026,
release `4sllfgq44brq8`) setelah `firebase login --reauth`. Rincian: `docs/25`
§1 & §7.

**Belum dikerjakan:** logo outlet di dalam PDF (dikecualikan pemilik).

## 17 Okt 2026 - Ekspor Excel Laporan Transaksi (Owner)

Permintaan pemilik (dipilih dari daftar lanjutan): **Ekspor Excel** untuk
**Laporan Transaksi** — berkas `.xlsx` dari laporan yang sama (satu baris per
ITEM), agar bisa diolah di Excel tanpa mengetik ulang.

**Dikerjakan:**
- `server/src/modules/report/xlsx.js` — `buildTransactionReportWorkbook()`:
  4 sheet (`Ringkasan`, `Detail Transaksi` + baris TOTAL, `Rekap Metode Pembayaran`
  dengan format persen, `Produk Terlaris`), nominal **rupiah** + format mata uang,
  sanitasi *formula injection*, peringatan **TERPOTONG** bila baris dipotong.
- `server/src/modules/report/{service,controller,routes,schema}.js` —
  `exportTransactionReportXlsx()` + rute `GET /reports/transactions/export`
  (owner & platform_admin baca-saja; kasir 403; owner lain 404). Skema ekspor:
  `limit` **5000** bawaan, maksimum **20000** (halaman tetap 1000).
- `apps/owner/{index.html,src/api.js,src/app.js}` — tombol
  `#rep-transactions-xlsx` ("Ekspor Laporan Transaksi (.xlsx)") + status sibuk &
  notifikasi lewat `runXlsxDownload` (pola yang sudah ada).

**Berkas:** `docs/35` (§5b + §6 + §7), `docs/16` (endpoint + 8 kasus uji),
`server/tests/report-transactions.test.js` (2 kasus baru),
`scripts/verify-ui.mjs` (bagian **"ekspor Excel laporan transaksi (17 Okt 2026)"**),
`scripts/qa-local.ps1` (label **268**), `README.md`.

**Pengujian lokal:** berkas `.xlsx` dibuka ulang dengan **ExcelJS** (nama sheet,
urutan baris, nilai rupiah, `numFmt` persen, baris TOTAL, peringatan terpotong,
batas `limit` 422, isolasi peran). Server **268/268 lulus**, `verify:ui` **SEMUA OK**.

**Rilis (17 Okt 2026, izin pemilik):** dideploy ke produksi — backend **root repo**
`npx.cmd vercel deploy --prod --yes` (proyek Vercel `kasir-nova`, alias
`https://kasir-nova.vercel.app`) + hosting `build-hosting` & `firebase deploy`
(`https://kasir-nova.web.app`). Verifikasi: alias menunjuk build baru,
`/api/health` **200** (`database: up`), tombol & API ekspor ada di berkas Hosting,
`/owner/` tampil normal via Chrome headless. Catatan lengkap + insiden "deploy ke
proyek Vercel yang salah": `docs/24` bagian *Deploy 17 Okt 2026 (lanjutan)*.

**Belum dikerjakan:** pembukaan berkas di Excel/Google Sheets versi pemilik;
tombol ini tidak muncul di APK (panel Owner hanya di web).

## 17 Okt 2026 - Nomor Halaman Cetak Laporan Transaksi (Owner)

Permintaan pemilik (dipilih dari daftar lanjutan): **nomor halaman** ("Halaman i
dari N") pada cetak *Laporan Transaksi* yang lebih dari satu halaman A4.

**Inti masalah:** CSS paged media tidak memberi nomor halaman ke dalam aliran
dokumen (Chrome tidak mendukung `@bottom-center { content: counter(page) }`), dan
peramban memenggal halaman sesuka ukuran isi. Jadi laporan harus **dipenggal
sendiri** supaya nomornya benar.

**Dikerjakan:**
- `apps/owner/src/report-print.js` (**baru**; murni, tanpa DOM) —
  `PRINT_LAYOUT { rowsFirstPage: 21, rowsNextPage: 26, tailRows: 5 }`,
  `planPrintPages()` (pembagian baris + peletakan blok bawah),
  `pageLabel()`, `renderPrintReport()` (HTML per halaman + footer nomor halaman),
  `PRINT_STATUS_LABELS`.
- `apps/owner/src/app.js` — penyusun HTML laporan (178 baris) dipindah dari `app.js`
  ke modul di atas; panggilan kini mengirim peta formatter
  (`escape/idr/periode/cetak/tanggalJam/metode/status`).
- `apps/owner/styles/styles.css` — `#print-report .pr-page + .pr-page { break-before: page }`
  + gaya kop ringkas `.pr-cont` untuk halaman lanjutan.
- `scripts/print-report-check.mjs` (**baru**) — pengukur tata letak nyata: cetak
  laporan sintetis ke **PDF via Chrome headless** (A4) lalu bandingkan jumlah
  halaman PDF dengan jumlah halaman rencana.
- `server/tests/report-print-pages.test.js` (**baru**) — **10 kasus** paginasi,
  nomor halaman, escaping, dan regresi label status.

**Kapasitas (diukur, lalu diberi margin):** halaman 1 ≈ 24 baris, halaman lanjutan
≈ 29 baris, blok bawah ≈ 5 baris → dipakai **21 / 26 / 5**. Konsekuensi yang
diterima: laporan **≤ 16 baris** tetap 1 halaman; laporan 17–21 baris memakai
halaman terakhir khusus untuk ringkasan (lebih baik daripada ringkasan terpotong).

**Berkas:** `docs/35` (§5c + §5b/section terkait + §6 + §7 + §8), `docs/16`
(jumlah tes), `scripts/verify-ui.mjs` (bagian **"nomor halaman cetak laporan
(17 Okt 2026)"** + penjaga regresi `STATUS_LABELS`), `scripts/qa-local.ps1`
(label **278**), `README.md`.

**Pengujian lokal:** `report-print-pages.test.js` **10/10**, suite server
**278/278**, `verify:ui` **SEMUA OK**, `scripts/qa-local.ps1` semua tahap lulus,
dan `print-report-check.mjs` **SEMUA OK** untuk 0…400 baris (jumlah halaman PDF =
jumlah halaman rencana; tidak ada halaman meluber/kosong).

**Rilis (17 Okt 2026, izin pemilik):** dideploy ke **Hosting Firebase saja**
(tidak ada perubahan backend) — `build-hosting` + `firebase deploy --only hosting
--project kasir-nova` (`https://kasir-nova.web.app`). Verifikasi: `/owner/src/report-print.js`
**200** (memuat `planPrintPages`/`rowsFirstPage: 21`), `styles.css` memuat
`break-before: page`, `app.js` mengimpor modul baru, `/owner/` tampil normal
(`#login-view` tanpa `hidden` di Chrome headless), JS/CSS `cache-control: no-cache`.

**Belum dikerjakan:** pencetakan sungguhan oleh pemilik (dialog cetak Chrome/Edge →
PDF) untuk menilai tampilan; tombol ini juga tidak muncul di APK.

## 17 Okt 2026 - Laporan Transaksi untuk Kasir (A5a)

Permintaan pemilik (dipilih dari daftar pekerjaan lanjutan): **laporan transaksi
untuk panel Kasir**. Keputusan pemilik yang diikuti: **B1** satu baris per
**transaksi** + kartu ringkasan, **B2** kasir **boleh** ekspor Excel, **B3** tab
baru **"Laporan Transaksi"** dengan rentang bawaan **hari ini**; ditambah **A5a**
cakupan = **semua** transaksi outlet kasir.

**Dikerjakan:**
- `server/src/modules/report/service.js` — dua helper bersama
  (`statusStats()`, `paymentMethodRecap()`) dipakai **bersama** laporan Owner &
  kasir (agar angka kedua panel tidak pernah berbeda) + `cashierTransactionReport()`
  (satu baris per transaksi, **terbaru dulu**, `items`/`methods` per baris) +
  `exportCashierTransactionReportXlsx`.
- `server/src/modules/report/schema.js` — `cashierTransactionReportQuerySchema`
  (limit **200**, maks 1000) & `cashierTransactionReportExportQuerySchema`
  (bawaan 2000, maks 20000). **Tanpa** `outletId`/`cashierId` (outlet dari akun).
- `server/src/modules/report/xlsx.js` — `buildCashierTransactionReportWorkbook`
  (**3 sheet**: Ringkasan, Daftar Transaksi + baris TOTAL, Rekap Metode; tanpa
  Produk Terlaris; peringatan **TERPOTONG**).
- `server/src/modules/cashier-area/{routes,controller}.js` —
  `GET /reports/transactions` + `GET /reports/transactions/export` di bawah
  `cashierOnly`; `outletId`/`businessId` **dipaksa** dari `req.cashierScope`;
  rentang dihitung server (bawaan hari ini).
- Panel Kasir: tab **Laporan Transaksi** (`#main-tabs` + menu Lainnya), pane
  `data-pane="laporan"` (rentang, tanggal kustom, status, pencarian, kartu
  ringkasan, tabel satu baris per transaksi, tombol **Ekspor Excel**),
  `api.transactionsReport()` & `api.transactionsReportFile()` (permintaan biner
  dengan refresh 401), ekspor lewat `strukShare.saveXlsx()` — plugin
  `NovaReceipt` di APK, unduhan blob di web (**tanpa kode Android baru**).
- **Bug lama diperbaiki:** `new root().Blob(...)` di `struk-share.js` selalu
  gagal ("root is not a constructor") sehingga jalur **unduh berkas di web**
  (fallback struk PDF) tidak pernah berfungsi; kini konstruktor diambil ke
  variabel dan `verify-ui.mjs` menolak pola itu.
- Tes **baru** `server/tests/cashier-report-transactions.test.js` (**10 kasus**)
  + **3 kasus** berkas Excel di `struk-pdf.test.js`.
- Dokumen **baru** `docs/37-laporan-transaksi-kasir.md`; `docs/16` (endpoint +
  pengujian), `docs/04` §8 (matriks: kasir kini ✅ untuk laporan transaksi outlet
  + ekspor .xlsx-nya), `scripts/verify-ui.mjs` (bagian **"laporan transaksi kasir
  (17 Okt 2026)"** + 2 pengunci negatif), `scripts/qa-local.ps1` (label **291**),
  `README.md`.

**Pengujian lokal:** `cashier-report-transactions.test.js` **10/10**,
`struk-pdf.test.js` **15/15**, suite server **291/291**
(≈239 detik), `node scripts/verify-ui.mjs` **SEMUA OK**, `node --check` seluruh
berkas panel yang diubah OK.

**Rilis (17 Okt 2026, izin pemilik):** dideploy **backend + hosting** — backend
dari **root repo** (`npx.cmd vercel deploy --prod --yes`) karena ada rute baru,
lalu `build-hosting` + `firebase deploy --only hosting --project kasir-nova`
(4 berkas kasir baru). Verifikasi: `/api/health` 200; rute baru **401** (ada)
sementara jalur tak dikenal **404**; hosting `/kasir/` + `src/{app,api,struk-share}.js`
memuat bagian baru (`data-pane="laporan"`, `loadReportTransactions`, `saveXlsx`)
dan bersih dari pola `new root().`; Chrome headless `/kasir/` menampilkan
`#login-view` tanpa `hidden`. Catatan: perintah root repo membuat PowerShell
menampilkan *exit code 1* palsu walau CLI melaporkan `ready`.

**Belum dikerjakan (sisi pemilik):** membuka berkas `.xlsx` hasil ekspor kasir di
Excel/Google Sheets; uji langsung tab baru di perangkat; **rebuild APK beta.9**
(pemilik memilih "nanti saja") agar fitur ini ikut di APK.

## 17 Okt 2026 — Pembayaran Langganan via Payment Gateway (Duitku SANDBOX)

Permintaan pemilik: menyiapkan **integrasi payment gateway untuk pembayaran
langganan** agar uji coba dapat dilakukan sebelum produksi.

- **Keputusan pemilik:** penyedia **Duitku SANDBOX**; bentuk tagihan **API inti
  per kanal** (VA/QRIS lewat `/v2/inquiry`), **bukan** halaman Snap; yang membayar
  **Owner self-service**; aktivasi setelah pembayaran **sukses** (callback);
  `auto_renew` tetap `false`; kredensial diisi pemilik di `server/.env`
  (tidak pernah di-commit/di-paste); uji webhook **lokal dulu**; **hanya
  langganan** (penjualan kasir tetap manual); rilis APK ditahan.
- **Migrasi `0010_subscription_invoices.sql`:** enum `subscription_invoice_status`
  + tabel `subscription_invoices` (amount **sen**, `order_id` unik, snapshot
  `plan.price`, data VA/QRIS dari gateway, `inquiry_payload`/`callback_payload`
  tanpa `signature`, `attempts`, `created_by`) dengan index **unik parsial**
  "satu tagihan pending per bisnis" — tabel **terpisah** dari `payments`
  (yang terikat penjualan).
- **Modul baru `server/src/payments/`:** `duitku.js` (HMAC-SHA256:
  inquiry `merchantCode+orderId+amount`, status `merchantCode+orderId`,
  callback `merchantCode+amount+orderId`; `timingSafeEqual`;
  `stripSignature`), `channels.js` (katalog kanal + `maxExpiry`), `index.js`
  (registri penyedia + `setProviderForTests` + `describePayments`).
  Kredensial kosong ⇒ **503**, server tetap jalan; mode produksi terkunci
  `PAYMENT_ALLOW_PRODUCTION`.
- **Modul baru `server/src/modules/subscription-invoice/`:** `checkoutOptions`
  (paket + kanal + status gateway), `createInvoiceForPlan` (nominal dari
  `plan.price`, pakai-ulang tagihan pending, batalkan pending lain, sen→rupiah),
  `handleDuitkuCallback` (verifikasi tanda tangan, cek nominal, idempoten),
  `syncInvoiceStatus` (cek manual, dibatasi limiter), aktivasi langganan dengan
  pola `assignSubscription` **dalam satu transaksi** + audit per Owner.
- **Rute:** `/api/owner/businesses/:businessId/subscription/{plans,invoices,…}`
  (`requireBusinessAccess`) dan **publik** `POST /api/payments/duitku/callback`
  + `GET /api/payments/duitku/return` (limiter + allowlist IP opsional).
- **Panel Owner:** tombol **Bayar / Perpanjang**, modal pilih paket & kanal,
  tampilan nomor VA/**kode QR QRIS** (gambar QR + string yang dapat disalin) +
  tautan pembayaran, tombol **Cek Status**, dan **riwayat tagihan** di kartu
  Langganan.
- **Encoder QR di-vendor (17 Okt 2026):** Owner memindai QRIS dari layar, jadi
  `qrString` digambar sebagai kode QR memakai pustaka *QR Code Generator for
  JavaScript* (MIT, Kazuhiko Arase) yang di-*vendor* apa adanya di
  `shared/vendor/qrcode-generator.js`, dibungkus `shared/qr-code.js`
  (keluaran SVG data URL, tanpa canvas, quiet zone 4 modul sesuai EMVCo/QRIS).
  Salinan ke `apps/owner/src/` dijaga oleh `scripts/sync-shared.mjs`;
  uji baru `scripts/test-qr-code.mjs` (**9 kasus**). Bukti dapat dipindai:
  **decoder independen (jsQR) 5/5 terbaca identik** (termasuk QRIS ~230
  karakter → versi 10) + render nyata di Chrome headless (gambar 390×390 px).
  Rincian: `docs/38` §12.
- **Tes baru:** `duitku-client.test.js` (**12**) + `subscription-invoice.test.js`
  (**18**) dengan transport gateway disuntikkan dan verifikasi tanda tangan
  memakai implementasi asli. **Dokumen baru** `docs/38-pembayaran-langganan-gateway.md`;
  `docs/01`, `docs/03`, `docs/11` (#4), `docs/12`, `docs/24`, `README.md`,
  `scripts/verify-ui.mjs` (bagian **"pembayaran langganan (17 Okt 2026)"** + 4
  pengunci negatif), `scripts/qa-local.ps1` (label **321**).

**Pengujian lokal:** suite server **321/321** lulus, `node scripts/verify-ui.mjs`
**SEMUA OK**, `scripts/qa-local.ps1` **SEMUA TAHAP LULUS** (8/8: tahap baru
*Kode QR QRIS*), Chrome headless `/owner/` menampilkan `#login-view` +
`#pay-modal` (modul panel tidak blank) dan berhasil memuat gambar QR
(390×390 px).

**Rilis 17 Okt 2026 (izin pemilik):** backend **+ hosting** sudah di-deploy —
`https://kasir-nova.vercel.app` (deployment `kasir-nova-o4ph9cosx`) dan
`https://kasir-nova.web.app` (**51 berkas**, 6 berkas baru). Verifikasi:
`/api/health` 200; `POST /api/payments/duitku/callback` → **503**
(`gateway_belum_dikonfigurasi`, jadi **belum mungkin** ada tagihan uang nyata);
`/api/owner/.../subscription/plans` → **401**; aset QR di hosting byte-identik
dengan sumber kanonik; **E2E online 29/29 PASS**. Rincian: `docs/24`
(lanjutan 3) & `docs/20` §7.

**Belum dikerjakan:** panggilan **sungguhan** ke Duitku (butuh kredensial sandbox
di `server/.env` — akan diisi pemilik; saya jalankan uji buat tagihan VA +
tombol Cek Status), uji **callback sungguhan** (butuh `PAYMENT_*` di Vercel),
mode produksi, dan penagihan otomatis (`auto_renew`).

## 17 Okt 2026 - Akun Admin Platform "paten" + Perkakas CLI

**Permintaan pemilik:** tetapkan `admin.ridwan@nova.test` sebagai akun Admin
"paten" yang berwenang memberi langganan **gratis maupun berbayar**.

**Temuan (diverifikasi, bukan asumsi):**
- Wewenang yang diminta **sudah ada** untuk peran `platform_admin`: panel Admin →
  tab **Bisnis** → tombol **Langganan** → modal *Pasang Paket Ini* (semua paket,
  gratis s/d berbayar) + *Terapkan Status* (`active`/`past_due`/`expired`).
- Akun tersebut **belum ada**; akun admin hanya lahir dari `db:seed`, dan memang
  **tidak ada** cara membuat/mengubah akun admin dari aplikasi (sengaja).
- `clean-test-fixtures.mjs` (jalan otomatis sebagai `pretest`) **menghapus semua
  akun `@nova.test`** kecuali daftar yang dipertahankan → akun baru akan hilang
  setiap kali `npm test` bila tidak diperbaiki lebih dulu.
- `docs/04` mengklaim "Mengubah password sendiri ✅" untuk ketiga peran, padahal
  **tidak ada** endpoint maupun UI-nya (ditemukan saat pekerjaan ini). Dokumen
  dikoreksi; fiturnya **belum** dibuat (menunggu keputusan pemilik).

**Hasil:**
- Skrip baru `server/scripts/admin-account.mjs` + npm script
  `admin:list|create|password|status` (root & server). Idempoten; sandi hanya
  dari `NOVA_ADMIN_PASSWORD` / `NOVA_ADMIN_PASSWORD_FILE` (tidak pernah lewat
  argumen CLI); menolak basis data non-lokal tanpa `--allow-production`; ganti
  sandi atau suspend **otomatis mencabut semua sesi**; perubahan tercatat di
  `audit_logs` **tanpa** sandi.
- `clean-test-fixtures.mjs`: daftar `PATEN_ADMIN_EMAILS` + env
  `NOVA_KEEP_ADMIN_EMAIL` agar akun pemilik tidak ikut dibersihkan.
- Akun dibuat di DB dev: `admin.ridwan@nova.test` | **Admin Ridwan** | `active`
  (17 Okt 2026). Sandi diminta pemilik dan **tidak** disimpan di repo.

**Pengujian:** `server/tests/admin-account.test.js` **11/11 lulus**. Bukti
wewenang end-to-end (skrip di luar repo, fixture dibersihkan setelahnya)
**10/10**: login admin → baca daftar paket → buat akun Owner → Owner membuat
bisnis (otomatis paket default **Gratis**) → admin memasang paket **berbayar
Rp 1.000.000 tanpa pembayaran** → memasang paket **Gratis** → ubah status
`expired` lalu `active` → baca lintas bisnis + audit log.

**Dokumen diperbarui:** `docs/02` (tree `server/scripts/`), `docs/04` (§ 1 akun &
sandi, § 2 catatan akun paten), `docs/09` (akun admin tidak lewat API), `docs/23`
(perintah `admin:create` untuk produksi), `README.md`.

## 19 Okt 2026 — Setoran Kas (migrasi 0011) + Workflow Pengembangan Termux

**Tujuan.** Menyelesaikan migrasi `0011_cash_deposits.sql` yang sebelumnya
menggantung (ada di DB & disk tetapi tidak di Git dan tanpa kode) menjadi fitur
**Setoran Kas** yang berfungsi penuh di backend, sekaligus menyiapkan HP
(Termux) sebagai lingkungan pengembangan kedua.

**Fitur baru — Setoran Kas (uang tunai kasir → Owner).**
- Migrasi `0011_cash_deposits.sql` kini resmi (tracked Git). Tabel append-only:
  koreksi lewat **void**, bukan hapus.
- Modul `server/src/modules/cash-deposit/` (schema, service, controller, routes):
  - Owner: `GET/POST /api/owner/businesses/:businessId/cash-deposits`,
    `POST .../:depositId/void`.
  - Kasir: `GET/POST /api/cashier/cash-deposits`, `POST .../:depositId/void`
    (outlet & kasir diturunkan dari akun, bukan body/URL → anti-IDOR).
- Aturan: nominal sen > 0, metode `cash` (enum migrasi), `deposited_on` di zona
  waktu bisnis ≤ hari ini, kasir hanya boleh void catatannya sendiri, Owner
  bebas. Setoran **tidak** memengaruhi laba/rugi (perpindahan kas, bukan
  pendapatan/beban).
- Audit log: `cash_deposit.create` / `cash_deposit.void`.

**Perkakas Termux (pengganti PowerShell).**
- `scripts/verify-db.mjs` (read-only) — koneksi + status migrasi disk vs DB.
- `scripts/backup-db.mjs` — `pg_dump -Fc` + verifikasi `pg_restore --list`.
- `scripts/qa-local.mjs` — matriks QA lintas platform.
- Skrip npm: `db:verify`, `db:backup:portable`, `qa:portable`.

**Keamanan.** `.gitignore` diperketat: `.env.*` diabaikan (dengan pengecualian
`.env.example`), sehingga cadangan env seperti `server/.env.backup-dev` tidak
bisa ter-commit.

**Pengujian:** `server/tests/cash-deposits.test.js` **7/7 lulus**
(scope tenant, IDOR, void append-only, validasi, isolasi peran).

**Dokumen diperbarui:** `docs/40-setoran-kas.md` (baru), `docs/11` (keputusan
#6 selesai), `docs/41-workflow-termux.md` (baru), `docs/05` (entri ini).

## 19 Okt 2026 — Setoran Kasir Berbasis Periode (migrasi 0012) + Perbaikan Omzet Tunai

**Tujuan.** Meningkatkan Setoran Kas dari pencatatan nominal manual menjadi
**perhitungan otomatis per periode shift** (revenue tunai/QRIS − pengeluaran kas
= setoran wajib), lengkap dengan UI tiga panel, struk, uji, dan deploy.

**Backend.**
- Migrasi `0012_cashier_settlements.sql` (aditif, non-destruktif): enum
  `draft`/`completed` + `expense_method 'other'`, kolom settlement pada
  `cash_deposits`, tabel `cash_deposit_transactions` & `cash_deposit_expenses`
  dengan indeks unik parsial `WHERE is_active` (anti-hitung-ganda), `CHECK amount
  >= 0` (dari `> 0`).
- `service.js`: `previewSettlement`, `createSettlement`, `completeSettlement`,
  `getCashDepositDetail`, `deleteDraft`, `settlementReport`,
  `listPlatformSettlements`, `resolvePeriod`, `computeSettlement`. Shift `full`,
  `pagi`, `sore`, `malam` di zona waktu bisnis. Advisory lock
  `pg_advisory_xact_lock(hashtextextended('settlement:<bisnis>:<outlet>:<tgl>'))`
  + deteksi periode tumpang tindih (409).
- Nomor setoran `STR-YYYYMMDD-NNN` unik per bisnis. Selisih ≠ 0 wajib beralasan
  (≥ 3 karakter), `difference = actual_cash − required_cash`.
- `xlsx.js` (ExcelJS) untuk ekspor; endpoint Owner `/report`, `/export`; Kasir
  scoped; Platform Admin `GET /api/platform/cash-settlements` (read-only).
- **Endpoint legacy tetap ada** (POST nominal manual + void) agar kompatibel;
  endpoint settlement ditambahkan berdampingan.

**Frontend.**
- Panel Kasir: form setoran (pratinjau live, pilih shift, draft/selesai), riwayat
  + filter, detail snapshot, void, hapus draft, dan **cetak struk**
  (`apps/kasir/src/setoran-receipt.js`): 58mm/80mm, PDF, ESC/POS, pratinjau,
  cetak ulang, penanda `DIBATALKAN` — mengikuti
  `assets/references/Contoh_Struk_Setoran_KASIR_NOVA.png`.
- Panel Owner: **Laporan Setoran** (filter outlet/kasir/tanggal/status, rekap
  harian/mingguan/bulanan, ekspor Excel).
- Panel Admin Platform: monitoring setoran lintas bisnis (read-only).

**Perbaikan (fix).** Omzet tunai setoran sebelumnya dijumlahkan dari
`payments.amount` (uang diterima, **termasuk kembalian**) sehingga kas wajib lebih
besar dari omzet. Diperbaiki memakai `t.total` (nilai bersih) — konsisten dengan
`paymentMethodRecap` laporan (lihat `server/src/modules/report/service.js`).
Contoh: total Rp40.000 dibayar Rp100.000 → setoran kini Rp40.000.
> Setoran yang sudah tersimpan sebelum fix menyimpan snapshot lama; perlu
> **void + buat ulang** agar angkanya benar.

**Pengujian.**
- `server/tests/cash-settlements.test.js`: 13 kasus (perhitungan tunai/QRIS/
  pengeluaran, nomor unik, tolak periode tumpang tindih/duplikat, kewajiban
  alasan selisih, snapshot setelah void, kekurangan kas, periode kosong,
  draft→selesai, isolasi outlet/tenant, rekap, ekspor xlsx, monitoring admin,
  **regresi omzet tunai bersih/kembalian**).
- Suite server total **352/352 lulus**; `node scripts/verify-ui.mjs` **SEMUA OK**.

**Deploy (19 Okt 2026, izin pemilik).**
- Migrasi `0012` diterapkan ke **Neon** produksi → total **12 migrasi**.
- Backend di-deploy ulang ke **Vercel** → https://kasir-nova.vercel.app
  (`/api/health` OK, `database: up`; rute settlement menjawab `401`, bukan 404).
- Frontend di-deploy ke **Firebase Hosting** → https://kasir-nova.web.app
  (base API `https://kasir-nova.vercel.app`).

**Commit:** `cc3102c` (feat: implement cashier settlement and receipt printing),
`bd4d3b4` (fix(setoran): hitung omzet tunai dari total bersih, kecualikan
kembalian). Push ke branch `feat/kasir-nova-v2`.

**Dokumen diperbarui:** `docs/40-setoran-kas.md` (model data, API, aturan,
frontend/struk, pengujian), `docs/05` (entri ini).

## 20 Okt 2026 — Navigasi Samping (Sidebar) Admin, Owner, dan Kasir

**Tujuan.** Menyesuaikan desain ketiga panel web agar menu berada di sisi kiri
mengikuti referensi `KASIR-NOVA-V3-REFERENSI-LENGKAP`. Perubahan hanya pada
lapisan tampilan frontend; alur bisnis, hak akses, API, dan database tidak
berubah.

**Frontend.**
- Stylesheet kanonik baru `shared/sidebar.css` disalin ke
  `apps/{admin,owner,kasir}/styles/sidebar.css` lewat `scripts/sync-shared.mjs`.
- `apps/admin`: sidebar berisi menu Owner, Paket, Bisnis & Langganan, Audit Log,
  Sesi Kasir, Setoran Kasir; info pengguna + tombol Keluar di kaki sidebar.
- `apps/owner`: sidebar berisi menu seksi (Dashboard, Profil Bisnis,
  Langganan, Outlet, Kasir, Produk & Stok, Transaksi, Laporan Penjualan,
  Laporan Keuangan, Pengeluaran, Setoran Kas, Riwayat Stok, Audit Log) yang
  menggulir ke seksi terkait dan menandai seksi aktif.
- `apps/kasir`: menu modul dipindah ke sidebar; navigasi bawah HP
  (`#bottom-nav`) tetap dipertahankan.
- Responsif: desktop sidebar tetap 252 px; layar ≤ 900 px memakai sidebar
  off-canvas dengan tombol hamburger, overlay, tombol Escape, dan kunci
  gulir halaman. Modal berada di atas sidebar (`z-index: 100`). Sidebar
  disembunyikan saat mencetak.

**Pengujian.**
- `node scripts/sync-shared.mjs --check` → **SEMUA SAMA**.
- `node scripts/verify-ui.mjs` → **SEMUA OK** (termasuk sintaks modul,
  id JS→HTML, token V2, dan smoke hosting).
- `npm run test:auth` → **10/10 lulus**.
- `node scripts/build-hosting.mjs` → berhasil.
- Keseimbangan tag HTML ketiga panel → OK.

**Deploy (20 Okt 2026, izin pemilik).**
- `firebase deploy --only hosting` → https://kasir-nova.web.app
- `/admin/`, `/owner/`, `/kasir/` → **200 OK**; `sidebar.css` tersaji (200).
- Backend/Vercel, database, dan billing tidak diubah.

**Dokumen:** `docs/42-navigasi-samping.md` (rincian lengkap), `docs/02`
(peta folder `shared/sidebar.css`), entri roadmap ini.

**Tertunda:** tinjauan visual pemilik di desktop dan HP.

## 20 Okt 2026 — Ganti Sandi Sendiri, Tombol Lihat Sandi, & Komitmen Navigasi Samping

**Tujuan.** Menutup pekerjaan yang tertunda di working tree (Keputusan #5 +
navigasi samping) dan menambahkan kemudahan **tombol lihat sandi** pada layar
login ketiga panel sesuai permintaan pemilik.

**Ganti sandi sendiri (Keputusan #5 — OPSI A).**
- Backend: `POST /api/auth/change-password` (`requireAuth` + `passwordLimiter`
  10/IP/15 menit + skema zod `changePasswordSchema`). Verifikasi sandi lama;
  sandi baru minimal 8 karakter & berbeda; **satu transaksi DB** mengganti
  `password_hash` + me-revoke **semua refresh token** peran+user **kecuali**
  token perangkat yang dipakai (dikirim via `refreshToken` opsional) +
  audit `auth.change_password` tanpa menyimpan sandi. Berlaku ketiga peran
  (`USER_STORES`).
- Frontend: modal **Ganti Sandi** di ketiga panel (`#password-modal`,
  tombol `#change-password-btn` di area pengguna/sidebar) + `api.changePassword()`
  (panggilan biner dengan refresh 401 mengikuti pola panel).
- Kontrak API: `docs/08` (bagian baru). Matriks hak akses: `docs/04` §1 kini
  ✅ untuk ketiga peran. Keputusan: `docs/11` #5 (arsip: sebelumnya "belum
  diputuskan").
- **Pengujian:** `server/tests/change-password.test.js` **8/8** (ketiga peran,
  sandi lama salah → 400 + hash tidak berubah, validasi 422, tanpa token → 401,
  sesi lain dicabut/refresh perangkat ini tetap jalan, audit tanpa data
  sensitif).

**Tombol lihat/sembunyikan sandi (permintaan pemilik).**
- Modul bersama baru `shared/pw-toggle.js` (disalin ke
  `apps/{admin,owner,kasir}/src/` oleh `scripts/sync-shared.mjs`, diimpor sebagai
  side-effect di tiap `app.js`). Membungkus **semua** `input[type="password"]`
  (layar login, modal ganti sandi, PIN kasir, reset sandi) dengan `.pw-wrap` +
  tombol `.pw-toggle` berikon mata (SVG inline, coretan saat aktif);
  `aria-label`/`aria-pressed`/`aria-controls` diperbarui otomatis; pengamat DOM
  menangani input yang muncul belakangan. Tanpa perubahan markup HTML; murni
  lapisan tampilan.
- Gaya `.pw-wrap`/`.pw-toggle` ditambahkan di `styles/styles.css` ketiga panel.
- **Pengunci regresi:** `scripts/verify-ui.mjs` bagian **"tombol lihat sandi
  (20 Okt 2026)"** (salinan sinkron, impor app.js, kelas CSS, input login tetap
  `type="password"`); `sync-shared --check` **SEMUA SAMA**.

**Navigasi samping (dikerjakan 20 Okt 2026 pagi, kini di-commit).**
Seluruh perubahan sidebar (`shared/sidebar.css` + salinan ketiga panel,
`docs/42-navigasi-samping.md`) dan ganti sandi sebelumnya **belum ter-commit**
di branch `feat/kasir-nova-v2` — pada sesi ini diselesaikan, diuji ulang, lalu
di-commit bersama fitur tombol lihat sandi.

**Hasil pengujian sesi ini:** suite server **360/360 lulus** (termasuk 8 tes
`change-password.test.js`), `sync-shared --check` **SEMUA SAMA**,
`node scripts/verify-ui.mjs` **SEMUA OK**, `node --check` seluruh berkas JS
panel OK.

**Deploy (20 Okt 2026, izin pemilik).** Backend **+ hosting** di-deploy —
`https://kasir-nova.vercel.app` (`/api/health` 200 `database: up`; rute baru
`change-password` menjawab **401** tanpa token) dan
`https://kasir-nova.web.app` (halaman ketiga panel **200**; `pw-toggle.js` &
`sidebar.css` tersaji **200**; `app.js` memuat impor pw-toggle; preflight CORS
**204**). Tidak ada migrasi DB & tidak ada perubahan env. Rincian perintah:
`docs/24` bagian *Deploy 20 Okt 2026*. Commit `5f24388` (push
`feat/kasir-nova-v2`).

**Tertunda (butuh tindakan/keputusan pemilik — tidak dikerjakan agent):**
tinjauan visual sidebar di desktop/HP; panggilan sungguhan Duitku (kredensial
sandbox di `server/.env` + `PAYMENT_*` di Vercel); uji cetak printer thermal
fisik; buka `.xlsx` di Excel milik pemilik; rilis APK berikutnya (ditahan
pemilik); tata letak halaman placeholder Kasir & paket mobile Owner/Admin
(menunggu spesifikasi, `docs/26` FASE 11); keputusan penyimpanan gambar
produk & aset logo transparan (`docs/26` §7).

## 20 Okt 2026 — Navigasi Panel Owner: Halaman Terpisah per Menu (bukan gulir)

**Tujuan.** Menutup poin tertunda `docs/42` §7: menu samping Owner yang
sebelumnya menggulir (`scrollIntoView`) diubah menjadi **halaman terpisah per
menu**, mengikuti pola tab Admin/Kasir sehingga konsisten antar panel.

**Implementasi (frontend saja).**
- `apps/owner/src/app.js`: blok navigasi diganti — `ownerPage` (halaman aktif,
  default `owner-top`, bisa dari `location.hash` saat reload/deep-link),
  `applyOwnerPage()` menandai seksi di luar halaman dengan kelas baru
  `.pg-off`, `navigateOwnerPage()` (tutup sidebar, scroll ke atas,
  `pushState`), plus `popstate` untuk tombol kembali/maju browser.
- `apps/owner/styles/styles.css`: `.pg-off { display: none !important }` —
  **terpisah** dari `.hidden` (status "data siap" milik pemuat data), sehingga
  pemuat data (`show`/`hide`) tidak perlu diubah sama sekali dan kembali ke
  suatu menu langsung menampilkan data yang sudah dimuat.
- Toolbar pemilih bisnis, `#alert`, dan `#waiting-state` tetap tampil di semua
  halaman; `#cross-section` & `#empty-state` khusus halaman Dashboard.
- **Tanpa perubahan** backend, skema DB, API, maupun aturan langganan
  (`git diff` hanya menyentuh `apps/owner`, `scripts/verify-ui.mjs`, docs).

**Pengunci regresi.** `scripts/verify-ui.mjs` bagian **"navigasi halaman
Owner"**: penanda `pg-off`/`applyOwnerPage`/`navigateOwnerPage`/`popstate`
ada di app.js, selektor `.pg-off` ada di CSS, dan tidak ada lagi
`scrollIntoView`.

**Hasil pengujian:** `sync-shared --check` **SEMUA SAMA**;
`node scripts/verify-ui.mjs` **SEMUA OK**; `npm run test:auth` **10/10**;
`npm run test:server` **360/360**; `node scripts/build-hosting.mjs` berhasil.

**Status:** commit `ae55a45` (push `feat/kasir-nova-v2`); **di-deploy 20 Okt
2026** ke Firebase Hosting (izin pemilik, cakupan hosting saja — backend tidak
diubah; rincian di `docs/24`). Tinjauan visual desktop/HP oleh pemilik tetap
dianjurkan — agen tidak memiliki browser (Chromium) di lingkungan Termux.

## 20 Okt 2026 — APK Kasir beta.11 + Kerangka APK Owner (FASE 11)

**APK Kasir 1.0.0-beta.11 (versionCode 11).**
- Dibangun di Termux (aarch64) dengan JDK 21 + Android SDK. `aapt2` bawaan
  Android SDK adalah biner x86-64 sehingga gagal di ARM (`Daemon startup
  failed`); solusinya override Gradle
  `-Pandroid.aapt2FromMavenOverride=/root/android-sdk-tools/build-tools/aapt2`
  (build-tools Android aarch64, statis). Dicatat di `README.md`.
- `npm run sync` + `setup-android.mjs` (versi 11). `gradlew assembleRelease`
  **BUILD SUCCESSFUL** → `app-release.apk` (5,29 MB) dengan tanda tangan
  resmi **KASIR NOVA** (`apksigner verify`: v1+v2 OK), izin Bluetooth lengkap,
  `NOVA_API_BASE=https://kasir-nova.vercel.app` di `www/config.js`, dan
  `pw-toggle.js` ikut terbundel.
- **Distribusi:** `npm run distribute` → Firebase App Distribution, grup
  `kasir-beta` (2 penguji: `ridwansyarifuddin110@gmail.com`,
  `arshakacoffe@gmail.com`). Rilis
  [beta.11](https://console.firebase.google.com/project/kasir-nova/appdistribution/app/android:id.kasirnova.kasir/releases/5c5h8k3prtkio).

**Kerangka APK Owner (`apps/owner-mobile`, belum build).**
- Keputusan pemilik: appId `id.kasirnova.owner`, nama **KASIR NOVA Owner**,
  ikon dari aset Owner V2 yang sudah ada, dibatasi sampai **kerangka
  siap-build** (tanpa `cap add android`, tanpa keystore, tanpa build).
- Isi baru: `package.json` (versi 1.0.0-beta.1), `capacitor.config.json`,
  `scripts/build-www.mjs` (menyalin `apps/owner` → `www`),
  `scripts/setup-android.mjs` (versi + signing + nama app, **tanpa** izin
  Bluetooth), `scripts/distribute.mjs` (butuh `NOVA_FIREBASE_APP_ID` setelah
  app didaftarkan), `android-templates/MainActivity.java`,
  `key.properties.example`.
- `.gitignore` diperluas untuk artefak `apps/owner-mobile`.
- Sisa langkah menunggu keputusan pemilik: `npx cap add android`, keystore
  Owner, pendaftaran app di Firebase, lalu build & distribusi.

**Pengujian:** `node scripts/verify-ui.mjs` **SEMUA OK**; `node --check`
ketiga skrip `owner-mobile` lolos; `build-www.mjs` Owner menghasilkan `www`
dengan `NOVA_API_BASE` benar.

## 21 Okt 2026 — APK Owner Dibangun & Didistribusikan (FASE 11 tuntas) + Keputusan #7–#9

**APK Owner `1.0.0-beta.1` (versionCode 1).**
- `npx cap add android` mengisi `apps/owner-mobile/android` (Capacitor 7,
  appId `id.kasirnova.owner`, nama **KASIR NOVA Owner**).
- Keystore rilis baru `nova-owner-release.jks` (alias `nova-owner`, RSA 2048,
  valid s/d 2053, `CN=KASIR NOVA Owner`; berbeda dari keystore Kasir) +
  `key.properties` + `keystore-credentials.txt` (semua diabaikan Git).
- **Perbaikan `scripts/setup-android.mjs`:** injeksi `signingConfig` dulu
  menghasilkan `build.gradle` tak valid pada template Owner (baris
  `proguardFiles` berbeda dari Kasir). Regex kini memakai pola
  `proguard-android(-optimize)?.txt` dan idempoten (diuji: dua kali jalan →
  berkas identik).
- Build rilis di Termux/aarch64 dengan override `aapt2` ARM
  (`-Pandroid.aapt2FromMavenOverride=…/build-tools/aapt2`): **BUILD
  SUCCESSFUL** → `app-release.apk` (3,66 MB). `aapt2 dump badging`:
  `id.kasirnova.owner`, versionCode 1, targetSdk 35, **hanya izin INTERNET**
  (tanpa Bluetooth = benar untuk panel Owner); `apksigner verify`: v1+v2 OK,
  DN `CN=KASIR NOVA Owner`.
- Salinan siap pasang: `dist/apk/KASIR-NOVA-Owner-1.0.0-beta.1.apk`
  (SHA-256 `d64df6a0…e99e5`).
- **Firebase App Distribution:** app Android `id.kasirnova.owner` didaftarkan
  (App ID `1:1057858530498:android:91a343c6cd0203432a9f5b`) dan APK
  **didistribusikan** ke grup `kasir-beta` (2 penguji), rilis
  `7ldpbpnkusdh0`.

**Keputusan pemilik (dijawab 21 Okt 2026) — dicatat di `docs/11` #7–#9 &
`docs/26` §7.**
- **#7 Foto produk:** tetap **data URL base64** di Postgres (tanpa
  object storage/biaya baru).
- **#8 Pembayaran penjualan kasir:** tetap **manual** (Duitku hanya untuk
  langganan).
- **#9 Perpanjangan langganan:** tetap **manual** (`auto_renew` tetap `false`).

**Pengujian:** `node scripts/verify-ui.mjs` **SEMUA OK**; `node --check` 3
skrip `owner-mobile` OK; **suite server 360/360 lulus** (DB lokal
`db:start`).

**Tertunda (sisi pemilik):** pasang APK Owner di perangkat & tinjauan visual;
kredensial Duitku; uji cetak printer thermal fisik; rotasi kredensial lama.

## 21 Okt 2026 (lanjutan) — Nama APK Owner menjadi **OWNER NOVA** (beta.2)

**Konteks.** Sesi sebelumnya berhenti di tengah proses: `capacitor.config.json`,
skrip `setup-android.mjs`, dan `strings.xml` sudah diubah ke label **OWNER
NOVA**, tetapi APK **belum dibangun ulang** — binary yang tersebar masih
berlabel "KASIR NOVA Owner" (`1.0.0-beta.1`), sehingga nama di layar perangkat
tidak sama dengan konfigurasi terbaru.

**Perubahan kode (tanpa menyentuh backend/skema/API).**
- `apps/owner-mobile/capacitor.config.json`: `appName` → `OWNER NOVA`.
- `apps/owner-mobile/scripts/setup-android.mjs`: label aplikasi default
  `OWNER NOVA` (dapat ditimpa `NOVA_APP_LABEL`); penandaan `app_name` **dan**
  `title_activity_main` disetel sama karena label di bawah ikon peluncur
  diambil dari activity LAUNCHER. Blok signing tetap idempoten (diuji dua kali
  jalan → berkas identik).
- `apps/owner-mobile/scripts/distribute.mjs`: grup penguji default
  `owner-beta` → **`kasir-beta`** (grup yang benar-benar ada di project
  `kasir-nova`, 2 penguji) dan catatan rilis memakai "OWNER NOVA".
- Ikon peluncur & splash APK Owner disamakan dengan panel Kasir:
  `scripts/generate-android-icons.ps1` & `scripts/generate-android-splash.ps1`
  kini menerima `-TargetApp owner-mobile`; seluruh folder `res` Owner kini
  identik dengan Kasir (dicek per direktori mipmap/drawable).
- Versi dinaikkan: **`1.0.0-beta.2` (versionCode 2)** di
  `apps/owner-mobile/package.json` + `package-lock.json`.
- Proyek Android Owner (`apps/owner-mobile/android`) kini **di-track Git**,
  sejajar dengan `apps/kasir-mobile/android` (54 berkas proyek; `key.properties`,
  `keystore-credentials.txt`, `local.properties`, dan seluruh artefak build
  tetap diabaikan lewat `.gitignore`).
- **Perbaikan `setup-android.mjs` (Owner **dan** Kasir):** blok signing kini
  dibungkus **sentinel** `// NOVA_SIGNING_*`, sehingga penghapusan blok lama
  tidak lagi bergantung pada teks komentar persis. Sebelumnya, mengubah
  komentar pada skrip Owner membuat blok `def keystoreProperties` **terduplikasi**
  di `app/build.gradle` (berkas rusak, build mustahil) — bug ini ditemukan
  saat sesi ini (saat mengganti nama aplikasi) dan langsung diperbaiki;
  idempotensi diuji 3× (hash berkas identik) dan build rilis Owner **dan**
  Kasir tetap sukses.

**Build & verifikasi.**
- `npm run sync` (build-www + `cap sync android`) → `www` 794 KB,
  `NOVA_API_BASE=https://kasir-nova.vercel.app`, `assets/capacitor.config.json`
  memuat `appName: OWNER NOVA`.
- `npm run android:prepare` (`NOVA_APP_VERSION_CODE=2`) → `versionName`
  `1.0.0-beta.2`, `versionCode` 2, blok signing idempoten.
- `./gradlew assembleRelease` (override `aapt2` ARM) → **BUILD SUCCESSFUL**
  (2m 19s) → `app-release.apk` **5,09 MB** (naik dari 3,66 MB pada beta.1
  karena aset ikon/splash Owner kini memakai logo resolusi penuh Kasir).
- `aapt2 dump badging`: `id.kasirnova.owner`, versionCode 2, versionName
  `1.0.0-beta.2`, targetSdk 35, **hanya izin INTERNET** (tanpa Bluetooth —
  benar untuk panel Owner), `application-label: OWNER NOVA` (semua locale).
- `apksigner verify`: v1+v2 **OK**, DN `CN=KASIR NOVA Owner` (keystore yang
  sama → beta.2 menimpa beta.1 di perangkat).
- SHA-256 `969da9e5e375687407c0f191cdd937d12ac0f70d4674d3a87e045f9e84ff153b`
  → `dist/apk/KASIR-NOVA-Owner-1.0.0-beta.2.apk` (beta.1 tetap diarsipkan).
  APK dibangun ulang setelah perbaikan skrip signing menghasilkan **binary
  byte-per-byte identik** (SHA-256 sama) → tidak perlu distribusi ulang.
- **Distribusi Firebase App Distribution:** app
  `1:1057858530498:android:91a343c6cd0203432a9f5b`, grup penguji
  `kasir-beta` (2 penguji), rilis **`1g27chnasnkeo`**.

**Pengujian:** `node scripts/sync-shared.mjs --check` **SEMUA SAMA**;
`node scripts/verify-ui.mjs` **SEMUA OK**; `npm run test:auth` **10/10**;
`npm run test:server` **360/360** (DB lokal `db:start`); `node --check` 3
skrip `owner-mobile` OK.

**Catatan:** nama tampilan app di **konsol Firebase** masih "KASIR NOVA
Owner" (metadata konsol, bukan label perangkat) — dapat diubah manual di
konsol bila pemilik diinginkan.

**Tertunda (sisi pemilik):** pasang APK Owner beta.2 di perangkat & tinjauan
visual (label ikon, halaman dashboard, muat data bisnis).

## 22 Okt 2026 — Beranda publik baru: harga paket + fitur + WhatsApp

**Konteks.** Sesi 22 Okt 2026 berhenti setelah halaman beranda ditulis ulang
dan diuji, tetapi integrasi skrip uji, dokumentasi, dan build belum
diselesaikan. Sesi 23 Okt 2026 melanjutkan dan menuntaskan bagian tersebut.

**Perubahan (hanya tampilan publik; tanpa backend/skema/API).**
- `scripts/hosting-landing.html` ditulis ulang: header navy + logo, panel
  login tiga peran (routing `/kasir/`, `/owner/`, `/admin/` **tetap**),
  empat paket harga (Starter/Business/Pro/Enterprise) dengan toggle
  **Bulanan/Tahunan** yang mengubah harga dan pesan WhatsApp, delapan fitur
  unggulan, panel kontak, dan footer.
- Seluruh tautan WhatsApp memakai nomor `6281359704766` dengan pesan siap
  kirim per paket/periode; tombol membuka tab baru (`noopener noreferrer`).
- Halaman **tidak** memanggil API, tidak mengaktifkan paket, dan tidak
  menyentuh autentikasi/sesi.
- `scripts/build-hosting.mjs` ikut menyalin `logo-kasir-nova-inverse.png`
  (dipakai header/panel kontak) ke `dist/hosting/assets`.
- `scripts/test-landing.mjs` (**baru**, 145 pemeriksaan, memakai `jsdom`
  sebagai devDependency): struktur/routing, teks wajib, pesan WhatsApp persis,
  tidak ada panggilan jaringan/error console, dan audit tata letak responsif
  mulai 360 px.
- Skrip npm `test:landing` ditambahkan; `scripts/qa-local.mjs` dan
  `scripts/qa-local.ps1` menjalankan uji ini pada tahap **3/8**.

**Pengujian:** `npm run test:landing` **145/145 lulus**;
`npm run verify:ui` **SEMUA OK**; `node scripts/build-hosting.mjs` berhasil
(termasuk aset inverse); `node --check` skrip terkait lolos.

**Status deploy:** dideploy **23 Okt 2026** atas izin pemilik
(`firebase deploy --only hosting`).

## 23 Okt 2026 — Deploy beranda baru + aktifkan checkout Duitku sandbox

**Beranda.** `dist/hosting` dibangun ulang lalu dideploy ke Firebase Hosting.
Verifikasi produksi: `/`, `/kasir/`, `/owner/`, `/admin/`, dan aset
`/assets/logo-kasir-nova-inverse.png` → **200**; beranda memuat empat paket,
panel login, dan nomor WhatsApp.

**Checkout paket (Duitku sandbox).** Pemilik memberikan Merchant Code dan API
Key sandbox. Nilai rahasia **hanya** disimpan di `server/.env` (gitignored) dan
Vercel Environment Variables (Production) — **tidak** di-commit dan tidak
pernah dicetak di log/UI. Konfigurasi: `PAYMENT_PROVIDER=duitku`,
`PAYMENT_MODE=sandbox`, `PAYMENT_ALLOW_PRODUCTION=false`, kanal
`BC,I1,M2,BR`, `PAYMENT_API_BASE_URL=https://kasir-nova.vercel.app`,
`PAYMENT_OWNER_PANEL_URL=https://kasir-nova.web.app/owner`.
- Uji lokal `npm run sandbox:duitku`: **SEMUA LANGKAH LULUS** — login Owner,
  status gateway `enabled=true`, buat tagihan VA BCA **201**, cek status
  **200** (benar-benar memanggil sandbox, bukan tiruan).
- Backend Vercel di-deploy ulang. `GET /api/health` **200**; callback publik
  tanpa tanda tangan sah → **401** (sebelumnya 503) → gateway aktif di
  produksi.
- **Belum diuji:** pembayaran penuh sampai callback asli mengaktifkan
  langganan (perlu menyelesaikan transaksi di halaman demo Duitku).

**Pengujian:** `npm run test:landing` **145/145**, `npm run verify:ui`
**SEMUA OK**, `node scripts/sync-shared.mjs --check` **SEMUA SAMA**.

## 23 Okt 2026 — Pendaftaran Owner mandiri + verifikasi email

**Keputusan pemilik.** Calon pelanggan boleh mendaftar sendiri; email wajib
diverifikasi; trial **Gratis 30 hari** otomatis; form tersedia di panel Owner
dan ditautkan dari beranda. Checkout paket tetap self-service lewat Duitku.

**Implementasi.**
- Migrasi `0013_owner_self_registration.sql`: `email_verified_at`,
  `email_verification_token_hash`, `email_verification_expires_at`,
  `pending_business_name`, index token & antrean unverified. `0014` membuat
  `email_verified_at` NULL-able (0013 sempat NOT NULL; instalasi baru sudah
  benar, 0014 memperbaiki DB yang sudah menjalankan 0013).
- `server/src/utils/mailer.js`: Resend HTTP / SMTP (`nodemailer`) / mode dev
  yang menulis tautan ke log. Produksi tanpa email = pendaftaran **503**.
- `env.mail` + `env.app` (`APP_PUBLIC_URL`, `APP_OWNER_PANEL_URL`,
  `EMAIL_VERIFICATION_TTL_HOURS`).
- Endpoint publik: `POST /api/auth/register-owner`,
  `GET /api/auth/verify-email`, `POST /api/auth/resend-verification`; limiter
  register 5/jam/IP dan resend 3/15 menit/IP.
- Login Owner menolak akun belum verifikasi (**403** `email_not_verified`).
- Verifikasi atomik: tandai email + buat bisnis pertama
  (`createBusinessInTransaction`) + langganan Gratis + audit.
- Panel Owner: form daftar, konfirmasi password, status verifikasi,
  `?daftar=1`, `?verified=1`, `?verify=invalid`, kirim ulang.
- Beranda: tombol **Daftar Gratis** di header + tautan di panel Pemilik
  (`/owner/?daftar=1`).

**Pengujian (lokal, DB berjalan).**
- `npm run db:migrate` → 14 migrasi.
- `npm run test:server` → **372/372 lulus** (12 baru untuk pendaftaran,
  termasuk duplikat, token kedaluwarsa, rotasi token, replay, login gate,
  trial otomatis).
- `npm run test:landing` → **173/173** (termasuk section **Cara Mendaftar** 4 langkah); `npm run test:auth` → **10/10**;
  `npm run verify:ui` → **SEMUA OK**; `node scripts/sync-shared.mjs --check`
  → **SEMUA SAMA**; semua berkas JS lolos `node --check`.

**Status.** Kode selesai & teruji lokal; **belum di-commit/dideploy**.
Produksi perlu kredensial email (`MAIL_PROVIDER`, `MAIL_FROM`,
`RESEND_API_KEY` atau SMTP) sebelum pendaftaran dibuka. Kolom
`email_verified_at` tetap kompatibel dengan owner lama/buatan Admin karena
default `now()`.

---

## 23 Okt 2026 — Verifikasi email Firebase (menggantikan WhatsApp)

**Keputusan pemilik.** Pendaftaran Owner memakai **Firebase Authentication
Email Verification Link** (paket Spark) agar tidak memerlukan SMTP, Resend,
atau domain email berbayar. Password Owner **tetap** dikelola KASIR NOVA
(scrypt + JWT); Firebase hanya menyimpan email/UID dan status `emailVerified`.

**Implementasi.**
- `POST /api/auth/register-owner`: membuat user Firebase tanpa password,
  menyimpan Owner pending (`firebase_uid`, metode `firebase`,
  `pending_business_name`), membuat state JWT, lalu meminta Firebase mengirim
  tautan verifikasi.
- Endpoint baru: `GET /api/auth/firebase/verification-status`,
  `POST /api/auth/firebase/verify-owner`,
  `POST /api/auth/firebase/resend-verification`.
- Backend memverifikasi status lewat **Firebase Admin SDK** (`getUser` /
  `verifyIdToken`); klaim `emailVerified` dari browser tidak dipercaya.
- Login Owner pending ditolak **403** `email_not_verified` + state. Bila email
  sudah diverifikasi, aktivasi diselesaikan otomatis saat login.
- Aktivasi atomik: `email_verified_at`, bisnis pertama, langganan Gratis 30
  hari, dan audit `owner.email_verified`.
- Halaman `/owner/verify-email` + rewrite Firebase Hosting; tombol **Buka
  Gmail**, **Saya Sudah Verifikasi**, **Kirim Ulang Email** (rate limit +
  cooldown), dan penanganan `emailSent=false`.
- Panel Admin tetap bisa memverifikasi akun pending **lama** via WhatsApp,
  tetapi menolak akun Firebase dan perubahan email Owner Firebase.
- Migrasi `0015_owner_firebase_verification.sql`; dependency
  `firebase-admin@14.5.0` (0 vulnerability saat audit).
- Alur email legacy (Resend/SMTP) dipertahankan hanya untuk akun pending lama.

**Pengujian (lokal, DB berjalan).**
- `npm run test:server` → **374/374 lulus** (14 tes pendaftaran Firebase).
- `npm run test:landing` → **173/173**; `npm run test:auth` → **10/10**;
  `npm run test:verify-email` → **1/1** (jsdom: state, status backend, tombol);
  `npm run verify:ui` → **SEMUA OK**; `node scripts/sync-shared.mjs --check`
  → **SEMUA SAMA**; `node scripts/build-hosting.mjs` → sukses.
- `npm audit --workspace server` → **0 vulnerability**.

**Status.** Kode selesai & teruji lokal dengan adapter Firebase palsu; **belum
di-commit/dideploy**. Pengiriman email sungguhan memerlukan kredensial Firebase
di Vercel + konfigurasi Firebase Console (lihat `docs/24`). Jangan deploy
produksi sebelum alur email diuji dengan kredensial asli.

---

## Modul Ditangguhkan (di luar roadmap di atas)

- **Gateway pembayaran digital**: abstraksi penyedia sudah dipakai untuk
  **langganan** (Duitku sandbox, lihat entri 17 Okt 2026 di atas). Kanal
  kartu/QR/wallet untuk **penjualan kasir** masih ditangguhkan (tetap dicatat
  manual) — tambah provider di tabel `payments.provider` bila nanti dibutuhkan.
- **Perpanjangan langganan otomatis**: job penagihan terpisah — sementara
  dicatat manual oleh Admin Platform atau dibeli Owner lewat gateway
  (`auto_renew` tetap `false`).

## Urutan untuk RAM ~2 GB
- Jalankan **satu server** + **satu app** + satu PostgreSQL. Hindari
  menjalankan 3 apps sekaligus saat dev.
- Gunakan pnpm/npm biasa; **tanpa Docker**.
- Test runner (Vitest) dijalankan per berkas/modul bila memori menipis.
