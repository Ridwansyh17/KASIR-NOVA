# KASIR NOVA — Dokumen Arsitektur

> Versi: 1.0 | Tanggal: 2026-10-10 | Status: DRAFT — menunggu persetujuan

## 1. Ringkasan Produk

Aplikasi Point of Sale (POS) berbasis web untuk berbagai jenis usaha, dengan
tiga area aplikasi yang berbagi **satu backend dan satu database terpusat**:

| Area | Pengguna | Cakupan |
|---|---|---|
| **Admin Platform** | Admin Platform | Membuat & mengelola akun Owner, pengawasan platform |
| **Owner** | Pemilik usaha | Multi-bisnis, outlet, kasir, produk, laporan, langganan |
| **Kasir** | Staff outlet | Transaksi penjualan di **satu outlet** saja |

## 2. Prinsip Arsitektur

1. **Multi-tenant dengan isolasi baris.** Setiap tabel bisnis membawa
   `business_id`. Setiap endpoint server **wajib** memverifikasi bahwa data
   yang diakses milik `business_id` dari sesi yang sedang aktif.
2. **Satu sumber kebenaran.** Seluruh transaksi penting disimpan persisten di
   PostgreSQL. **Tidak ada** penyimpanan transaksi di array memori (browser
   maupun server) sebagai sumber utama.
3. **Server sebagai penegak otoritas.** Validasi input dan otorisasi
   dilakukan di server untuk **setiap** operasi penting. Frontend hanya
   membantu UX, tidak pernah menjadi pengaman tunggal.
4. **Tenant-aware di tiap lapisan.** Query selalu difilter `business_id`;
   ditambah Row Level Security (RLS) PostgreSQL sebagai lapisan pertahanan
   kedua.
5. **Tidak ada akun admin publik.** Admin Platform dibuat lewat mekanisme
   khusus (seeding terkontrol / endpoint internal terproteksi), **bukan**
   endpoint pendaftaran publik.

## 3. Diagram Arsitektur Tinggi

```
┌─────────────────────────────────────────────────────────────┐
│                        KLIEN                                 │
│  apps/admin   apps/owner   apps/kasir      (Web saja; bukan APK) │
│  HTML+CSS+JS  HTML+CSS+JS  HTML+CSS+JS    Firebase Hosting        │
└──────────────┬──────────────────────────────────────────────┘
               │  HTTPS / REST + JSON
               │  Authorization: Bearer <access token>
               ▼
┌─────────────────────────────────────────────────────────────┐
│               BACKEND (Node.js + Express)                    │
│                                                              │
│  Middleware:  CORS → Helmet → RateLimit → Auth → Tenant →    │
│               Validate → Error                               │
│                                                              │
│  Modul:  auth · platform-admin · owner · business · outlet · │
│          cashier · product · transaction · report ·          │
│          subscription · audit                                │
│                                                              │
│  Lapisan:  routes → controller → service → repository         │
└──────────────┬──────────────────────────────────────────────┘
               │  pg (connection pool)
               ▼
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL (terpusat)                      │
│   skema pub + RLS policy (business_id)                       │
│   migrasi terlacak (node-pg-migrate)                         │
└─────────────────────────────────────────────────────────────┘
```

## 4. Autentikasi & Sesi

- **Skema:** Access token (JWT, umur pendek ~15 menit) + Refresh token
  (umur panjang, **dirotasi** pada setiap pemakaian).
- **Pencabutan:** Refresh token disimpan di tabel `refresh_tokens`
  (disimpan sebagai **hash**, bukan plain). Logout / pencabutan mengubah
  status baris menjadi `revoked`, sehingga token lama langsung tidak valid.
- **Hash password:** `scrypt` bawaan Node (`node:crypto`) — **tanpa
  dependency native**, aman untuk Windows dan hemat RAM.
- **Rate limiting** pada endpoint login untuk mencegah brute force.
- **Jenis token** dibedakan per peran (`platform_admin` / `owner` /
  `cashier`) agar tidak bisa saling dipakai.

## 5. Pemisahan Area Aplikasi

Ketiga area adalah **build terpisah** dengan antarmuka dan hak akses
berbeda, sesuai aturan produk:

```
apps/admin   →  prefix URL /admin   →  hanya bisa login sbg platform_admin
apps/owner   →  prefix URL /owner   →  hanya bisa login sbg owner
apps/kasir   →  prefix URL /kasir   →  hanya bisa login sbg cashier
                                       (sesi terkunci ke satu outlet)
```

Backend memvalidasi kecocokan jenis token dengan area yang diakses.

## 6. Batasan Domain (tidak boleh dilanggar)

| Aturan | Penegakan Teknis |
|---|---|
| 1 Owner ↔ banyak bisnis | `businesses.owner_id` (FK ke `owners`) |
| Admin Platform kelola Owner | hanya modul `platform-admin` |
| Owner kelola Kasir | modul `owner` + cek kepemilikan |
| **1 Kasir = 1 outlet** | `cashiers.email` UNIQUE + `outlet_id` NOT NULL; satu baris = satu outlet |
| Langganan per bisnis | `subscriptions.business_id` UNIQUE (aktif); status satu bisnis tidak menular |
| Owner banyak outlet per bisnis | `outlets.business_id`, batas dari `subscription_plans.max_outlets` |
| UI & hak akses berbeda | 3 build frontend terpisah + penegakan di server |
| Panel Admin Platform terpisah | area `/admin` + jenis token khusus |
| Transaksi persisten | DB transaction (BEGIN/COMMIT) + row lock pada stok |
| Distribusi klien | **Web via Firebase Hosting** (keputusan 11 Okt 2026); tidak ada APK/Capacitor |


## 7. Modul Ditangguhkan (dirancang terpisah, ikut setelahnya)

Sesuai instruksi, dua hal ini **bukan** bagian fase awal dan dirancang sebagai
modul pluggable agar integrasi tidak mengganggu inti:

- **Metode pembayaran digital & gateway** — abstraksi `PaymentProvider`
  (interface `charge / refund / status`). Sekarang hanya tunai (cash) yang
  diimplementasikan; kartu/QR/wallet diisi setelah penyedia ditetapkan.
- **Perpanjangan langganan otomatis** — tabel `subscription_payments`
  dan job penagihan terpisah. Sekarang langganan dicatat manual oleh Admin
  Platform.

## 8. Catatan Teknologi (dan alasannya)

| Pilihan | Alasan |
|---|---|
| Node.js + Express | Sesuai stack yang ditetapkan; ringan di RAM terbatas |
| PostgreSQL | DB utama sesuai stack; RLS mendukung isolasi tenant |
| `pg` (node-postgres) | Driver resmi, ringan, connection pool bawaan |
| `node-pg-migrate` | Migrasi SQL murni terlacak; jejak kecil |
| `zod` | Validasi input + inferensi tipe, tidak ada dependency native |
| `scrypt` (node:crypto) | Hash password tanpa build native (Windows aman) |
| `helmet`, `cors`, `express-rate-limit` | Standar keamanan HTTP, ringan |
| Vitest + Supertest | Unit & integrasi cepat; jejak RAM kecil |
| Vanilla HTML/CSS/JS modular | Sesuai stack; tidak butuh bundler berat saat dev |

> **Catatan lingkungan:** mesin adalah Windows 10 Pro, RAM bebas ~1.87 GB.
> Pilihan di atas sengaja menghindari dependency native (bcrypt/argon2)
> dan Docker agar tidak membebani sistem.
