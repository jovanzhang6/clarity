Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  public static List<string> List() {
    var result = new List<string>();
    EnumWindows((h, lp) => {
      if (!IsWindowVisible(h)) return true;
      var title = new StringBuilder(256); GetWindowText(h, title, 256);
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      int w = r.Right - r.Left, ht = r.Bottom - r.Top;
      if (w < 80 || ht < 60) return true;
      result.Add(string.Format("pid={0} cls={1} rect=({2},{3})-({4},{5}) size={6}x{7} title={8}",
        pid, cls, r.Left, r.Top, r.Right, r.Bottom, w, ht, title));
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@

[WinEnum]::List() | ForEach-Object { $_ }
