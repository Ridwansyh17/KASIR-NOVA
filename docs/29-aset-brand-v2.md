# 29 - Aset Brand V2 (logo transparan & ikon)

> **Status:** diterapkan pada 16 Okt 2026. Menunggu **tinjauan visual pemilik**
> (agen tidak dapat melihat gambar; semua keputusan diambil dari pengukuran
> piksel).
> Ikon launcher Android sudah dipakai sejak APK `1.0.0-beta.4` dan splash
> ber-brand sejak APK `1.0.0-beta.5` (lihat `docs/25`, §7.6).

## 1. Sumber aset

Pemilik menyediakan `KASIR-NOVA-V2-TRANSPARENT.zip` (1,9 MB) di root repo.
Isinya 7 berkas PNG:

| Berkas | Ukuran | Transparan | Peran (dari nama berkas) |
|---|---|---|---|
| `00-brand-guideline.png` | 1536×1024 | 33,6 % | Pedoman brand (tidak dipakai di aplikasi) |
| `01-logo-dark-reference.png` | 635x284 | 78,9 % | Lockup lengkap: tanda + kata + tagline (latar gelap) |
| `02-logo-horizontal-reference.png` | 420x185 | 72,2 % | Lockup lengkap versi gelap (latar terang) |
| `03-app-icon-light-reference.png` | 179x178 | 65,9 % | **Ikon/tanda varian "untuk latar terang"** |
| `04-app-icon-dark-reference.png` | 182x187 | 3,8 % | **Ikon berlatar navy (untuk latar gelap)** |
| `05-splash-reference.png` | 152x222 | 0,3 % | Acuan splash milik pemilik (tidak dipakai di web) |
| `06-thumbnail-reference.png` | 156x162 | 0,3 % | Thumbnail (tidak dipakai di web) |

### Verifikasi transparansi (bukan asumsi dari nama berkas)

1. **Piksel sudut** tiap PNG: `A = 0` (benar-benar transparan).
2. **Proporsi piksel transparan** diukur dengan sampling grid (contoh:
   `01-logo-dark-reference.png` 78,9% transparan).
3. **Profil baris/kolom** dipakai untuk memetakan isi gambar
   (contoh `01`: bilah tanda di baris 48–187, baris kata di baris 208–235;
   ada jarak kosong di kolom 285–324 yang memisahkan tanda dari kata).
4. **Render ASCII kanal alpha** dipakai sebagai pengganti "melihat" gambar,
   untuk memastikan bentuk (tanda vs kata) dan warna dominan.

## 2. Pemetaan ke aset aplikasi

| Aset aplikasi | Sumber | Dipakai di | Alasan |
| --- | --- | --- | --- |
| `assets/logo-kasir-nova.png` | `03-app-icon-light-reference.png` (di-trim) | logo **halaman Login** (kartu putih) | tanda biru/hijau di atas latar transparan → terlihat di kartu putih |
| `assets/logo-kasir-nova-inverse.png` | `04-app-icon-dark-reference.png` | logo **topbar navy** | ikon membawa latar navy-nya sendiri; aman di topbar navy |
| `assets/favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | `04` (di-resize) | favicon & ikon PWA | ikon utuh, konsisten dengan topbar |
| `assets/icon-maskable-512.png` | `04` pada latar senada (`#043573`), ikon 80% | manifest Kasir (`purpose: maskable`) | area aman agar tidak terpotong mask Android |

Berkas `01`/`02` (lockup lengkap: tanda + kata + tagline) **tidak dipakai** di
UI web karena slot logo di UI hanya 34–128 px; kata/tagline tidak terbaca dan
akan menduplikasi teks "KASIR NOVA" yang sudah ada. `01` **dipakai** untuk
splash APK Android (`scripts/generate-android-splash.ps1`, kanvas 320×480 …
1920×1280) karena di sana lockup tampil besar di tengah layar.

Aset lama (`assets/logo-kasir-nova.jpeg`, raster tanpa transparansi) **dihapus**
dari ketiga panel (tersimpan di riwayat git). Tidak ada logo yang digambar
ulang.

## 3. Cara meregenerasi

```powershell
# dari root repo
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
# bila aset sudah diekstrak:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1 -SourceDir C:\path\hasil-ekstrak
```

Skrip mengekstrak `KASIR-NOVA-V2-TRANSPARENT.zip` ke folder sementara, memotong
tepi transparan (`minPixels=2` agar bintik anti-alias tidak ikut terhitung),
lalu menulis ulang seluruh aset di atas untuk `admin`, `owner`, dan `kasir`.

Aset Android (ikon launcher & splash) diregenerasi oleh skrip terpisah agar
tetap dapat dijalankan ulang setelah `npx cap add android`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-android-icons.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-android-splash.ps1
```

## 4. Perubahan CSS

`.topbar .brand-logo` tidak lagi memakai "chip" navy `--navy-900` berbingkai
(aset baru sudah membawa latarnya sendiri):

```css
.topbar .brand-logo {
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(2, 16, 43, 0.5);
}
```

## 5. Batasan & pekerjaan tersisa

1. **Ikon launcher & splash Android sudah diganti** — ikon sejak APK
   `1.0.0-beta.4`, splash ber-brand + bilah sistem navy sejak APK `1.0.0-beta.5`
   (`docs/25`, §7.6). Keduanya belum dilihat langsung di perangkat oleh agen.
2. **Belum ada SVG vektor.** Semua aset berasal dari PNG 32–512 px; ikon
   512 px adalah hasil pembesaran dari sumber 182×187 sehingga agak lunak.
   Bila pemilik menyediakan SVG, penimpaan tetap hanya menimpa berkas aset.
3. **Tinjauan visual pemilik diperlukan** — terutama apakah tanda pada
   halaman Login (biru/hijau di kartu putih), ikon topbar (kotak navy), splash
   APK, dan warna bilah status sudah sesuai maksud desain.
