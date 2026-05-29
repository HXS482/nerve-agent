import { BrowserWindow } from 'electron'

let koffi: any = null
let user32: any = null
let dwmapi: any = null

function loadKoffi() {
  if (koffi) return
  try {
    koffi = require('koffi')
    user32 = koffi.load('user32.dll')
    dwmapi = koffi.load('dwmapi.dll')
  } catch {
    console.warn('[DWM] koffi not available')
  }
}

export function applyDwmFix(win: BrowserWindow) {
  if (win.isDestroyed()) return
  const hwnd = win.getNativeWindowHandle()
  if (!hwnd) return

  loadKoffi()
  if (!user32 || !dwmapi) return

  try {
    // Strip WS_CAPTION (0x00C00000) and WS_THICKFRAME (0x00040000)
    const GWL_STYLE = -16
    const WS_CAPTION = 0x00C00000
    const WS_THICKFRAME = 0x00040000

    const GetWindowLong = user32.func('int GetWindowLongW(void* hWnd, int nIndex)')
    const SetWindowLong = user32.func('int SetWindowLongW(void* hWnd, int nIndex, int dwNewLong)')

    const style = GetWindowLong(hwnd, GWL_STYLE)
    const newStyle = style & ~(WS_CAPTION | WS_THICKFRAME)
    SetWindowLong(hwnd, GWL_STYLE, newStyle)

    // Extend frame into client area (all -1) to remove residual frame
    const DwmExtendFrameIntoClientArea = dwmapi.func('int DwmExtendFrameIntoClientArea(void* hwnd, void* margins)')
    const margins = new Int32Array([-1, -1, -1, -1])
    DwmExtendFrameIntoClientArea(hwnd, margins)

    console.log('[DWM] Frame removed')
  } catch (e) {
    console.warn('[DWM] Failed:', (e as Error).message?.slice(0, 200))
  }
}
