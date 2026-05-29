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
public class Win32 {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("dwmapi.dll")]
    public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);
}'
$hwnd = [IntPtr]::New(${hwnd})
$GWL_STYLE = -16

# Read current style, strip caption + thickframe
$style = [Win32]::GetWindowLong($hwnd, $GWL_STYLE)
$style = $style -band (-bnot (0x00C00000 -bor 0x00040000))
[Win32]::SetWindowLong($hwnd, $GWL_STYLE, $style) | Out-Null

# Extend frame into client area
$m = New-Object MARGINS
$m.Left = -1; $m.Right = -1; $m.Top = -1; $m.Bottom = -1
[Win32]::DwmExtendFrameIntoClientArea($hwnd, [ref]$m)
`.trim()

  const tmpFile = join(tmpdir(), `dwm-${Date.now()}.ps1`)
  try {
    writeFileSync(tmpFile, script, 'utf-8')
    execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, {
      stdio: 'pipe',
      timeout: 10000,
    })
    console.log('[DWM] Frame removed')
  } catch (e) {
    console.warn('[DWM] Failed:', (e as Error).message?.slice(0, 200))
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
}
