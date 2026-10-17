# 30 — Smart Receipt Preview + alur cetak (FASE 3)

Status: **selesai secara teknis dan lulus uji** (16 Oktober 2026).
Prasyarat: —

---

## 1. Perilaku yang diminta

Alur kasir harus memisahkan **pratinjau** dari **pembayaran terkonfirmasi**:

```
BELUM DIBAYAR  →  [Bayar]  →  konfirmasi server  →  struk FINAL  →  Cetak / Selesai
```

Ketentuan yang dijaga:

1. Struk pratinjau berstatus **BELUM DIBAYAR** dan **tidak pernah** LUNAS.
2. Status **LUNAS** hanya berasal dari **respons server**, bukan dari UI.
3. Cetak 58 mm & 80 mm (dialog cetak) + cetak thermal Bluetooth.
4. **Cetak ulang** memakai *snapshot* struk saat konfirmasi (bukan hitung ulang).
5. **Tidak ada transaksi ganda** bila permintaan dikirim ulang (idempotensi).
6. **Gagal cetak tidak membatalkan** transaksi yang sudah tersimpan.

---

## 2. Desain

### 2.1 Modul alur murni — `apps/kasir/src/sale-flow.js`

Sama seperti `receipt.js`/`escpos.js`, modul ini **tanpa DOM, tanpa jaringan, dan
tanpa impor relatif** sehingga dapat diuji langsung di Node lewat `data:` URL.

State alur:

| Field | Nilai | Arti |
| --- | --- | --- |
| `MODE_DRAFT` | `'draft'` | pratinjau; **tidak boleh dicetak** |
| `MODE_FINAL` | `'final'` | sudah dikonfirmasi server; boleh dicetak |

API publik:

| Fungsi | Kegunaan |
| --- | --- |
| `validateSale({items,method,amount,total})` | validasi form sebelum pratinjau (sen) |
| `createDraft({...})` | buat pratinjau + **`clientRef` dibuat sekali** |
| `draftToTransaction(draft,{items,totals})` | objek transaksi *tiruan* untuk merender pratinjau |
| `buildSalePayload(draft)` | payload `POST /transactions` (tanpa harga dari klien) |
| `confirmDraft(draft,tx)` | draft → state final |
| `isPrintable(state)` | hanya `final` + punya id/invoice yang boleh dicetak |
| `isDraftState(state)` | penanda pratinjau |
| `afterPrintFailure(state,msg)` | catat gagal cetak **tanpa** membatalkan transaksi |
| `createSnapshot({...})` / `hasSnapshot()` | bekukan HTML struk + data saat konfirmasi |
| `markReprint(snapshot)` | tandai snapshot sebagai cetak ulang (immutable) |
| `renderPrintHtml(snapshot)` | HTML ke `#print-struk`; cetakan ke-2+ berlabel **CETAK ULANG** |

**Idempotensi:** `clientRef` (UUID v4) dibuat saat pratinjau dan **dipakai ulang**
saat konfirmasi. Server menyimpan `client_ref` unik per outlet; permintaan ulang
mengembalikan transaksi yang sama (`idempotent: true`) sehingga tidak ada dobel.

### 2.2 Status pembayaran

`paymentStatusLabel()` diperbarui di **`receipt.js`** dan **`escpos.js`**
(keduanya identik, dijaga tes paritas):

| Kondisi | Label |
| --- | --- |
| `status === 'draft'` | **BELUM DIBAYAR** |
| `status === 'voided'` | DIBATALKAN |
| `refunded` | DIKEMBALIKAN |
| pembayaran `failed` | GAGAL |
| pembayaran `pending` | BELUM LUNAS |
| selain itu | LUNAS |

Pratinjau tunai memakai label **"Rencana Bayar"/"Kembalian"** (bukan "Uang
Diterima") agar tidak menyiratkan uang sudah diterima.

### 2.3 Alur UI (`apps/kasir/src/app.js`)

| Tombol | Aksi |
| --- | --- |
| `#checkout-btn` "Tampilkan Pratinjau Struk" | `openPreview()` → `validateSale` → `createDraft` → render **BELUM DIBAYAR** |
| `#receipt-pay-btn` "Bayar Sekarang" | `confirmPayment()` → `api.createTransaction` → struk **FINAL** + snapshot |
| `#receipt-cancel-btn` "Batal" | buang pratinjau; **keranjang tidak diubah** |
| `#receipt-done-btn` "Selesai" | reset struk; siap transaksi berikutnya |
| `#struk-share-btn` "Kirim" | kirim **struk PDF** (Web Share di peramban; lembar berbagi Android di APK) — 17 Okt 2026 |
| `#struk-save-btn` "Simpan PDF" | simpan **struk PDF** (unduh di peramban; pemilih berkas di APK) |
| `#struk-print-btn` "Cetak" | cetak **struk PDF** (layanan cetak Android) / dialog cetak peramban |
| `#print-struk-thermal` | cetak ESC/POS dari snapshot |

> Tombol `Cetak 58mm` / `Cetak 80mm` **digantikan** tombol `Cetak` pada 17 Okt 2026
> (alur baru: struk PDF). Rincian: `docs/36-struk-pdf-kasir.md`.

Tombol cetak **disembunyikan** selama pratinjau (`isPrintable`). Bila keranjang
atau form berubah setelah pratinjau tampil, pratinjau otomatis **dibuang**
(`invalidateDraft`) agar angka yang ditampilkan tidak basi.

Cetak otomatis (bila disetel) berjalan setelah transaksi & snapshot siap;
kegagalannya hanya menampilkan pesan di `#receipt-print-error` — transaksi tetap
`final` dan tetap bisa dicetak ulang.

Cetak ulang juga bisa dipicu dari **Riwayat Transaksi** (detail transaksi →
`showFinalReceipt`), yang membentuk snapshot baru dari data server.

### 2.4 Gaya

Semua kelas struk tambahan tetap ter-scope ke `#print-struk` (tidak bocor ke
layar). Panel layar memakai `.receipt.draft` (garis putus-putus) vs
`.receipt.final`, plus `#receipt-note` dan `#receipt-print-error`.

---

## 3. Berkas yang dibuat / diubah

| Berkas | Perubahan |
| --- | --- |
| `apps/kasir/src/sale-flow.js` | **baru** — modul alur murni (draft/confirm/snapshot/reprint) |
| `apps/kasir/src/receipt.js` | +`DRAFT_STATUS/LABEL/NOTICE`, cabang draft, banner & baris "Rencana Bayar" |
| `apps/kasir/src/escpos.js` | +cabang draft, `reprint` (`*** CETAK ULANG ***`), label prapratinjau |
| `apps/kasir/src/app.js` | alur 2 langkah (pratinjau → konfirmasi), snapshot, cetak ulang, gagal-cetak non-blokir |
| `apps/kasir/index.html` | `#receipt-headline/#receipt-note/#receipt-print-error/#receipt-pay-row/#receipt-pay-btn/#receipt-cancel-btn/#receipt-done-btn`; label tombol |
| `apps/kasir/styles/styles.css` | gaya pratinjau layar + `#print-struk .struk-draft/.struk-reprint` |
| `server/tests/sale-flow.test.js` | **baru** — 21 uji alur |
| `server/tests/receipt-struk.test.js` | +3 uji (draft, draft non-tunai, CSS cetak) |
| `server/tests/printer-escpos.test.js` | +2 uji + kasus draft pada uji paritas label |
| `scripts/verify-ui.mjs` | +guard FASE 3 (modul murni, id HTML, kelas CSS, scope `#print-struk`) |

---

## 4. Pengujian

```
# Backend (butuh PostgreSQL dev; jalankan cleaner lalu tes)
cd server
node scripts/clean-test-fixtures.mjs
node --test "tests/**/*.test.js"     → 246 lulus / 0 gagal

# UI & aset
node scripts/build-hosting.mjs
node scripts/verify-ui.mjs           → SEMUA OK
node --test scripts/test-auth-restore.mjs   → 10 lulus
node --test scripts/test-product-image.mjs  → 9 lulus
```

Hasil (16 Okt 2026): semuanya lulus. Kenaikan 220 → 246 tes berasal dari modul
alur, draft struk, dan cetak ulang ESC/POS.

---

## 5. Batasan & catatan jujur

1. **Cetak fisik (printer thermal) belum diuji di perangkat nyata** — hanya
   encoder ESC/POS yang diuji otomatis. Perlu verifikasi saat printer tersedia.
2. Dialog cetak 58/80 mm bergantung pada driver/keluaran perangkat; ukuran
   ditetapkan lewat `@page` (58 mm margin 5 mm; 80 mm margin 4 mm).
3. Status LUNAS tetap **milik server** (`payments.status = 'paid'`,
   `transactions.status = 'completed'`). Pratinjau tidak pernah menulis apa pun.
4. Verifikasi visual (warna/tata letak pratinjau) belum dijalankan otomatis di
   browser — perlu tinjauan pemilik.
