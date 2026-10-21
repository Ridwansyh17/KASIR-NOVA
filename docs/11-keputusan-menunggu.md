# KASIR NOVA — Keputusan Menunggu (Pending Decisions)

> Dokumen ini mencatat pertanyaan/keputusan bisnis yang **belum** diputuskan
> pemilik proyek dan **menahan** pekerjaan fase tertentu. Jangan dihapus.
> Diarsipkan dari percakapan agar tidak hilang saat sesi baru.

## Status: ⏸ PAUSED — menunggu jawaban (disimpan 11 Okt 2026)

Pemilik proyek meminta pertanyaan ini **disimpan** dan dilanjutkan nanti siang.
**Fase 3 (Owner & Multi-Bisnis) sudah SELESAI** dan tidak menunggu apa pun;
yang ditahan adalah mulai implementasi **Fase 4**.

---

## Keputusan yang SUDAH disepakati (arsip — jangan tanya ulang)

| # | Pertanyaan | Jawaban | Dipakai di |
|---|---|---|---|
| 1 | Bisnis baru: langsung dapat langganan (trial) otomatis, atau dibuat tanpa langganan dulu? | **Dibuat bebas tanpa langganan otomatis** — langganan diatur di fase subscription. | Fase 3 (implementasi `businesses`, `createBusiness`) |
| 2 | Field `business_type`: teks bebas atau daftar pilihan? | **Teks bebas.** | Fase 3 (kolom `business_type TEXT`) |
| 3 | Akses AI ke model `opencode/big-pickle` untuk sesi ini? | Tidak dijawab — tidak memblokir apa pun; hanya konfigurasi tooling. | — |

---

## KEPUTUSAN MENUNGGU #1 — Gerbang pembuatan Outlet (menahan Fase 4)

**✅ DIPUTUSKAN 11 Okt 2026 — OPSI A (Plan default otomatis).**

**Konteks.** Fase 4 (Outlet & Batas Langganan) mensyaratkan: *membuat outlet
melebihi batas plan **ditolak** server*. Karena bisnis baru dibuat tanpa
langganan (keputusan #1), perlu diputuskan bagaimana perlakuan bisnis yang
**belum punya langganan** saat Owner mencoba membuat outlet.

**Opsi (belum dipilih):**
- **A. Plan default otomatis (disarankan):** saat bisnis dibuat, otomatis
  diberi plan default "Gratis" (mis. `max_outlets=1`, `max_cashiers=1`, harga 0,
  durasi 30 hari). Batas aktif sejak awal → kriteria Fase 4 langsung teruji.
  Admin tetap bisa mengubah plan/maksimum nanti.
- **B. Diblokir sampai ada langganan:** bisnis tanpa langganan **tidak bisa**
  membuat outlet; menunggu Admin memasang langganan. Paling ketat; uji
  "melebihi batas" baru berjalan setelah data langganan ada.
- **C. Tanpa batas (bebas):** pembatasan `max_outlets` ditunda ke Fase 10
  bersama modul langganan penuh.

**Catatan terkait yang sudah pasti (model data `docs/03-model-data.md`):**
- `subscriptions`: UNIQUE (`business_id`) + status aktif ⇒ **maksimal 1
  langganan aktif per bisnis**; status satu bisnis tidak menular ke bisnis lain
  (kriteria uji Fase 4).
- `subscription_plans`: `name, max_outlets, max_cashiers, price, duration_days,
  features` — dikelola **Admin Platform** (matriks: kelola plans ✅ A).

---

## KEPUTUSAN MENUNGGU #2 — Detail transaksi penjualan (menahan Fase 7)

**✅ DIPUTUSKAN 11 Okt 2026** (dijawab via tool pertanyaan). Tidak ada lagi
item yang menahan Fase 7.

| Aspek | Keputusan |
|---|---|
| **Pajak** | Konfigurasi **per outlet**: `tax_rate` (sudah ada) + flag `tax_inclusive` (baru). Eksklusif = pajak ditambahkan; inklusif = harga sudah termasuk pajak (porsi pajak dipisahkan di hitungan). Snapshot tarif disimpan di transaksi. |
| **Diskon** | **Per transaksi** (bukan per item): **persen** (maks 100) atau **nominal** (sen). Diterapkan **sebelum pajak**. Kasir **tanpa batas nominal** (kontrol aturan diskon utuh oleh Owner/rencana lanjutan). |
| **Void** | Hanya oleh **Owner**. Otomatis **mengembalikan stok** ke outlet. Status `voided`, dicatat `voided_by`/`voided_at` + audit. |
| **Pembayaran** | **Tunai** (boleh lebih → kembalian) + **kartu/QR/wallet dicatat manual** (tanpa gateway pembayaran). **Satu pembayaran per transaksi**; split pembayaran = fase lanjut. |
Catatan implementasi: semua nominal disimpan dalam **sen (BIGINT)**; server
menghitung ulang harga/total dari katalog (harga tidak bisa di-override kasir);
anti-duplikasi dengan `client_ref` unik per outlet.

---

## KEPUTUSAN MENUNGGU #3 — PIN Login Kasir (dikerjakan sebelum Fase 11)

**✅ DIPUTUSKAN 11 Okt 2026** (dijawab via tool pertanyaan) — dikerjakan sebagai
**Fase 10b** dan sudah selesai.

| Aspek | Keputusan |
|---|---|
| **Format PIN** | **4 digit** angka. |
| **Keunikan PIN** | **Boleh sama** antar kasir — alur pilih kartu kasir di layar, lalu PIN hanya memverifikasi identitas yang dipilih. |
| **Lockout** | **5× salah → kunci sementara 15 menit** (`pin_locked_until`); **10× salah → status `locked`** (perlu unlock Owner). |
| **Status PIN vs password** | **PIN opsional** — password tetap ada; Owner pasang/hapus PIN per kasir. |

---

## KEPUTUSAN MENUNGGU #4 — Pembayaran langganan via payment gateway

**✅ DIPUTUSKAN 17 Okt 2026** (dijawab pemilik proyek lewat tool pertanyaan) —
dikerjakan sebagai fitur "Pembayaran Langganan (gateway sandbox)":
lihat **`docs/38-pembayaran-langganan-gateway.md`**.

| Aspek | Keputusan |
|---|---|
| Penyedia & mode | **Duitku, SANDBOX** (produksi belum) |
| Bentuk tagihan | **API inti per kanal** (VA/QRIS: `/v2/inquiry`), bukan halaman Snap |
| Siapa yang membayar | **Owner self-service** di panel Owner (pilih paket + kanal) |
| Aktivasi | Setelah pembayaran **sukses** (callback bertanda tangan) — pola sama dengan Admin memasang paket |
| `auto_renew` | Tetap **`false`** (belum ada penagihan otomatis) |
| Kredensial | Diisi **pemilik proyek** di `server/.env`/Vercel — tidak pernah di-commit/paste di chat |
| Uji webhook | **Lokal dulu**, lalu minta izin bila perlu deploy backend |
| Lingkup | **Hanya langganan**; pembayaran penjualan kasir tetap manual |
| APK | Rilis APK **ditahan** atas permintaan pemilik ("jangan rilis dulu") |

---

## KEPUTUSAN MENUNGGU #5 — "Ubah sandi sendiri" tidak ada (klaim dokumen vs kenyataan)

**✅ DIPUTUSKAN 20 Okt 2026 — OPSI A (fitur ganti sandi sendiri), diimplementasikan.**

**Konteks.** `docs/04-matriks-hak-akses.md` § 1 mengklaim "Mengubah password
sendiri ✅" untuk **ketiga** peran. Setelah diperiksa ke kode: **tidak ada**
endpoint `.../password` untuk diri sendiri, dan **tidak ada** UI "ganti sandi"
di panel Admin/Owner/Kasir. Yang ada hanya:
- Admin mereset sandi Owner (`POST /api/platform/owners/:id/password`),
- Owner mereset sandi Kasir (`.../cashiers/:cashierId/password`),
- Admin lewat CLI `npm run admin:password`.

Dokumen sudah dikoreksi agar jujur. Akibat praktis: pemilik **tidak bisa**
mengganti sandi akun Admin-nya sendiri dari aplikasi (harus lewat CLI).

**Keputusan.** Opsi **A** — fitur ganti sandi sendiri untuk ketiga peran:
`POST /api/auth/change-password` (verifikasi sandi lama, minimal 8 karakter,
berbeda dari sandi lama, **mencabut semua sesi lain** di server dalam satu
transaksi, sesi perangkat yang dipakai tetap berlaku via `refreshToken`
opsional, audit `auth.change_password` tanpa menyimpan sandi) + form
**Ganti Sandi** di panel Admin, Owner, dan Kasir (`passwordLimiter`
10/IP/15 menit). Kontrak API: `docs/08-api-auth.md`; tes:
`server/tests/change-password.test.js` (8 kasus).

**Catatan terkait:** demi kemudahan pemakaian, ketiga panel kini juga
memiliki **tombol lihat/sembunyikan sandi** pada semua input sandi (login,
ganti sandi, PIN) — `shared/pw-toggle.js`. Lihat entri roadmap 20 Okt 2026.

---

## KEPUTUSAN MENUNGGU #6 — Migrasi 0011 "Setoran Kas" yang menggantung

**✅ DIPUTUSKAN 19 Okt 2026** — dijadikan **fitur nyata** dan diimplementasikan.

**Konteks.** `0011_cash_deposits.sql` ditemukan sudah diterapkan di DB dev dan
ada di disk, tetapi **tidak di-track Git** dan **tanpa kode/doc** — sumber
ketidaksesuaian database vs source.

**Keputusan.** Diimplementasikan sebagai modul **Setoran Kas** (uang tunai
kasir → Owner), append-only (koreksi via void), tidak memengaruhi laba/rugi.
Lihat **`docs/40-setoran-kas.md`**. Sisa lingkup (UI frontend, metode non-tunai,
integrasi laporan) menyusul sebagai pekerjaan terpisah.

---

## KEPUTUSAN MENUNGGU #7 — Penyimpanan gambar/foto produk (21 Okt 2026)

**✅ DIPUTUSKAN 21 Okt 2026 — OPSI A: tetap data URL base64 di Postgres.**

| Aspek | Keputusan |
|---|---|
| Media | **Base64 data URL** di `products.photo_url` (batas ≈280 KB, divalidasi skema; klien mengecilkan JPEG di canvas) |
| Alternatif ditolak | Firebase Storage & S3-compatible — menambah biaya/kredensial, belum perlu untuk skala saat ini |

Tidak ada perubahan kode; kontrak lama tetap berlaku.

## KEPUTUSAN MENUNGGU #8 — Kanal pembayaran digital untuk penjualan kasir (21 Okt 2026)

**✅ DIPUTUSKAN 21 Okt 2026 — tetap MANUAL (sesuai keputusan #4 lingkup).**

Pembayaran kartu/QR/wallet pada penjualan kasir **tetap dicatat manual**
(satu pembayaran per transaksi). Integrasi Duitku **hanya untuk langganan**.
Bila nanti dibutuhkan, tambahkan kolom `payments.provider` + modul provider
baru (pola `server/src/payments/`).

## KEPUTUSAN MENUNGGU #9 — Perpanjangan langganan otomatis (21 Okt 2026)

**✅ DIPUTUSKAN 21 Okt 2026 — tetap MANUAL.**

`auto_renew` tetap `false`; tidak ada job penagihan otomatis. Perpanjangan
dilakukan Owner via gateway (Duitku) atau Admin Platform memasang paket.

## KEPUTUSAN MENUNGGU #10 — Nama aplikasi APK Owner (21 Okt 2026)

**✅ DIPUTUSKAN 21 Okt 2026 — nama aplikasi: "OWNER NOVA".**

| Aspek | Keputusan |
|---|---|
| Label di perangkat | **OWNER NOVA** (ikon peluncur + judul aplikasi) |
| App ID | tetap `id.kasirnova.owner` (tidak berubah — App ID tidak boleh diubah setelah rilis) |
| Rilis | `1.0.0-beta.2` (versionCode 2), Build `1g27chnasnkeo` |
| Ikon & splash | logo yang sama persis dengan panel Kasir (`-TargetApp owner-mobile`) |

Label sebelumnya "KASIR NOVA Owner" (rilis `1.0.0-beta.1`) tetap terarsip di
`dist/apk/`; APK beta.2 memakai keystore yang sama sehingga dapat menimpa
beta.1 di perangkat.

## Cara melanjutkan

Bila pemilik proyek menjawab Keputusan #1 (mis. "pilih A"), Fase 4 dapat
langsung dikerjakan: migrasi `outlets` + `subscription_plans` + `subscriptions`,
modul `outlet` (owner + tenant-check), modul `subscription` (admin), dan tes
termasuk uji negatif `max_outlets`.