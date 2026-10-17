# KASIR NOVA — Matriks Hak Akses

> Peran: **A** = Platform Admin, **O** = Owner, **K** = Kasir.
> ✅ = boleh, ❌ = dilarang, ➖ = tidak berlaku (tidak relevan untuk peran ini).
> Setiap tanda ✅ juga **selalu** dibatasi oleh `business_id` sesi (tenant).

## 1. Akun & Sesi

| Operasi | A | O | K |
|---|---|---|---|
| Login ke area masing-masing | ✅ | ✅ | ✅ |
| Login ke area peran lain | ❌ | ❌ | ❌ |
| Login Kasir via **PIN** (4 digit) | ❌ | ❌ | ✅ (hanya kasir ber-PIN, outlet perangkatnya) |
| Membuat akun Owner | ✅ | ❌ | ❌ |
| Membuat akun Kasir | ❌ | ✅ (outlet miliknya) | ❌ |
| Membuat akun Admin Platform | ❌ **sengaja** tidak ada di aplikasi — hanya CLI `npm run admin:create` / seeding | ❌ | ❌ |
| Mencabut sesi sendiri (logout) | ✅ | ✅ | ✅ |
| Mencabut sesi bawahan | ✅ (semua) | ✅ (kasirnya) | ❌ |
| Mengubah password sendiri | ❌ belum ada di API (pakai CLI `npm run admin:password`) | ❌ belum ada di API (direset Admin) | ❌ belum ada di API (direset Owner) |

## 2. Platform Admin

| Operasi | A | O | K |
|---|---|---|---|
| Daftar/suspend/hapus Owner | ✅ | ❌ | ❌ |
| Lihat semua bisnis di platform | ✅ | ❌ | ❌ |
| Kelola subscription_plans | ✅ | ❌ | ❌ |
| Set status langganan suatu bisnis | ✅ | ❌ | ❌ |
| Akses panel `/admin` | ✅ | ❌ | ❌ |

> **Akun Admin Platform (akun "paten").** Akun Admin **tidak dibuat dari
> aplikasi** (sengaja, agar tidak ada jalur privilege escalation lewat UI).
> Dua cara sah:
> 1. `npm run db:seed` — akun admin pertama saat instalasi (`SEED_ADMIN_*`).
> 2. `npm run admin:create` — akun admin tambahan (`NOVA_ADMIN_EMAIL`,
>    `NOVA_ADMIN_NAME`; sandi dari `NOVA_ADMIN_PASSWORD` /
>    `NOVA_ADMIN_PASSWORD_FILE`, **tidak pernah** lewat argumen CLI).
>
> Akun Admin "paten" yang dipakai pemilik proyek: **`admin.ridwan@nova.test`**
> (peran `platform_admin`, status `active`, dibuat 17 Okt 2026, nama
> "Admin Ridwan"). Wewenangnya = **seluruh** wewenang Platform Admin di tabel
> § 2 dan § 10, termasuk memasang paket **gratis maupun berbayar** ke bisnis
> mana pun **tanpa pembayaran** (tombol `Langganan` di tab **Bisnis** panel
> Admin) dan mengubah status langganan (`active` / `past_due` / `expired`).
>
> Perkakas: `npm run admin:list` (daftar akun), `admin:create`,
> `admin:password` (ganti sandi), `admin:status` (aktif/suspend). Ganti sandi
> atau suspend **otomatis mencabut semua sesi** akun itu. Perubahan penting
> tercatat di `audit_logs` (tidak pernah memuat sandi). Sandi **tidak**
> disimpan di repo. Skrip menolak basis data non-lokal kecuali diberi
> `--allow-production`.

## 3. Owner — Multi-Bisnis

| Operasi | A | O | K |
|---|---|---|---|
| Membuat bisnis baru | ❌ | ✅ | ❌ |
| Melihat daftar bisnisnya sendiri | ❌ | ✅ | ❌ |
| Melihat bisnis owner lain | ❌ | ❌ | ❌ |
| Mengaktifkan/menonaktifkan bisnisnya | ❌ | ✅ | ❌ |
| Status langganan bisnis lain menular? | ❌ | ❌ (tidak pernah) | ❌ |

## 4. Outlet

| Operasi | A | O | K |
|---|---|---|---|
| Melihat outlet | ✅ (semua) | ✅ (miliknya) | ➖ (miliknya saja) |
| Membuat outlet | ❌ | ✅ (jika < `max_outlets` plan) | ❌ |
| Mengubah nama/alamat/pajak outlet | ❌ | ✅ | ❌ |
| Menghapus outlet | ❌ | ✅ (cek: tidak ada transaksi aktif) | ❌ |

## 5. Kasir

| Operasi | A | O | K |
|---|---|---|---|
| Melihat daftar kasir | ✅ (semua) | ✅ (miliknya) | ➖ |
| Membuat kasir di outlet | ❌ | ✅ | ❌ |
| Memindahkan kasir ke outlet lain | ❌ | ✅ (1 outlet tetap, ganti `outlet_id`) | ❌ |
| Akun kasir di **lebih dari 1 outlet** | ❌ | ❌ (dicegah DB: email UNIQUE) | ❌ |
| Suspend/aktivasi kasir | ✅ | ✅ | ❌ |
| Pasang/ganti PIN kasir | ❌ | ✅ | ❌ |
| Hapus PIN kasir | ❌ | ✅ | ❌ |
| Buka kunci kasir `locked` (10× PIN salah) | ❌ | ✅ | ❌ |
| Lebih dari 5× PIN salah | ❌ | ❌ | ➖ (kunci sementara 15 mnt, otomatis) |

## 6. Produk, Kategori, Harga, Stok

| Operasi | A | O | K |
|---|---|---|---|
| CRUD kategori | ❌ | ✅ | ❌ |
| Melihat produk | ❌ | ✅ | ✅ (hanya outletnya) |
| Membuat / mengubah produk & harga | ❌ | ✅ | ✅ (di outletnya) |
| Hapus produk (soft delete) | ❌ | ✅ | ❌ (tidak ada endpoint hapus di area kasir) |
| Lihat/ubah **HPP** (`cost_price`) | ❌ | ✅ (selalu) | ✅ **hanya bila** `can_view_profit` |
| Memberi/mencabut izin HPP kasir | ❌ | ✅ | ❌ |
| Adjust stok (opname) | ❌ | ✅ (per outlet) | ✅ (outletnya saja) |
| Tandai HABIS / aktifkan kembali | ❌ | ✅ | ✅ (produk ber-`track_stock`) |
| Lihat stok outletnya | ❌ | ➖ | ✅ |
| Lihat riwayat pergerakan stok | ❌ | ✅ (bisnisnya) | ✅ (outletnya) |

> **V0.3 (migrasi `0009`, `docs/14` & `docs/18`):**
> - **HPP** hanya dikembalikan/diubah di server bila pemanggil berizin. Owner
>   **selalu** berizin; Kasir **hanya** bila Owner menyalakan
>   `cashiers.can_view_profit`. Kasir mencoba mengisi HPP tanpa izin → **403**.
> - **HABIS bersifat turunan** = `manual_out_of_stock` ATAU
>   (`track_stock` DAN `Σ stok ≤ 0`). Menandai HABIS tidak mengubah saldo.
>   Produk HABIS **diblokir server** saat dijual (409); aktivasi kembali
>   membutuhkan stok > 0.
> - Kasir dapat **membuat/mengubah produk & mengatur stok outletnya**; **tidak
>   ada** endpoint hapus produk di area kasir (hapus = Owner, soft delete).
> - Setiap perubahan saldo menulis `inventory_movements` (append-only) di
>   transaksi DB yang sama.

## 7. Transaksi Penjualan

| Operasi | A | O | K |
|---|---|---|---|
| Membuat transaksi (jual) | ❌ | ❌ | ✅ (outletnya sendiri) |
| Melihat detail transaksi | ✅ | ✅ (miliknya) | ✅ (outletnya) |
| Void / refund transaksi | ❌ | ✅ | ❌ |
| Menerapkan diskon | ❌ | ✅ (config) | ✅ (sesuai aturan yang diset Owner) |
| Mengubah konfigurasi pajak | ❌ | ✅ | ❌ |
| Mencetak struk | ❌ | ➖ | ✅ |

> Fase 7 (implementasi `docs/15-api-transaksi.md`): Admin melihat detail
> transaksi = **baca saja**; void = Owner, stok otomatis dikembalikan;
> diskon per transaksi (persen/nominal) oleh kasir tanpa batas nominal;
> pajak dikonfigurasi per outlet (eksklusif/inklusif). Struk menyusul Fase 8.

## 8. Laporan

| Operasi | A | O | K |
|---|---|---|---|
| Laporan harian/mingguan/bulanan/tahunan | ✅ (semua bisnis) | ✅ (bisnisnya) | ❌ |
| Ringkasan omzet outlet | ✅ (semua bisnis) | ✅ (bisnisnya) | ❌ |
| **Laporan pendapatan harian outletnya** (V0.3) | ❌ | ➖ | ✅ (outletnya; HPP/laba disembunyikan tanpa izin) |
| **Laporan keuangan & laba** (HPP, biaya, pengeluaran, laba kotor/bersih) | ➖ (tidak disediakan) | ✅ (bisnisnya) | ✅ **hanya** bila `can_view_profit` |
| Ekspor laporan keuangan (.xlsx) | ➖ | ✅ | ❌ |
| Export laporan (CSV/JSON/Excel rekapan transaksi) | ✅ (baca saja, semua bisnis) | ✅ (bisnisnya) | ❌ |
| **Laporan transaksi outlet** (satu baris per transaksi; 17 Okt 2026) | ➖ (memakai endpoint platform baca-saja) | ✅ (bisnisnya; filter/outlet) | ✅ (outletnya; **semua** kasir outlet itu) |
| Ekspor Excel **laporan transaksi outlet** (.xlsx; 17 Okt 2026) | ➖ | ✅ | ✅ (khusus laporan ini; ekspor laporan keuangan tetap ❌) |

> Fase 9 (implementasi `docs/16-api-laporan.md`): seluruh agregat dan ekspor
> dihitung **di server** memakai zona waktu bisnis; fokus kriteria selesai
> adalah **isolasi tenant** ("angkat laporan untuk 2 business_id terisolasi,
> hasilnya tidak bocor"). Admin tetap **baca-saja**: menyandingkan "Export
> laporan A = ❌" pada matriks rencana dengan kemampuan admin membaca data
> lintas bisnis; karena ekspor adalah penyajian data baca (tanpa perubahan
> data), admin diberi akses ekspor *read-only* agar konsisten dengan perannya
> pada baris "Laporan … = ✅ (semua bisnis)".
>
> **V0.3 (`docs/16`, `docs/18`):** `GET .../reports/finance` menghitung
> pendapatan per metode, HPP (snapshot item), biaya transaksi
> (`payments.fee_amount`), pengeluaran operasional, lalu **laba kotor**
> (pendapatan − HPP) dan **laba bersih** (laba kotor − operasional − biaya).
> Kategori `inventory_purchase` **dikecualikan** dari laba. Endpoint laporan
> harian kasir (`/api/cashier/reports/daily`) juga menyertakan perbandingan
> HPP/laba **hanya** bila kasir berizin; server menghapus field tersebut
> sebaliknya.
>
> **17 Okt 2026 — Laporan Transaksi untuk Kasir (`docs/37`).** Dua baris
> terakhir di atas berubah atas **permintaan pemilik**: kasir kini punya
> **laporan transaksi outletnya** (keputusan **B1** satu baris per transaksi,
> **B3** tab "Laporan Transaksi" dengan rentang bawaan hari ini) **beserta
> ekspor Excel** (keputusan **B2**), cakupan **semua** transaksi outlet kasir
> (keputusan **A5a**). Batas yang **tidak** berubah: kasir tetap **tidak**
> dapat mengekspor laporan **keuangan/laba** (`❌` pada baris "Ekspor laporan
> keuangan"), tetap **tidak** melihat HPP/laba tanpa izin, dan outletnya
> **selalu** diturunkan dari akun (tidak ada `outletId` pada skema query —
> parameter klien dibuang, bukan dipakai).

## 8b. Pengeluaran & Pergerakan Stok (V0.3)

| Operasi | A | O | K |
|---|---|---|---|
| Mencatat pengeluaran outlet | ❌ | ✅ (outlet bisnisnya) | ✅ (outletnya) |
| Melihat daftar pengeluaran | ❌ | ✅ (bisnisnya, filter outlet/kategori/tanggal) | ✅ (outletnya) |
| Mengoreksi pengeluaran | ❌ | ✅ (void + alasan) | ✅ (hanya yang ia catat) |
| Menghapus pengeluaran | ❌ | ❌ | ❌ |
| Melihat pergerakan stok | ❌ | ✅ (bisnisnya) | ✅ (outletnya) |
| Mengubah/menghapus pergerakan stok | ❌ | ❌ | ❌ |

> **V0.3 (migrasi `0009`, `docs/18`):** koreksi = **void** (`recorded` →
> `voided` + `void_reason`), bukan hapus; `inventory_movements` bersifat
> **append-only**. Nominal pengeluaran dalam **sen** di API. Kategori
> `inventory_purchase` tetap dicatat sebagai pengeluaran tetapi **tidak**
> mengurangi laba bersih.

## 9. Audit Log

| Operasi | A | O | K |
|---|---|---|---|
| Membaca audit log | ✅ (semua) | ✅ (bisnisnya) | ❌ |
| Menghapus audit log | ❌ | ❌ | ❌ |

> Fase 11 (implementasi): viewer `GET /api/platform/audit-logs` (admin) dan
> `GET /api/owner/businesses/:businessId/audit-logs` (owner, scoped). Pencabutan
> sesi bawahan (baris matriks §1) via `POST /api/platform/sessions/:cashierId/revoke`
> (admin) dan `.../cashiers/:cashierId/sessions/revoke` (owner); `refresh_tokens`
> di-set `revoked_at` di server sehingga token lama ditolak `/refresh`.

## 10. Langganan

| Operasi | A | O | K |
|---|---|---|---|
| Melihat langganan bisnisnya | ✅ | ✅ | ❌ |
| Membayar/memperpanjang | ✅ (manual) | ✅ **self-service** (tagihan VA/QRIS gateway, 17 Okt 2026) | ❌ |
| Membuat tagihan langganan (gateway) | ❌ | ✅ (hanya bisnisnya) | ❌ |
| Mengubah plan | ✅ | ❌ | ❌ |
| Akses fitur saat langganan kedaluwarsa | ❌ (diblokir server) | ❌ | ❌ |

> Callback gateway (`POST /api/payments/duitku/callback`) adalah endpoint
> **publik** tanpa peran — pengamannya **verifikasi tanda tangan HMAC-SHA256** +
> nominal harus sama dengan tagihan + rate limit (opsional allowlist IP).
> Aktivasi langganan dicatat di audit atas nama **Owner** pemilik tagihan
> (`actor_role='owner'`).

> Fase 10 (implementasi): gerbang `enforceSubscriptionActive` di **level
> server**, di dalam transaksi DB — pembuatan transaksi penjualan (baris
> `businesses` ikut `FOR UPDATE`), produk, kategori diblokir dengan 409 saat
> status ≠ `active` atau melewati `expires_at`. Void tetap diizinkan untuk
> membereskan data. Kuota outlet/kasir memakai gerbang yang sama.

## Aturan Penegakan

1. **Server wajib** mengecek tabel ini untuk setiap endpoint — frontend
   menyembunyikan menu saja **tidak cukup**.
2. Setiap request membawa `business_id` dari **sesi terverifikasi**, bukan
   dari input klien, untuk mencegah akses lintas tenant (IDOR).
3. Token peran berbeda tidak dapat dipakai lintas area (`/admin`, `/owner`,
   `/kasir`).
