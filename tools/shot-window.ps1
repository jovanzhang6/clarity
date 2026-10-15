param(
  [string]$Out = 'D:\study\clarity\shot-window.png'
)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32Shot {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

$procs = Get-Process | Where-Object { $_.ProcessName -eq 'electron' -and $_.MainWindowHandle -ne 0 }
$proc = $procs | Select-Object -First 1
if (-not $proc) { Write-Output 'no electron window found'; exit 1 }

$hwnd = $proc.MainWindowHandle
$rect = New-Object Win32Shot+RECT
[Win32Shot]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { Write-Output "bad rect $w x $h"; exit 1 }

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT = 2: needed for DWM-composited (Electron/Chromium) windows
[Win32Shot]::PrintWindow($hwnd, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save($Out)
Write-Output "saved $Out ($w x $h) title='$($proc.MainWindowTitle)'"
