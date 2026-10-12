# KASIR NOVA — Backup & Restore PostgreSQL

> Memenuhi kriteria Fase 12 roadmap: *"Skrip backup/restore PostgreSQL
> terjadwal (`pg_dump`/`pg_restore`)"* dan *"backup teruji bisa direstore"*.

## Berkas

| Berkas | Fungsi |
|---|---|
| `scripts/lib-nova-db.ps1` | Helper kredensial (baca `server/.env` → `DATABASE_URL`, atau `$env:NOVA_DB_PASSWORD`). Tidak mencetak password. |
| `scripts/backup-db.ps1` | `pg_dump` format custom (`-Fc`, terkompresi) + verifikasi arsip (`pg_restore --list`) |
| `scripts/restore-db.ps1` | `pg_restore` ke database **baru** `<db>_restore` (aman; tidak menimpa DB kerja kecuali `-Force`) |

## Backup

```powershell
npm run db:backup
# atau:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-db.ps1
```

- Output: `backups\<db>_<yyyyMMdd-HHmmss>.dump` (+ `.dump.ok` bila verifikasi lolos).
- `backups/` sudah di-`.gitignore`.
- Opsi: `-OutDir <dir>`, `-Plain` (SQL teks `.sql`), `-Port`, `-Database`, `-User`.

Contoh jadwal (Windows Task Scheduler) — harian 02:00:

```powershell
schtasks /Create /SC DAILY /ST 02:00 /TN "NOVA Backup DB" ^
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"D:\NOVA PROJECT (RIDWAN)\scripts\backup-db.ps1\""
```

## Restore (drill / uji)

```powershell
npm run db:restore -- -Dump backups\nova_kasir_dev_20261012-184714.dump
# -> membuat database nova_kasir_dev_restore, lalu melaporkan jumlah tabel & migrasi
```

Menimpa DB tertentu (**HATI-HATI**):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-db.ps1 `
  -Dump <file.dump> -TargetDb nova_kasir_dev -Force
```

## Hasil uji restore (12 Okt 2026)

Backup `nova_kasir_dev` → restore ke `nova_kasir_dev_restore` → bandingkan
jumlah baris seluruh tabel:

| Tabel | dev | restore |
|---|---|---|
| schema_migrations | 8 | 8 |
| platform_admins | 1 | 1 |
| owners | 1 | 1 |
| audit_logs | 183 | 183 |
| refresh_tokens | 37 | 37 |
| subscription_plans | 1 | 1 |
| (11 tabel lain: businesses, outlets, cashiers, product_categories, products, product_stocks, transactions, transaction_items, payments, outlet_invoice_counters, subscriptions) | 0 | 0 |

**Kesimpulan: 17/17 tabel cocok — backup valid & restorable.** DB drill
dihapus setelah pengujian.

## Catatan produksi (Cloud SQL)

- Jadwalkan backup otomatis **Cloud SQL** (Automated backups + PITR) sebagai
  lapisan utama; skrip di atas untuk backup manual/drill.
- Simpan salinan dump di luar instance (mis. Cloud Storage dengan lifecycle).
- Uji restore berkala ke instance/database terpisah — jangan ke produksi.
