<#
  e2e-local.ps1 — jalankan E2E penuh (31 langkah) terhadap server LOKAL.

  Alur:
    1. Baca kredensial seed (admin/owner) dari server/.env.
    2. Nyalakan server (server/src/server.js) pada port yang diminta.
    3. Tunggu /api/health sampai 200.
    4. Jalankan scripts/e2e-online.mjs dengan BASE_URL=http://localhost:<port>.
    5. Matikan server (apa pun hasilnya).

  Tidak menyentuh produksi: hanya server lokal + database dev (server/.env).
  Exit code mengikuti hasil E2E (0 = semua lulus).

  Pemakaian (dari root repo):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-local.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-local.ps1 -Port 4000
#>
param(
  [int]$Port = 4000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root 'server/.env'

if (-not (Test-Path $envFile)) { throw "server/.env tidak ditemukan. Salin server/.env.example dulu." }

function Read-EnvValue([string]$name) {
  $match = Select-String -Path $envFile -Pattern ("^" + $name + "=") | Select-Object -First 1
  if (-not $match) { throw "Nilai $name tidak ditemukan di server/.env" }
  return ($match.Line -replace ("^" + $name + "="), '').Trim()
}

$env:BASE_URL = "http://localhost:$Port"
$env:PORT = "$Port"
$env:ADMIN_EMAIL = 'admin@nova.test'
$env:OWNER_EMAIL = 'owner@nova.test'
$env:ADMIN_PASSWORD = Read-EnvValue 'SEED_ADMIN_PASSWORD'
$env:OWNER_PASSWORD = Read-EnvValue 'SEED_OWNER_PASSWORD'
$env:E2E_PLATFORM_FLOW = '1'

$serverDir = Join-Path $root 'server'
$logOut = Join-Path $env:TEMP 'nova-e2e-server.out.log'
$logErr = Join-Path $env:TEMP 'nova-e2e-server.err.log'

Write-Output "[e2e-local] menyalakan server pada port $Port ..."
$server = Start-Process -FilePath 'node' -ArgumentList 'src/server.js' `
  -WorkingDirectory $serverDir -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $logOut -RedirectStandardError $logErr

$code = 1
try {
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $r = Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/api/health" -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) {
    Write-Output '[e2e-local] Server lokal tidak siap. 30 baris terakhir log:'
    if (Test-Path $logOut) { Get-Content $logOut -Tail 30 }
    if (Test-Path $logErr) { Get-Content $logErr -Tail 30 }
    exit 1
  }

  Write-Output "[e2e-local] server siap; menjalankan E2E 31 langkah ..."
  node (Join-Path $root 'scripts/e2e-online.mjs')
  $code = $LASTEXITCODE
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
    Write-Output '[e2e-local] server dimatikan.'
  }
}

exit $code
