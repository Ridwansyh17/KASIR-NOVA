<#
  mockup-region.ps1 — palet warna sebuah wilayah (region) mockup.

  Dipakai untuk memastikan warna elemen tertentu (mis. logo di bilah atas,
  bilah navigasi bawah, tombol utama) tanpa melihat gambar secara visual.

  Pemakaian:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mockup-region.ps1 `
      -Path 'gambar.png' -X0 0.0 -Y0 0.925 -X1 1.0 -Y1 0.995 -Label 'bottom-nav'
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [double]$X0 = 0, [double]$Y0 = 0, [double]$X1 = 1, [double]$Y1 = 1,
  [string]$Label = 'region',
  [int]$Top = 6
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

$x0 = [int]($X0 * $w); $x1 = [int][Math]::Ceiling($X1 * $w)
$y0 = [int]($Y0 * $h); $y1 = [int][Math]::Ceiling($Y1 * $h)

$counts = @{}
for ($y = $y0; $y -lt $y1; $y++) {
  for ($x = $x0; $x -lt $x1; $x++) {
    $c = $bmp.GetPixel($x, $y)
    # kuantisasi 8 tingkat per kanal agar warna mirip tergabung
    $r = [int]($c.R / 32) * 32; $g2 = [int]($c.G / 32) * 32; $b2 = [int]($c.B / 32) * 32
    $key = ('#{0:X2}{1:X2}{2:X2}' -f [Math]::Min($r, 255), [Math]::Min($g2, 255), [Math]::Min($b2, 255))
    if (-not $counts.ContainsKey($key)) { $counts[$key] = 0 }
    $counts[$key]++
  }
}
$total = ($y1 - $y0) * ($x1 - $x0)
$name = Split-Path $Path -Leaf
Write-Output ("--- " + $name + "  region[" + $X0 + "," + $Y0 + " -> " + $X1 + "," + $Y1 + "]  " + $Label)
$counts.GetEnumerator() | Sort-Object { -$_.Value } | Select-Object -First 8 | ForEach-Object {
  Write-Output ("     {0}  {1,5:N1}%" -f $_.Key, (100.0 * $_.Value / $total))
}
$bmp.Dispose()
