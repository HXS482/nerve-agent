import { BrowserWindow } from 'electron'

let user32: any = null
let dwmapi: any = null

function ensureLibs() {
  if (process.platform !== 'win32') return false
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
    const GWL_EXSTYLE = -20
    const WS_BORDER = 0x00800000
    const WS_CAPTION = 0x00C00000
    const WS_DLGFRAME = 0x00400000
    const WS_THICKFRAME = 0x00040000
    const WS_EX_DLGMODALFRAME = 0x00000001
    const WS_EX_CLIENTEDGE = 0x00000200
    const WS_EX_STATICEDGE = 0x00020000
    const WS_EX_WINDOWEDGE = 0x00000100
    const SWP_FRAMECHANGED = 0x0020
    const SWP_NOMOVE = 0x0002
    const SWP_NOSIZE = 0x0001
    const SWP_NOZORDER = 0x0004
    const SWP_NOACTIVATE = 0x0010
    const DWMWA_NCRENDERING_POLICY = 2
    const DWMWA_WINDOW_CORNER_PREFERENCE = 33
    const DWMWA_BORDER_COLOR = 34
    const DWMNCRP_DISABLED = 1
    const DWMWCP_DONOTROUND = 1
    const DWMWA_COLOR_NONE = 0xfffffffe

    const GetWindowLongW = user32.func('int GetWindowLongW(void* hWnd, int nIndex)')
    const SetWindowLongW = user32.func('int SetWindowLongW(void* hWnd, int nIndex, int dwNewLong)')
    const SetWindowPos = user32.func('int SetWindowPos(void* hWnd, void* hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)')
    const DwmSetWindowAttribute = dwmapi.func('int DwmSetWindowAttribute(void* hwnd, int dwAttribute, void* pvAttribute, uint cbAttribute)')

    const style = GetWindowLongW(hwnd, GWL_STYLE)
    const cleanStyle = style & ~(WS_CAPTION | WS_BORDER | WS_DLGFRAME | WS_THICKFRAME)
    if (cleanStyle !== style) {
      SetWindowLongW(hwnd, GWL_STYLE, cleanStyle)
    }

    const exStyle = GetWindowLongW(hwnd, GWL_EXSTYLE)
    const cleanExStyle = exStyle & ~(WS_EX_DLGMODALFRAME | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE | WS_EX_WINDOWEDGE)
    if (cleanExStyle !== exStyle) {
      SetWindowLongW(hwnd, GWL_EXSTYLE, cleanExStyle)
    }

    const ncPolicy = new Int32Array([DWMNCRP_DISABLED])
    DwmSetWindowAttribute(hwnd, DWMWA_NCRENDERING_POLICY, ncPolicy, 4)

    const cornerPreference = new Int32Array([DWMWCP_DONOTROUND])
    DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, cornerPreference, 4)

    const borderColor = new Uint32Array([DWMWA_COLOR_NONE])
    DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, borderColor, 4)

    SetWindowPos(hwnd, null, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
  } catch (e) {
    console.warn('[DWM] Failed:', (e as Error).message?.slice(0, 200))
  }
}
