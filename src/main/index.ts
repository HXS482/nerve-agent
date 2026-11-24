import './proxy-bootstrap' // 必须在最前面，全局代理 HTTP/HTTPS
import { app, BrowserWindow, shell, ipcMain, protocol, net, Menu } from 'electron'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { existsSync, statSync, createReadStream } from 'fs'
import { Readable } from 'stream'

import { is } from '@electron-toolkit/utils'
import chokidar from 'chokidar'
import { ClaudeService } from './claude'
import { GitService } from './git'
import { McpOAuthManager } from './mcp-oauth'
import { setupIPC } from './ipc'
import { IPC_CHANNELS } from '../shared/types'
import { applyDwmFix } from './dwm'
import { initImagesDir } from './images'
import { McpBridgeServer } from './mcp-bridge'
import { RoutineStore } from './store/routine-store'
import { BotRegistry } from './core/bot-registry'
import { Scheduler } from './core/scheduler'
import { injectSettingsEnv, getChannels, getProxy, getGatewayPublicAccess, getGatewayToken, loadMcpBridgeConfig, NERVE_DIR } from './settings'
import { MemoryTdaiCore } from './memory-tdai'
import { OffloadBridge } from './offload-bridge'
import { createTray } from './tray'
import { NerveGateway } from './gateway'
import { createQuitDrain } from './quit-drain'
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

// 退出排空闸门；在 whenReady 里、依赖都建好之后赋值。before-quit 早于它就绪时
// 这里还是 null —— 那种情况下没有队列可排，直接放行退出。
let quitDrain: ReturnType<typeof createQuitDrain> | null = null

const MAIN_WINDOW_RADIUS = 19
const MAIN_WINDOW_SHAPE_GUARD_RADIUS = 19

ipcMain.on('window:minimize', () => currentMainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (currentMainWindow?.isMaximized()) currentMainWindow.unmaximize()
  else currentMainWindow?.maximize()
})
ipcMain.on('window:close', () => {
  // 最小化到托盘，而不是关闭窗口
  currentMainWindow?.hide()
})
ipcMain.handle('window:get-bounds', () => currentMainWindow?.getBounds())
ipcMain.on('window:set-bounds', (_event, bounds: Electron.Rectangle) => {
  if (currentMainWindow && !currentMainWindow.isDestroyed()) {
    currentMainWindow.setBounds(bounds)
  }
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
    backgroundColor: '#00000000',
    shadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webSecurity: true,
    },
  })

  // Apply DWM fix before window is visible —抢先 in DWM's first render
  applyDwmFix(window)

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 不让页面内链接把主窗口整个带走：renderer 没拦到的 <a> 会走默认导航，
  // 无边框窗口没有后退按钮，一旦导航到外站就回不来了。域内放行（dev 热更、
  // file:// 自身 hash 路由），站外一律转交系统浏览器。
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://') || url.startsWith('devtools://')) return
    event.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle('')
  })

  // DWM can redraw the inactive frame on focus changes, so keep the HWND style clean.
  const syncWindowChrome = () => {
    applyDwmFix(window)
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

// Register custom protocol (must be before app.whenReady())
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nerve-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const mainWindow = createWindow()

  // 创建系统托盘 — 窗口关闭时最小化到托盘，不退出应用
  createTray(() => currentMainWindow)

  // Setup Claude service, Git service, and IPC
  const projectDir = process.cwd()
  injectSettingsEnv()
  initImagesDir(projectDir)
  const mcpOAuth = new McpOAuthManager()
  const claude = new ClaudeService(mainWindow, projectDir, mcpOAuth)
  const gitService = new GitService()

  // Watch settings.json for external edits → hot reload soul/persona/providers
  // (事件驱动，平时零开销；debounce 300ms 吸收原子写的多次事件)
  const nerveSettingsFile = join(homedir(), '.nerve', 'settings.json')
  if (existsSync(nerveSettingsFile)) {
    let settingsReloadTimer: NodeJS.Timeout | null = null
    chokidar.watch(nerveSettingsFile, { ignoreInitial: true }).on('all', () => {
      if (settingsReloadTimer) clearTimeout(settingsReloadTimer)
      settingsReloadTimer = setTimeout(() => {
        claude.reloadProvider()
        console.log('[Nerve] settings.json changed on disk — reloaded soul/persona/providers')
      }, 300)
    })
  }

  // Initialize TencentDB memory system
  const memoryCore = new MemoryTdaiCore(projectDir, claude.getSettings())
  memoryCore.initialize().catch((err) => console.error('[Nerve] MemoryTdaiCore init failed:', err))
  claude.setMemoryCore(memoryCore)

  // Initialize OffloadBridge (context compression for long conversations)
  const offloadSettings = claude.getSettings()
  if (offloadSettings.extraction?.baseURL && offloadSettings.extraction?.authToken) {
    try {
      const offloadClient = new OpenAI({
        baseURL: offloadSettings.extraction.baseURL,
        apiKey: offloadSettings.extraction.authToken,
      })
      const offloadBridge = new OffloadBridge({
        client: offloadClient,
        model: offloadSettings.extraction.model || 'deepseek-chat',
        // 这里压的是发往 extraction 模型的上下文，跟主模型（GLM）的窗口无关：
        // 原先是写死的 128_000，现在优先读全局 contextWindow（用户配的就是当前在用的模型），
        // 否则留在 128_000 —— 宁可晚压缩，也别拿错误的窗口提前把历史切碎。
        contextWindow: offloadSettings.contextWindow ?? 128_000,
        compressRatio: 0.6,
      })
      claude.setOffloadBridge(offloadBridge)
      console.log('[Nerve] OffloadBridge initialized')
    } catch (err) {
      console.error('[Nerve] OffloadBridge init failed:', err)
    }
  }

  // Initialize plugins
  await claude.initPlugins()

  // 从 settings 加载公网访问配置
  const publicAccess = await getGatewayPublicAccess()
  const configuredToken = publicAccess ? await getGatewayToken() : null
  let gatewayToken = 'nerve-default-token'
  let gatewayHost = '127.0.0.1'

  if (publicAccess) {
    if (!configuredToken) {
      console.error('[Nerve] Gateway publicAccess enabled but no token configured! Add {"gateway":{"token":"your-strong-token"}} to ~/.nerve/settings.json')
      console.error('[Nerve] Falling back to localhost.')
    } else {
      gatewayToken = configuredToken
      gatewayHost = '0.0.0.0'
      console.log('[Nerve] Gateway public access enabled — listening on 0.0.0.0')
    }
  }

  // 创建 Gateway 实例
  const gateway = new NerveGateway({
    port: 18789,
    host: gatewayHost,
    auth: { mode: 'token', secret: gatewayToken },
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

  // ── Routine Scheduler ──
  // 桌面场景没有独立 worker：app 开着就跑，关了就停（已与用户确认）。
  // dispatch 走 AgentCore：Gateway 已启动时进 Ticket 队列，否则直连 sendMessage，
  // 所以 routine 触发不依赖 Gateway 是否启动。
  const agentCore = claude.getAgentCore()
  // 原生模块 / JSON 目录都可能坏掉。routine 只是附加能力，初始化失败要降级成
  // "调度器不可用"，而不是让整个 whenReady 抛错 —— 那会留下一个没有 IPC 的窗口。
  let routineStore: RoutineStore | null = null
  let schedulerBots: BotRegistry | null = null
  try {
    routineStore = RoutineStore.open(join(NERVE_DIR, 'routines.db'))
    schedulerBots = await BotRegistry.create(join(NERVE_DIR, 'bots'))
  } catch (err) {
    console.error('[Nerve] routine 存储初始化失败，定时任务不可用:', err)
  }
  const scheduler = routineStore && schedulerBots
    ? new Scheduler({
        store: routineStore,
        bots: schedulerBots,
        dispatch: (d) => agentCore.dispatchRoutine(d),
      })
    : null
  scheduler?.start()

  // 上次退出时没跑完的 bot 交接：队列在磁盘上，worker 在进程里，不接就永远不会被执行。
  // 必须是异步的（它会碰 sqlite），但也不该拖住窗口 —— 所以不 await。
  void Promise.resolve()
    .then(() => agentCore.resumeHandoffQueue())
    .catch((err) => console.warn('[Nerve] 恢复交接队列失败:', err))

  // MCP Bridge
  const mcpBridgeConfig = await loadMcpBridgeConfig()
  mcpBridgeConfig.cwd = app.getPath('home')
  mcpBridgeConfig.projectDir = projectDir

  const mcpBridge = new McpBridgeServer(mcpBridgeConfig)

  if (mcpBridgeConfig.enabled) {
    mcpBridge.start().catch(err => console.error('[Nerve] MCP Bridge start failed:', err.message))
  }

  setupIPC(mainWindow, claude, gitService, gateway, mcpBridge, { routineStore: routineStore ?? undefined, botRegistry: schedulerBots ?? undefined }, mcpOAuth)

  // Handle nerve-file:// protocol for sandbox-safe local file access
  protocol.handle('nerve-file', async (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname).replace(/^\//, '')
      const absPath = resolve(filePath)
      // <video> 播放依赖 Range 请求，net.fetch(file://) 不支持，手动切 206。
      // 流式返回：整段读进内存会导致大文件每次 seek/循环都卡顿
      const range = request.headers.get('range')
      if (range) {
        const { size } = statSync(absPath)
        const m = /bytes=(\d+)-(\d*)/.exec(range)
        if (m) {
          const start = Number(m[1])
          const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
          const stream = Readable.toWeb(createReadStream(absPath, { start, end })) as unknown as ReadableStream
          return new Response(stream, {
            status: 206,
            headers: {
              'Content-Range': `bytes ${start}-${end}/${size}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(end - start + 1),
            },
          })
        }
      }
      return net.fetch(`file://${absPath.replace(/\\/g, '/')}`)
    } catch (err: any) {
      console.warn('[nerve-file] Failed to serve:', request.url, err.message?.slice(0, 200))
      return new Response('Not found', { status: 404 })
    }
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
      setupIPC(newWindow, claude, gitService, undefined, undefined, undefined, mcpOAuth)
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        newWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
        newWindow.webContents.openDevTools()
      } else {
        newWindow.loadFile(join(__dirname, '../renderer/index.html'))
      }
    }
  })

  // 退出收尾：**先**排空 gateway 队列，再拆别的。
  //
  // gateway.stop() 做的正是有序排空（runner 先停、等 in-flight 跑完，再拆传输层）；
  // 不调它的话，mid-turn 退出会把整个 turn 留成未消费的行，下次启动原样重放一遍。
  // 一定要在 mcpBridge / claude 关掉**之前**：正在跑的那条消息还要用它们。
  quitDrain = createQuitDrain({
    quit: () => app.quit(),
    teardown: async () => {
      scheduler?.stop()
      routineStore?.close()
      agentCore.closeToolStores()
      await gateway.stop().catch((err) => { console.warn('[Nerve] gateway stop failed:', err) })
      await mcpBridge.stop().catch(() => {})
      await memoryCore.destroy().catch(() => {})
      // 杀掉所有后台作业：一条 sleep 10 或 npm install 不该在 app 退出后继续占着
      try { claude.killAllJobs?.() } catch { /* 尽力而为 */ }
      await claude.close().catch(() => {})
    },
  })
})

app.on('window-all-closed', () => {
  // 托盘常驻模式：窗口关闭不退出应用
  // 记忆引擎和 Claude 服务保持运行
  // 用户可以通过托盘图标重新打开窗口
  // 真正退出通过托盘右键菜单的"退出 Nerve"
})

// 退出前排空持久化队列。
//
// 这一条从 window-all-closed 里提到顶层：托盘常驻模式下那个回调是靠不住的注册点
// （窗口全关就退出时根本走不到），而 before-quit 迟早会来。
//
// 必须 preventDefault() + 自己 quit()：`before-quit` 的异步监听器**拦不住** Electron，
// 事件回来进程就走，那些 await 等于没执行 —— 结果就是 mid-turn 退出时整个 turn
// 在下次启动被重放一遍。收尾只跑一次、有超时、抛错也照样放行，见 quit-drain.ts。
app.on('before-quit', (event) => { quitDrain?.handler(event) })
