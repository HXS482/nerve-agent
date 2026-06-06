import './proxy-bootstrap' // 必须在最前面，全局代理 HTTP/HTTPS
import { app, BrowserWindow, shell, ipcMain, screen, protocol, net, Menu } from 'electron'
import { join, resolve } from 'path'
import { homedir } from 'os'

import { is } from '@electron-toolkit/utils'
import { ClaudeService } from './claude'
import { GitService } from './git'
import { PetSkinManager } from './pet-skins'
import { setupIPC } from './ipc'
import { IPC_CHANNELS } from '../shared/types'
import { applyDwmFix } from './dwm'
import { initImagesDir } from './images'
import { injectSettingsEnv, getChannels, getProxy, getGatewayPublicAccess } from './settings'
import { MemoryTdaiCore } from './memory-tdai'
import { OffloadBridge } from './offload-bridge'
import { createTray } from './tray'
import { NerveGateway } from './gateway'
import OpenAI from 'openai'

// Suppress noisy AI SDK warnings (MiMo reasoning metadata not recognized by Anthropic SDK)
process.env.AI_SDK_LOG_WARNINGS = 'false'

// Suppress EPIPE errors from console.log in dev mode (broken pipe to parent process)
process.on('uncaughtException', (err) => {
  if ((err as any).code === 'EPIPE') return
  console.error(err)
})

// Window control IPC — registered once, reference updated per window
let currentMainWindow: BrowserWindow | null = null
const MAIN_WINDOW_RADIUS = 16
const MAIN_WINDOW_SHAPE_GUARD_RADIUS = 15

ipcMain.on('window:minimize', () => currentMainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (currentMainWindow?.isMaximized()) currentMainWindow.unmaximize()
  else currentMainWindow?.maximize()
})
ipcMain.on('window:close', () => {
  // 最小化到托盘，而不是关闭窗口
  currentMainWindow?.hide()
})

function buildRoundedWindowShape(width: number, height: number, radius: number) {
  const rects: Electron.Rectangle[] = []
  const r = Math.min(radius, Math.floor(width / 2), Math.floor(height / 2))

  for (let y = 0; y < height; y++) {
    let inset = 0

    if (y < r) {
      const dy = r - y - 0.5
      inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)))
    } else if (y >= height - r) {
      const dy = y - (height - r) + 0.5
      inset = Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)))
    }

    rects.push({ x: inset, y, width: Math.max(0, width - inset * 2), height: 1 })
  }

  return rects
}

function applyMainWindowShape(window: BrowserWindow) {
  if (process.platform !== 'win32' || window.isDestroyed()) return

  if (window.isMaximized() || window.isFullScreen()) {
    window.setShape([])
    return
  }

  const { width, height } = window.getBounds()
  window.setShape(buildRoundedWindowShape(width, height, MAIN_WINDOW_SHAPE_GUARD_RADIUS))
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '',
    show: false,
    frame: false,
    transparent: true,
    icon: join(__dirname, '../../resources/icons/icon_256x256.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    thickFrame: false,
    roundedCorners: false,
    backgroundMaterial: 'none',
    backgroundColor: '#00000000',
    shadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false,
    },
  })

  // Apply DWM fix before window is visible —抢先 in DWM's first render
  applyDwmFix(window)
  applyMainWindowShape(window)

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle('')
  })

  // DWM can redraw the inactive frame on focus changes, so keep the HWND style clean.
  const syncWindowChrome = () => {
    applyDwmFix(window)
    applyMainWindowShape(window)
  }

  window.on('focus', syncWindowChrome)
  window.on('blur', syncWindowChrome)
  window.on('restore', syncWindowChrome)
  window.on('unmaximize', syncWindowChrome)
  window.on('maximize', syncWindowChrome)
  window.on('resize', syncWindowChrome)

  // Capture renderer console messages
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const prefix = ['VERBOSE', 'INFO', 'WARNING', 'ERROR'][level] || 'LOG'
    console.log(`[Renderer ${prefix}] ${message} (${sourceId}:${line})`)
  })

  window.setBackgroundColor('#00000000')

  // Re-apply DWM fix + show after page loads
  window.webContents.on('did-finish-load', () => {
    syncWindowChrome()
    window.show()
  })

  currentMainWindow = window
  return window
}

function createPetWindow(): { petWin: BrowserWindow; setMainWindow: (win: BrowserWindow) => void } {
  const display = screen.getPrimaryDisplay()
  const { width: screenW, height: screenH } = display.workAreaSize

  const petWin = new BrowserWindow({
    width: 150,
    height: 210,
    x: screenW - 210,
    y: screenH - 270,
    frame: false,
    transparent: true,
    backgroundColor: '#0d0d0d',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    shadow: false,
    focusable: false,
    show: false,
    title: '',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false,
    },
  })

  petWin.setBackgroundColor('#00000000')
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Use 'floating' level so pet stays above main window even when main window has focus
  petWin.setAlwaysOnTop(true, 'floating')

  // Helper: nudge the window to force DWM to render active frame (removes white title bar)
  function nudgeWindow() {
    const [x, y] = petWin.getPosition()
    petWin.setPosition(x + 1, y)
    petWin.setPosition(x, y)
  }

  // Receive shape data from renderer and apply window clipping
  ipcMain.on(IPC_CHANNELS.PET_SET_SHAPE, (_event, rects: { x: number; y: number; width: number; height: number }[]) => {
    if (rects && rects.length > 0 && !petWin.isDestroyed()) {
      petWin.setShape(rects)
    }
  })

  // Load pet route
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    petWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/pet`)
  } else {
    petWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/pet' })
  }

  // Pet state
  let petDocked = false
  let petVisible = false
  let dragOffset: { x: number; y: number } | null = null
  let mainWindowRef: BrowserWindow | null = null
  let currentWinPos: { x: number; y: number } = { x: screenW - 200, y: screenH - 240 }

  function sendPetStatus() {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send(IPC_CHANNELS.PET_STATUS, { visible: petVisible, docked: petDocked })
    }
  }

  ipcMain.on(IPC_CHANNELS.PET_DRAG_START, (_event, mouseX: number, mouseY: number) => {
    const [winX, winY] = petWin.getPosition()
    dragOffset = { x: mouseX - winX, y: mouseY - winY }
    currentWinPos = { x: winX, y: winY }
  })

  ipcMain.on(IPC_CHANNELS.PET_DRAG_MOVE, (_event, screenX: number, screenY: number) => {
    if (dragOffset) {
      const newX = screenX - dragOffset.x
      const newY = screenY - dragOffset.y
      petWin.setPosition(newX, newY)
      currentWinPos = { x: newX, y: newY }
    }
  })

  ipcMain.on(IPC_CHANNELS.PET_DRAG_END, () => {
    dragOffset = null

    const petCenterX = currentWinPos.x + 64
    const petCenterY = currentWinPos.y + 80

    const mainBounds = mainWindowRef?.getBounds()
    if (!mainBounds) return

    const sidebarLeft = mainBounds.x + 4
    const sidebarRight = mainBounds.x + 4 + 208
    const homeTop = mainBounds.y + mainBounds.height - 180
    const homeBottom = mainBounds.y + mainBounds.height - 4

    const isNearHome =
      petCenterX >= sidebarLeft &&
      petCenterX <= sidebarRight &&
      petCenterY >= homeTop &&
      petCenterY <= homeBottom

    if (isNearHome) {
      petDocked = true
      petVisible = true
      petWin.hide()
      sendPetStatus()
    }
  })

  // Get current pet state (for renderer sync on mount)
  ipcMain.handle(IPC_CHANNELS.PET_GET_STATE, () => ({
    visible: petVisible,
    docked: petDocked,
  }))

  // Toggle pet on/off
  ipcMain.handle(IPC_CHANNELS.PET_TOGGLE, () => {
    if (petVisible) {
      // Turn OFF
      petVisible = false
      petDocked = false
      petWin.hide()
      sendPetStatus()
      return false
    } else {
      // Turn ON — dock directly in sidebar home (not floating)
      petVisible = true
      petDocked = true
      petWin.hide()
      sendPetStatus()
      return true
    }
  })

  // Undock - release pet from sidebar back to floating
  ipcMain.handle(IPC_CHANNELS.PET_UNDOCK, () => {
    if (!petVisible) return
    petDocked = false
    petWin.show()
    setTimeout(() => nudgeWindow(), 50)
    sendPetStatus()
  })

  // Relay color scheme from sidebar to pet window
  ipcMain.on(IPC_CHANNELS.PET_COLOR_SCHEME, (_event, scheme: string) => {
    if (!petWin.isDestroyed()) {
      petWin.webContents.send(IPC_CHANNELS.PET_COLOR_SCHEME, scheme)
    }
  })

  // Expose mainWindowRef setter
  return { petWin, setMainWindow: (win: BrowserWindow) => { mainWindowRef = win } }
}

// Register custom protocol for serving pet spritesheets
// Must be before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pet-sprite',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const mainWindow = createWindow()
  const { petWin, setMainWindow } = createPetWindow()
  setMainWindow(mainWindow)

  // 创建系统托盘 — 窗口关闭时最小化到托盘，不退出应用
  createTray(() => currentMainWindow)

  // Setup Claude service, Git service, and IPC
  const projectDir = process.cwd()
  injectSettingsEnv()
  initImagesDir(projectDir)
  const claude = new ClaudeService(mainWindow, projectDir)
  const skinManager = new PetSkinManager()
  const gitService = new GitService()
  claude.setPetWindow(petWin)

  // Initialize TencentDB memory system
  const memoryCore = new MemoryTdaiCore(projectDir, claude.getSettings())
  memoryCore.initialize().catch((err) => console.error('[Nerve] MemoryTdaiCore init failed:', err))
  claude.setMemoryCore(memoryCore)

  // Initialize OffloadBridge (context compression for long conversations)
  const offloadSettings = claude.getSettings()
  if (offloadSettings.extraction?.baseURL && offloadSettings.extraction?.authToken) {
    try {
      const offloadClient = new OpenAI({
        baseURL: offloadSettings.extraction.baseURL.replace(/\/v1$/, ''),
        apiKey: offloadSettings.extraction.authToken,
      })
      const offloadBridge = new OffloadBridge({
        client: offloadClient,
        model: offloadSettings.extraction.model || 'deepseek-chat',
        contextWindow: 128_000,
        compressRatio: 0.6,
      })
      claude.setOffloadBridge(offloadBridge)
      console.log('[Nerve] OffloadBridge initialized')
    } catch (err) {
      console.error('[Nerve] OffloadBridge init failed:', err)
    }
  }

  // 从 settings 加载公网访问配置
  const publicAccess = await getGatewayPublicAccess()
  const gatewayHost = publicAccess ? '0.0.0.0' : '127.0.0.1'
  if (publicAccess) {
    console.log('[Nerve] Gateway public access enabled — listening on 0.0.0.0')
  }

  // 创建 Gateway 实例
  const gateway = new NerveGateway({
    port: 18789,
    host: gatewayHost,
    auth: { mode: 'token', secret: 'nerve-default-token' },
    dataDir: join(homedir(), '.nerve'),
    projectDir: projectDir,
    sourceDir: projectDir,
  })

  // 从 settings 加载代理配置和 IM 适配器
  Promise.all([getProxy(), getChannels()]).then(([proxy, channels]) => {
    gateway.setProxy(proxy)
    if (channels.length > 0) {
      return gateway.loadAdapters(channels)
    }
  }).catch(err => {
    console.error('[Nerve] Failed to load gateway config:', err)
  })

  setupIPC(mainWindow, claude, skinManager, gitService, gateway)

  // Handle pet-sprite:// protocol for serving local spritesheets
  const petsDir = join(homedir(), '.nerve', 'pets')
  protocol.handle('pet-sprite', (request) => {
    const url = new URL(request.url)
    const skinId = url.hostname
    const filename = url.pathname.slice(1) // remove leading /
    const resolved = resolve(petsDir, skinId, filename)
    if (!resolved.startsWith(petsDir)) return new Response('Not found', { status: 404 })
    return net.fetch(`file://${resolved.replace(/\\/g, '/')}`)
  })

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  app.on('activate', () => {
    // macOS dock 点击：显示窗口或创建新窗口
    if (currentMainWindow && !currentMainWindow.isDestroyed()) {
      currentMainWindow.show()
      currentMainWindow.focus()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      const newWindow = createWindow()
      const gitService = new GitService()
      claude.setWindow(newWindow)
      setupIPC(newWindow, claude, skinManager, gitService)
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        newWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
        newWindow.webContents.openDevTools()
      } else {
        newWindow.loadFile(join(__dirname, '../renderer/index.html'))
      }
    }
  })
})

app.on('window-all-closed', () => {
  // 托盘常驻模式：窗口关闭不退出应用
  // 记忆引擎和 Claude 服务保持运行
  // 用户可以通过托盘图标重新打开窗口
  // 真正退出通过托盘右键菜单的"退出 Nerve"

  // 应用退出前清理
  app.on('before-quit', async () => {
    await memoryCore.destroy().catch(() => {})
    await claude.close()
  })
})
