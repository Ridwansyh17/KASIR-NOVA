<#
  mockup-bands.ps1 — rata-rata warna per pita horizontal sebuah mockup.

  Dipakai untuk mengetahui warna bilah atas (topbar), bilah bawah (bottom nav),
  dan badan halaman tanpa melihat gambar secara visual.

  Pemakaian:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mockup-bands.ps1 `
      -Paths 'a.png','b.png' -Step 25
#>
param(
  [Parameter(Mandatory = $true)][string[]]$Paths,
  [int]$Step = 25
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Show-Bands([string]$p, [int]$step) {
  $img = [System.Drawing.Image]::FromFile((Resolve-Path $p))
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList @($img.Width, $img.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImage($img, 0, 0, $img.Width, $img.Height)
  $g.Dispose()
  $w = $img.Width; $h = $img.Height
  $img.Dispose()

  Write-Output ("--- " + (Split-Path $p -Leaf) + "  " + $w + "x" + $h)
  for ($i = 0; $i -lt $step; $i++) {
    $y0 = [int][Math]::Floor($i * $h / $step)
    $y1 = [int][Math]::Ceiling(($i + 1) * $h / $step)
    $cols = @()
    foreach ($span in @(@(0.0, 1.0), @(0.0, 0.18), @(0.82, 1.0))) {
      $x0 = [int]($span[0] * $w); $x1 = [int][Math]::Ceiling($span[1] * $w)
      $sr = 0; $sg = 0; $sb = 0; $n = 0
      for ($y = $y0; $y -lt $y1; $y += 2) {
        for ($x = $x0; $x -lt $x1; $x += 2) {
          $c = $bmp.GetPixel($x, $y); $sr += $c.R; $sg += $c.G; $sb += $c.B; $n++
        }
      }
      $cols += ('#{0:X2}{1:X2}{2:X2}' -f ([int]($sr / $n)), ([int]($sg / $n)), ([int]($sb / $n)))
    }
    Write-Output ("  y={0,5:N2}-{1,5:N2}  all={2}  L={3}  R={4}" -f ($y0 / [double]$h), ($y1 / [double]$h), $cols[0], $cols[1], $cols[2])
  }
  $bmp.Dispose()
}

foreach ($p in $Paths) { Show-Bands $p $Step }
