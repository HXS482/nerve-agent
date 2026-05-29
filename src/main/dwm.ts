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
    [DllImport("user32.dll")]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("dwmapi.dll")]
    public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);
}'
$hwnd = [IntPtr]::New(${hwnd})

# Remove WS_CAPTION and WS_THICKFRAME to eliminate DWM non-client area
$GWL_STYLE = -16
$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$WS_SYSMENU = 0x00080000
$WS_MAXIMIZEBOX = 0x00010000
$WS_MINIMIZEBOX = 0x00020000
$style = [Win32]::GetWindowLong($hwnd, $GWL_STYLE)
$style = $style -band (-bnot ($WS_CAPTION -bor $WS_THICKFRAME -bor $WS_SYSMENU -bor $WS_MAXIMIZEBOX -bor $WS_MINIMIZEBOX))
[Win32]::SetWindowLong($hwnd, $GWL_STYLE, $style) | Out-Null

# Extend frame into client area (all -1) to remove any residual frame
$m = New-Object MARGINS
$m.Left = -1; $m.Right = -1; $m.Top = -1; $m.Bottom = -1
[Win32]::DwmExtendFrameIntoClientArea($hwnd, [ref]$m)
`.trim()

  const tmpFile = join(tmpdir(), `dwm-${Date.now()}.ps1`)
  try {
    writeFileSync(tmpFile, script, 'utf-8')
    execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, {
      stdio: 'pipe',
      timeout: 5000,
    })
    console.log('[DWM] Frame removed')
  } catch (e) {
    console.warn('[DWM] Failed:', (e as Error).message?.slice(0, 200))
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
}
