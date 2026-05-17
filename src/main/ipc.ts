import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { IPC_CHANNELS, SendMessagePayload, ClaudeConfig } from '../shared/types'
import { ClaudeService, testConnection, fetchModels, getSkills, toggleSkill, transcribeAudio } from './claude'
import { PetSkinManager } from './pet-skins'
import { getNerveSettings, saveNerveSettings, getMcpServers, saveMcpServers, getAvailableModels } from './settings'
import { saveImage, listImages, deleteImage, getImagePath } from './images'
import { scanBrain, readBrainFile } from './brain'
import { GitService } from './git'

export function setupIPC(window: BrowserWindow, claude: ClaudeService, skinManager: PetSkinManager, gitService: GitService) {
  ipcMain.handle(IPC_CHANNELS.SEND_MESSAGE, async (_event, payload: SendMessagePayload) => {
    await claude.sendMessage(payload)
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL, () => {
    claude.cancel()
  })

  ipcMain.handle(IPC_CHANNELS.SET_MODEL, (_event, model: string) => {
    claude.setModel(model)
  })

  ipcMain.handle(IPC_CHANNELS.SET_PROVIDER, (_event, providerId: string) => {
    claude.setProvider(providerId)
  })

  ipcMain.handle(IPC_CHANNELS.SET_EFFORT, (_event, effort: string) => {
    claude.setEffort(effort as ClaudeConfig['effort'])
  })

  ipcMain.handle(IPC_CHANNELS.SET_CWD, async (_event, cwd: string) => {
    await claude.setCwd(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.SET_PERMISSION_MODE, (_event, mode: string) => {
    claude.setPermissionMode(mode as ClaudeConfig['permissionMode'])
  })

  ipcMain.handle(IPC_CHANNELS.PICK_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      await claude.setCwd(result.filePaths[0])
      return result.filePaths[0]
    }
    return null
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
    // Basic type validation — reject obviously malformed payloads
    if (settings && typeof settings !== 'object') return getAvailableModels()
    if (settings.baseURL !== undefined && typeof settings.baseURL !== 'string') return getAvailableModels()
    if (settings.authToken !== undefined && typeof settings.authToken !== 'string') return getAvailableModels()
    if (settings.providers !== undefined && (typeof settings.providers !== 'object' || Array.isArray(settings.providers))) return getAvailableModels()
    await saveNerveSettings(settings)
    claude.reloadProvider()
    return getAvailableModels()
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
      const c = config as any
      if (typeof c.command !== 'string' || c.command.length === 0) return
      if (c.args !== undefined && !Array.isArray(c.args)) return
      if (c.env !== undefined && (typeof c.env !== 'object' || Array.isArray(c.env))) return
    }
    await saveMcpServers(servers)
  })

  // Skills
  ipcMain.handle(IPC_CHANNELS.GET_SKILLS, () => {
    return getSkills(claude.getSourceDir())
  })

  ipcMain.handle(IPC_CHANNELS.TOGGLE_SKILL, async (_event, id: string, enabled: boolean) => {
    await toggleSkill(id, enabled)
  })

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

  // Brain
  ipcMain.handle(IPC_CHANNELS.BRAIN_SCAN, () => {
    return scanBrain()
  })

  ipcMain.handle(IPC_CHANNELS.BRAIN_READ_FILE, (_event, filePath: string) => {
    return readBrainFile(filePath)
  })

  // File explorer
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

  // Git
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async (_event, cwd: string) => {
    return gitService.getStatus(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STAGE, async (_event, files: string[], cwd: string) => {
    return gitService.stageFiles(cwd, files)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_UNSTAGE, async (_event, files: string[], cwd: string) => {
    return gitService.unstageFiles(cwd, files)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_event, message: string, cwd: string) => {
    return gitService.commit(cwd, message)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PUSH, async (_event, cwd: string) => {
    return gitService.push(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PULL, async (_event, cwd: string) => {
    return gitService.pull(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_LOG, async (_event, cwd: string, maxCount?: number) => {
    return gitService.getLog(cwd, maxCount)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_LIST, async (_event, cwd: string) => {
    return gitService.listBranches(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_CHECKOUT, async (_event, branch: string, cwd: string) => {
    return gitService.checkout(cwd, branch)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DIFF, async (_event, files: string[] | undefined, cwd: string, staged?: boolean) => {
    return gitService.getDiff(cwd, files, staged)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_INIT, async (_event, cwd: string) => {
    return gitService.init(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_CREATE_BRANCH, async (_event, branch: string, cwd: string) => {
    return gitService.checkoutNewBranch(cwd, branch)
  })

  ipcMain.handle(IPC_CHANNELS.OPEN_IN_BROWSER, async (_event, { type, content }: { type: string; content: string }) => {
    if (type === 'image') {
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
}
