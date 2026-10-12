# KASIR NOVA — Deploy Backend ke Cloud Run + Cloud SQL

> **Status: BELUM DI-DEPLOY.** Keputusan pemilik 12 Okt 2026: **tetap paket
> Spark (gratis), tanpa backend publik.** Dokumen ini disimpan sebagai runbook
> untuk dipakai **bila kelak** beralih ke Blaze.
>
> Backend = Node.js/Express (`server/`) + PostgreSQL. Dipilih **Cloud Run**
> (bukan Firebase Functions) karena Express bersifat long-lived dan memakai
> connection pool PostgreSQL.
>
> ❌ **Cloudflare tidak dipakai** sebagai proxy/hosting/DNS/dependency deploy.

---

## 1. Prasyarat (tindakan pengguna)

| # | Prasyarat | Status saat ini |
|---|---|---|
| 1 | `gcloud` CLI terpasang & `gcloud auth login` | ❌ belum terpasang |
| 2 | `docker` lokal (opsional; Cloud Build bisa tanpa docker lokal) | ❌ belum terpasang |
| 3 | Project GCP dgn **billing AKTIF** (Cloud Run + Cloud SQL berbayar) | ⏳ perlu persetujuan |
| 4 | `cloud-sql-proxy` (untuk migrasi/seed pertama) | ⏳ menyusul |

> **Jangan** mengaktifkan billing / membuat resource berbayar tanpa persetujuan
> eksplisit pemilik proyek.

---

## 2. Berkas yang sudah disiapkan

| Berkas | Fungsi |
|---|---|
| `server/Dockerfile` | image multi-stage, non-root, `NODE_ENV=production` |
| `.dockerignore` (root) | kecualikan `.env`, `node_modules`, `.git`, dsb. dari build context |
| `cloudbuild.yaml` | build → push Artifact Registry → deploy Cloud Run |
| `scripts/deploy-gcp.ps1` | orkestrasi: enable API, Artifact Registry, Cloud SQL, Secret Manager, build & deploy |
| `server/.env.production.example` | contoh env produksi (tanpa nilai asli) |

Data sensitif (DATABASE_URL, JWT) **hanya** lewat **Secret Manager** — tidak
ditulis di berkas repo.

---

## 3. Deploy (setelah prasyarat terpenuhi)

```powershell
# login & pilih project
gcloud auth login
pwsh -File scripts/deploy-gcp.ps1 -ProjectId "<PROJECT_ID>"
```

Skrip membuat: Cloud SQL (Postgres 16, tier `db-f1-micro`), Artifact Registry,
3 secret (`nova-db-url`, `nova-jwt-access`, `nova-jwt-refresh`), lalu men-deploy
service `nova-server` dan mencetak **URL Cloud Run**.

Variabel penting: `-Region` (default `us-central1`), `-ServiceName`
(default `nova-server`), `-DbInstance` (default `nova-db`).

---

## 4. Migrasi & seed database (sekali, lewat proxy)

Cloud Run tidak boleh menjalankan seed otomatis. Lakukan sekali dari lokal:

```powershell
# Terminal 1 — buka proxy ke Cloud SQL
cloud-sql-proxy "<PROJECT_ID>:<REGION>:<DB_INSTANCE>"

# Terminal 2 — arahkan DATABASE_URL lokal ke 127.0.0.1:5432
#   (password DB ada di Secret Manager: nova-db-url)
$env:DATABASE_URL="postgresql://nova_app:<PASSWORD>@127.0.0.1:5432/nova_kasir_prod"
npm run db:migrate
npm run db:seed     # butuh SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
```

---

## 5. Menyambungkan ke Firebase Hosting

1. Widget Cloud Run service: `nova-server` (project yang sama dengan Hosting).
2. **Tambahkan** rewrite `/api/**` dengan blok `run` di `firebase.json`
   (urutan pertama), **bukan** URL eksternal:
   ```json
   "rewrites": [
     { "source": "/api/**", "run": { "serviceId": "nova-server", "region": "us-central1" } },
     { "source": "/admin/**", "destination": "/admin/index.html" },
     { "source": "/owner/**", "destination": "/owner/index.html" },
     { "source": "/kasir/**", "destination": "/kasir/index.html" }
   ]
   ```
3. Build & deploy hosting:
   ```powershell
   node scripts/build-hosting.mjs        # base kosong = same-origin
   firebase deploy --only hosting
   ```

---

## 6. Verifikasi

```powershell
# health via Hosting (same-origin)
Invoke-RestMethod https://kasir-nova.web.app/api/health   # {status:"ok"}
```

Kriteria lolos:
- `GET /api/health` → `200 {status:"ok"}` (tanpa data sensitif).
- Login owner/kasir via Hosting berhasil.
- Isolasi tenant & validasi langganan tetap berlaku (suite 159 tes lokal lulus).

---

## 7. Rollback

| Skenario | Tindakan |
|---|---|
| Backend bermasalah | `gcloud run services update-traffic nova-server --to-revisions=<REV_SEBELUMNYA>=100` |
| `/api/**` salah | Hapus entry rewrite `/api/**` di `firebase.json`, `firebase deploy --only hosting` |
| Konfigurasi hosting | Pulihkan `firebase.json.backup-*` |

---

## 8. Catatan paket Firebase

Integrasi Hosting → Cloud Run (blok `rewrites[].run`) dan Cloud Functions
(blok `rewrites[].function`) **memerlukan paket Blaze**. Pada **Spark tidak
tersedia**.

> ⚠️ `rewrites[].destination` **hanya** menerima **berkas lokal** — menulis URL
> eksternal (`https://...`) di `destination` **tidak didukung** (akan gagal /
> diabaikan). Gunakan blok `run`/`function`, bukan URL.
