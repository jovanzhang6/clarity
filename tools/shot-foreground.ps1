param(
  [string]$Out = 'D:\study\clarity\shot-live.png'
)
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinShow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@

$proc = Get-Process | Where-Object { $_.ProcessName -eq 'electron' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output 'no electron window'; exit 1 }

[WinShow]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null  # SW_RESTORE
[WinShow]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 900

$b = [Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size)
$g.Dispose()
$bmp.Save($Out)
Write-Output "saved $Out ($($b.Width) x $($b.Height))"
