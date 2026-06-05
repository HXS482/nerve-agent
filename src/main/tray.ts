import { app, Tray, Menu, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'

let tray: Tray | null = null

/**
 * 创建系统托盘
 * - 窗口关闭时不退出应用，最小化到托盘
 * - 点击托盘图标重新显示窗口
 * - 右键托盘显示菜单（显示/退出）
 */
export function createTray(getMainWindow: () => BrowserWindow | null): Tray {
  // 使用自定义图标
  const icon = nativeImage.createFromPath(
    join(__dirname, '../../resources/icons/icon_32x32.png')
  )

  tray = new Tray(icon)
  tray.setToolTip('Nerve Agent')

  // 更新右键菜单
  function updateMenu() {
    const mainWindow = getMainWindow()
    const isVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()

    const contextMenu = Menu.buildFromTemplate([
      {
        label: isVisible ? '隐藏窗口' : '显示窗口',
        click: () => {
          const win = getMainWindow()
          if (!win || win.isDestroyed()) return

          if (win.isVisible()) {
            win.hide()
          } else {
            win.show()
            win.focus()
          }
          updateMenu()
        },
      },
      { type: 'separator' },
      {
        label: '退出 Nerve',
        click: () => {
          // 真正退出应用
          app.quit()
        },
      },
    ])

    tray?.setContextMenu(contextMenu)
  }

  // 点击托盘图标：显示/隐藏窗口
  tray.on('click', () => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return

    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
    updateMenu()
  })

  // 初始化菜单
  updateMenu()

  // 监听窗口事件，更新菜单
  app.on('browser-window-created', (_event, window) => {
    window.on('show', updateMenu)
    window.on('hide', updateMenu)
  })

  return tray
}

/**
 * 更新托盘提示文字（可用于显示未读消息数等）
 */
export function updateTrayTooltip(text: string) {
  tray?.setToolTip(text)
}

/**
 * 销毁托盘
 */
export function destroyTray() {
  tray?.destroy()
  tray = null
}
