import { BrowserWindow } from 'electron'

let user32: any = null
let dwmapi: any = null

function ensureLibs() {
  if (user32) return true
  try {
    const koffi = require('koffi')
    user32 = koffi.load('user32.dll')
    dwmapi = koffi.load('dwmapi.dll')
    return true
  } catch {
    console.warn('[DWM] koffi not available')
    return false
  }
}

export function applyDwmFix(win: BrowserWindow) {
  if (win.isDestroyed()) return
  if (!ensureLibs()) return

  const hwnd = win.getNativeWindowHandle()
  if (!hwnd) return

  try {
    const GWL_STYLE = -16
    const WS_CAPTION = 0x00C00000
    const WS_THICKFRAME = 0x00040000
    const SWP_FRAMECHANGED = 0x0020
    const SWP_NOMOVE = 0x0002
    const SWP_NOSIZE = 0x0001
    const SWP_NOZORDER = 0x0004

    const GetWindowLongW = user32.func('int GetWindowLongW(void* hWnd, int nIndex)')
    const SetWindowLongW = user32.func('int SetWindowLongW(void* hWnd, int nIndex, int dwNewLong)')
    const SetWindowPos = user32.func('int SetWindowPos(void* hWnd, void* hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)')
    const DwmExtendFrameIntoClientArea = dwmapi.func('int DwmExtendFrameIntoClientArea(void* hwnd, void* margins)')

    // Strip caption + thickframe
    const style = GetWindowLongW(hwnd, GWL_STYLE)
    SetWindowLongW(hwnd, GWL_STYLE, style & ~(WS_CAPTION | WS_THICKFRAME))

    // Extend frame into client area (all -1)
    const margins = new Int32Array([-1, -1, -1, -1])
    DwmExtendFrameIntoClientArea(hwnd, margins)

    // Force frame recalc
    SetWindowPos(hwnd, null, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER)

    console.log('[DWM] Frame removed')
  } catch (e) {
    console.warn('[DWM] Failed:', (e as Error).message?.slice(0, 200))
  }
}
