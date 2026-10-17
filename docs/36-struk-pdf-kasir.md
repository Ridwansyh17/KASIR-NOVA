# 36 — Struk PDF di Panel Kasir (kirim / simpan / cetak)

> **Status:** kode selesai & **diuji lokal 17 Okt 2026** (`server/tests/struk-pdf.test.js`
> **12/12 lulus**, seluruh backend **265/265 lulus**, `verify:ui` **SEMUA OK**).
> **Uji di perangkat: SUKSES** (dilaporkan pemilik, 17 Okt 2026).
> **APK `1.0.0-beta.8`** (memuat plugin native `NovaReceipt` + **perbaikan PDF
> kosong**, §6.1) **sudah dibangun & didistribusikan** ke grup `kasir-beta`
> pada 17 Okt 2026 — lihat §6.
>
> **Permintaan pemilik (17 Okt 2026):**
> *"saya ingin merubah alurnya, saat klik bayar harus tampil struk pdfnya dan dari
> situ pdfnya bisa di share/kirim dan di cetak, jadi tidak perlu menunggu printer
> tersambung terlebih dahulu untuk menampilkan struk pdfnya."*

---

## 1. Alur baru

```
Keranjang → "Tampilkan Pratinjau Struk" (BELUM DIBAYAR, tidak pernah LUNAS)
   → "Bayar Sekarang"  ──►  server mencatat transaksi
        │
        └─► STRUK langsung tampil + BERKAS PDF dibentuk saat itu juga
              (tanpa printer thermal, tanpa sambungan Bluetooth)
                 ├─ [ Kirim ]      → bagikan PDF (WhatsApp/e-mail/Drive)
                 ├─ [ Simpan PDF ] → simpan berkas PDF
                 ├─ [ Cetak ]      → layanan cetak Android (PDF) / dialog cetak peramban
                 ├─ [ Cetak Thermal ] (opsional, hanya bila printer tersambung)
                 └─ [ Selesai ]
```

Sebelum perubahan ini, cetak hanya tersedia lewat dialog cetak peramban
(`Cetak 58mm` / `Cetak 80mm`) dan printer thermal Bluetooth; tidak ada berkas PDF
yang bisa disimpan/dikirim, dan printer harus tersambung untuk mencetak.

---

## 2. Berkas

**Baru**

| Berkas | Isi |
|---|---|
| `apps/kasir/src/receipt-pdf.js` | Pembentuk **struk PDF** murni: susunan baris + penulis PDF minimal (tanpa pustaka pihak ketiga) |
| `apps/kasir/src/struk-share.js` | Pengirim: **simpan / kirim / cetak** (peramban & APK) |
| `apps/kasir-mobile/android/.../NovaReceiptPlugin.java` | Plugin Capacitor `NovaReceipt` (`share`, `save`, `print`) |
| `server/tests/struk-pdf.test.js` | 11 tes (PDF valid + jalur kirim/simpan/cetak) |

**Diubah**

| Berkas | Perubahan |
|---|---|
| `apps/kasir/index.html` | Tombol `#struk-share-btn`, `#struk-save-btn`, `#struk-print-btn`, catatan `#struk-pdf-note`; tombol `Cetak 58mm`/`Cetak 80mm` **digantikan** tombol `Cetak` |
| `apps/kasir/src/app.js` | Impor modul baru, `buildStrukPdfBundle()`, penangan tombol PDF, PDF dibentuk di `showFinalReceipt()` |
| `apps/kasir/styles/styles.css` | Gaya `#struk-pdf-note` |
| `apps/kasir-mobile/.../MainActivity.java` | `registerPlugin(NovaReceiptPlugin.class)` |
| `scripts/verify-ui.mjs` | Pengunci baru **"struk pdf kasir (17 Okt 2026)"** |
| `scripts/qa-local.ps1`, `docs/25`, `docs/30`, `docs/05-roadmap.md`, `README.md` | Dokumen & jumlah tes |

Tidak ada perubahan server: struk memakai data transaksi yang sudah dikembalikan
`POST /api/cashier/transactions` (dan `GET .../transactions/:id` untuk struk lama).

---

## 3. Format berkas PDF

- **Ukuran halaman** mengikuti lebar kertas: **58 mm** (32 kolom) atau **80 mm**
  (48 kolom) — sama dengan pengaturan lebar printer (`app.js` memakai
  `printer.getSettings().width`), sehingga struk PDF dan struk thermal identik.
- **Tinggi halaman mengikuti isi** (seperti kertas struk), dan struk yang sangat
  panjang otomatis **dipecah ke beberapa halaman**.
- **Font:** Courier / Courier-Bold (base-14). Tidak ada font/gambar yang
  disematkan, jadi berkas berukuran kecil (± 2–4 KB) dan bisa dibuka di mana saja.
- **ASCII** saja: karakter di luar 32–126 (emoji, huruf non-Latin) menjadi `?` —
  sama seperti printer thermal generik.
- Susunan baris identik dengan `escpos.js`: kop toko, No. Struk, Tanggal, ID
  Transaksi, Kasir, Pelanggan, item, Total Produk/Subtotal/Diskon/Pajak/**TOTAL**,
  Pembayaran/Status/Uang Diterima/Kembalian, dan footer.
- Status selalu **jujur**: pratinjau = `BELUM DIBAYAR`, void = `DIBATALKAN`,
  refund = `DIKEMBALIKAN` (tidak pernah mengarang `LUNAS`).

**Penyimpangan yang disengaja**

| # | Penyimpangan | Alasan |
|---|---|---|
| 1 | Logo outlet tidak disematkan ke PDF | Menyematkan gambar memerlukan penulis PDF jauh lebih rumit; nama bisnis/outlet tetap tercetak sebagai teks |
| 2 | Label "ID Transaksi" (UUID) dicetak di baris sendiri | Agar tidak melewati lebar halaman (UUID 36 karakter > 32 kolom) |
| 3 | Tombol `Cetak 58mm` / `Cetak 80mm` dihapus, diganti tombol `Cetak` | Alur baru: cetak dari struk PDF (di APK lewat layanan cetak Android). Lebar kertas tetap dapat diatur di kartu **Printer Thermal**. Silakan beri tahu bila ingin tombol 80 mm dikembalikan |

---

## 4. Perilaku per lingkungan

| Aksi | Peramban (web/PWA) | APK Android (Capacitor) |
|---|---|---|
| **Kirim** | Web Share API (`navigator.share` dengan berkas PDF) — Chrome Android bisa langsung ke WhatsApp. Bila tidak didukung → berkas **diunduh** + pesan agar dikirim manual | Lembar berbagi Android (`ACTION_SEND`) lewat plugin `NovaReceipt.share` |
| **Simpan PDF** | Unduhan berkas (`<a download>`) | Pemilih berkas sistem (`ACTION_CREATE_DOCUMENT`) lewat `NovaReceipt.save` |
| **Cetak** | Dialog cetak peramban (struk HTML 58 mm; tersedia juga "Simpan sebagai PDF") | Layanan cetak Android atas **berkas PDF** (`NovaReceipt.print`, tersedia opsi "Save as PDF") |
| **Cetak Thermal** | Tidak tersedia (butuh perangkat native) | Tetap ada, hanya bila printer tersambung |

**Catatan keterbatasan:** WebView Android **tidak dapat menampilkan PDF di dalam
halaman** (tidak ada penampil PDF). Karena itu pratinjau di layar tetap berupa
struk (isi identik dengan PDF), sedangkan **berkas PDF-nya** yang dipakai untuk
kirim/simpan/cetak. Ini juga alasan `window.print()` tidak dipakai di APK —
WebView tidak mendukungnya.

---

## 5. Pengujian

| Perintah | Hasil |
|---|---|
| `node --test tests/struk-pdf.test.js` (di `server/`) | **12/12 lulus** |
| `node scripts/verify-ui.mjs` | **SEMUA OK** (bagian baru `[struk pdf kasir (17 Okt 2026)]`) |

Yang diuji:

1. Berkas PDF benar-benar **valid**: header `%PDF-1.4`, tabel **xref** (setiap
   offset menunjuk tepat ke `n 0 obj`), `trailer`, dan `%%EOF`.
2. **Pohon halaman sah & isi halaman tidak kosong** (lihat §6.1): `/Kids` menunjuk
   objek `/Type /Page` (bukan stream isi), `/Count` = jumlah `/Kids`, tiap halaman
   menunjuk `/Parent` + `/Contents`, `/Length` tepat, dan teks benar-benar berada
   di dalam stream isi halaman — diuji untuk 58 mm **dan** 80 mm.
3. Ukuran halaman 58 mm (164,41 pt) dan 80 mm (226,77 pt) serta isi struk lengkap
   (nomor, produk, TOTAL, metode, uang diterima, kembalian, footer).
4. **Tidak ada baris melebihi lebar kertas** (32/48 kolom) — termasuk nama produk
   panjang, nama bisnis panjang, dan UUID transaksi.
5. Teks non-ASCII → `?`, dan karakter `(`, `)`, `\` di-escape agar PDF tetap sah.
6. Pratinjau **tidak pernah** `LUNAS`; void → `DIBATALKAN`; refund → `DIKEMBALIKAN`.
7. Penanda `CETAK ULANG`.
8. Struk 240 item → **beberapa halaman** (pohon halaman tiap halaman ikut diuji).
9. base64 bolak-balik utuh (dipakai jembatan native) & nama berkas aman.
10. Jalur **APK**: `share`/`save`/`print` memanggil plugin `NovaReceipt` dengan
    `mime: application/pdf` + base64.
11. Jalur **peramban tanpa Web Share**: `share` ditandai `share_unsupported`
    (UI otomatis mengunduh berkas); `print` ditandai `not_native`.
12. Jalur **peramban dengan Web Share**: berkas `Struk-*.pdf` dikirim dengan tipe
    `application/pdf`.

---

## 6. Status kepengerjaan (17 Okt 2026)

Sudah dikerjakan atas perintah pemilik ("lakukan selain no.4"):

1. ✅ **Build & distribusi APK `1.0.0-beta.8`** (versionCode `8`) yang memuat plugin
   `NovaReceipt` + perbaikan PDF kosong (§6.1). Berkas
   `dist/apk/KASIR-NOVA-1.0.0-beta.8.apk` (~5,02 MB), keystore rilis sama
   (SHA-256 `5bf78eb1…d055`) sehingga dapat dipasang langsung di atas beta.7,
   **terkirim ke grup `kasir-beta`** (Firebase App Distribution).
   Verifikasi: `aapt dump badging` → `versionCode='8' versionName='1.0.0-beta.8'`;
   isi APK diperiksa (`assets/public/src/receipt-pdf.js` memuat perbaikan §6.1);
   `gradlew assembleRelease` → **BUILD SUCCESSFUL**.
2. ✅ **Uji di perangkat** — **pemilik melaporkan SUKSES** ("uji struk pdf sukses",
   17 Okt 2026) pada rilis `kasir-beta` (beta.8): struk PDF tampil & dapat
   dipakai dari kartu struk. (Rincian aksi yang dicoba ada di pemilik; cetak ke
   printer thermal fisik tetap belum diuji karena tidak ada perangkat printer.)
3. ✅ **Jumlah halaman cetak** kini dibaca dari berkas PDF (`pdfPageCount`, pola
   `/Count n`) dan dilaporkan ke `PrintDocumentInfo`, bukan lagi
   `PAGE_COUNT_UNKNOWN`.
4. ⏭️ **Opsi logo outlet di dalam PDF** — **tidak dikerjakan** (dikecualikan
   pemilik pada 17 Okt 2026).

### 6.1 Perbaikan penting — PDF tampil KOSONG (dilaporkan pemilik)

**Laporan pemilik:** *"saya cek pdf struk hanya kosongan dan tidak menampilkan
struk."*

**Penyebab (terverifikasi):** pada penulis PDF, `/Kids` di **pohon halaman**
(`/Type /Pages`) menunjuk ke objek **stream isi** (`5+2i`) alih-alih objek
**halaman** (`6+2i`). Berkas tetap terbuka tetapi pembaca PDF menolaknya sehingga
halaman tampil kosong. Kesalahan ada **sejak beta.7** (fitur struk PDF baru).

**Cara menemukannya (bukti, bukan dugaan):**
1. Berkas PDF yang dihasilkan modul dibangun ulang di Node dan dirender dengan
   mesin PDF bawaan Windows (`Windows.Data.Pdf`): **gagal dimuat**.
2. Sebagai pembanding, PDF acuan dari Chrome (`--print-to-pdf`) **berhasil
   dimuat** oleh mesin yang sama → membuktikan masalahnya di berkas kita, bukan
   di alat ujinya.
3. `/Kids [5 0 R]` diperiksa: objek 5 adalah `<< /Length … >> stream … endstream`,
   sedangkan objek halaman sebenarnya adalah 6.

**Perbaikan:** `/Kids` memakai id objek halaman (`6 + i * 2`).

**Verifikasi setelah perbaikan:**
- Mesin PDF Windows **berhasil memuat** berkas → dirender ke PNG dan diperiksa
  secara visual: struk tampil utuh (kop, item, TOTAL, pembayaran, footer).
- Struk panjang (120 item) → **2 halaman**; halaman 2 dirender & diperiksa:
  item lanjutan + ringkasan + footer tampil.
- Pengujian otomatis baru **`assertPageTreeValid`** memastikan: setiap `/Kids`
  adalah objek `/Type /Page` (bukan stream), `/Count` = jumlah `/Kids`, tiap
  halaman menunjuk `/Parent` + `/Contents`, `/Length` **tepat** sama dengan
  panjang byte stream, dan tidak ada halaman "yatim". Tes ini **gagal** pada kode
  beta.7 dan **lulus** setelah perbaikan.

**Dampak:** APK beta.7 (PDF kosong) tidak dipakai lagi; pemilik/penguji diminta
memasang **beta.8**.

Catatan: fitur struk PDF **tidak memerlukan perubahan backend** — berkas dibentuk
di perangkat dari data transaksi yang sudah ada. Deploy backend/hosting terpisah
(Laporan Transaksi Owner) tetap menunggu persetujuan pemilik.
