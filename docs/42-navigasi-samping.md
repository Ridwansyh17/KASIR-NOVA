# KASIR NOVA — Navigasi Samping (Sidebar) Tiga Panel

> **Tanggal:** 20 Oktober 2026
> **Referensi desain:** folder `KASIR-NOVA-V3-REFERENSI-LENGKAP`
> (mockup Admin, Owner, dan Kasir Desktop memakai menu di sisi kiri).
> **Status:** selesai, teruji statis, dan sudah dideploy ke Firebase Hosting.

## 1. Tujuan

Mengganti navigasi menu atas (tab horizontal) pada ketiga panel web menjadi
**navigasi samping (sidebar)** agar tampilan lebih rapi, konsisten dengan
referensi desain V3, dan tetap nyaman di layar kecil.

Keputusan bisnis, alur transaksi, hak akses, dan seluruh endpoint backend
**tidak berubah**. Perubahan ini murni lapisan tampilan (HTML/CSS + sedikit
pengendali navigasi di frontend).

## 2. Perubahan per panel

### Admin Platform (`apps/admin`)
- Sidebar navy berisi brand, label peran **Admin**, dan menu:
  Owner, Paket, Bisnis & Langganan, Audit Log, Sesi Kasir, Setoran Kasir.
- `current-user` dan tombol **Keluar** dipindah ke kaki sidebar.
- Topbar lama tidak lagi tampil di desktop; pada layar kecil topbar berubah
  menjadi bilah atas berisi tombol hamburger + brand.

### Owner (`apps/owner`)
- Sidebar navy berisi brand, label peran **Owner**, dan menu seksi:
  Dashboard Owner, Profil Bisnis, Langganan, Manajemen Outlet,
  Manajemen Kasir, Produk & Stok, Transaksi, Laporan Penjualan,
  Laporan Keuangan, Pengeluaran, Setoran Kas, Riwayat Stok, Audit Log.
- Karena panel Owner berupa satu halaman panjang, menu samping **menggulir ke
  seksi terkait** (`scrollIntoView`) dan menandai seksi yang sedang terlihat
  saat pengguna menggulir.
- Menu hanya berpindah ke seksi yang sedang tersedia (tidak tersembunyi).
  Bila belum ada bisnis aktif, klik menu akan kembali ke atas halaman.

### Kasir (`apps/kasir`)
- Sidebar navy berisi brand, label peran **Kasir**, dan menu:
  Beranda, Kasir, Produk, Pendapatan, Laporan Transaksi, Pengeluaran,
  Setoran Kas, Riwayat Stok, Lainnya.
- Navigasi bawah (`#bottom-nav`) **tetap dipertahankan** untuk layar HP,
  sesuai desain Kasir Mobile V2.
- Tombol **Keluar** dan info pengguna berada di kaki sidebar.

## 3. Perilaku responsif

- **Desktop (> 900 px):** sidebar tetap terlihat di kiri (lebar 252 px),
  konten bergeser ke kanan, topbar disembunyikan.
- **Layar kecil (≤ 900 px):** sidebar menjadi panel geser (off-canvas),
  dibuka lewat tombol hamburger di topbar; klik overlay, tombol Escape,
  atau memilih menu akan menutup sidebar.
- Scroll halaman dikunci saat sidebar terbuka agar tidak menggulir di belakang.
- Modal dinaikkan ke `z-index: 100` agar selalu berada di atas sidebar/overlay.
- Saat mencetak, sidebar, topbar, dan overlay disembunyikan.

## 4. File yang dibuat / diubah

| File | Perubahan |
|---|---|
| `shared/sidebar.css` | **Baru** — stylesheet kanonik sidebar (layout, menu aktif, off-canvas, cetak). |
| `apps/admin/styles/sidebar.css` | **Baru** — salinan dari `shared/sidebar.css`. |
| `apps/owner/styles/sidebar.css` | **Baru** — salinan dari `shared/sidebar.css`. |
| `apps/kasir/styles/sidebar.css` | **Baru** — salinan dari `shared/sidebar.css`. |
| `apps/admin/index.html` | Struktur `app-shell` + sidebar; menu tab lama dipindah; tautan CSS sidebar. |
| `apps/owner/index.html` | Struktur `app-shell` + sidebar; menu seksi Owner; tautan CSS sidebar. |
| `apps/kasir/index.html` | Struktur `app-shell` + sidebar; menu tab lama dipindah; bottom-nav dipertahankan. |
| `apps/admin/src/app.js` | Pengendali buka/tutup sidebar; menutup sidebar saat tab dipilih. |
| `apps/owner/src/app.js` | Pengendali sidebar + navigasi gulir seksi & penanda seksi aktif. |
| `apps/kasir/src/app.js` | Pengendali sidebar; menutup sidebar setiap perpindahan tab. |
| `scripts/sync-shared.mjs` | Mendaftarkan `shared/sidebar.css` → salinan di ketiga panel. |
| `docs/02-struktur-folder.md` | Mencatat `shared/sidebar.css` sebagai stylesheet kanonik. |
| `docs/05-roadmap.md` | Entri progres 20 Oktober 2026. |
| `docs/42-navigasi-samping.md` | **Baru** — dokumen ini. |

## 5. Pengujian

| Perintah | Hasil |
|---|---|
| `node scripts/sync-shared.mjs --check` | **SEMUA SAMA** (salinan `sidebar.css` identik). |
| `node scripts/verify-ui.mjs` | **SEMUA OK** — rujukan lokal, id JS→HTML, api→api.js, sintaks modul, token V2, smoke hosting. |
| `node --input-type=module --check < apps/owner/src/app.js` | LOLOS. |
| `npm run test:auth` | **10/10 lulus**. |
| `node scripts/build-hosting.mjs` | Berhasil membangun `dist/hosting`. |
| Pemeriksaan keseimbangan tag HTML ketiga panel | OK (tidak ada tag tak tertutup). |

**Catatan:** verifikasi visual manual oleh pemilik tetap dianjurkan karena agen
tidak dapat merender browser secara langsung. Fokus pemeriksaan: lebar sidebar,
menu aktif, dan perilaku hamburger di HP.

## 6. Deploy

- **Tanggal:** 20 Oktober 2026, atas permintaan pemilik.
- **Perintah:** `firebase deploy --only hosting`
- **URL:** https://kasir-nova.web.app
- **Verifikasi pascadeploy:**
  - `/admin/`, `/owner/`, `/kasir/` → **HTTP 200**
  - `/admin/styles/sidebar.css` → **HTTP 200**
  - Ketiga halaman memuat `styles/sidebar.css`
- **Cakupan:** hanya Firebase Hosting. Backend/Vercel, database, dan billing
  tidak diubah.

## 7. Pekerjaan tertunda / catatan

- Tinjauan visual pemilik pada perangkat desktop dan HP.
- Bila diinginkan, menu Owner dapat diubah dari navigasi gulir menjadi
  halaman terpisah per seksi pada fase desain berikutnya (memerlukan
  penyesuaian logika tampil/sembunyi seksi yang saat ini dipakai bersama).
- Tidak ada perubahan skema database, API, atau aturan langganan.
