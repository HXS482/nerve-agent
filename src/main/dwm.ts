import { BrowserWindow } from 'electron'
import { execSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export function applyDwmFix(win: BrowserWindow) {
  if (win.isDestroyed()) return
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0)
  if (!hwnd) return

  const [w, h] = win.getSize()
  const radius = 16 // matches --app-window-radius

  const script = `
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct MARGINS { public int Left, Right, Top, Bottom; }
[StructLayout(LayoutKind.Sequential)]
public struct POINT { public int X, Y; }
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
public struct RGNDATAHEADER { public int dwSize, iType, nCount, nRgnSize; public RECT rcBound; }
[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int Left, Top, Right, Bottom; }
public class Dwm {
    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    [DllImport("dwmapi.dll")]
    public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);
    [DllImport("user32.dll")]
    public static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h);
    [DllImport("user32.dll")]
    public static extern int SetWindowRgn(IntPtr hwnd, IntPtr hRgn, bool bRedraw);
}'
$hwnd = [IntPtr]::New(${hwnd})

# 1. Disable non-client rendering
$policy = 1
[void][Dwm]::DwmSetWindowAttribute($hwnd, 2, [ref]$policy, 4)

# 2. Set border color to none
$color = -2
[void][Dwm]::DwmSetWindowAttribute($hwnd, 34, [ref]$color, 4)

# 3. Extend frame into client area (prevents inactive frame)
$m = New-Object MARGINS
$m.Left = -1; $m.Right = -1; $m.Top = -1; $m.Bottom = -1
[void][Dwm]::DwmExtendFrameIntoClientArea($hwnd, [ref]$m)

# 4. Clip window to rounded rectangle to hide white corners on blur
$r = [IntPtr][Dwm]::CreateRoundRectRgn(0, 0, ${w}, ${h}, ${radius * 2}, ${radius * 2})
[void][Dwm]::SetWindowRgn($hwnd, $r, $true)
`.trim()

  const tmpFile = join(tmpdir(), `dwm-${Date.now()}.ps1`)
  try {
    writeFileSync(tmpFile, script, 'utf-8')
    execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, {
      stdio: 'pipe',
      timeout: 5000,
    })
    console.log('[DWM] All fixes applied (including rounded clip region)')
  } catch (e) {
    console.warn('[DWM] Failed:', (e as Error).message?.slice(0, 200))
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
}
