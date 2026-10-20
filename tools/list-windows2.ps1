Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinEnum3 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  public static string List() {
    var sb = new System.Text.StringBuilder();
    EnumWindows((h, lp) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      var title = new StringBuilder(256); GetWindowText(h, title, 256);
      RECT r; GetWindowRect(h, out r);
      int w = r.Right - r.Left, ht = r.Bottom - r.Top;
      if (w < 60 || ht < 30) return true;
      sb.AppendLine(string.Format("pid={0} rect=({1},{2}) size={3}x{4} title=[{5}]", pid, r.Left, r.Top, w, ht, title));
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
'@
[WinEnum3]::List()
