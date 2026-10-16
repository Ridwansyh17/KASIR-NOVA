# 27 — Desain V2: Token & Komponen (FASE 1)

Status: **FASE 1 selesai secara teknis — menunggu peninjauan pemilik proyek.**
Tanggal: 16 Oktober 2026. Panel: `admin`, `owner`, `kasir` (desktop + mobile).
Rencana induk: `docs/26-audit-v2-dan-rencana.md`.

---

## 1. Apa yang dikerjakan

FASE 1 mengubah **identitas visual** dari tema gelap lama menjadi **tema terang
dengan permukaan navy** sesuai aset brand V2, **tanpa mengubah** struktur data,
id elemen, alur kerja, atau fungsi apa pun. Semua perubahan bersifat
**tampilan (CSS/meta)** saja.

Yang berubah:

| Area | Sebelum | Sesudah |
| --- | --- | --- |
| Latar halaman | navy sangat gelap `#060e22` | terang `#F4F7FC` + pendar biru tipis |
| Kartu/panel | `#0C1A34` | putih `#FFFFFF` |
| Header (topbar) | kartu gelap | **navy brand** `#062A66 → #042650` |
| Aksen utama | cyan `#00B4FF` | biru brand `#0072F6` (tua `#0050D2`) |
| Teks | `#E9F1FF` (terang) | `#0B1B33` (gelap) |
| Garis | `#1D3160` | `#E0E7F2` |
| Layar login | kartu gelap | latar navy bergradasi + kartu putih |
| `theme-color` | `#060e22` | `#062A66` |

## 2. Token desain

Token lama **dipertahankan namanya** (`--bg`, `--card`, `--text`, `--primary`,
…) agar seluruh aturan CSS yang sudah ada tetap valid; hanya nilainya yang
dipetakan ke tema terang. Token baru ditambahkan untuk kebutuhan V2:

```css
/* Skala brand (hasil ekstraksi programatik aset brand V2) */
--navy-900:#02102b  --navy-800:#042650  --navy-700:#062a66  --navy-600:#0a3678
--blue-600:#0050d2  --blue-500:#0072f6  --blue-400:#1ba4fe  --blue-100:#e6effe

/* Permukaan & teks (tema terang) */
--bg:#f4f7fc  --card:#ffffff  --card-2:#f2f6fc  --card-3:#e8eef8
--input-bg:#ffffff  --text:#0b1b33  --text-invert:#ffffff
--muted:#5b6b85  --border:#e0e7f2  --border-strong:#c9d6e8

/* Aksen & status */
--primary:#0072f6  --primary-dark:#0050d2  --primary-tint  --focus-ring
--danger:#d64545  --danger-tint  --danger-border
--ok-fg:#0e8f63   --ok-bg  --ok-border   --off-fg  --off-bg

/* Permukaan navy (topbar & login) */
--sidebar:#062a66  --sidebar-2:#042650  --sidebar-fg  --sidebar-muted
--sidebar-active  --sidebar-border

/* Overlay & bayangan */
--overlay  --shadow-sm  --shadow  --shadow-lg
```

Setiap `styles.css` diakhiri dengan blok **"Lapisan identitas visual (FASE 1)"**
yang menimpa komponen yang bergantung pada struktur (bukan sekadar warna token):
`body`, `.topbar`, `.auth`, `.brand-logo-lg`, `.tab`. Blok ini sengaja dipisah
agar mudah ditinjau dan di-revert.

## 3. Berkas yang diubah

| Berkas | Perubahan |
| --- | --- |
| `apps/kasir/styles/styles.css` | blok `:root` baru + penggantian warna literal → token + lapisan identitas V2 |
| `apps/owner/styles/styles.css` | idem + perbaikan tombol Ekspor Excel (`.btn.xlsx`, `#rep-export-xlsx`) yang sebelumnya gelap-di-gelap |
| `apps/admin/styles/styles.css` | idem |
| `apps/{kasir,owner,admin}/index.html` | `meta name="theme-color"` → `#062A66` (owner & admin: ditambahkan) |
| `apps/kasir/site.webmanifest` | `theme_color` → `#062A66` (`background_color` tetap `#02102B`) |
| `scripts/apply-theme-v2.mjs` | **baru** — skrip migrasi token (idempoten, melaporkan jumlah penggantian) |
| `scripts/verify-ui.mjs` | **baru** — penjaga regresi token V2 (token wajib ada, warna gelap lama wajib hilang, topbar navy, `body` terang, login navy) |

## 4. Batasan yang harus diketahui pemilik

1. **Aset brand V2 masih RASTER.** Folder `KASIR-NOVA-V2-BRAND-ASSETS/` berisi
   potongan gambar (JPEG) tanpa transparansi — **bukan** vektor/PNG transparan.
   Karena itu logo yang dipakai di aplikasi **masih aset lama**
   (`assets/logo-kasir-nova.jpeg`, latar navy `#02102B`), ditempatkan dalam
   "chip" navy bergaris agar terlihat disengaja. Bila pemilik menyediakan
   **SVG/PNG transparan** logo V2, penggantian hanya perlu menimpa satu berkas
   tersebut di tiap panel — tanpa perubahan kode.
2. **Belum ada sidebar vertikal.** Struktur aplikasi memakai *topbar* horizontal.
   Identitas navy diterapkan pada topbar (aman, tanpa mengubah struktur HTML
   setiap halaman). Bila pemilik menginginkan sidebar vertikal penuh (seperti
   mockup), ini menjadi pekerjaan struktur terpisah yang perlu disetujui.
3. **Verifikasi visual oleh manusia diperlukan.** Makna/piksel mockup tidak bisa
   dilihat langsung oleh agen; warna diambil lewat ekstraksi programatik. Karena
   itu hasil ini **wajib ditinjau pemilik** sebelum dianggap final.
3b. **Uang/label tetap**: tidak ada teks/istilah yang diubah, tidak ada alur
   bisnis yang disentuh.

## 5. Cara meninjau (checklist pemilik)

Jalankan lokal lalu buka:

```powershell
node scripts/build-hosting.mjs
npx --yes serve dist/hosting     # atau: npx serve dist/hosting
```

Periksa:

- [ ] **Login** (admin/owner/kasir): latar navy, kartu putih, logo terbaca.
2. **Topbar** navy dengan nama aplikasi + tombol "Keluar" terbaca jelas.
3. **Kartu & tabel**: latar putih, teks gelap, garis halus, badge warna masih
   terbaca (HABIS / aktif, ok/merah).
4. **Tombol**: primer biru `#0072F6`, sekunder putih, bahaya merah.
5. **Form & modal**: input putih, fokus cincin biru, tombol **Simpan Produk**
   tetap terjangkau pada layar pendek.
6. **Tab** (admin/owner): tab aktif jelas, tab lain redup.
7. **Kasir mobile**: setelah login, topbar navy + daftar produk tetap terbaca.
8. **Struk/pratinjau**: area kertas tetap putih dengan teks hitam.

## 5. Pengujian

```powershell
node scripts/verify-ui.mjs        # integritas statis + penjaga token V2 + smoke hosting
node scripts/test-auth-restore.mjs # regresi login persisten (10 kasus)
```

Hasil (16 Okt 2026):

- `verify-ui.mjs` → **SEMUA OK** (rujukan lokal, id JS→HTML, api→api.js, ikon
  manifest, 10 token V2 + 9 warna gelap lama per aplikasi, 12 smoke HTTP).
- `test-auth-restore.mjs` → **10/10 lulus**.
- Suite backend `server/` → **220/220 lulus** (baseline; lihat catatan
  `docs/26-audit-v2-dan-rencana.md` tentang cara menjalankan Postgres dev).

## 6. Risiko & rencana lanjutan

- Bila pemilik tidak menyetujui arah ini, revert cukup dengan membuang blok
  lapisan FASE 1 dan mengembalikan blok `:root` (token lama ada di riwayat git).
- FASE berikutnya: **FASE 2 — Smart Product Image** (penyimpanan tetap base64 di
  Postgres, sesuai keputusan pemilik), lalu FASE 3 — Smart Receipt Preview,
  FASE 6 — verifikasi fitur 13 Okt, FASE 7 — matriks QA, FASE 8 — laporan akhir.
