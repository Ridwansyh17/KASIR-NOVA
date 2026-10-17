# 37 — Laporan Transaksi untuk Kasir (A5a)

> Dibuat **17 Okt 2026** atas permintaan pemilik dari daftar pekerjaan lanjutan
> ("**Laporan untuk Kasir (A5a)**"). Dokumen ini merinci **keputusan pemilik**,
> bentuk endpoint, tampilan panel Kasir, ekspor Excel, temuan bug, dan hasil
> pengujian. Ringkasan endpoint ada di `docs/16-api-laporan.md`; perubahan
> matriks hak akses di `docs/04-matriks-hak-akses.md` §8.

---

## 1. Keputusan pemilik yang dipatuhi

| Kode | Pertanyaan | Keputusan |
|---|---|---|
| **A5a** | Cakupan baris | **Semua transaksi outlet kasir** (bukan hanya transaksi yang dibuat kasir itu sendiri) |
| **B1** | Bentuk baris | **Satu baris per TRANSAKSI** + kartu ringkasan di atas tabel (bukan per item) |
| **B2** | Ekspor Excel | **Kasir boleh mengekspor** laporan ini (`.xlsx`) |
| **B3** | Penempatan & rentang | **Tab baru "Laporan Transaksi"** di panel Kasir; rentang bawaan **hari ini**, dengan preset rentang seperti tab "Pendapatan" |

Yang **tidak** diubah (aturan proyek tetap):

- **Satu akun kasir = satu outlet.** Outlet & bisnis **selalu** dari akun
  (`req.cashierScope`), tidak pernah dari input klien.
- Laporan **keuangan/laba** (HPP, biaya, pengeluaran, laba) tetap **tidak**
  dapat diekspor kasir dan tetap disembunyikan bila `can_view_profit = false`.
- Tidak ada migrasi skema: seluruh angka dihitung dari tabel Fase 7.

---

## 2. Endpoint (server)

Modul: `server/src/modules/cashier-area/` (rute) + `server/src/modules/report/`
(logika & berkas Excel) — **memakai ulang** mesin laporan Owner supaya angka
kedua panel tidak pernah berbeda.

| Metode | Path | Bawaan | Maksimum |
|---|---|---|---|
| GET | `/api/cashier/reports/transactions` | `limit` **200** | **1000** |
| GET | `/api/cashier/reports/transactions/export` | `limit` **2000** | **20000** |

**Otorisasi:** `requireAuth` + `requireRole('cashier')` + `loadCashierScope`.

```js
// cashier-area/routes.js
const cashierOnly = [requireAuth, requireRole('cashier'), loadCashierScope];

router.get('/reports/transactions', ...cashierOnly,
  ...validate({ query: cashierTransactionReportQuerySchema }), controller.reportTransactions);

router.get('/reports/transactions/export', ...cashierOnly,
  ...validate({ query: cashierTransactionReportExportQuerySchema }), controller.reportTransactionsExport);
```

**Outlet tidak bisa dipilih klien.** Skema query (`report/schema.js`) **tidak
punya** `outletId` maupun `cashierId`; Zod membuang field asing, jadi
`?outletId=<outlet lain>` **diabaikan** (bukan 422) dan permintaan tetap
memakai outlet akun kasir. Pengunci `scripts/verify-ui.mjs` menolak bila kata
`outletId` muncul pada blok skema kasir (regresi IDOR).

Controller (`cashier-area/controller.js`) menghitung rentang **di server**
memakai zona waktu bisnis, lalu **memaksa** tenant:

```js
const range = await reportService.resolveFinanceRange(scope.timezone, query);
reportService.cashierTransactionReport({
  businessId: scope.business_id,
  outletId: scope.outlet_id,     // <- dari ACCOUNT, bukan dari query
  filters: { ...query, from: range.from, to: range.to },
});
```

### 2.1 Angka: satu sumber untuk dua panel

`report/service.js` kini memakai dua helper bersama:

- `statusStats(businessId, filters, outletId)` → jumlah & total transaksi
  menurut status (dipakai laporan Owner **dan** kasir);
- `paymentMethodRecap(...)` → rekap metode + persentase (jumlah selalu **100%**).

`payment_methods[].total` dihitung dari **`transactions.total`**, **bukan**
`payments.amount` (`payments.amount` = uang diterima, termasuk kembalian pada
tunai). Tes kasus 2 membandingkan langsung ringkasan & rekap metode kasir
dengan endpoint Owner untuk outlet + rentang yang sama.

### 2.2 Urutan baris

| Laporan | Urutan | Alasan |
|---|---|---|
| Transaksi **Owner** (cetak/Excel) | `created_at ASC, invoice_no ASC` | berkas cetak dibaca berurutan dari atas |
| Transaksi **Kasir** (layar/Excel) | **`created_at DESC, invoice_no DESC`** | daftar operasional: transaksi terbaru dulu |

---

## 3. Panel Kasir (tampilan)

Berkas: `apps/kasir/index.html`, `apps/kasir/src/app.js`,
`apps/kasir/src/api.js`, `apps/kasir/src/struk-share.js`.

- **Tab baru** `data-tab="laporan"` di `#main-tabs` **dan** butir
  "Laporan Transaksi" di menu **Lainnya** (sekaligus butir bilah bawah HP —
  `BOTTOM_NAV` tidak berubah, pane ini melewati "Lainnya").
- `PAGE_INFO.laporan = ['Laporan Transaksi', 'Riwayat transaksi outlet Anda (satu baris per transaksi)']`.
- Filter: `#lap-range` (Hari ini/Kemarin/7 hari/Bulan ini/Kustom),
  `#lap-date` (mode kustom), `#lap-status`
  (Selesai/Dibatalkan/Refund), `#lap-search` (cari nomor transaksi),
  `#lap-refresh-btn`, `#lap-export-btn`.
- Kartu ringkasan `#lap-summary`: **Total omzet**, **Rata-rata/transaksi**,
  **Dibatalkan (void)**, **Nilai void**.
- Tabel `#lap-body` satu baris per transaksi: No · Nomor Transaksi · Waktu
  (tanggal + jam) · Item (qty) · Total · Metode · Kasir · Status.
- `#lap-methods` = ringkasan metode satu baris (`Metode: Tunai Rp 40.000 • …`),
  `#lap-note` = peringatan bila data **terpotong**.
- Semua angka & label status diambil dari respons server; klien **tidak**
  menghitung ulang (hanya format `fmtIDR`).

### 3.1 Ekspor Excel (web **dan** APK)

```js
const { bytes, filename } = await api.transactionsReportFile(laporanQuery());  // biner dari server
const saved = await strukShare.saveXlsx({ bytes, base64: bytesToBase64(bytes), filename });
```

- **Web/PWA:** `strukShare.saveXlsx` → unduhan blob (`downloadFile`).
- **APK Android:** plugin `NovaReceipt.save` (turunan `Capacitor`) menyimpan
  berkas ke perangkat/layanan berbagi — **tanpa kode Android baru**. Bila
  plugin lama tidak punya `save`, dipakai `share`.
- `api.js` mendapat `requestFile()` tersendiri (autentikasi + refresh 401 sama
  seperti `request()`) karena isi respons **biner** tidak boleh diparse JSON.

---

## 4. Berkas Excel (`report/xlsx.js`)

`buildCashierTransactionReportWorkbook({ business, report, filters, generatedAt })`
— **3 sheet** (sengaja **tanpa** Produk Terlaris, konsekuensi keputusan B1):

| Sheet | Isi |
|---|---|
| **Ringkasan** | Nama bisnis, Outlet, Periode, Dicetak, Status, jumlah transaksi, total omzet (Rp), rata-rata, item (qty), void, dan peringatan **TERPOTONG** bila `limit` terpakai |
| **Daftar Transaksi** | Header + **satu baris per transaksi** + baris **TOTAL** (qty & omzet) |
| **Rekap Metode Pembayaran** | Metode, transaksi, omzet, persentase (`numFmt '0.0%'`) + TOTAL |

Nama berkas: `KASIR_NOVA_Laporan_Transaksi_Kasir_<from>_sampai_<to>.xlsx`
(dibuat server, dipakai apa adanya oleh APK/web).

---

## 5. Bug lama yang ditemukan & diperbaiki

Tes baru `struk-share` menyingkap **bug nyata** di `apps/kasir/src/struk-share.js`:

```js
const blob = new root().Blob([bytes], { type: mime });   // ❌ "root is not a constructor"
```

JS memparsing baris itu sebagai `new (root())` sehingga **selalu gagal** —
artinya jalur **unduh struk PDF di web/PWA** (fallback tanpa Web Share) tidak
pernah berfungsi; jalur APK (plugin native) tidak terpengaruh sehingga tidak
terlihat. Perbaikan (pola sama seperti `pdfFile()`):

```js
const BlobCtor = root().Blob;
if (typeof BlobCtor !== 'function') return { ok: false, reason: 'no_download' };
const blob = new BlobCtor([bytes], { type: mime });
```

`verify-ui.mjs` kini **menolak** pola `new root().X(...)` agar tidak kembali.
(fungsi `downloadPdf` dipertahankan sebagai pembungkus tipis `downloadFile`.)

---

## 6. Pengujian

| Perintah (dari `server/`) | Hasil |
|---|---|
| `node --test tests/cashier-report-transactions.test.js` | **10/10 lulus** |
| `node --test tests/struk-pdf.test.js` | **15/15 lulus** (3 kasus baru berkas Excel) |
| `node --test "tests/**/*.test.js"` | **291/291 lulus** (~239 detik) |
| `node scripts/verify-ui.mjs` (dari root) | **SEMUA OK** |

Kasus uji kasir dijelaskan satu per satu di `docs/16` §Pengujian. Yang paling
penting: (1) satu baris per transaksi, (2) angka identik dengan laporan Owner,
(3) isolasi outlet + `outletId` diabaikan, (4) bawaan hari ini, (9) berkas
`.xlsx` di-*parse balik* dengan ExcelJS (3 sheet, baris TOTAL, format persen).

Fixture tes membuat **outlet kedua** untuk bisnis yang sama lewat SQL langsung
(kuota paket "Gratis" = 1 outlet adalah **aturan produk** yang tidak boleh
diubah; tes butuh dua outlet untuk membuktikan isolasi).

---

## 7. Pengunci regresi (`scripts/verify-ui.mjs`)

Bagian **"laporan transaksi kasir (17 Okt 2026)"** memeriksa:

- `index.html`: `data-pane="laporan"`, `data-tab="laporan"`, `#lap-summary`,
  `#lap-body`, `#lap-range`, `#lap-status`, `#lap-search`, `#lap-export-btn`,
  `#lap-note`;
- `app.js`: `api.transactionsReport(`, `api.transactionsReportFile(`,
  `strukShare.saveXlsx(`, `laporan: ['Laporan Transaksi'`,
  `TX_STATUS_LABELS`, `loadReportTransactions`;
- `api.js`: kedua path `/api/cashier/reports/transactions[/export]`;
- `struk-share.js`: `saveFile`, `saveXlsx`, `XLSX_MIME`;
- rute & controller kasir: kedua path, kedua skema, `outletId: scope.outlet_id`,
  `resolveFinanceRange(scope.timezone`;
- service & skema: `cashierTransactionReport`,
  `exportCashierTransactionReportXlsx`, kedua skema kasir;
- **negatif 1:** blok skema kasir **tidak boleh** memuat `outletId`/`cashierId`;
- **negatif 2:** `struk-share.js` **tidak boleh** memakai `new root().X(...)`.

---

## 8. Status

**Kode & pengujian: selesai (lokal).** Belum ada perubahan produksi yang
dilakukan oleh agent untuk fitur ini.

Yang **masih tertunda di sisi pemilik** (tidak dapat dikerjakan agent):

1. Uji langsung di panel Kasir: rentang, filter status, pencarian, dan tombol
   **Ekspor Excel** (buka berkas dengan Excel/Google Sheets — 3 sheet).
2. Uji di **APK**: tombol ekspor memakai plugin `NovaReceipt`. Karena panel
   kasir di APK memuat berkas JS lokal, fitur ini **baru ikut** setelah APK
   dibangun ulang (beta.9) — **menunggu persetujuan** pemilik.
3. Penyebaran ke produksi (backend + hosting) — **menunggu persetujuan** pemilik.
