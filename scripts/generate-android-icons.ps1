<#
  generate-android-icons.ps1 — buat ulang IKON LAUNCHER Android KASIR NOVA (V2)
  dari aset brand transparan kanonik (arsip KASIR-NOVA-V2-TRANSPARENT.zip).

  Latar belakang: ikon launcher APK masih bawaan Capacitor (vector robot).
  Skrip ini menggantinya dengan merek KASIR NOVA.

  Sumber (arsip zip di root repo, atau folder via -SourceDir):
    - 03-app-icon-light-reference.png : tanda (mark) di latar transparan
      -> FOREGROUND adaptive icon + ikon bulat legacy.
    - 04-app-icon-dark-reference.png  : ikon kotak navy + tanda terang
      -> ikon legacy persegi (ic_launcher.png) + sumber warna latar navy.

  Keluaran (apps/kasir-mobile/android/app/src/main/res):
    - mipmap-mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi/ic_launcher.png      (48/72/96/144/192)
    - mipmap-*/ic_launcher_round.png                             (bulat, ukuran sama)
    - mipmap-*/ic_launcher_foreground.png                        (adaptive 108dp: 108/162/216/324/432)
    - values/ic_launcher_background.xml                          (warna navy brand)

  Pemakaian (dari root repo):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-android-icons.ps1
#>
param([string]$SourceDir)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot

# --------------------------------------------------------------- Sumber -----
if (-not $SourceDir) {
  $zip = Join-Path $root 'KASIR-NOVA-V2-TRANSPARENT.zip'
  if (-not (Test-Path $zip)) { throw "Aset tidak ditemukan: $zip (atau beri -SourceDir)" }
  $SourceDir = Join-Path $env:TEMP 'nova-android-icons-src'
  if (Test-Path $SourceDir) { Remove-Item $SourceDir -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $SourceDir)
  Write-Output "Sumber: ekstraksi $zip"
}
$srcMark = Join-Path $SourceDir '03-app-icon-light-reference.png'
$srcFull = Join-Path $SourceDir '04-app-icon-dark-reference.png'
if (-not (Test-Path $srcMark)) { throw "Aset tidak ditemukan: $srcMark" }
if (-not (Test-Path $srcFull)) { throw "Aset tidak ditemukan: $srcFull" }

# --------------------------------------------------------------- Helper -----
function Set-HighQuality([System.Drawing.Graphics]$g) {
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}
function Ensure-Dir([string]$p) { if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null } }

function Get-ContentBounds([System.Drawing.Bitmap]$bmp, [int]$minPixels) {
  $w = $bmp.Width; $h = $bmp.Height
  $rows = New-Object 'int[]' $h
  for ($y = 0; $y -lt $h; $y++) {
    $n = 0
    for ($x = 0; $x -lt $w; $x++) { if ($bmp.GetPixel($x, $y).A -ge 16) { $n++ } }
    $rows[$y] = $n
  }
  $top = -1; for ($y = 0; $y -lt $h; $y++) { if ($rows[$y] -ge $minPixels) { $top = $y; break } }
  if ($top -lt 0) { return $null }
  $bottom = $top; for ($y = $h - 1; $y -ge $top; $y--) { if ($rows[$y] -ge $minPixels) { $bottom = $y; break } }
  $cols = New-Object 'int[]' $w
  for ($x = 0; $x -lt $w; $x++) {
    $n = 0
    for ($y = $top; $y -le $bottom; $y++) { if ($bmp.GetPixel($x, $y).A -ge 16) { $n++ } }
    $cols[$x] = $n
  }
  $left = -1; for ($x = 0; $x -lt $w; $x++) { if ($cols[$x] -ge $minPixels) { $left = $x; break } }
  $right = $left; for ($x = $w - 1; $x -ge $left; $x--) { if ($cols[$x] -ge $minPixels) { $right = $x; break } }
  return @{ X = $left; Y = $top; W = ($right - $left + 1); H = ($bottom - $top + 1) }
}
function Get-Trimmed([System.Drawing.Bitmap]$bmp, [int]$minPixels) {
  $b = Get-ContentBounds $bmp $minPixels
  if ($null -eq $b) { throw 'Gambar tidak memiliki piksel konten.' }
  $rect = New-Object System.Drawing.Rectangle -ArgumentList @($b.X, $b.Y, $b.W, $b.H)
  return [System.Drawing.Bitmap]$bmp.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}
function New-Composed([System.Drawing.Bitmap]$img, [int]$size, [double]$padFrac, [System.Drawing.Color]$bg, [switch]$Circle) {
  $dst = New-Object System.Drawing.Bitmap -ArgumentList @($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  try {
    Set-HighQuality $g
    $g.Clear([System.Drawing.Color]::Transparent)
    if ($bg.A -gt 0) {
      $brush = New-Object System.Drawing.SolidBrush -ArgumentList @($bg)
      if ($Circle) { $g.FillEllipse($brush, 0, 0, $size, $size) } else { $g.FillRectangle($brush, 0, 0, $size, $size) }
      $brush.Dispose()
    }
    $box = [int][Math]::Round($size * (1.0 - 2.0 * $padFrac))
    $scale = [Math]::Min($box / [double]$img.Width, $box / [double]$img.Height)
    $w = [int][Math]::Max(1, [Math]::Round($img.Width * $scale))
    $h = [int][Math]::Max(1, [Math]::Round($img.Height * $scale))
    $x = [int][Math]::Round(($size - $w) / 2.0)
    $y = [int][Math]::Round(($size - $h) / 2.0)
    $g.DrawImage($img, $x, $y, $w, $h)
  } finally { $g.Dispose() }
  return $dst
}
function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
  Ensure-Dir (Split-Path -Parent $path)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# --------------------------------------------------------------- Siapkan ----
$imgMark = [System.Drawing.Bitmap]::FromFile($srcMark)
$imgFull = [System.Drawing.Bitmap]::FromFile($srcFull)
$mark = Get-Trimmed $imgMark 2
$navy = $imgFull.GetPixel(2, [int]($imgFull.Height / 2))   # warna tepi kotak navy ikon 04
Write-Output ("Mark: {0}x{1} | Ikon penuh: {2}x{3} | Latar navy: #{4:X2}{5:X2}{6:X2}" -f $mark.Width, $mark.Height, $imgFull.Width, $imgFull.Height, $navy.R, $navy.G, $navy.B)

$res = Join-Path $root 'apps/kasir-mobile/android/app/src/main/res'
$legacy = [ordered]@{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
$adaptiveFg = [ordered]@{ mdpi = 108; hdpi = 162; xhdpi = 216; xxhdpi = 324; xxxhdpi = 432 }

foreach ($d in $legacy.Keys) {
  $dir = Join-Path $res ("mipmap-" + $d)
  # Ikon legacy persegi: ikon kotak navy penuh (tanpa celah transparan).
  Save-Png (New-Composed $imgFull $legacy[$d] 0.0 ([System.Drawing.Color]::Transparent)) (Join-Path $dir 'ic_launcher.png')
  # Ikon bulat legacy: lingkaran navy + tanda di tengah.
  Save-Png (New-Composed $mark $legacy[$d] 0.22 $navy -Circle) (Join-Path $dir 'ic_launcher_round.png')
}

foreach ($d in $adaptiveFg.Keys) {
  $dir = Join-Path $res ("mipmap-" + $d)
  # Foreground adaptive icon: tanda di kanvas transparan 108dp (safe zone ~66%).
  Save-Png (New-Composed $mark $adaptiveFg[$d] 0.17 ([System.Drawing.Color]::Transparent)) (Join-Path $dir 'ic_launcher_foreground.png')
}

# Warna latar adaptive icon = navy brand.
$bgXml = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#{0:X2}{1:X2}{2:X2}</color>
</resources>
"@ -f $navy.R, $navy.G, $navy.B
Set-Content -Path (Join-Path $res 'values/ic_launcher_background.xml') -Value $bgXml -NoNewline -Encoding UTF8

Write-Output ("Selesai. Warna latar: #{0:X2}{1:X2}{2:X2}" -f $navy.R, $navy.G, $navy.B)
Write-Output 'Ikon launcher -> apps/kasir-mobile/android/app/src/main/res'
