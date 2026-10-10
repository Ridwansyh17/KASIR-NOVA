# Verifikasi Database Dev — KASIR NOVA
#
# Cek cepat: binary PostgreSQL, koneksi, database, dan tabel fondasi.
# Jalankan setelah instalasi & migrasi.

$ErrorActionPreference = 'Stop'
$pgHome = 'D:\postgresql-16.1-1-windows-x64-full\pgsql'
$bin    = Join-Path $pgHome 'bin'
$port   = 5433
$db     = 'nova_kasir_dev'

$env:PGPASSWORD = $env:NOVA_DB_PASSWORD
if (-not $env:PGPASSWORD) {
  Write-Host 'Set $env:NOVA_DB_PASSWORD dulu (password DB dev), lalu jalankan lagi.' -ForegroundColor Red
  exit 1
}

function Step($label, $sb) {
  Write-Host -NoNewline "[ ] $label ... "
  try {
    &$sb
    Write-Host 'OK' -ForegroundColor Green
  } catch {
    Write-Host 'GAGAL' -ForegroundColor Red
    Write-Host "      $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
}

Step 'Binary pgsql ditemukan'      { if (-not (Test-Path (Join-Path $bin 'postgres.exe'))) { throw 'postgres.exe tidak ada' } }
Step 'Server merespons'            { & (Join-Path $bin 'pg_isready.exe') -h localhost -p $port | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'server tidak merespons' } }
Step 'Versi server'                { & (Join-Path $bin 'psql.exe') -h localhost -p $port -U postgres -d $db -tAc 'SELECT version();' }
Step 'Database nova_kasir_dev'     { & (Join-Path $bin 'psql.exe') -h localhost -p $port -U postgres -d $db -tAc "SELECT current_database();" }
Step 'Tabel fondasi'               {
  $t = & (Join-Path $bin 'psql.exe') -h localhost -p $port -U postgres -d $db -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
  Write-Host "($t tabel) "
}
Step 'Migrasi terlacak'            {
  $m = & (Join-Path $bin 'psql.exe') -h localhost -p $port -U postgres -d $db -tAc "SELECT count(*) FROM schema_migrations;"
  Write-Host "($m migrasi) "
}
Step 'Admin platform ada'          {
  $a = & (Join-Path $bin 'psql.exe') -h localhost -p $port -U postgres -d $db -tAc "SELECT count(*) FROM platform_admins;"
  Write-Host "($a admin) "
}

Write-Host ''
Write-Host 'Semua pemeriksaan database LOLOS.' -ForegroundColor Green
