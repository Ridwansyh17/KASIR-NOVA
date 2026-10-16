<#
  mockup-colors.ps1 — peta warna kasar sebuah gambar mockup.

  Agen tidak dapat "melihat" PNG; skrip ini mencetak grid warna (kolom x baris)
  dari warna dominan tiap blok, sehingga susunan visual halaman (bilah atas,
  kartu, tab bawah, tombol aksen) dapat disimpulkan bersama hasil OCR.

  Pemakaian:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mockup-colors.ps1 `
      -Path KASIR-NOVA-V3-REFERENSI-LENGKAP/05-KASIR-MOBILE/02-DASHBOARD-KASIR-MOBILE.png `
      -Cols 10 -Rows 30
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$Cols = 10,
  [int]$Rows = 30
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile((Resolve-Path $Path))
$bmp = New-Object System.Drawing.Bitmap -ArgumentList @($img.Width, $img.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($img, 0, 0, $img.Width, $img.Height)
$g.Dispose()
$w = $img.Width; $h = $img.Height
$img.Dispose()

Write-Output "=== $Path  ($w x $h)  grid ${Cols}x${Rows} ==="
for ($r = 0; $r -lt $Rows; $r++) {
  $y0 = [int][Math]::Floor($r * $h / $Rows)
  $y1 = [int][Math]::Ceiling(($r + 1) * $h / $Rows)
  $line = 'y={0,5:N2} ' -f ($r / [double]$Rows)
  for ($c = 0; $c -lt $Cols; $c++) {
    $x0 = [int][Math]::Floor($c * $w / $Cols)
    $x1 = [int][Math]::Ceiling(($c + 1) * $w / $Cols)
    # warna rata-rata blok (sampling tiap 2 piksel agar cepat)
    $sr = 0; $sg = 0; $sb = 0; $n = 0
    for ($y = $y0; $y -lt $y1; $y += 2) {
      for ($x = $x0; $x -lt $x1; $x += 2) {
        $p = $bmp.GetPixel($x, $y)
        $sr += $p.R; $sg += $p.G; $sb += $p.B; $n++
      }
    }
    if ($n -eq 0) { $line += '------ '; continue }
    $line += ('#{0:X2}{1:X2}{2:X2} ' -f [int]($sr / $n), [int]($sg / $n), [int]($sb / $n))
  }
  Write-Output $line
}
$bmp.Dispose()
