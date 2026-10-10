# Instalasi PostgreSQL (Dev Lokal) — KASIR NOVA

> Panduan instalasi PostgreSQL **native tanpa hak admin** di Windows.
> Diperlukan untuk backend KASIR NOVA.

## Mengapa tanpa installer EDB?

Installer resmi EDB (`.exe`) **memerlukan hak Administrator**. Shell dev ini
berjalan sebagai user biasa (non-admin), sehingga installer tidak bisa
dijalankan tanpa UAC.

Solusi: gunakan **zip "full"** dari komunitas (PostgreSQL Portable) yang
berisi server lengkap (bin, lib, share, `postgres.bki`). Zip "binaries"
resmi EDB **hanya berisi client tools** — tidak ada direktori `share`, jadi
server tidak bisa start.

## Versi terpasang

| Item | Nilai |
|---|---|
| PostgreSQL | 16.1 (Windows x64) |
| Lokasi | `D:\postgresql-16.1-1-windows-x64-full\pgsql` |
| Data dir | `D:\pgdata` |
| Port | **5433** (non-default, hindari bentrok) |
| Database dev | `nova_kasir_dev` |
| User super | `postgres` |

## Konfigurasi (sudah diterapkan)

File `D:\pgdata\postgresql.conf`:

```
shared_buffers = 128MB      # disesuaikan RAM ~2GB bebas
max_connections = 20        # dev tidak butuh banyak
work_mem = 4MB
maintenance_work_mem = 32MB
listen_addresses = 'localhost'
port = 5433
```

File `D:\pgdata\pg_hba.conf`:

```
local   all   all                     trust
host    all   all   127.0.0.1/32      md5
host    all   all   ::1/128           md5
```

## Mengelola server

```cmd
D:\postgresql-16.1-1-windows-x64-full\pg-server.cmd start
D:\postgresql-16.1-1-windows-x64-full\pg-server.cmd stop
D:\postgresql-16.1-1-windows-x64-full\pg-server.cmd restart
D:\postgresql-16.1-1-windows-x64-full\pg-server.cmd status
```

Koneksi manual:

```cmd
set PGPASSWORD=<password_db_dev_anda>
"D:\postgresql-16.1-1-windows-x64-full\pgsql\bin\psql.exe" -h localhost -p 5433 -U postgres -d nova_kasir_dev
```

> Password DB dev hanya untuk pengembangan lokal, disimpan di `server/.env`
> (diabaikan git). Jangan tulis password literal di file yang di-commit.

## Catatan

- **Password DB dev hanya untuk pengembangan lokal**, disimpan di
  `server/.env` (diabaikan git). Jangan tulis password literal di file
  yang di-commit.
- Server dimulai sebagai proses user biasa (bukan Windows service) karena
  registrasi service butuh hak admin.
- `pgpass.conf` di `C:\Users\User\AppData\Roaming\postgresql\` menyimpan
  kredensial agar `psql`/`pg_ctl` tidak prompt. File ini TIDAK di-commit.
