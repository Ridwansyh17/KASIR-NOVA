<#
  generate-android-splash.ps1 — buat ulang SPLASH SCREEN Android KASIR NOVA (V2)
  dari aset brand transparan kanonik (arsip KASIR-NOVA-V2-TRANSPARENT.zip).

  Latar belakang: tema aplikasi `AppTheme.NoActionBarLaunch` mewarisi
  `Theme.SplashScreen` dari pustaka androidx.core:core-splashscreen. Pustaka
  itu menyetel `windowSplashScreenAnimatedIcon` = ikon bawaan Android
  (`@android:drawable/sym_def_app_icon`) sehingga splash APK tampil generik.
  Selain itu `@drawable/splash` bawaan Capacitor masih berisi citra polos.

  Skrip ini menggantinya dengan merek KASIR NOVA:
  latar navy brand + lockup lengkap (tanda + kata + tagline) di tengah.

  Sumber (arsip zip di root repo, atau folder via -SourceDir):
    - 01-logo-dark-reference.png : lockup lengkap untuk LATAR GELAP
      (tanda + kata + tagline) -> satu-satunya aset yang cocok untuk navy.
    - 04-app-icon-dark-reference.png : warna tepi kotak navy ikon -> warna
      latar splash (dijaga identik dengan `values/ic_launcher_background.xml`
      agar splash Android 12+ menyatu dengan ikon peluncur).

  Keluaran (apps/<TargetApp>/android/app/src/main/res), ukuran mengikuti
  templat Capacitor supaya tidak mengubah perilaku pemuatan gambar:
    - drawable/splash.png                    480x320  (default)
    - drawable-land-mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi/splash.png
    - drawable-port-mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi/splash.png

  Pemakaian (dari root repo):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-android-splash.ps1
    # atau, bila aset sudah diekstrak:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-android-splash.ps1 -SourceDir C:\path\hasil-ekstrak
    # APK Owner memakai logo loading yang sama persis dengan panel Kasir:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-android-splash.ps1 -TargetApp owner-mobile
#>
param(
  [string]$SourceDir,
  [string]$BackgroundColor,
  [ValidateSet('kasir-mobile', 'owner-mobile')]
  [string]$TargetApp = 'kasir-mobile'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot

# --------------------------------------------------------------- Sumber -----
if (-not $SourceDir) {
  $zip = Join-Path $root 'KASIR-NOVA-V2-TRANSPARENT.zip'
  if (-not (Test-Path $zip)) { throw "Aset tidak ditemukan: $zip (atau beri -SourceDir)" }
  $SourceDir = Join-Path $env:TEMP 'nova-android-splash-src'
  if (Test-Path $SourceDir) { Remove-Item $SourceDir -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $SourceDir)
  Write-Output "Sumber: ekstraksi $zip"
}
$srcLockup = Join-Path $SourceDir '01-logo-dark-reference.png'
$srcFull = Join-Path $SourceDir '04-app-icon-dark-reference.png'
if (-not (Test-Path $srcLockup)) { throw "Aset tidak ditemukan: $srcLockup" }
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

# Susun splash: latar penuh + lockup di tengah (skala proporsional).
function New-Splash([System.Drawing.Bitmap]$lockup, [int]$w, [int]$h, [System.Drawing.Color]$bg, [double]$widthFrac, [double]$maxHeightFrac) {
  $dst = New-Object System.Drawing.Bitmap -ArgumentList @($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  try {
    Set-HighQuality $g
    $brush = New-Object System.Drawing.SolidBrush -ArgumentList @($bg)
    $g.FillRectangle($brush, 0, 0, $w, $h)
    $brush.Dispose()

    $scale = ($w * $widthFrac) / [double]$lockup.Width
    if ($lockup.Height * $scale -gt $h * $maxHeightFrac) { $scale = ($h * $maxHeightFrac) / [double]$lockup.Height }
    $lw = [int][Math]::Max(1, [Math]::Round($lockup.Width * $scale))
    $lh = [int][Math]::Max(1, [Math]::Round($lockup.Height * $scale))
    $x = [int][Math]::Round(($w - $lw) / 2.0)
    $y = [int][Math]::Round(($h - $lh) / 2.0)
    $g.DrawImage($lockup, $x, $y, $lw, $lh)
  } finally { $g.Dispose() }
  return $dst
}
function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
  Ensure-Dir (Split-Path -Parent $path)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# --------------------------------------------------------------- Siapkan ----
$imgFull = [System.Drawing.Bitmap]::FromFile($srcFull)
$navy = if ($BackgroundColor) {
  [System.Drawing.ColorTranslator]::FromHtml($BackgroundColor)
} else {
  $imgFull.GetPixel(2, [int]($imgFull.Height / 2))   # warna tepi kotak navy ikon 04
}
$imgLockup = [System.Drawing.Bitmap]::FromFile($srcLockup)
$lockup = Get-Trimmed $imgLockup 2
Write-Output ("Lockup: {0}x{1} | Latar navy: #{2:X2}{3:X2}{4:X2}" -f $lockup.Width, $lockup.Height, $navy.R, $navy.G, $navy.B)

# Ukuran kanvas mengikuti templat Capacitor (@capacitor/android).
$targets = @(
  @{ dir = 'drawable';                w = 480;  h = 320  },
  @{ dir = 'drawable-land-mdpi';      w = 480;  h = 320  },
  @{ dir = 'drawable-land-hdpi';      w = 800;  h = 480  },
  @{ dir = 'drawable-land-xhdpi';     w = 1280; h = 720  },
  @{ dir = 'drawable-land-xxhdpi';    w = 1600; h = 960  },
  @{ dir = 'drawable-land-xxxhdpi';   w = 1920; h = 1280 },
  @{ dir = 'drawable-port-mdpi';      w = 320;  h = 480  },
  @{ dir = 'drawable-port-hdpi';      w = 480;  h = 800  },
  @{ dir = 'drawable-port-xhdpi';     w = 720;  h = 1280 },
  @{ dir = 'drawable-port-xxhdpi';    w = 960;  h = 1600 },
  @{ dir = 'drawable-port-xxxhdpi';   w = 1280; h = 1920 }
)

$res = Join-Path $root ("apps/" + $TargetApp + "/android/app/src/main/res")
foreach ($t in $targets) {
  $path = Join-Path (Join-Path $res $t.dir) 'splash.png'
  Save-Png (New-Splash $lockup $t.w $t.h $navy 0.66 0.42) $path
  Write-Output ("  {0,-24} {1}x{2}" -f ($t.dir + '/splash.png'), $t.w, $t.h)
}

Write-Output 'Selesai. Splash Android -> apps/kasir-mobile/android/app/src/main/res'
