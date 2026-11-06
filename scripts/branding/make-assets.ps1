<#
.SYNOPSIS
  Generates storageCleaner's brand assets: the app icon source and the
  installer artwork (NSIS sidebar + header bitmaps).

.DESCRIPTION
  Everything is drawn in code with System.Drawing so it can be tweaked and
  regenerated. Outputs:
    scripts/branding/out/icon.png            1024x1024 app icon source
    app/src-tauri/installer/sidebar.bmp      164x314  Welcome/Finish page art
    app/src-tauri/installer/header.bmp       150x57   inner page header
  (+ .png previews of the bitmaps in scripts/branding/out/)

  Then build every icon size with:  cd app; npx tauri icon ../scripts/branding/out/icon.png

.EXAMPLE
  ./scripts/branding/make-assets.ps1
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$out = Join-Path $PSScriptRoot 'out'
$installer = Join-Path $root 'app/src-tauri/installer'
New-Item -ItemType Directory -Force $out, $installer | Out-Null

# Brand palette: warm dark + orange, mint for "freed" (matches the app theme).
$indigo = [System.Drawing.Color]::FromArgb(255, 255, 122, 47)    # orange  #ff7a2f (primary)
$indigoLight = [System.Drawing.Color]::FromArgb(255, 255, 177, 108) # orange-light #ffb16c
$cyan = [System.Drawing.Color]::FromArgb(255, 232, 93, 4)        # deep orange #e85d04
$mint = [System.Drawing.Color]::FromArgb(255, 110, 231, 183)     # mint #6ee7b7
$bgTop = [System.Drawing.Color]::FromArgb(255, 26, 19, 15)       # #1a130f
$bgBottom = [System.Drawing.Color]::FromArgb(255, 12, 9, 7)      # #0c0907
$tileTop = [System.Drawing.Color]::FromArgb(255, 52, 36, 26)     # #34241a
$muted = [System.Drawing.Color]::FromArgb(255, 168, 150, 136)    # #a89688
$white = [System.Drawing.Color]::White

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  return @($bmp, $g)
}

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# The logo: gradient tile with a disk-usage ring (most of the ring "used",
# a bright cyan slice "freed") and a small sparkle for "clean".
function Draw-Logo($g, [float]$x, [float]$y, [float]$size) {
  $tile = New-RoundRect $x $y $size $size ($size * 0.22)
  $rect = New-Object System.Drawing.RectangleF $x, $y, $size, $size
  # Dark warm tile with a thin orange rim.
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $tileTop, $bgBottom, 60.0
  $g.FillPath($grad, $tile)
  $rw = [Math]::Max(1.0, $size * 0.012)
  $rimPath = New-RoundRect ($x + $rw) ($y + $rw) ($size - 2 * $rw) ($size - 2 * $rw) ($size * 0.21)
  $rim = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(80, 255, 122, 47)), $rw
  $g.DrawPath($rim, $rimPath)

  # Soft top highlight for depth.
  $hl = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(22, 255, 200, 160)), ([System.Drawing.Color]::FromArgb(0, 255, 255, 255)), 90.0
  $g.FillPath($hl, $tile)

  $cx = $x + $size / 2; $cy = $y + $size / 2
  $r = $size * 0.27
  $w = $size * 0.11
  $ring = New-Object System.Drawing.RectangleF ($cx - $r), ($cy - $r), ($r * 2), ($r * 2)
  # Faint full track, then the bright "used" arc: reads as a disk-usage gauge.
  $track = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(45, 255, 177, 108)), $w
  $g.DrawEllipse($track, $ring)
  # Gradient area covers the whole stroke (ring + pen width) so it never repeats.
  $gradRect = New-Object System.Drawing.RectangleF ($cx - $r - $w), ($cy - $r - $w), (($r + $w) * 2), (($r + $w) * 2)
  $usedBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $gradRect, $indigoLight, $cyan, 90.0
  $usedBrush.WrapMode = [System.Drawing.Drawing2D.WrapMode]::TileFlipXY
  $used = New-Object System.Drawing.Pen $usedBrush, $w
  $used.StartCap = 'Round'; $used.EndCap = 'Round'
  $g.DrawArc($used, $ring, 0, 270)  # gap at the top-right = freed space

  # Sparkle (four-point star) at the top-right of the ring.
  $s = $size * 0.12
  # Sparkle sits in the gap of the ring.
  $sx = $cx + $r * 0.72; $sy = $cy - $r * 0.72
  $star = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pts = @(
    (New-Object System.Drawing.PointF $sx, ($sy - $s)),
    (New-Object System.Drawing.PointF ($sx + $s * 0.28), ($sy - $s * 0.28)),
    (New-Object System.Drawing.PointF ($sx + $s), $sy),
    (New-Object System.Drawing.PointF ($sx + $s * 0.28), ($sy + $s * 0.28)),
    (New-Object System.Drawing.PointF $sx, ($sy + $s)),
    (New-Object System.Drawing.PointF ($sx - $s * 0.28), ($sy + $s * 0.28)),
    (New-Object System.Drawing.PointF ($sx - $s), $sy),
    (New-Object System.Drawing.PointF ($sx - $s * 0.28), ($sy - $s * 0.28))
  )
  $star.AddPolygon([System.Drawing.PointF[]]$pts)
  $g.FillPath((New-Object System.Drawing.SolidBrush $mint), $star)
}

function Save-Bmp24($bmp, [string]$path) {
  # NSIS needs a plain 24-bit BMP (no alpha).
  $flat = New-Object System.Drawing.Bitmap $bmp.Width, $bmp.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $fg = [System.Drawing.Graphics]::FromImage($flat)
  $fg.DrawImage($bmp, 0, 0, $bmp.Width, $bmp.Height)
  $fg.Dispose()
  $flat.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $flat.Dispose()
}

# ── App icon (1024 px, transparent corners) ─────────────────────────────
$icon, $g = New-Canvas 1024 1024
Draw-Logo $g 40 40 944
$g.Dispose()
$icon.Save((Join-Path $out 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Dispose()
Write-Host "  icon.png"

# ── Installer sidebar (164 x 314): Welcome & Finish pages ───────────────
$sb, $g = New-Canvas 164 314
$full = New-Object System.Drawing.Rectangle 0, 0, 164, 314
$g.FillRectangle((New-Object System.Drawing.Drawing2D.LinearGradientBrush $full, $bgTop, $bgBottom, 90.0), $full)

# Indigo glow behind the logo.
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath
$glow.AddEllipse(-40, -10, 244, 200)
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
$pgb.CenterColor = [System.Drawing.Color]::FromArgb(85, 255, 122, 47)
$pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 122, 47))
$g.FillPath($pgb, $glow)

# Decorative usage rings in the lower part.
$ringPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(30, 255, 177, 108)), 2
foreach ($rr in 50, 80, 110) { $g.DrawEllipse($ringPen, 82 - $rr, 300 - $rr, $rr * 2, $rr * 2) }
$arcPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 110, 231, 183)), 3
$arcPen.StartCap = 'Round'; $arcPen.EndCap = 'Round'
$g.DrawArc($arcPen, 82 - 80, 300 - 80, 160, 160, 200, 70)

Draw-Logo $g 50 46 64

$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'
$fontBold = New-Object System.Drawing.Font 'Segoe UI', 15, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontSmall = New-Object System.Drawing.Font 'Segoe UI', 10.5, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
# Two-tone wordmark: "storage" white + "Cleaner" cyan, centered as one word.
$w1 = $g.MeasureString('storage', $fontBold, 999, [System.Drawing.StringFormat]::GenericTypographic).Width
$w2 = $g.MeasureString('Cleaner', $fontBold, 999, [System.Drawing.StringFormat]::GenericTypographic).Width
$startX = (164 - ($w1 + $w2)) / 2
$g.DrawString('storage', $fontBold, (New-Object System.Drawing.SolidBrush $white), $startX, 124, [System.Drawing.StringFormat]::GenericTypographic)
$cyanBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.RectangleF ($startX + $w1), 124, $w2, 20), $indigoLight, $cyan, 0.0
$g.DrawString('Cleaner', $fontBold, $cyanBrush, $startX + $w1, 124, [System.Drawing.StringFormat]::GenericTypographic)
$g.DrawString('Disk analyzer', $fontSmall, (New-Object System.Drawing.SolidBrush $muted), (New-Object System.Drawing.RectangleF 0, 150, 164, 16), $fmt)
$g.DrawString('& safe cleaner', $fontSmall, (New-Object System.Drawing.SolidBrush $muted), (New-Object System.Drawing.RectangleF 0, 164, 164, 16), $fmt)

# Accent line.
$line = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 52, 190, 60, 2), $indigo, $cyan, 0.0
$g.FillRectangle($line, 52, 190, 60, 2)
$g.Dispose()
Save-Bmp24 $sb (Join-Path $installer 'sidebar.bmp')
$sb.Save((Join-Path $out 'sidebar-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$sb.Dispose()
Write-Host "  sidebar.bmp"

# ── Installer header (150 x 57): top-right of every inner page ──────────
# The header area is light: clean white banner, two-tone wordmark + logo.
$hd, $g = New-Canvas 150 57
$g.Clear($white)
$fontHead = New-Object System.Drawing.Font 'Segoe UI', 13, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$gt = [System.Drawing.StringFormat]::GenericTypographic
$hw1 = $g.MeasureString('storage', $fontHead, 999, $gt).Width
$hw2 = $g.MeasureString('Cleaner', $fontHead, 999, $gt).Width
$tx = 104 - ($hw1 + $hw2)
$g.DrawString('storage', $fontHead, (New-Object System.Drawing.SolidBrush $bgTop), $tx, 20, $gt)
$hb = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.RectangleF ($tx + $hw1), 20, $hw2, 16), $indigo, $cyan, 0.0
$g.DrawString('Cleaner', $fontHead, $hb, $tx + $hw1, 20, $gt)
Draw-Logo $g 110 10 37
$g.Dispose()
Save-Bmp24 $hd (Join-Path $installer 'header.bmp')
$hd.Save((Join-Path $out 'header-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$hd.Dispose()
Write-Host "  header.bmp"

Write-Host "Done. Next: cd app; npx tauri icon ../scripts/branding/out/icon.png"
