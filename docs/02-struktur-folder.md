# KASIR NOVA — Struktur Folder

> Monorepo. Satu repo berisi backend, 3 area aplikasi frontend, dan package
> bersama. Alasan: satu backend + DB terpusat, sehingga berbagi kode lebih
> mudah dan satu CI cukup.

```
nova-kasir/
├── docs/                     # Dokumentasi arsitektur & rencana
│   ├── 01-arsitektur.md
│   ├── 02-struktur-folder.md
│   ├── 03-model-data.md
│   ├── 04-matriks-hak-akses.md
│   ├── 05-roadmap.md
│   ├── 06-keamanan-dan-infrastruktur.md
│   └── 07-file-yang-dibuat.md
│
├── server/                   # Backend Node.js + Express (satu-satunya API)
│   ├── src/
│   │   ├── app.js            # Inisialisasi Express + middleware
│   │   ├── server.js         # Entry point (bind port)
│   │   ├── config/
│   │   │   ├── env.js        # Baca & validasi .env (wajib ada saat start)
│   │   │   └── db.js         # Konfigurasi connection pool
│   │   ├── db/
│   │   │   ├── pool.js       # pg.Pool singleton
│   │   │   ├── migrate.js    # Runner migrasi
│   │   │   ├── seed.js       # Seed (hanya dev; tidak untuk produksi)
│   │   │   └── migrations/   # File SQL terlacak (timestamped)
│   │   ├── middleware/
│   │   │   ├── auth.js       # Verifikasi JWT + muat sesi peran
│   │   │   ├── tenant.js     # Inject business_id & cek akses tenant
│   │   │   ├── validate.js   # Validasi body/query/param via zod
│   │   │   ├── error.js      # Penangan error terpusat
│   │   │   └── rateLimit.js  # Pembatasan request
│   │   ├── modules/          # Satu folder per modul (vertikal)
│   │   │   ├── auth/
│   │   │   ├── platform-admin/
│   │   │   ├── owner/
│   │   │   ├── business/
│   │   │   ├── outlet/
│   │   │   ├── cashier/
│   │   │   ├── product/
│   │   │   ├── transaction/
│   │   │   ├── report/
│   │   │   ├── subscription/
│   │   │   └── audit/
│   │   └── utils/            # hash password, token, logger, dll.
│   ├── tests/                # Unit + integrasi (Vitest + Supertest)
│   ├── .env.example          # Template env (TANPA nilai rahasia)
│   └── package.json
│
├── apps/                     # 3 area aplikasi terpisah (build & hak akses beda)
│   ├── admin/                # Panel Admin Platform
│   │   ├── index.html
│   │   ├── src/ (main.js, router, views, api-client)
│   │   └── styles/
│   ├── owner/                # Panel Owner (multi-bisnis, outlet, kasir, laporan)
│   │   └── (struktur sama)
│   └── kasir/                # Aplikasi Kasir (POS, 1 outlet)
│       ├── index.html
│       ├── src/ (app.js, escpos.js, printer.js, dll.)
│       └── styles/
│   └── kasir-mobile/         # Pembungkus Capacitor panel Kasir → APK Android
│       ├── capacitor.config.json
│       ├── scripts/ (build-www.mjs, setup-android.mjs)
│       ├── android-templates/ (MainActivity.java, NovaPrinterPlugin.java)
│       └── android/          # dihasilkan `cap add android` (tidak di-commit)
│
├── packages/                 # Kode yang dipakai bersama server & 3 apps
│   └── shared/
│       ├── src/
│       │   ├── constants.js  # Peran, status, nominal format (IDR)
│       │   ├── validation.js # Skema zod bersama (endpoint & form)
│       │   └── utils.js      # Format rupiah, tanggal, dll.
│       └── package.json
│
├── scripts/                  # Skrip operasional (install PG, backup, dll.)
├── .gitignore                # Abaikan node_modules, .env, dist, log
├── .env.example              # Contoh variabel lingkungan root
├── package.json              # Root workspace (npm workspaces)
└── README.md                 # Cara setup & jalankan
```

## Alasan pemisahan

- **`server/modules/*` vertikal:** setiap modul punya routes, controller,
  service, repository sendiri. Mengikuti 12 modul yang diminta; modul baru
  tidak menyentuh modul lain.
- **`apps/*` terpisah:** antarmuka & hak akses Owner ≠ Kasir ≠ Admin.
  Build terpisah mencegah kode Kasir ikut dimuat di bundle Admin.
- **`packages/shared`:** format IDR, konstanta peran, dan skema validasi
  dipakai ulang oleh server dan semua apps sehingga aturan tidak menyimpang.
- **`migrations/` SQL murni terlacak:** setiap perubahan skema tercatat di git
  dan bisa di-rollback, bukan skema hasil desain manual.
