import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { readdirSync, statSync, readFileSync, existsSync } from 'fs'
import { join, relative, extname, basename, resolve } from 'path'
import { homedir, hostname } from 'os'
import { IPC_CHANNELS, SendMessagePayload, ClaudeConfig, FileAttachment, ToolApprovalResponse } from '../shared/types'
import { ClaudeService, testConnection, fetchModels, getSkills, toggleSkill, transcribeAudio } from './claude'
import { PetSkinManager } from './pet-skins'
import { NERVE_DIR, getNerveSettings, saveNerveSettings, getMcpServers, saveMcpServers, getAvailableModels, getChannels, saveChannels, getProxy, saveProxy, getGatewayPublicAccess, getGatewayToken, saveGatewayPublicAccess, loadMcpBridgeConfig, saveMcpBridgeConfig, isRemoteMcpConfig, getRecentProjects, type McpServerConfig } from './settings'
import { saveImage, listImages, deleteImage, getImagePath, getImagesDir } from './images'
import { scanMemoryBrowser, readMemoryContent } from './memory-browser'
import { GitService } from './git'
import { NerveGateway } from './gateway'
import { RoutineStore } from './store/routine-store'
import { BotRegistry } from './core/bot-registry'

export function setupIPC(window: BrowserWindow, claude: ClaudeService, skinManager: PetSkinManager, gitService: GitService, gateway?: NerveGateway,
  mcpBridge?: import('./mcp-bridge').McpBridgeServer,
  stores?: { routineStore?: RoutineStore; botRegistry?: BotRegistry },
) {
  // ── Forward gateway / mcp-bridge logs to renderer ──
  const forwardLog = (entry: { level: string; message: string; timestamp: number }) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.GATEWAY_LOG, entry)
    }
  }
  gateway?.on('log', forwardLog)
  mcpBridge?.on('log', forwardLog)

  // Ticket 阶段变化 → 推给渲染层，Tasks 视图靠它实时刷新（不轮询）
  gateway?.on('ticket-changed', (ticket: unknown) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.TICKET_CHANGED, ticket)
    }
  })
  ipcMain.handle(IPC_CHANNELS.SEND_MESSAGE, async (_event, payload: SendMessagePayload) => {
    // cwd 可能是 undefined / 空串（老会话或渲染层没取到）：原样交给 agent-core，
    // 由 resolveCwd 统一回落全局 projectDir，这里不做路径补全
    await claude.sendMessage({
      prompt: payload.prompt,
      sessionId: payload.sessionId,
      files: payload.files,
      runId: payload.runId,
      cwd: payload.cwd,
      botId: payload.botId,
    })
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL, (_event, sessionId?: string) => {
    claude.cancel(sessionId)
  })

  // sessionId 可选：带了只改该会话，缺省写全局（历史行为）
  ipcMain.handle(IPC_CHANNELS.SET_MODEL, async (_event, model: string, sessionId?: string) => {
    await claude.setModel(model, sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SET_PROVIDER, async (_event, providerId: string, sessionId?: string) => {
    await claude.setProvider(providerId, sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SET_EFFORT, async (_event, effort: string, sessionId?: string) => {
    await claude.setEffort(effort as ClaudeConfig['effort'], sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SET_CWD, async (_event, cwd: string) => {
    await claude.setCwd(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.SET_PERMISSION_MODE, async (_event, mode: string, sessionId?: string) => {
    await claude.setPermissionMode(mode as ClaudeConfig['permissionMode'], sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.TOOL_APPROVAL_RESPONSE, (_event, response: ToolApprovalResponse) => {
    claude.handleToolApprovalResponse(response)
  })

  ipcMain.handle(IPC_CHANNELS.ASK_USER_RESPONSE, (_event, response: { askId: string; answers: import('../shared/types').AskUserAnswers }) => {
    claude.handleAskUserResponse(response)
  })

  ipcMain.handle(IPC_CHANNELS.PICK_AND_READ_FILES, async () => {
    const MIME_MAP: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
      '.log': 'text/plain',
      '.js': 'text/javascript', '.ts': 'text/typescript', '.tsx': 'text/typescript',
      '.jsx': 'text/javascript', '.py': 'text/x-python', '.go': 'text/x-go',
      '.rs': 'text/x-rust', '.java': 'text/x-java', '.c': 'text/x-c',
      '.cpp': 'text/x-c++', '.h': 'text/x-c', '.cs': 'text/x-csharp',
      '.rb': 'text/x-ruby', '.php': 'text/x-php', '.swift': 'text/x-swift',
      '.kt': 'text/x-kotlin', '.sh': 'text/x-shellscript', '.bash': 'text/x-shellscript',
      '.json': 'application/json', '.xml': 'application/xml',
      '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain',
      '.ini': 'text/plain',
    }
    const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'])
    const MAX_IMAGE = 10 * 1024 * 1024
    const MAX_DOC = 50 * 1024 * 1024

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
        { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'csv'] },
        { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'swift', 'kt', 'sh'] },
        { name: 'Data', extensions: ['json', 'xml', 'yaml', 'yml', 'toml', 'ini'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled) return []

    const attachments: FileAttachment[] = []
    for (const filePath of result.filePaths) {
      try {
        const stat = statSync(filePath)
        const ext = extname(filePath).toLowerCase()
        const mimeType = MIME_MAP[ext] || 'application/octet-stream'
        const isImage = IMAGE_TYPES.has(mimeType)
        const maxSize = isImage ? MAX_IMAGE : MAX_DOC
        if (stat.size > maxSize) continue

        const buffer = readFileSync(filePath)
        const data = isImage || mimeType === 'application/pdf'
          ? buffer.toString('base64')
          : buffer.toString('utf-8')
        attachments.push({
          name: basename(filePath),
          mimeType,
          size: stat.size,
          data,
          isImage,
        })
      } catch {
        // skip unreadable files
      }
    }
    return attachments
  })

  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, () => {
    return claude.getConfig()
  })

  ipcMain.handle(IPC_CHANNELS.GET_MODELS, () => {
    return getAvailableModels()
  })

  ipcMain.handle(IPC_CHANNELS.LIST_SESSIONS, async () => {
    return claude.listSessions()
  })

  ipcMain.handle(IPC_CHANNELS.GET_SESSION_MESSAGES, async (_event, sessionId: string) => {
    return claude.getSessionMessages(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.DELETE_SESSION, async (_event, sessionId: string) => {
    return claude.deleteSession(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.BRANCH_SESSION, async (_event, sessionId: string, fromEntryId: string, branchName?: string) => {
    return claude.branchSession(sessionId, fromEntryId, branchName)
  })

  ipcMain.handle(IPC_CHANNELS.SWITCH_BRANCH, async (_event, sessionId: string, branchName: string) => {
    return claude.switchBranch(sessionId, branchName)
  })

  ipcMain.handle(IPC_CHANNELS.LIST_BRANCHES, async (_event, sessionId: string) => {
    return claude.listBranches(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.GET_PROVIDERS, () => {
    return claude.getProviders()
  })

  ipcMain.handle(IPC_CHANNELS.GET_SESSION_USAGE, async (_event, sessionId: string) => {
    return claude.getSessionUsage(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.GET_USAGE_STATS, () => {
    return claude.getUsageStats()
  })

  // Pet skins
  ipcMain.handle(IPC_CHANNELS.PET_LIST_SKINS, () => {
    return skinManager.listSkins()
  })

  ipcMain.handle(IPC_CHANNELS.PET_IMPORT_SKIN, async () => {
    return skinManager.importSkin(window)
  })

  ipcMain.handle(IPC_CHANNELS.PET_DELETE_SKIN, (_event, id: string) => {
    return skinManager.deleteSkin(id)
  })

  ipcMain.handle(IPC_CHANNELS.PET_SET_SKIN, (_event, id: string) => {
    claude.setPetSkin(id)
  })

  // Nerve settings
  ipcMain.handle(IPC_CHANNELS.GET_NERVE_SETTINGS, () => {
    return getNerveSettings()
  })

  ipcMain.handle(IPC_CHANNELS.SAVE_NERVE_SETTINGS, async (_event, settings) => {
    try {
      // Basic type validation — reject obviously malformed payloads
      if (settings && typeof settings !== 'object') throw new Error('Invalid settings format')
      if (settings.baseURL !== undefined && typeof settings.baseURL !== 'string') throw new Error('baseURL must be a string')
      if (settings.authToken !== undefined && typeof settings.authToken !== 'string') throw new Error('authToken must be a string')
      if (settings.providers !== undefined && (typeof settings.providers !== 'object' || Array.isArray(settings.providers))) throw new Error('providers must be an object')
      if (settings.soul !== undefined && typeof settings.soul !== 'string') throw new Error('soul must be a string')
      if (settings.persona !== undefined && typeof settings.persona !== 'string') throw new Error('persona must be a string')
      await saveNerveSettings(settings)
      claude.reloadProvider()
      return { ok: true, models: await getAvailableModels() }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.TEST_CONNECTION, async (_event, { baseURL, authToken }) => {
    return testConnection(baseURL, authToken)
  })

  ipcMain.handle(IPC_CHANNELS.FETCH_MODELS, async (_event, { baseURL, authToken }) => {
    return fetchModels(baseURL, authToken)
  })

  ipcMain.handle(IPC_CHANNELS.GET_MCP_SERVERS, () => {
    return getMcpServers()
  })

  ipcMain.handle(IPC_CHANNELS.SAVE_MCP_SERVERS, async (_event, servers) => {
    // Validate MCP server configs — reject malformed payloads
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return
    for (const [name, config] of Object.entries(servers)) {
      if (typeof name !== 'string' || !config || typeof config !== 'object') return
      const c = config as McpServerConfig
      // 远端 MCP：给了 url 就走 HTTP，不要求 command
      if (isRemoteMcpConfig(c)) {
        if (c.headers !== undefined && (typeof c.headers !== 'object' || Array.isArray(c.headers))) return
        continue
      }
      if (typeof c.command !== 'string' || c.command.length === 0) return
      if (c.args !== undefined && !Array.isArray(c.args)) return
      if (c.env !== undefined && (typeof c.env !== 'object' || Array.isArray(c.env))) return
    }
    await saveMcpServers(servers)
    // 保存即热生效：连接池同步（连新增/关删除/变更重连）
    await claude.reloadMcpServers()
  })

  ipcMain.handle(IPC_CHANNELS.GET_MCP_STATUS, () => {
    return claude.getMcpStatus()
  })

  // Skills
  ipcMain.handle(IPC_CHANNELS.GET_SKILLS, () => {
    return getSkills(claude.getSourceDir())
  })

  ipcMain.handle(IPC_CHANNELS.TOGGLE_SKILL, async (_event, id: string, enabled: boolean) => {
    await toggleSkill(id, enabled)
  })

  // Plugins
  ipcMain.handle(IPC_CHANNELS.GET_PLUGINS, () => claude.getPlugins())
  ipcMain.handle(IPC_CHANNELS.TOGGLE_PLUGIN, (_event, pluginId: string, enabled: boolean) => claude.togglePlugin(pluginId, enabled))
  ipcMain.handle(IPC_CHANNELS.RELOAD_PLUGIN, (_event, pluginId: string) => claude.reloadPlugin(pluginId))
  ipcMain.handle(IPC_CHANNELS.ROLLBACK_MCP, (_event, serverId: string) => claude.rollbackMcp(serverId))

  // Voice — audio transcription
  ipcMain.handle(IPC_CHANNELS.TRANSCRIBE_AUDIO, async (_event, audioData: Uint8Array, mimeType: string) => {
    return transcribeAudio(audioData, mimeType)
  })

  // Images / Gallery
  ipcMain.handle(IPC_CHANNELS.IMAGE_SAVE, async (_event, { filename, buffer, source }: { filename: string; buffer: ArrayBuffer; source?: string }) => {
    return saveImage(filename, Buffer.from(buffer), source)
  })

  ipcMain.handle(IPC_CHANNELS.IMAGE_LIST, () => {
    return listImages()
  })

  ipcMain.handle(IPC_CHANNELS.IMAGE_DELETE, (_event, filename: string) => {
    return deleteImage(filename)
  })

  ipcMain.handle(IPC_CHANNELS.IMAGE_GET_PATH, (_event, filename: string) => {
    return getImagePath(filename)
  })

  ipcMain.handle(IPC_CHANNELS.IMAGE_LOAD, (_event, filePath: string) => {
    const absPath = resolve(filePath)
    const imagesDir = resolve(getImagesDir())
    if (!absPath.startsWith(imagesDir)) return null
    try {
      const buffer = readFileSync(absPath)
      const ext = extname(absPath).toLowerCase()
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.gif' ? 'image/gif'
        : ext === '.webp' ? 'image/webp'
        : ext === '.svg' ? 'image/svg+xml'
        : 'image/png'
      return `data:${mime};base64,${buffer.toString('base64')}`
    } catch {
      return null
    }
  })

  // Stage 背景视频：落盘到 ~/.nerve/stage-bg/（单文件，新的替换旧的），返回 nerve-file URL
  ipcMain.handle(IPC_CHANNELS.STAGE_BG_SAVE, async (_event, { buffer, ext }: { buffer: ArrayBuffer; ext: string }) => {
    const { mkdir, writeFile, readdir, rm } = await import('fs/promises')
    const dir = join(homedir(), '.nerve', 'stage-bg')
    await mkdir(dir, { recursive: true })
    const safeExt = ext.replace(/[^a-z0-9.]/gi, '').toLowerCase() || '.mp4'
    for (const f of await readdir(dir)) await rm(join(dir, f), { force: true })
    // 时间戳文件名：保证每次导入 URL 唯一，强制媒体元素重新加载（同名会因 URL 不变而继续播旧文件）
    const absPath = join(dir, `bg-${Date.now()}${safeExt}`)
    await writeFile(absPath, Buffer.from(buffer))
    // standard scheme 的 URL 必须带 host（空 host 无法被 Chromium 解析），占位 host: local
    return 'nerve-file://local/' + absPath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  })

  // Memory Browser (replaces Brain)
  ipcMain.handle(IPC_CHANNELS.BRAIN_SCAN, () => {
    return scanMemoryBrowser()
  })

  ipcMain.handle(IPC_CHANNELS.BRAIN_READ_FILE, (_event, type: string, id: string) => {
    return readMemoryContent(type, id)
  })

  // System
  ipcMain.handle(IPC_CHANNELS.GET_HOSTNAME, () => hostname())

  // File explorer
  // 磁盘根：Windows 逐个盘符探测（fs 不接受空串当根），其余平台只有 /
  ipcMain.handle(IPC_CHANNELS.LIST_ROOTS, () => {
    if (process.platform !== 'win32') return ['/']
    const roots: string[] = []
    for (let code = 65; code <= 90; code++) {
      const root = `${String.fromCharCode(code)}:\\`
      if (existsSync(root)) roots.push(root)
    }
    return roots
  })

  ipcMain.handle(IPC_CHANNELS.GET_RECENT_PROJECTS, () => getRecentProjects())

  ipcMain.handle(IPC_CHANNELS.LIST_DIR, async (_event, dirPath: string) => {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })
      const result = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => {
          const fullPath = join(dirPath, e.name)
          try {
            const st = statSync(fullPath)
            return {
              name: e.name,
              path: fullPath,
              isDirectory: e.isDirectory(),
              size: e.isFile() ? st.size : 0,
              mtimeMs: st.mtimeMs,
            }
          } catch {
            return {
              name: e.name,
              path: fullPath,
              isDirectory: e.isDirectory(),
              size: 0,
              mtimeMs: 0,
            }
          }
        })
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      return { success: true, entries: result, cwd: dirPath }
    } catch (err: any) {
      return { success: false, error: err.message, entries: [], cwd: dirPath }
    }
  })

  const notifyGitRefresh = () => {
    try { window.webContents.send(IPC_CHANNELS.GIT_REFRESH) } catch { /* window may be closing */ }
  }

  // Git
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async (_event, cwd: string) => {
    return gitService.getStatus(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STAGE, async (_event, files: string[], cwd: string) => {
    const r = await gitService.stageFiles(cwd, files)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_UNSTAGE, async (_event, files: string[], cwd: string) => {
    const r = await gitService.unstageFiles(cwd, files)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_event, message: string, cwd: string) => {
    const r = await gitService.commit(cwd, message)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PUSH, async (_event, cwd: string) => {
    const r = await gitService.push(cwd)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PULL, async (_event, cwd: string) => {
    const r = await gitService.pull(cwd)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_LOG, async (_event, cwd: string, maxCount?: number) => {
    return gitService.getLog(cwd, maxCount)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_LIST, async (_event, cwd: string) => {
    return gitService.listBranches(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_CHECKOUT, async (_event, branch: string, cwd: string) => {
    const r = await gitService.checkout(cwd, branch)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DIFF, async (_event, files: string[] | undefined, cwd: string, staged?: boolean) => {
    return gitService.getDiff(cwd, files, staged)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_INIT, async (_event, cwd: string) => {
    const r = await gitService.init(cwd)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_CREATE_BRANCH, async (_event, branch: string, cwd: string) => {
    const r = await gitService.checkoutNewBranch(cwd, branch)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STASH_LIST, async (_event, cwd: string) => {
    return gitService.listStashes(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STASH_PUSH, async (_event, cwd: string, message?: string, includeUntracked?: boolean) => {
    const r = await gitService.stashPush(cwd, message, includeUntracked)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STASH_POP, async (_event, cwd: string, index?: number) => {
    const r = await gitService.stashPop(cwd, index)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STASH_APPLY, async (_event, cwd: string, index?: number) => {
    const r = await gitService.stashApply(cwd, index)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STASH_DROP, async (_event, cwd: string, index: number) => {
    const r = await gitService.stashDrop(cwd, index)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DELETE_BRANCH, async (_event, cwd: string, branch: string, force?: boolean) => {
    const r = await gitService.deleteBranch(cwd, branch, force)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DISCARD, async (_event, cwd: string, files: string[], tracked: boolean) => {
    const r = await gitService.discardChanges(cwd, files, tracked)
    notifyGitRefresh()
    return r
  })

  ipcMain.handle(IPC_CHANNELS.GIT_SHOW_DIFF, async (_event, cwd: string, hash: string) => {
    return gitService.getCommitDiff(cwd, hash)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_FETCH, async (_event, cwd: string) => {
    const r = await gitService.fetch(cwd)
    notifyGitRefresh()
    return r
  })

  // 批量取当前分支（stage 会话列表条目）：非 git 目录 / 无权限各自兜底成空串
  ipcMain.handle(IPC_CHANNELS.GIT_CURRENT_BRANCHES, async (_event, cwds: string[]) => {
    const branches: Record<string, string> = {}
    await Promise.all(cwds.map(async (cwd) => {
      try {
        branches[cwd] = await gitService.getCurrentBranch(cwd)
      } catch {
        branches[cwd] = ''
      }
    }))
    return branches
  })

  ipcMain.handle(IPC_CHANNELS.OPEN_IN_BROWSER, async (_event, { type, content }: { type: string; content: string }) => {
    if (type === 'image' || type === 'url') {
      shell.openExternal(content)
    } else if (type === 'file') {
      shell.openPath(content)
    } else {
      const { writeFile } = await import('fs/promises')
      const { join } = await import('path')
      const { tmpdir } = await import('os')
      const file = join(tmpdir(), `nerve-flow-${Date.now()}.html`)
      await writeFile(file, content, 'utf-8')
      shell.openExternal(`file://${file}`)
    }
  })

  // Gateway
  if (gateway) {
    ipcMain.handle(IPC_CHANNELS.GATEWAY_STATUS, async () => {
      return gateway.getHealth()
    })

    ipcMain.handle(IPC_CHANNELS.GATEWAY_ADAPTERS, async () => {
      const channels = await getChannels()
      const liveAdapters = new Map(gateway.getAdapters().map(a => [a.name, a]))
      return channels.map(ch => {
        const live = liveAdapters.get(ch.name)
        return {
          name: ch.name,
          platform: ch.platform,
          enabled: ch.enabled,
          connected: live?.isConnected ?? false,
          config: {},
        }
      })
    })

    ipcMain.handle(IPC_CHANNELS.GATEWAY_ADAPTER_TOGGLE, async (_event, name: string, enabled: boolean) => {
      try {
        const channels = await getChannels()
        const updated = channels.map(ch => ch.name === name ? { ...ch, enabled } : ch)
        await saveChannels(updated)
        await gateway.loadAdapters(updated)
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle(IPC_CHANNELS.GATEWAY_SESSIONS, async () => {
      if (!gateway) return []
      return gateway.getSessionMappings()
    })

    ipcMain.handle(IPC_CHANNELS.GATEWAY_SESSION_DELETE, async (_event, sessionId: string) => {
      // TODO: 实现会话删除
      console.log(`[Gateway] Delete session: ${sessionId}`)
    })

  
  // ── Routines / Bots（bot 驱动改造）────────────────────────
  //
  // setupIPC 会被调用两次（主窗口 + pet 窗口 / activate 重建），而 ipcMain.handle
  // 对已注册的 channel 会抛 "Attempted to register a second handler"。
  // 这几个 channel 的 handler 只依赖模块级的 stores 参数与 claude，与具体窗口无关，
  // 所以第二次注册前先移除旧的即可（Electron 允许 removeHandler 后重新 handle）。
  for (const ch of [
    IPC_CHANNELS.ROUTINE_LIST, IPC_CHANNELS.ROUTINE_CREATE, IPC_CHANNELS.ROUTINE_UPDATE,
    IPC_CHANNELS.ROUTINE_DELETE, IPC_CHANNELS.ROUTINE_SWEEP_STATUS,
    IPC_CHANNELS.BOT_LIST, IPC_CHANNELS.BOT_CREATE, IPC_CHANNELS.BOT_UPDATE, IPC_CHANNELS.SESSION_BIND_BOT,
  ]) {
    ipcMain.removeHandler(ch)
  }

  // stores 缺省时用一个惰性打开的 RoutineStore：老调用点（pet 窗口那条 setupIPC）不传，
  // 也不能让 UI 一打开就崩。
  let fallbackStore: RoutineStore | null = null
  const routineStore = () => {
    if (stores?.routineStore) return stores.routineStore
    if (!fallbackStore) fallbackStore = RoutineStore.open(join(NERVE_DIR, 'routines.db'))
    return fallbackStore
  }
  let fallbackBots: BotRegistry | null = null
  const botRegistry = async () => {
    if (stores?.botRegistry) return stores.botRegistry
    if (!fallbackBots) fallbackBots = await BotRegistry.create(join(NERVE_DIR, 'bots'))
    return fallbackBots
  }

  ipcMain.handle(IPC_CHANNELS.ROUTINE_LIST, async (_event, botId: string) =>
    routineStore().listByBot(botId, { includeDisabled: true }))

  ipcMain.handle(IPC_CHANNELS.ROUTINE_CREATE, async (_event, input: { botId: string; sessionId: string; instruction: string; schedule: string }) => {
    // 空会话 → 该 Bot 的 home 会话；都没有就明确拒绝，不写一个投递不出去的 routine
    let sessionId = input.sessionId
    if (!sessionId) {
      const bot = await (await botRegistry()).get(input.botId)
      sessionId = bot?.homeSessionId ?? ''
    }
    if (!sessionId) throw new Error('请先在该 Bot 的某个会话里创建过任务（该会话会成为默认投递目标）')
    return routineStore().create({ ...input, sessionId, createdBy: 'user' })
  })

  ipcMain.handle(IPC_CHANNELS.ROUTINE_UPDATE, async (_event, id: string, patch: { instruction?: string; schedule?: string; enabled?: boolean }) =>
    routineStore().update(id, patch))

  ipcMain.handle(IPC_CHANNELS.ROUTINE_DELETE, async (_event, id: string) =>
    routineStore().remove(id))

  ipcMain.handle(IPC_CHANNELS.ROUTINE_SWEEP_STATUS, async () => {
    const lastSweep = routineStore().lastSweep()
    return { lastSweep, healthy: lastSweep !== null && Date.now() - lastSweep < 15 * 60_000 }
  })

  ipcMain.handle(IPC_CHANNELS.BOT_LIST, async () => (await botRegistry()).list())

  ipcMain.handle(IPC_CHANNELS.BOT_CREATE, async (_event, input: { name: string; group?: string; emoji?: string; avatarColor?: string; avatarOrb?: boolean; instructions?: string }) =>
    (await botRegistry()).create({
      name: input.name,
      group: input.group ?? '',
      emoji: input.emoji ?? '',
      avatarColor: input.avatarColor ?? '',
      avatarOrb: input.avatarOrb ?? true,
      instructions: input.instructions ?? '',
    }))

  ipcMain.handle(IPC_CHANNELS.BOT_UPDATE, async (_event, id: string, patch: { name?: string; group?: string; emoji?: string; avatarColor?: string; avatarOrb?: boolean; instructions?: string; homeSessionId?: string; canAskBots?: string[] | null; boundSkills?: string[]; boundMcp?: string[] }) =>
    (await botRegistry()).update(id, patch))

  ipcMain.handle(IPC_CHANNELS.SESSION_BIND_BOT, async (_event, sessionId: string, botId: string) =>
    claude.getAgentCore().setSessionBot(sessionId, botId))

  /*
   * 交接的答复是**另一个 Bot** 在另一个会话里跑出来、再被写回这个会话的，
   * 期间没有任何 IPC 事件经过渲染层。不推这一下，用户得手动切走再切回来才看得到。
   *
   * 推的是「哪个会话变了」，不是消息内容：渲染层已经有一条拉取路径
   * （getSessionMessages），再开一条推送路径就得维护两份格式。让 UI 自己重新拉，
   * 天然不会和正在流式输出的那一轮打架。
   */
  const offSessionUpdated = claude.getAgentCore().onSessionUpdated((sessionId: string) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.SESSION_UPDATED, sessionId)
    }
  })
  // setupIPC 会被调用不止一次（macOS dock 点击会新建窗口）。不摘监听的话每次开窗都往
  // AgentCore 的监听集合里多塞一个闭包，而且它们都捏着已销毁的 window。
  window.on('closed', offSessionUpdated)

  // 交接的「正在跑」状态：侧栏那个 Bot 的头像靠它转圈。同样是只推事实，不推进度。
  const offBotActivity = claude.getAgentCore().onBotActivity((activity) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.BOT_ACTIVITY, activity)
    }
  })
  window.on('closed', offBotActivity)
  // ── Tickets（右侧栏 Tasks 视图）──────────────────────────
    //
    // Gateway 未启动时这几个都返回空/失败而不是抛错：
    // 右侧栏在任何时候都可能被打开，UI 不该因为 gateway 没开就报错。
    ipcMain.handle(IPC_CHANNELS.TICKET_LIST, async (_event, opts?: { includeEnded?: boolean }) => {
      if (!gateway) return []
      return gateway.listTickets(opts ?? {})
    })

    ipcMain.handle(IPC_CHANNELS.TICKET_GET, async (_event, id: string) => {
      if (!gateway) return undefined
      return gateway.getTicket(id)
    })

    ipcMain.handle(IPC_CHANNELS.TICKET_STOP, async (_event, id: string) => {
      const router = gateway?.getTicketRouter()
      if (!router) return { success: false, error: 'Gateway not running' }
      try {
        router.stop(id)
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    })

    ipcMain.handle(IPC_CHANNELS.GATEWAY_START, async () => {
      try {
        await gateway.start()
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle(IPC_CHANNELS.GATEWAY_STOP, async () => {
      try {
        await gateway.stop()
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    })
  }

  if (mcpBridge) {
    ipcMain.handle(IPC_CHANNELS.MCP_BRIDGE_STATUS, async () => mcpBridge.getHealth())
    ipcMain.handle(IPC_CHANNELS.MCP_BRIDGE_TOGGLE, async (_event, enabled: boolean) => {
      try {
        if (enabled) {
          await mcpBridge.start()
        } else {
          await mcpBridge.stop()
        }
        const config = await loadMcpBridgeConfig()
        config.enabled = enabled
        await saveMcpBridgeConfig(config)
        return { success: true, enabled }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    })
  }

  // Gateway Channels (settings, no gateway instance needed)
  ipcMain.handle(IPC_CHANNELS.GATEWAY_CHANNELS_GET, async () => {
    return getChannels()
  })

  ipcMain.handle(IPC_CHANNELS.GATEWAY_CHANNELS_SAVE, async (_event, channels) => {
    if (!Array.isArray(channels)) return
    await saveChannels(channels)
    // 热重载适配器
    if (gateway) {
      gateway.loadAdapters(channels).catch(err => {
        console.error('[IPC] Failed to reload adapters:', err)
      })
    }
  })

  // Gateway Proxy
  ipcMain.handle(IPC_CHANNELS.GATEWAY_PROXY_GET, async () => {
    return getProxy()
  })

  ipcMain.handle(IPC_CHANNELS.GATEWAY_PROXY_SAVE, async (_event, proxy) => {
    if (!proxy || typeof proxy !== 'object') return
    await saveProxy(proxy)
    // 实时应用代理并重载适配器
    if (gateway) {
      gateway.setProxy(proxy)
      const channels = await getChannels()
      gateway.loadAdapters(channels).catch(err => {
        console.error('[IPC] Failed to reload adapters after proxy change:', err)
      })
    }
  })

  // Gateway Public Access
  ipcMain.handle(IPC_CHANNELS.GATEWAY_PUBLIC_ACCESS_GET, async () => {
    const publicAccess = await getGatewayPublicAccess()
    const token = await getGatewayToken()
    return { publicAccess, token: token || '' }
  })

  ipcMain.handle(IPC_CHANNELS.GATEWAY_PUBLIC_ACCESS_SAVE, async (_event, config) => {
    if (!config || typeof config !== 'object') return
    await saveGatewayPublicAccess(config)
    // 热更新 gateway 监听地址
    if (gateway) {
      const host = config.publicAccess && config.token ? '0.0.0.0' : '127.0.0.1'
      gateway.setHost(host)
    }
  })
}
