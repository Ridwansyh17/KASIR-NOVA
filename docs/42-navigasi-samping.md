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
- Sejak 20 Oktober 2026 (perbaikan poin tertunda §7) panel Owner memakai
  **halaman terpisah per menu**, bukan lagi gulir-scroll:
  - Satu klik menu = satu seksi tampil sendirian; seksi lain disembunyikan
    lewat kelas `.pg-off` (terpisah dari `.hidden` status "data siap" milik
    pemuat data, sehingga kembali ke menu langsung menampilkan data yang
    sudah dimuat).
  - Halaman aktif disimpan di `location.hash` (mis. `/owner/#report-section`)
    sehingga reload/deep-link langsung membuka halaman itu, dan tombol
    kembali/maju browser berpindah halaman (`popstate`).
  - Toolbar pemilih bisnis, `#alert`, dan `#waiting-state` ("Pilih bisnis
    untuk melihat detailnya.") tetap tampil di semua halaman sebagai konteks.
    Blok khusus dashboard (`#cross-section`, `#empty-state`) hanya tampil di
    halaman **Dashboard Owner**.
  - Saat memilih menu, sidebar ditutup (pada HP) dan halaman di-scroll ke atas.

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
| `apps/owner/src/app.js` | Pengendali sidebar + **navigasi halaman per seksi** (`applyOwnerPage`/`navigateOwnerPage`, hash + `popstate`). |
| `apps/owner/styles/styles.css` | Selektor `.pg-off { display: none !important }` untuk halaman non-aktif. |
| `apps/kasir/src/app.js` | Pengendali sidebar; menutup sidebar setiap perpindahan tab. |
| `scripts/sync-shared.mjs` | Mendaftarkan `shared/sidebar.css` → salinan di ketiga panel. |
| `scripts/verify-ui.mjs` | Pemeriksaan regresi navigasi halaman Owner (penanda `pg-off`, tanpa `scrollIntoView`). |
| `docs/02-struktur-folder.md` | Mencatat `shared/sidebar.css` sebagai stylesheet kanonik. |
| `docs/05-roadmap.md` | Entri progres 20 Oktober 2026. |
| `docs/42-navigasi-samping.md` | **Baru** — dokumen ini. |

## 5. Pengujian

| Perintah | Hasil |
|---|---|
| `node scripts/sync-shared.mjs --check` | **SEMUA SAMA** (salinan `sidebar.css` identik). |
| `node scripts/verify-ui.mjs` | **SEMUA OK** — rujukan lokal, id JS→HTML, api→api.js, sintaks modul, token V2, smoke hosting, **regresi navigasi halaman Owner**. |
| `node --input-type=module --check < apps/owner/src/app.js` | LOLOS. |
| `npm run test:auth` | **10/10 lulus**. |
| `npm run test:server` | **360/360 lulus** (tidak ada perubahan backend). |
| `node scripts/build-hosting.mjs` | Berhasil membangun `dist/hosting`. |
| Pemeriksaan keseimbangan tag HTML ketiga panel | OK (tidak ada tag tak tertutup). |

**Catatan:** verifikasi visual manual oleh pemilik tetap dianjurkan karena agen
tidak dapat merender browser secara langsung. Fokus pemeriksaan: lebar sidebar,
menu aktif, perilaku hamburger di HP, dan (Owner) satu halaman per menu.

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

- Tinjauan visual pemilik pada perangkat desktop dan HP tetap dianjurkan
  (agen tidak dapat merender browser di lingkungan Termux — tidak ada
  Chromium/Chrome). Perubahan perilaku terbaru yang perlu dilihat: menu
  Owner kini membuka halaman terpisah per seksi.
- ~~Menu Owner diubah dari navigasi gulir menjadi halaman terpisah per seksi~~
  — **selesai 20 Okt 2026** (lihat §2, kelas `.pg-off`, hash + `popstate`).
- Tidak ada perubahan skema database, API, atau aturan langganan
  (diverifikasi lewat `git diff`: hanya `apps/owner`, `scripts/verify-ui.mjs`,
  dan dokumen).
