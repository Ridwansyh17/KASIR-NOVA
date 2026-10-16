<#
  mockup-ocr.ps1 — ekstrak TEKS + POSISI dari gambar mockup KASIR NOVA.

  Agen tidak dapat "melihat" PNG. Skrip ini memakai OCR bawaan Windows
  (Windows.Media.Ocr; butuh Windows PowerShell 5.1) untuk membaca setiap gambar
  mockup, lalu menuliskan tiap baris teks beserta kotak batasnya (bounding box)
  dalam koordinat ternormalisasi 0..1. Dari koordinat itu tata letak halaman
  (topbar, kartu, tab bawah, dsb.) dapat disimpulkan.

  Gambar diperbesar lebih dulu (default 3x, bicubic) agar teks kecil pada
  mockup ponsel (510x1040 px) terbaca OCR.

  Pemakaian (dari root repo):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mockup-ocr.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mockup-ocr.ps1 `
      -Root KASIR-NOVA-V3-REFERENSI-LENGKAP/05-KASIR-MOBILE -Out mockup-mobile.txt
#>
param(
  [string]$Root = 'KASIR-NOVA-V3-REFERENSI-LENGKAP',
  [string]$Out = 'mockup-ocr.txt',
  [double]$Scale = 3.0,
  [int]$TargetWidth = 1600
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Media.Ocr.OcrEngine, Windows.Media, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'OCR engine tidak tersedia (Windows.Media.Ocr).' }

$root = (Resolve-Path $Root).Path
$files = Get-ChildItem $root -Recurse -File -Filter *.png | Sort-Object FullName
if ($files.Count -eq 0) { throw "Tidak ada PNG di $Root" }

if (Test-Path $Out) { Remove-Item $Out -Force }
$header = "# Hasil OCR mockup KASIR NOVA (koordinat ternormalisasi 0..1)" + "`r`n"
Set-Content -Path $Out -Value $header -Encoding UTF8

foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')

  $img = [System.Drawing.Image]::FromFile($f.FullName)
  $iw = $img.Width; $ih = $img.Height
  # Skala adaptif: pastikan lebar hasil >= TargetWidth (teks kecil tetap terbaca),
  # tetapi gambar besar tidak diperbesar tanpa perlu.
  $factor = [Math]::Max(1.0, $TargetWidth / [double]$iw)
  $sw = [int][Math]::Round($iw * $factor)
  $sh = [int][Math]::Round($ih * $factor)
  $scaled = New-Object System.Drawing.Bitmap -ArgumentList @($sw, $sh, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($scaled)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $sw, $sh)
  $g.Dispose()
  $img.Dispose()

  $tmpPng = Join-Path $env:TEMP ('nova-ocr-' + [guid]::NewGuid().ToString('N') + '.png')
  $scaled.Save($tmpPng, [System.Drawing.Imaging.ImageFormat]::Png)
  $scaled.Dispose()

  $lines = @()
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmpPng)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    foreach ($line in $result.Lines) {
      $x0 = [double]::MaxValue; $y0 = [double]::MaxValue; $x1 = 0.0; $y1 = 0.0
      foreach ($wd in $line.Words) {
        $r = $wd.BoundingRect
        if ($r.X -lt $x0) { $x0 = $r.X }
        if ($r.Y -lt $y0) { $y0 = $r.Y }
        if (($r.X + $r.Width) -gt $x1) { $x1 = $r.X + $r.Width }
        if (($r.Y + $r.Height) -gt $y1) { $y1 = $r.Y + $r.Height }
      }
      $lines += [pscustomobject]@{
        y = [Math]::Round($y0 / $sh, 3)
        x = [Math]::Round($x0 / $sw, 3)
        w = [Math]::Round(($x1 - $x0) / $sw, 3)
        text = (($line.Words | ForEach-Object { $_.Text }) -join ' ')
      }
    }
  } catch {
    $lines += [pscustomobject]@{ y = 0.0; x = 0.0; w = 0.0; text = "(OCR gagal: $($_.Exception.Message))" }
  } finally {
    Remove-Item $tmpPng -Force -ErrorAction SilentlyContinue
  }

  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("===== $rel  ($iw x $ih px)")
  $ordered = $lines | Sort-Object y, x
  if ($ordered.Count -eq 0) { [void]$sb.AppendLine('   (tidak ada teks terdeteksi)') }
  foreach ($l in $ordered) {
    [void]$sb.AppendLine(("  y={0,5:N3} x={1,5:N3} w={2,5:N3} | {3}" -f $l.y, $l.x, $l.w, $l.text))
  }
  $chunk = $sb.ToString()
  Write-Host $chunk -NoNewline
  Add-Content -Path $Out -Value $chunk -Encoding UTF8
}

Write-Output "Selesai. Keluaran: $Out"
