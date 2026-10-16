# 28 — Smart Product Image (FASE 2)

Status: **selesai secara teknis dan lulus uji** (16 Oktober 2026).
Prasyarat: keputusan pemilik — **foto tetap disimpan sebagai data URL di Postgres**
(tanpa object storage baru), dan pustaka gambar internal dibuat sendiri
(bukan mengambil gambar dari Google Images / sumber tanpa lisensi).

---

## 1. Perilaku yang diminta

Gambar produk ditentukan **otomatis** bila pemilik/kasir tidak mengunggah foto,
dengan urutan prioritas:

| Prioritas | Sumber (`source`) | Dasar penentuan |
| --- | --- | --- |
| 1 | `manual` | foto yang diunggah pengguna (`products.photo_url`, data URL) |
| 2 | `library` | **nama produk** dicocokkan ke pustaka internal via kata kunci/sinonim |
| 3 | `category` | **nama kategori** produk (bila nama tidak dikenali) |
| 4 | `placeholder` | gambar bawaan bila tidak ada yang cocok |

## 2. Implementasi

### 2.1 Modul kanonik

`shared/product-image.js` — modul murni (tanpa DOM) yang:

- memuat **18 gambar SVG** buatan sendiri (bentuk geometris sederhana):
  `placeholder, minuman, botol, kopi, susu, makanan, mie, snack, beras, telur,
  roti, rokok, sabun, obat, gas, pulsa, pakaian, elektronik, lainnya`;
- menormalkan teks (huruf kecil, tanpa aksen, hanya `a-z0-9`, spasi tunggal);
- mencocokkan **per token** (bukan potongan kata) dan memilih **kata kunci
  terpanjang** yang cocok sehingga istilah paling spesifik menang
  (contoh: "Rokok Sampoerna" → `rokok`, bukan `sabun` dari kata "sampo");
- mengembalikan gambar sebagai **data URL** (`data:image/svg+xml,…`) sehingga
  pemakaian di UI seragam: cukup `<img src="…">`;
- menyediakan `renderThumb()` yang meng-escape atribut (nama produk tidak bisa
  menyuntikkan HTML).

API publik: `resolveImage(product)`, `suggestImage(name, category)`,
`renderThumb(product, opts)`, `normalize(text)`, `libraryKeys()`.

### 2.2 Tanpa bundler — salinan bersama

Aplikasi KASIR NOVA tidak memakai bundler, jadi modul bersama disalin ke tiap
panel yang membutuhkannya (owner & kasir):

```
shared/product-image.js            (kanonik)
  -> apps/owner/src/product-image.js
  -> apps/kasir/src/product-image.js
```

- `node scripts/sync-shared.mjs` menulis salinan;
- `node scripts/sync-shared.mjs --check` gagal bila salinan menyimpang;
- `scripts/verify-ui.mjs` **memeriksa kesamaan** salinan + keberadaan kelas CSS,
  jadi penyimpangan tertangkap otomatis.

### 2.3 Titik pakai di UI

| Aplikasi | Lokasi | Kelas |
| --- | --- | --- |
| Kasir | layar jual (POS) | `.pos-photo` |
| Kasir | daftar kelola produk | `.product-thumb` |
| Owner | daftar produk | `.product-thumb` |
| Kasir & Owner | form produk: blok **"Gambar otomatis"** yang berubah saat nama/kategori diketik | `.photo-auto` |

Pada form, blok "Gambar otomatis" menjelaskan sumber yang dipakai
("sesuai nama produk" / "sesuai kategori" / "gambar bawaan"), dan bila sudah ada
foto unggahan, blok itu memberi tahu bahwa **unggahan menang**.

## 3. Berkas yang dibuat / diubah

| Berkas | Perubahan |
| --- | --- |
| `shared/product-image.js` | **baru** — modul kanonik (pustaka SVG + pencocokan + resolver) |
| `apps/owner/src/product-image.js`, `apps/kasir/src/product-image.js` | **baru** — salinan hasil `sync:shared` |
| `scripts/sync-shared.mjs` | **baru** — penyalin + pemeriksa berkas bersama |
| `scripts/test-product-image.mjs` | **baru** — 10 uji resolver (prioritas, sinonim, fallback, escape, determinisme) |
| `scripts/verify-ui.mjs` | + pemeriksaan FASE 2 (salinan sama, urutan `<script>`, kelas CSS) & smoke `product-image.js` |
| `apps/kasir/src/app.js` | helper `productThumbHtml`/`renderAutoPhoto`, gambar di POS & daftar kelola, saran di form |
| `apps/owner/src/app.js` | helper yang sama, gambar di daftar produk, saran di form |
| `apps/{kasir,owner}/index.html` | `<script src="./src/product-image.js">` sebelum `app.js`; elemen `#mprod-photo-auto` / `#product-photo-auto` |
| `apps/{kasir,owner}/styles/styles.css` | kelas `.product-main`, `.product-thumb`, `.photo-auto` (+ `.pos-photo` di kasir) |
| `package.json` | skrip `test:image`, `sync:shared` |

## 4. Pengujian

```powershell
node --test scripts/test-product-image.mjs   # 10/10 lulus
node scripts/sync-shared.mjs --check         # SEMUA SAMA
node scripts/build-hosting.mjs
node scripts/verify-ui.mjs                   # SEMUA OK
```

Hasil (16 Okt 2026): semua di atas lulus. Uji mencakup kasus nyata seperti
`Aqua 600ml → minuman`, `Indomie Goreng → mie`, `Minyak Goreng Sania → botol`,
`Rokok Sampoerna → rokok` (bukan `sabun`), `Beras Pandan Wangi → beras`,
`Produk XYZ + kategori Minuman → kategori minuman`, dan `{} → placeholder`.

## 5. Batasan & catatan jujur

1. Pustaka internal adalah **SVG buatan sendiri**, bukan foto realistis. Bila
   pemilik ingin foto produk nyata untuk pustaka, perlu sumber berlisensi —
   ini keputusan pemilik (dan menambah ukuran unggahan/hosting).
2. Pencocokan memakai kata kunci/sinonim, **bukan AI**. Kata kunci yang belum
   tercantum akan jatuh ke gambar kategori atau `placeholder`; daftar kata
   kunci mudah ditambah di `NAME_RULES`/`CATEGORY_RULES`.
3. `photo_url` tetap base64 di Postgres (keputusan pemilik); batas ±380 KB per
   foto dijaga di klien dan divalidasi ulang di server.
4. Belum ada pemakaian gambar produk di **struk** (struk thermal tetap
   teks/monospace) dan di panel Admin (Admin tidak menampilkan produk).
