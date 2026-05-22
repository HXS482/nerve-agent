import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, FileAttachment } from '../shared/types'

const api = {
  sendMessage: (prompt: string, sessionId?: string, files?: FileAttachment[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.SEND_MESSAGE, { prompt, sessionId, files }),
  cancel: () => ipcRenderer.invoke(IPC_CHANNELS.CANCEL),
  setModel: (model: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_MODEL, model),
  setEffort: (effort: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_EFFORT, effort),
  setProvider: (providerId: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_PROVIDER, providerId),
  setCwd: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_CWD, cwd),
  setPermissionMode: (mode: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_PERMISSION_MODE, mode),
  pickDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.PICK_DIRECTORY),
  pickAndReadFiles: (): Promise<FileAttachment[]> => ipcRenderer.invoke(IPC_CHANNELS.PICK_AND_READ_FILES),
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG),
  getModels: () => ipcRenderer.invoke(IPC_CHANNELS.GET_MODELS),
  listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.LIST_SESSIONS),
  getSessionMessages: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_SESSION_MESSAGES, sessionId),
  deleteSessionRemote: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DELETE_SESSION, sessionId),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  onMessage: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.MESSAGE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MESSAGE, handler)
  },
  onError: (callback: (data: { message: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.ERROR, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ERROR, handler)
  },
  onDone: (callback: (data: { sessionId: string; cost: number; maxContextTokens: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.DONE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DONE, handler)
  },
  onStreamClear: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.STREAM_CLEAR, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.STREAM_CLEAR, handler)
  },
  // Pet
  onPetStateChange: (callback: (state: string) => void) => {
    const handler = (_event: any, state: string) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.PET_STATE_CHANGE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PET_STATE_CHANGE, handler)
  },
  petDragStart: (mouseX: number, mouseY: number) =>
    ipcRenderer.send(IPC_CHANNELS.PET_DRAG_START, mouseX, mouseY),
  petDragMove: (screenX: number, screenY: number) =>
    ipcRenderer.send(IPC_CHANNELS.PET_DRAG_MOVE, screenX, screenY),
  petDragEnd: () => ipcRenderer.send(IPC_CHANNELS.PET_DRAG_END),
  togglePet: () => ipcRenderer.invoke(IPC_CHANNELS.PET_TOGGLE),
  onPetStatus: (callback: (status: { visible: boolean; docked: boolean }) => void) => {
    const handler = (_event: any, status: { visible: boolean; docked: boolean }) => callback(status)
    ipcRenderer.on(IPC_CHANNELS.PET_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PET_STATUS, handler)
  },
  getPetState: () => ipcRenderer.invoke(IPC_CHANNELS.PET_GET_STATE),
  sendPetColorScheme: (scheme: string) => ipcRenderer.send(IPC_CHANNELS.PET_COLOR_SCHEME, scheme),
  onPetColorScheme: (callback: (scheme: string) => void) => {
    const handler = (_event: any, scheme: string) => callback(scheme)
    ipcRenderer.on(IPC_CHANNELS.PET_COLOR_SCHEME, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PET_COLOR_SCHEME, handler)
  },
  undockPet: () => ipcRenderer.invoke(IPC_CHANNELS.PET_UNDOCK),
  // Pet skins
  listPetSkins: () => ipcRenderer.invoke(IPC_CHANNELS.PET_LIST_SKINS),
  importPetSkin: () => ipcRenderer.invoke(IPC_CHANNELS.PET_IMPORT_SKIN),
  deletePetSkin: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PET_DELETE_SKIN, id),
  setPetSkin: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PET_SET_SKIN, id),
  onPetSkinChanged: (callback: (skinId: string) => void) => {
    const handler = (_event: any, skinId: string) => callback(skinId)
    ipcRenderer.on(IPC_CHANNELS.PET_SKIN_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PET_SKIN_CHANGED, handler)
  },
  petSetShape: (rects: { x: number; y: number; width: number; height: number }[]) =>
    ipcRenderer.send(IPC_CHANNELS.PET_SET_SHAPE, rects),
  // Nerve settings
  getNerveSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_NERVE_SETTINGS),
  saveNerveSettings: (settings: any) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_NERVE_SETTINGS, settings),
  testConnection: (baseURL: string, authToken: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TEST_CONNECTION, { baseURL, authToken }),
  fetchModels: (baseURL: string, authToken: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FETCH_MODELS, { baseURL, authToken }),
  getMcpServers: () => ipcRenderer.invoke(IPC_CHANNELS.GET_MCP_SERVERS),
  saveMcpServers: (servers: any) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_MCP_SERVERS, servers),
  // Skills
  getSkills: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SKILLS),
  toggleSkill: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_SKILL, id, enabled),
  // Voice
  transcribeAudio: (audioData: Uint8Array, mimeType: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSCRIBE_AUDIO, audioData, mimeType),
  // Branches
  branchSession: (sessionId: string, fromEntryId: string, branchName?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BRANCH_SESSION, sessionId, fromEntryId, branchName),
  switchBranch: (sessionId: string, branchName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SWITCH_BRANCH, sessionId, branchName),
  listBranches: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_BRANCHES, sessionId),
  // Providers
  getProviders: () => ipcRenderer.invoke(IPC_CHANNELS.GET_PROVIDERS),
  // Session usage
  getSessionUsage: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_SESSION_USAGE, sessionId),
  // Images / Gallery
  saveImage: (filename: string, buffer: ArrayBuffer, source?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMAGE_SAVE, { filename, buffer, source }),
  listImages: () => ipcRenderer.invoke(IPC_CHANNELS.IMAGE_LIST),
  deleteImage: (filename: string) => ipcRenderer.invoke(IPC_CHANNELS.IMAGE_DELETE, filename),
  getImagePath: (filename: string) => ipcRenderer.invoke(IPC_CHANNELS.IMAGE_GET_PATH, filename),
  // Memory Browser (replaces Brain)
  brainScan: () => ipcRenderer.invoke(IPC_CHANNELS.BRAIN_SCAN),
  brainReadFile: (type: string, id: string) => ipcRenderer.invoke(IPC_CHANNELS.BRAIN_READ_FILE, type, id),
  // Flow
  onFlowItem: (callback: (data: { type: string; content: string; meta?: Record<string, any> }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.FLOW_ITEM, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FLOW_ITEM, handler)
  },
  pushFlowItem: (type: string, content: string, meta?: Record<string, any>) =>
    ipcRenderer.send(IPC_CHANNELS.FLOW_ITEM, { type, content, meta }),
  openInBrowser: (type: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_BROWSER, { type, content }),
  listDir: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.LIST_DIR, dirPath),
  // Git
  gitStatus: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STATUS, cwd),
  gitStage: (files: string[], cwd: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_STAGE, files, cwd),
  gitUnstage: (files: string[], cwd: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_UNSTAGE, files, cwd),
  gitCommit: (message: string, cwd: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, message, cwd),
  gitPush: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_PUSH, cwd),
  gitPull: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_PULL, cwd),
  gitLog: (cwd: string, maxCount?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_LOG, cwd, maxCount),
  gitListBranches: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_BRANCH_LIST, cwd),
  gitCheckout: (branch: string, cwd: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECKOUT, branch, cwd),
  gitDiff: (files: string[] | undefined, cwd: string, staged?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF, files, cwd, staged),
  gitInit: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_INIT, cwd),
  gitCreateBranch: (branch: string, cwd: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_CREATE_BRANCH, branch, cwd),
  gitStashList: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_LIST, cwd),
  gitStashPush: (cwd: string, message?: string, includeUntracked?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_PUSH, cwd, message, includeUntracked),
  gitStashPop: (cwd: string, index?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_POP, cwd, index),
  gitStashApply: (cwd: string, index?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_APPLY, cwd, index),
  gitStashDrop: (cwd: string, index: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_DROP, cwd, index),
  gitDeleteBranch: (cwd: string, branch: string, force?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_DELETE_BRANCH, cwd, branch, force),
  gitDiscard: (cwd: string, files: string[], tracked: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_DISCARD, cwd, files, tracked),
  gitShowDiff: (cwd: string, hash: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_SHOW_DIFF, cwd, hash),
  gitFetch: (cwd: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_FETCH, cwd),
  onGitRefresh: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.GIT_REFRESH, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.GIT_REFRESH, handler)
  },
}

contextBridge.exposeInMainWorld('claude', api)

export type ClaudeAPI = typeof api
