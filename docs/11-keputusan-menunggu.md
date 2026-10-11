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

## Cara melanjutkan

Bila pemilik proyek menjawab Keputusan #1 (mis. "pilih A"), Fase 4 dapat
langsung dikerjakan: migrasi `outlets` + `subscription_plans` + `subscriptions`,
modul `outlet` (owner + tenant-check), modul `subscription` (admin), dan tes
termasuk uji negatif `max_outlets`.