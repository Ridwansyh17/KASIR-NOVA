# KASIR NOVA — Matriks Hak Akses

> Peran: **A** = Platform Admin, **O** = Owner, **K** = Kasir.
> ✅ = boleh, ❌ = dilarang, ➖ = tidak berlaku (tidak relevan untuk peran ini).
> Setiap tanda ✅ juga **selalu** dibatasi oleh `business_id` sesi (tenant).

## 1. Akun & Sesi

| Operasi | A | O | K |
|---|---|---|---|
| Login ke area masing-masing | ✅ | ✅ | ✅ |
| Login ke area peran lain | ❌ | ❌ | ❌ |
| Membuat akun Owner | ✅ | ❌ | ❌ |
| Membuat akun Kasir | ❌ | ✅ (outlet miliknya) | ❌ |
| Membuat akun Admin Platform | ❌ (hanya seeding internal) | ❌ | ❌ |
| Mencabut sesi sendiri (logout) | ✅ | ✅ | ✅ |
| Mencabut sesi bawahan | ✅ (semua) | ✅ (kasirnya) | ❌ |
| Mengubah password sendiri | ✅ | ✅ | ✅ |

## 2. Platform Admin

| Operasi | A | O | K |
|---|---|---|---|
| Daftar/suspend/hapus Owner | ✅ | ❌ | ❌ |
| Lihat semua bisnis di platform | ✅ | ❌ | ❌ |
| Kelola subscription_plans | ✅ | ❌ | ❌ |
| Set status langganan suatu bisnis | ✅ | ❌ | ❌ |
| Akses panel `/admin` | ✅ | ❌ | ❌ |

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

## 6. Produk, Kategori, Harga, Stok

| Operasi | A | O | K |
|---|---|---|---|
| CRUD kategori | ❌ | ✅ | ❌ |
| CRUD produk & harga | ❌ | ✅ | ❌ |
| Lihat produk | ❌ | ✅ | ✅ (hanya outletnya) |
| Ubah harga jual | ❌ | ✅ | ❌ |
| Adjust stok (opname) | ❌ | ✅ | ❌ |
| Lihat stok outletnya | ❌ | ➖ | ✅ |

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
| Export laporan (CSV/JSON) | ✅ (baca saja, semua bisnis) | ✅ (bisnisnya) | ❌ |

> Fase 9 (implementasi `docs/16-api-laporan.md`): seluruh agregat dan ekspor
> dihitung **di server** memakai zona waktu bisnis; fokus kriteria selesai
> adalah **isolasi tenant** ("angkat laporan untuk 2 business_id terisolasi,
> hasilnya tidak bocor"). Admin tetap **baca-saja**: menyandingkan "Export
> laporan A = ❌" pada matriks rencana dengan kemampuan admin membaca data
> lintas bisnis; karena ekspor adalah penyajian data baca (tanpa perubahan
> data), admin diberi akses ekspor *read-only* agar konsisten dengan perannya
> pada baris "Laporan … = ✅ (semua bisnis)".

## 9. Audit Log

| Operasi | A | O | K |
|---|---|---|---|
| Membaca audit log | ✅ (semua) | ✅ (bisnisnya) | ❌ |
| Menghapus audit log | ❌ | ❌ | ❌ |

## 10. Langganan

| Operasi | A | O | K |
|---|---|---|---|
| Melihat langganan bisnisnya | ✅ | ✅ | ❌ |
| Membayar/memperpanjang | ✅ (manual, sementara) | ✅ (memicu bukti bayar) | ❌ |
| Mengubah plan | ✅ | ❌ | ❌ |
| Akses fitur saat langganan kedaluwarsa | ❌ (diblokir server) | ❌ | ❌ |

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
