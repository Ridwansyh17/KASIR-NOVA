<#
  qa-local.ps1 — jalankan SELURUH matriks verifikasi lokal dengan satu perintah,
  lalu tampilkan ringkasan LULUS/GAGAL per tahap.

  Tahapan (sama seperti docs/32 & docs/33 §8):
    1) Salinan berkas bersama   (node scripts/sync-shared.mjs --check)
    2) Uji backend              (clean-test-fixtures + node --test tests/**)
    3) Verifikasi UI statis     (build-hosting + verify-ui)
    4) Sesi & pemulihan login   (node --test scripts/test-auth-restore.mjs)
    5) Smart Product Image      (node --test scripts/test-product-image.mjs)
    6) Tata letak cetak laporan (Chrome headless; DILEWATI bila Chrome tidak ada)
    7) E2E lokal 31 langkah     (opsional; -WithE2E)

  Tidak menyentuh produksi dan tidak melakukan deployment. Memakai DB dev
  (server/.env -> localhost:5433/nova_kasir_dev).

  Pemakaian (dari root repo):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qa-local.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qa-local.ps1 -WithE2E
#>
param([switch]$WithE2E)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$script:rows = @()

function Record([string]$name, $code) {
  $script:rows += [pscustomobject]@{ Step = $name; Code = [int]$code }
  $label = if ($code -eq 0) { 'LULUS' } else { "GAGAL ($code)" }
  Write-Host ("--- {0}: {1}`n" -f $name, $label)
}

# Preflight: PostgreSQL dev harus mendengarkan port 5433.
function Test-Port([int]$port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $port); $c.Close(); return $true
  } catch { return $false }
}
if (-not (Test-Port 5433)) {
  Write-Host 'GAGAL: PostgreSQL dev tidak mendengarkan port 5433.' -ForegroundColor Red
  Write-Host 'Nyalakan dulu, contoh:'
  Write-Host '  Start-Process -WindowStyle Hidden -FilePath "D:\postgresql-16.1-1-windows-x64-full\pgsql\bin\pg_ctl.exe" -ArgumentList @("-D","D:\pgdata","-l","D:\pgdata\nova-run.log","start")'
  exit 1
}

Write-Host "`n=== 1/7 Salinan berkas bersama ==="
node scripts/sync-shared.mjs --check
Record '1/7 Salinan berkas bersama' $LASTEXITCODE

Write-Host "`n=== 2/7 Uji backend ==="
Push-Location server
node scripts/clean-test-fixtures.mjs
node --test "tests/**/*.test.js"
$backendCode = $LASTEXITCODE
Pop-Location
Record '2/7 Uji backend (321 diharapkan)' $backendCode

Write-Host "`n=== 3/7 Verifikasi UI statis + bundel hosting ==="
node scripts/build-hosting.mjs
$buildCode = $LASTEXITCODE
node scripts/verify-ui.mjs
$uiCode = $LASTEXITCODE
Record '3/7 Verifikasi UI statis' ([Math]::Max($buildCode, $uiCode))

Write-Host "`n=== 4/7 Sesi & pemulihan login ==="
node --test scripts/test-auth-restore.mjs
Record '4/7 Sesi & pemulihan login (10 diharapkan)' $LASTEXITCODE

Write-Host "`n=== 5/7 Smart Product Image ==="
node --test scripts/test-product-image.mjs
Record '5/7 Smart Product Image (9 diharapkan)' $LASTEXITCODE

Write-Host "`n=== 6/7 Tata letak cetak laporan (Chrome headless) ==="
$chromeCandidates = @(
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
)
$hasChrome = $false
foreach ($p in $chromeCandidates) { if (Test-Path $p) { $hasChrome = $true } }
if ($env:NOVA_CHROME -and (Test-Path $env:NOVA_CHROME)) { $hasChrome = $true }
if ($hasChrome) {
  node scripts/print-report-check.mjs
  Record '6/7 Tata letak cetak laporan (halaman PDF = halaman rencana)' $LASTEXITCODE
} else {
  Write-Host 'DILEWATI: Chrome tidak ditemukan (set NOVA_CHROME untuk mengaktifkan).'
  Record '6/7 Tata letak cetak laporan (DILEWATI: Chrome tidak ada)' 0
}

if ($WithE2E) {
  Write-Host "`n=== 7/7 E2E lokal (31 langkah) ==="
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-local.ps1
  Record '7/7 E2E lokal (31 langkah)' $LASTEXITCODE
} else {
  Write-Host "`n=== 7/7 E2E lokal: DILEWATI (pakai -WithE2E untuk menjalankan) ==="
}

Write-Host "`n================ RINGKASAN ================"
$failed = 0
foreach ($r in $script:rows) {
  if ($r.Code -ne 0) { $failed++ }
  $mark = if ($r.Code -eq 0) { 'LULUS' } else { 'GAGAL' }
  Write-Host ("  [{0}] {1}" -f $mark, $r.Step)
}
if ($failed -eq 0) {
  Write-Host "`nSEMUA TAHAP LULUS" -ForegroundColor Green
  exit 0
}
Write-Host "`n$failed TAHAP GAGAL" -ForegroundColor Red
exit 1
