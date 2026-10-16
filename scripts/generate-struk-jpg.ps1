# Generator gambar struk pembayaran (.jpg) untuk dokumentasi/demo KASIR NOVA.
#
# Meniru format struk POS panel Kasir (apps/kasir/src/receipt.js):
# kertas 58mm, font monospace 32 kolom, garis putus-putus, label/nilai sejajar,
# harga rata kanan.
#
# Pemakaian:
#   # data contoh bawaan
#   powershell -ExecutionPolicy Bypass -File scripts/generate-struk-jpg.ps1
#
#   # dari data transaksi nyata (dihasilkan scripts/struk-from-db.mjs)
#   powershell -ExecutionPolicy Bypass -File scripts/generate-struk-jpg.ps1 `
#       -LinesFile "$env:TEMP\struk.json" -Out "STRUK-PEMBAYARAN.jpg"
param(
  [string]$LinesFile, # teks, tiap baris: <style><teks32kolom>; style = n|b|m
  [string]$Out        # path keluaran .jpg (default: STRUK-PEMBAYARAN.jpg)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outPath = if ($Out) { $Out } else { Join-Path $root 'STRUK-PEMBAYARAN.jpg' }

$W = 32 # kolom monospace (kertas 58mm)

function Center([string]$s) {
  $s = $s.Trim()
  if ($s.Length -ge $W) { return $s }
  return (' ' * [math]::Floor(($W - $s.Length) / 2)) + $s
}
function Col2([string]$left, [string]$right) {
  $gap = $W - $left.Length - $right.Length
  if ($gap -lt 1) { $gap = 1 }
  return $left + (' ' * $gap) + $right
}
function FmtRp([int]$n) { 'Rp ' + (('{0:N0}' -f $n) -replace ',', '.') }

# --- Isi struk --------------------------------------------------------------
$dash = '-' * $W
$lines = New-Object System.Collections.Generic.List[object]
function Add([string]$t, [string]$s = 'n') { $lines.Add([pscustomobject]@{ T = $t; S = $s }) }

if ($LinesFile) {
  # Tiap baris: 1 karakter style (n|b|m) diikuti teks 32 kolom.
  foreach ($ln in (Get-Content -LiteralPath $LinesFile -Encoding UTF8)) {
    if ($null -eq $ln -or $ln.Length -lt 2) { continue }
    Add ($ln.Substring(1)) ([string]$ln[0])
  }
} else {
  Add (Center 'KOPI SENJA') 'b'
  Add (Center 'Outlet Pusat') 'n'
  Add (Center 'Jl. Merdeka No. 12, Bandung') 'n'
  Add (Center 'Telp. 0812-3456-7890') 'n'
  Add $dash 'm'
  Add (Col2 'No. Struk' 'INV-20261013-0007') 'n'
  Add (Col2 'Tanggal' '13/10/2026 19:54') 'n'
  Add (Col2 'Kasir' 'Ridwan') 'n'
  Add $dash 'm'
  foreach ($it in @(
      @(2, 'Kopi Susu', 18000, 36000),
      @(1, 'Roti Bakar', 15000, 15000),
      @(3, 'Air Mineral 600ml', 3000, 9000)
    )) {
    Add (Col2 ("{0}x {1}" -f $it[0], $it[1]) (FmtRp $it[3])) 'n'
    if ([int]$it[0] -gt 1) { Add ('   @ ' + (FmtRp $it[2])) 'm' }
  }
  Add $dash 'm'
  Add (Col2 'Total Produk' '6 item') 'n'
  Add (Col2 'Subtotal' (FmtRp 60000)) 'n'
  Add (Col2 'Diskon' ('-' + (FmtRp 5000))) 'n'
  Add (Col2 'TOTAL' (FmtRp 55000)) 'b'
  Add $dash 'm'
  Add (Col2 'Pembayaran' 'Tunai') 'n'
  Add (Col2 'Status' 'LUNAS') 'b'
  Add (Col2 'Uang Diterima' (FmtRp 100000)) 'n'
  Add (Col2 'Kembalian' (FmtRp 45000)) 'n'
  Add $dash 'm'
  Add (Center 'Terima kasih atas kunjungan Anda') 'n'
  Add (Center 'KASIR NOVA') 'b'
}

# --- Font monospace ---------------------------------------------------------
function PickFamily([string[]]$preferred, [string]$fallback) {
  $names = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
  foreach ($p in $preferred) { if ($names -contains $p) { return $p } }
  return $fallback
}
$family = PickFamily @('Consolas', 'Courier New', 'Lucida Console') 'Courier New'
$size = 24
$font = New-Object System.Drawing.Font($family, $size, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fontB = New-Object System.Drawing.Font($family, $size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

# --- Ukur ---------------------------------------------------------------
$tmp = New-Object System.Drawing.Bitmap 4, 4
$mg = [System.Drawing.Graphics]::FromImage($tmp)
$lineH = [math]::Ceiling($mg.MeasureString('Ag', $font).Height) + 4
$charW = $mg.MeasureString(('M' * $W), $font).Width / $W
$mg.Dispose(); $tmp.Dispose()

$pad = 36
$barH = 58
$paperW = [int][math]::Ceiling($charW * $W) + ($pad * 2)
$bodyH = $lines.Count * $lineH
$paperH = $barH + $pad + $bodyH + $pad
$margin = 56
$canvasW = $paperW + ($margin * 2)
$canvasH = $paperH + ($margin * 2)

$bmp = New-Object System.Drawing.Bitmap $canvasW, $canvasH, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$bmp.SetResolution(300, 300)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# Latar gradien lembut
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.RectangleF 0, 0, $canvasW, $canvasH),
  [System.Drawing.Color]::FromArgb(238, 242, 247),
  [System.Drawing.Color]::FromArgb(214, 223, 235),
  [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillRectangle($bg, 0, 0, $canvasW, $canvasH)

# Kertas putih (rounded) + bayangan
function RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}
$px = [single]$margin; $py = [single]$margin
$paper = RoundedPath $px $py ([single]$paperW) ([single]$paperH) 14
$shadow = RoundedPath $px ($py + 8) ([single]$paperW) ([single]$paperH) 14
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(45, 15, 23, 42))), $shadow)
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255))), $paper)

# Bilah merek navy (terpotong mengikuti kertas)
$navy = [System.Drawing.Color]::FromArgb(2, 16, 43)
$clip = $paper.Clone()
$g.SetClip($clip)
$g.FillRectangle((New-Object System.Drawing.SolidBrush $navy), $px, $py, [single]$paperW, [single]$barH)
$g.ResetClip()
$g.DrawString('KASIR NOVA', (New-Object System.Drawing.Font($family, 22, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)),
  (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255))),
  [single]($px + $pad), [single]($py + 18))
$g.DrawString('STRUK PEMBAYARAN', (New-Object System.Drawing.Font($family, 13, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)),
  (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(120, 214, 255))),
  [single]($px + $pad), [single]($py + 40))

# Teks struk
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(17, 24, 39))
$muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(107, 114, 128))
$y = $py + $barH + $pad
foreach ($ln in $lines) {
  $f = if ($ln.S -eq 'b') { $fontB } else { $font }
  $br = if ($ln.S -eq 'm') { $muted } else { $dark }
  $g.DrawString($ln.T, $f, $br, [single]($px + $pad), [single]$y)
  $y += $lineH
}

$g.Dispose()

# Simpan JPEG (kualitas 92)
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [int64]92)
$bmp.Save($outPath, $enc, $params)
$bmp.Dispose()

$fi = Get-Item $outPath
Write-Host ("OK: {0} ({1}x{2}, {3:N0} byte, font {4})" -f $fi.FullName, $canvasW, $canvasH, $fi.Length, $family)
