<#
  Generator aset brand & ikon KASIR NOVA (V2) dari aset logo transparan.

  Sumber (arsip KASIR-NOVA-V2-TRANSPARENT.zip di root repo, atau folder
  hasil ekstraksi bila -SourceDir diberikan):
    - 03-app-icon-light-reference.png .. tanda versi TERANG warna-warni, latar
                                          transparan -> untuk permukaan TERANG
                                          (kartu login putih).
    - 04-app-icon-dark-reference.png ... ikon kotak navy + tanda terang)
                                          -> untuk latar gelap (topbar navy) & ikon aplikasi.

  Keduanya PNG berkanal alpha (sudah diverifikasi: piksel sudut A=0).
  Berkas 01 (lockup lengkap: tanda + kata + tagline) dan 02 (lockup gelap)
  TIDAK dipakai karena tabel logo hanya memuat ikon 34-128 px sehingga
  kata/tagline tidak terbaca dan akan menduplikasi judul "KASIR NOVA".

  Output:
    - apps/{admin,owner,kasir}/assets/logo-kasir-nova.png          (varian gelap, latar terang -> login)
    - apps/{admin,owner,kasir}/assets/logo-kasir-nova-inverse.png  (varian terang, latar navy -> topbar)
    - apps/{admin,owner,kasir}/assets/favicon-32.png
    - apps/{admin,owner,kasir}/assets/apple-touch-icon.png (180)
    - apps/{admin,owner,kasir}/assets/icon-192.png
    - apps/{admin,owner,kasir}/assets/icon-512.png
    - apps/kasir/assets/icon-maskable-512.png

  Pemakaian (dari root repo):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1 -SourceDir C:\path\hasil-ekstrak
#>
param(
  [string]$SourceDir = ''
)

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# --------------------------------------------------------- Sumber aset ------
if ([string]::IsNullOrWhiteSpace($SourceDir)) {
  $zipPath = Join-Path $root 'KASIR-NOVA-V2-TRANSPARENT.zip'
  if (-not (Test-Path $zipPath)) { throw "Arsip sumber tidak ditemukan: $zipPath (atau isi -SourceDir)" }
  $SourceDir = Join-Path ([System.IO.Path]::GetTempPath()) 'kn-brand-src'
  if (Test-Path $SourceDir) { Remove-Item $SourceDir -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $SourceDir)
  Write-Output "Sumber: ekstraksi $zipPath"
} else {
  if (-not (Test-Path $SourceDir)) { throw "Folder sumber tidak ditemukan: $SourceDir" }
  Write-Output "Sumber: $SourceDir"
}

$srcMarkLight = Join-Path $SourceDir '03-app-icon-light-reference.png'
$srcIconDark = Join-Path $SourceDir '04-app-icon-dark-reference.png'
if (-not (Test-Path $srcMarkLight)) { throw "Aset tidak ditemukan: $srcMarkLight" }
if (-not (Test-Path $srcIconDark)) { throw "Aset tidak ditemukan: $srcIconDark" }

# ------------------------------------------------------------- Helper ------
function Set-HighQuality([System.Drawing.Graphics]$g) {
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

function Ensure-Dir([string]$p) { if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null } }

# Kotak pembatas konten (alpha >= 16). Baris/kolom dengan piksel konten kurang
# dari $minPixels diabaikan agar bintik anti-alias di tepi tidak ikut terhitung.
function Get-ContentBounds([System.Drawing.Bitmap]$bmp, [int]$minPixels) {
  $w = $bmp.Width; $h = $bmp.Height
  $rows = New-Object 'int[]' $h
  for ($y = 0; $y -lt $h; $y++) {
    $n = 0
    for ($x = 0; $x -lt $w; $x++) { if ($bmp.GetPixel($x, $y).A -ge 16) { $n++ } }
    $rows[$y] = $n
  }
  $top = -1
  for ($y = 0; $y -lt $h; $y++) { if ($rows[$y] -ge $minPixels) { $top = $y; break } }
  if ($top -lt 0) { return $null }
  $bottom = $top
  for ($y = $h - 1; $y -ge $top; $y--) { if ($rows[$y] -ge $minPixels) { $bottom = $y; break } }

  $cols = New-Object 'int[]' $w
  for ($x = 0; $x -lt $w; $x++) {
    $n = 0
    for ($y = $top; $y -le $bottom; $y++) { if ($bmp.GetPixel($x, $y).A -ge 16) { $n++ } }
    $cols[$x] = $n
  }
  $left = -1
  for ($x = 0; $x -lt $w; $x++) { if ($cols[$x] -ge $minPixels) { $left = $x; break } }
  $right = $left
  for ($x = $w - 1; $x -ge $left; $x--) { if ($cols[$x] -ge $minPixels) { $right = $x; break } }

  return @{ X = $left; Y = $top; W = ($right - $left + 1); H = ($bottom - $top + 1) }
}

function Get-Trimmed([System.Drawing.Bitmap]$bmp, [int]$minPixels) {
  $b = Get-ContentBounds $bmp $minPixels
  if ($null -eq $b) { throw 'Gambar tidak memiliki piksel konten.' }
  $rect = New-Object System.Drawing.Rectangle -ArgumentList @($b.X, $b.Y, $b.W, $b.H)
  return [System.Drawing.Bitmap]$bmp.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

# Gambar -> kanvas persegi $size. $padFrac = proporsi sisi yang dikosongkan (per sisi).
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
    $rect = New-Object System.Drawing.Rectangle -ArgumentList @($x, $y, $w, $h)
    $g.DrawImage($img, $rect)
  } finally { $g.Dispose() }
  return $dst
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$out) {
  Ensure-Dir (Split-Path -Parent $out)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# --------------------------------------------------------- Siapkan sumber --
$imgMarks = [System.Drawing.Bitmap][System.Drawing.Image]::FromFile($srcMarkLight)
$imgIcon  = [System.Drawing.Bitmap][System.Drawing.Image]::FromFile($srcIconDark)

# 03 = varian "untuk latar terang" -> tanda biru/hijau di atas latar transparan.
$markOnLight = Get-Trimmed $imgMarks 2
$iconBg = $imgIcon.GetPixel(2, [int]($imgIcon.Height / 2))   # warna latar tepi ikon gelap

Write-Output ("Tanda varian latar-terang (transparan): {0}x{1}" -f $markOnLight.Width, $markOnLight.Height)
Write-Output ("Ikon latar gelap: {0}x{1}, warna latar contoh #{2:X2}{3:X2}{4:X2}" -f $imgIcon.Width, $imgIcon.Height, $iconBg.R, $iconBg.G, $iconBg.B)

# ------------------------------------------------------------- Keluaran ----
foreach ($app in @('admin', 'owner', 'kasir')) {
  $dir = Join-Path $root "apps/$app/assets"
  Ensure-Dir $dir

  # Login (kartu putih): tanda berwarna pada latar transparan.
  Save-Png (New-Composed $markOnLight 256 0.06 ([System.Drawing.Color]::Transparent)) (Join-Path $dir 'logo-kasir-nova.png')

  # Topbar navy: ikon latar gelap (membawa latar navy-nya sendiri).
  Save-Png (New-Composed $imgIcon 128 0.0 ([System.Drawing.Color]::Transparent)) (Join-Path $dir 'logo-kasir-nova-inverse.png')

  # Ikon aplikasi.
  Save-Png (New-Composed $imgIcon 32 0.0 ([System.Drawing.Color]::Transparent)) (Join-Path $dir 'favicon-32.png')
  Save-Png (New-Composed $imgIcon 180 0.0 ([System.Drawing.Color]::Transparent)) (Join-Path $dir 'apple-touch-icon.png')
  Save-Png (New-Composed $imgIcon 192 0.0 ([System.Drawing.Color]::Transparent)) (Join-Path $dir 'icon-192.png')
  Save-Png (New-Composed $imgIcon 512 0.0 ([System.Drawing.Color]::Transparent)) (Join-Path $dir 'icon-512.png')
  Write-Output "aset web: apps/$app/assets"
}

# Maskable: ikon diperkecil 80% di atas latar senada agar aman dari pemotongan.
Save-Png (New-Composed $imgIcon 512 0.10 $iconBg) (Join-Path $root 'apps/kasir/assets/icon-maskable-512.png')
Write-Output 'aset maskable: apps/kasir/assets/icon-maskable-512.png'

$imgMarks.Dispose()
$imgIcon.Dispose()
$markOnLight.Dispose()

Write-Output 'Catatan: ikon launcher Android tidak diubah (menunggu build APK berikutnya).'
Write-Output 'Selesai.'
