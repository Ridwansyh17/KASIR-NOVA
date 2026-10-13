<#
  Generator aset ikon KASIR NOVA dari logo sumber.

  Sumber tunggal: "Logo KASIR NOVA.jpeg" di root repo.
  Output:
    - apps/{admin,owner,kasir}/assets/favicon-32.png
    - apps/{admin,owner,kasir}/assets/apple-touch-icon.png (180)
    - apps/{admin,owner,kasir}/assets/icon-192.png
    - apps/{admin,owner,kasir}/assets/icon-512.png
    - apps/kasir/assets/icon-maskable-512.png
    - apps/kasir-mobile/android/.../mipmap-*/ic_launcher(.png|_round|_foreground)

  Pemakaian (dari root repo):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
#>
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'Logo KASIR NOVA.jpeg'
if (-not (Test-Path $src)) { throw "Logo sumber tidak ditemukan: $src" }

$SRC = [System.Drawing.Image]::FromFile($src)
$SRC_W = $SRC.Width
$SRC_H = $SRC.Height
$SIDE = [Math]::Min($SRC_W, $SRC_H)
$CROP_X = [int](($SRC_W - $SIDE) / 2)
$CROP_Y = [int](($SRC_H - $SIDE) / 2)

# Warna latar diambil dari sudut kanan-atas logo (navy seragam).
$bg = $SRC.GetPixel($SRC_W - 1, 0)

function Set-HighQuality([System.Drawing.Graphics]$g) {
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

# Logo -> kotak $size, penuh (crop tengah persegi sumber).
function Save-Square([int]$size, [string]$out) {
  $dst = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  try {
    Set-HighQuality $g
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $srcRect = New-Object System.Drawing.Rectangle($CROP_X, $CROP_Y, $SIDE, $SIDE)
    $g.DrawImage($SRC, $rect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  } finally { $g.Dispose() }
  $dst.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
}

# Logo -> lingkaran $size (menggunakan mask ellipse).
function Save-Circle([int]$size, [string]$out) {
  $dst = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  try {
    Set-HighQuality $g
    $g.Clear([System.Drawing.Color]::Transparent)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $size, $size)
    $g.SetClip($path)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $srcRect = New-Object System.Drawing.Rectangle($CROP_X, $CROP_Y, $SIDE, $SIDE)
    $g.DrawImage($SRC, $rect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.ResetClip()
    $path.Dispose()
  } finally { $g.Dispose() }
  $dst.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
}

# Logo -> foreground adaptive: kanvas $size, konten ~66% (safe zone), latar transparan.
function Save-Adaptive([int]$size, [string]$out) {
  $inner = [int]($size * 0.66)
  $offset = [int](($size - $inner) / 2)
  $dst = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  try {
    Set-HighQuality $g
    $g.Clear([System.Drawing.Color]::Transparent)
    $rect = New-Object System.Drawing.Rectangle($offset, $offset, $inner, $inner)
    $srcRect = New-Object System.Drawing.Rectangle($CROP_X, $CROP_Y, $SIDE, $SIDE)
    $g.DrawImage($SRC, $rect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  } finally { $g.Dispose() }
  $dst.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
}

# Logo di atas latar berwarna penuh (untuk maskable PWA).
function Save-Maskable([int]$size, [string]$out) {
  $dst = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  try {
    Set-HighQuality $g
    $g.Clear([System.Drawing.Color]::FromArgb($bg.R, $bg.G, $bg.B))
    $inner = [int]($size * 0.72)
    $off = [int](($size - $inner) / 2)
    $rect = New-Object System.Drawing.Rectangle($off, $off, $inner, $inner)
    $srcRect = New-Object System.Drawing.Rectangle($CROP_X, $CROP_Y, $SIDE, $SIDE)
    $g.DrawImage($SRC, $rect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  } finally { $g.Dispose() }
  $dst.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
}

function Ensure-Dir([string]$p) { if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null } }

# ---------------------------------------------------------- Ikon web 3 app --
foreach ($app in @('admin', 'owner', 'kasir')) {
  $dir = Join-Path $root "apps/$app/assets"
  Ensure-Dir $dir
  Save-Square 32  (Join-Path $dir 'favicon-32.png')
  Save-Square 180 (Join-Path $dir 'apple-touch-icon.png')
  Save-Square 192 (Join-Path $dir 'icon-192.png')
  Save-Square 512 (Join-Path $dir 'icon-512.png')
  Write-Output "ikan web: apps/$app/assets"
}
Save-Maskable 512 (Join-Path $root 'apps/kasir/assets/icon-maskable-512.png')
Write-Output "ikon maskable: apps/kasir/assets/icon-maskable-512.png"

# ------------------------------------------------- Ikon launcher Android ---
$density = @{
  'mdpi'    = 48
  'hdpi'    = 72
  'xhdpi'   = 96
  'xxhdpi'  = 144
  'xxxhdpi' = 192
}
$fgFactor = 108.0 / 48.0
$resRoot = Join-Path $root 'apps/kasir-mobile/android/app/src/main/res'
foreach ($d in $density.Keys) {
  $dir = Join-Path $resRoot "mipmap-$d"
  Ensure-Dir $dir
  $size = [int]$density[$d]
  Save-Square $size (Join-Path $dir 'ic_launcher.png')
  Save-Circle $size (Join-Path $dir 'ic_launcher_round.png')
  Save-Adaptive ([int][Math]::Round($size * $fgFactor)) (Join-Path $dir 'ic_launcher_foreground.png')
  Write-Output "ikan Android: mipmap-$d"
}

$SRC.Dispose()
Write-Output ('Latar ikon (navy): #{0:X2}{1:X2}{2:X2}' -f $bg.R, $bg.G, $bg.B)
Write-Output 'Selesai.'
