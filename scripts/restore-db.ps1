<#
  Restore database KASIR NOVA dari berkas pg_dump (format custom).

  AMAN secara default: memulihkan ke database BARU bernama "<db>_restore"
  (tidak menimpa DB kerja). Untuk menimpa DB yang sudah ada, gunakan -Force
  secara eksplisit.

  Pemakaian (uji restore / drill):
    powershell -ExecutionPolicy Bypass -File scripts/restore-db.ps1 -Dump backups\nova_kasir_dev_20261012-120000.dump
    # -> membuat nova_kasir_dev_restore

  Menimpa DB tertentu (HATI-HATI):
    powershell -ExecutionPolicy Bypass -File scripts/restore-db.ps1 -Dump <file> -TargetDb nova_kasir_dev -Force
#>
param(
  [Parameter(Mandatory = $true)][string]$Dump,
  [string]$PgHome = 'D:\postgresql-16.1-1-windows-x64-full\pgsql',
  [int]$Port = 0,
  [string]$User = '',
  [string]$TargetDb = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-nova-db.ps1')

$cfg = Get-NovaDbConfig -PgHome $PgHome -Port $Port -User $User
$bin = $cfg.Bin

if (-not (Test-Path $Dump)) { throw "Berkas dump tidak ditemukan: $Dump" }
$Dump = (Resolve-Path $Dump).Path

# Target default = <db>_restore (tidak menyentuh DB kerja).
$target = if ($TargetDb) { $TargetDb } else { "$($cfg.Database)_restore" }
$env:PGPASSWORD = $cfg.Password

& (Join-Path $bin 'pg_isready.exe') -h $cfg.Host -p $cfg.Port | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Server PostgreSQL tidak merespons di $($cfg.Host):$($cfg.Port)." }

$exists = (& (Join-Path $bin 'psql.exe') -h $cfg.Host -p $cfg.Port -U $cfg.User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$target'" | Out-String).Trim()
if ($exists -eq '1') {
  if (-not $Force) {
    throw "Database '$target' sudah ada. Gunakan -Force untuk menimpanya, atau -TargetDb lain."
  }
  Write-Host ">> dropdb --if-exists $target"
  & (Join-Path $bin 'dropdb.exe') -h $cfg.Host -p $cfg.Port -U $cfg.User --if-exists $target
  if ($LASTEXITCODE -ne 0) { throw 'dropdb gagal.' }
}

Write-Host ">> createdb $target"
& (Join-Path $bin 'createdb.exe') -h $cfg.Host -p $cfg.Port -U $cfg.User $target
if ($LASTEXITCODE -ne 0) { throw 'createdb gagal.' }

Write-Host ">> pg_restore -> $target"
& (Join-Path $bin 'pg_restore.exe') -h $cfg.Host -p $cfg.Port -U $cfg.User -d $target --no-owner --no-privileges --clean --if-exists -j 2 $Dump
if ($LASTEXITCODE -ne 0) { throw "pg_restore gagal (exit $LASTEXITCODE)." }

$tables = (& (Join-Path $bin 'psql.exe') -h $cfg.Host -p $cfg.Port -U $cfg.User -d $target -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';" | Out-String).Trim()
$migs = (& (Join-Path $bin 'psql.exe') -h $cfg.Host -p $cfg.Port -U $cfg.User -d $target -tAc "SELECT count(*) FROM schema_migrations;" | Out-String).Trim()

Write-Host ''
Write-Host "RESTORE SELESAI: $target (tabel=$tables, migrasi=$migs)" -ForegroundColor Green
Write-Host "Verifikasi: psql -h $($cfg.Host) -p $($cfg.Port) -U $($cfg.User) -d $target -c '\dt'"
