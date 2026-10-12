# Helper kredensial DB KASIR NOVA — dipakai scripts/backup-db.ps1 & restore-db.ps1.
#
# Sumber kredensial (berurutan):
#   1. $env:NOVA_DB_PASSWORD (bila diisi) untuk password.
#   2. server/.env -> DATABASE_URL (host/port/db/user/password).
# Parameter eksplisit yang diisi pemanggil akan menimpa hasil di atas.
#
# Tidak mencetak password. Dipanggil via dot-sourcing:
#   . (Join-Path $PSScriptRoot 'lib-nova-db.ps1')

function Get-NovaDbConfig {
  param(
    [string]$PgHome = 'D:\postgresql-16.1-1-windows-x64-full\pgsql',
    [int]$Port = 0,
    [string]$Database = '',
    [string]$User = '',
    [string]$DbHost = ''
  )

  $cfg = @{
    PgHome   = $PgHome
    Host     = 'localhost'
    Port     = 5433
    Database = 'nova_kasir_dev'
    User     = 'postgres'
    Password = $env:NOVA_DB_PASSWORD
  }

  $envFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'server\.env'
  if (Test-Path $envFile) {
    $line = (Select-String -Path $envFile -Pattern '^DATABASE_URL=' | Select-Object -First 1).Line
    if ($line) {
      $url = $line.Substring('DATABASE_URL='.Length).Trim()
      $m = [regex]::Match(
        $url,
        '^postgres(?:ql)?://(?<u>[^:]+):(?<p>[^@]+)@(?<h>[^:/?]+):?(?<port>\d+)?/(?<db>[^?]+)'
      )
      if ($m.Success) {
        $cfg.Host = $m.Groups['h'].Value
        if ($m.Groups['port'].Success) { $cfg.Port = [int]$m.Groups['port'].Value }
        $cfg.Database = $m.Groups['db'].Value
        $cfg.User = $m.Groups['u'].Value
        if (-not $cfg.Password) { $cfg.Password = $m.Groups['p'].Value }
      }
    }
  }

  # Override eksplisit dari pemanggil.
  if ($DbHost) { $cfg.Host = $DbHost }
  if ($Port) { $cfg.Port = $Port }
  if ($Database) { $cfg.Database = $Database }
  if ($User) { $cfg.User = $User }

  if (-not $cfg.Password) {
    throw 'Password DB tidak ditemukan. Set $env:NOVA_DB_PASSWORD atau isi DATABASE_URL di server/.env.'
  }
  $cfg.Bin = Join-Path $cfg.PgHome 'bin'
  if (-not (Test-Path (Join-Path $cfg.Bin 'psql.exe'))) {
    throw "PostgreSQL bin tidak ditemukan di $($cfg.Bin). Sesuaikan -PgHome."
  }
  return $cfg
}

# Menjalankan fungsi dalam konteks PGPASSWORD aman (tidak bocor ke log).
function Invoke-NovaPsql {
  param([hashtable]$Cfg, [string]$Sql, [string]$Db)
  $env:PGPASSWORD = $Cfg.Password
  $target = if ($Db) { $Db } else { $Cfg.Database }
  & (Join-Path $Cfg.Bin 'psql.exe') -h $Cfg.Host -p $Cfg.Port -U $Cfg.User -d $target -tAc $Sql
}
