import { BrowserWindow } from 'electron'
import { execSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export function applyDwmFix(win: BrowserWindow) {
  if (win.isDestroyed()) return
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0)
  if (!hwnd) return

  const script = `
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct MARGINS { public int Left, Right, Top, Bottom; }
public class Dwm {
    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    [DllImport("dwmapi.dll")]
    public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);
}'
$hwnd = [IntPtr]::New(${hwnd})

# 1. Disable non-client rendering
$policy = 1
[void][Dwm]::DwmSetWindowAttribute($hwnd, 2, [ref]$policy, 4)

# 2. Set border color to none
$color = -2
[void][Dwm]::DwmSetWindowAttribute($hwnd, 34, [ref]$color, 4)

# 3. Enable immersive dark mode so DWM frame is dark, not white
$dark = 1
[void][Dwm]::DwmSetWindowAttribute($hwnd, 20, [ref]$dark, 4)

# 4. Extend frame into client area
$m = New-Object MARGINS
$m.Left = -1; $m.Right = -1; $m.Top = -1; $m.Bottom = -1
[void][Dwm]::DwmExtendFrameIntoClientArea($hwnd, [ref]$m)
`.trim()

  const tmpFile = join(tmpdir(), `dwm-${Date.now()}.ps1`)
  try {
    writeFileSync(tmpFile, script, 'utf-8')
    execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, {
      stdio: 'pipe',
      timeout: 5000,
    })
    console.log('[DWM] All fixes applied')
  } catch (e) {
    console.warn('[DWM] Failed:', (e as Error).message?.slice(0, 200))
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
}
