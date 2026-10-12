<#
  Backup database KASIR NOVA (PostgreSQL) dengan pg_dump format custom.
  Format custom (-Fc) terkompresi dan dapat dipulihkan dengan pg_restore.

  Pemakaian:
    powershell -ExecutionPolicy Bypass -File scripts/backup-db.ps1
    powershell -ExecutionPolicy Bypass -File scripts/backup-db.ps1 -OutDir D:\backup
    powershell -ExecutionPolicy Bypass -File scripts/backup-db.ps1 -Plain   # SQL teks (.sql)

  Hasil: <OutDir>\<db>_<yyyyMMdd-HHmmss>.dump  (+ .dump.ok jika verifikasi lolos)
  Default OutDir: <repo>\backups  (di-.gitignore).
#>
param(
  [string]$PgHome = 'D:\postgresql-16.1-1-windows-x64-full\pgsql',
  [int]$Port = 0,
  [string]$Database = '',
  [string]$User = '',
  [string]$OutDir = '',
  [switch]$Plain
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-nova-db.ps1')

$cfg = Get-NovaDbConfig -PgHome $PgHome -Port $Port -Database $Database -User $User
$bin = $cfg.Bin

if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'backups' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$env:PGPASSWORD = $cfg.Password

# Cek server hidup
& (Join-Path $bin 'pg_isready.exe') -h $cfg.Host -p $cfg.Port | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Server PostgreSQL tidak merespons di $($cfg.Host):$($cfg.Port)." }

if ($Plain) {
  $out = Join-Path $OutDir "$($cfg.Database)_$stamp.sql"
  Write-Host ">> pg_dump (plain) $($cfg.Database) -> $out"
  & (Join-Path $bin 'pg_dump.exe') -h $cfg.Host -p $cfg.Port -U $cfg.User -d $cfg.Database --no-owner --no-privileges -f $out
} else {
  $out = Join-Path $OutDir "$($cfg.Database)_$stamp.dump"
  Write-Host ">> pg_dump -Fc $($cfg.Database) -> $out"
  & (Join-Path $bin 'pg_dump.exe') -h $cfg.Host -p $cfg.Port -U $cfg.User -d $cfg.Database -Fc --no-owner --no-privileges -f $out
}
if ($LASTEXITCODE -ne 0) { throw "pg_dump gagal (exit $LASTEXITCODE)." }
if (-not (Test-Path $out) -or (Get-Item $out).Length -eq 0) { throw "Berkas dump kosong/tidak dibuat: $out" }

# Verifikasi isi arsip (khusus format custom)
if (-not $Plain) {
  Write-Host '>> verifikasi arsip (pg_restore --list)'
  & (Join-Path $bin 'pg_restore.exe') --list $out | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Arsip dump tidak valid (pg_restore --list gagal).' }
  Set-Content -Path "$out.ok" -Value "verified $(Get-Date -Format o)" -NoNewline
}

$sizeKb = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host ''
Write-Host "BACKUP SELESAI: $out ($sizeKb KB)" -ForegroundColor Green
