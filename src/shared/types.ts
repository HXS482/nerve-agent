// IPC channel names
export const IPC_CHANNELS = {
  SEND_MESSAGE: 'claude:send-message',
  CANCEL: 'claude:cancel',
  SET_MODEL: 'claude:set-model',
  SET_CWD: 'claude:set-cwd',
  SET_EFFORT: 'claude:set-effort',
  SET_PROVIDER: 'claude:set-provider',
  SET_PERMISSION_MODE: 'claude:set-permission-mode',
  PICK_DIRECTORY: 'claude:pick-directory',
  GET_CONFIG: 'claude:get-config',
  GET_MODELS: 'claude:get-models',
  LIST_SESSIONS: 'claude:list-sessions',
  GET_SESSION_MESSAGES: 'claude:get-session-messages',
  DELETE_SESSION: 'claude:delete-session',
  MESSAGE: 'claude:message',
  STREAM_CLEAR: 'claude:stream-clear',
  ERROR: 'claude:error',
  DONE: 'claude:done',
  PET_STATE_CHANGE: 'pet:state-change',
  PET_DRAG_START: 'pet:drag-start',
  PET_DRAG_MOVE: 'pet:drag-move',
  PET_DRAG_END: 'pet:drag-end',
  PET_TOGGLE: 'pet:toggle',
  PET_REPORT_DROP: 'pet:report-drop',
  PET_STATUS: 'pet:status',
  PET_GET_STATE: 'pet:get-state',
  PET_COLOR_SCHEME: 'pet:color-scheme',
  PET_UNDOCK: 'pet:undock',
  PET_LIST_SKINS: 'pet:list-skins',
  PET_IMPORT_SKIN: 'pet:import-skin',
  PET_DELETE_SKIN: 'pet:delete-skin',
  PET_SET_SKIN: 'pet:set-skin',
  PET_SKIN_CHANGED: 'pet:skin-changed',
  PET_SET_SHAPE: 'pet:set-shape',
  // Nerve settings
  GET_NERVE_SETTINGS: 'nerve:get-settings',
  SAVE_NERVE_SETTINGS: 'nerve:save-settings',
  TEST_CONNECTION: 'nerve:test-connection',
  FETCH_MODELS: 'nerve:fetch-models',
  GET_MCP_SERVERS: 'nerve:get-mcp-servers',
  SAVE_MCP_SERVERS: 'nerve:save-mcp-servers',
  // Skills
  GET_SKILLS: 'nerve:get-skills',
  TOGGLE_SKILL: 'nerve:toggle-skill',
  // Voice
  TRANSCRIBE_AUDIO: 'nerve:transcribe-audio',
  // Branches
  BRANCH_SESSION: 'nerve:branch-session',
  SWITCH_BRANCH: 'nerve:switch-branch',
  LIST_BRANCHES: 'nerve:list-branches',
  // Providers
  GET_PROVIDERS: 'nerve:get-providers',
  // Session usage
  GET_SESSION_USAGE: 'nerve:get-session-usage',
  // Aggregate usage stats
  GET_USAGE_STATS: 'nerve:get-usage-stats',
  // Images / Gallery
  IMAGE_SAVE: 'nerve:image-save',
  IMAGE_LIST: 'nerve:image-list',
  IMAGE_DELETE: 'nerve:image-delete',
  IMAGE_GET_PATH: 'nerve:image-get-path',
  // File upload
  PICK_AND_READ_FILES: 'nerve:pick-and-read-files',
  // Brain
  BRAIN_SCAN: 'nerve:brain-scan',
  BRAIN_READ_FILE: 'nerve:brain-read-file',
  // Flow
  FLOW_ITEM: 'nerve:flow-item',
  OPEN_IN_BROWSER: 'nerve:open-in-browser',
  // File explorer
  LIST_DIR: 'nerve:list-dir',
  // Git
  GIT_STATUS: 'git:status',
  GIT_STAGE: 'git:stage',
  GIT_UNSTAGE: 'git:unstage',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_PULL: 'git:pull',
  GIT_LOG: 'git:log',
  GIT_BRANCH_LIST: 'git:branch-list',
  GIT_CHECKOUT: 'git:checkout',
  GIT_DIFF: 'git:diff',
  GIT_INIT: 'git:init',
  GIT_CREATE_BRANCH: 'git:create-branch',
  GIT_STASH_LIST: 'git:stash-list',
  GIT_STASH_PUSH: 'git:stash-push',
  GIT_STASH_POP: 'git:stash-pop',
  GIT_STASH_APPLY: 'git:stash-apply',
  GIT_STASH_DROP: 'git:stash-drop',
  GIT_DELETE_BRANCH: 'git:delete-branch',
  GIT_DISCARD: 'git:discard',
  GIT_SHOW_DIFF: 'git:show-diff',
  GIT_FETCH: 'git:fetch',
  // Git UI refresh notification (main → renderer)
  GIT_REFRESH: 'git:refresh',
} as const

// Our 9 behavioral states — maps 1:1 to Petdex animations
export type PetState =
  | 'idle'
  | 'working'
  | 'running-left'
  | 'thinking'
  | 'happy'
  | 'error'
  | 'sleeping'
  | 'jumping'
  | 'waiting'

// Petdex standard 9 animation rows
export type PetdexAnimId =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

// A single animation row in the spritesheet
export interface PetAnimState {
  id: PetdexAnimId
  label: string
  row: number
  frames: number
  durationMs: number
}

// Petdex standard constants
export const PETDEX_FRAME_W = 192
export const PETDEX_FRAME_H = 208
export const PETDEX_COLS = 8
export const PETDEX_ROWS = 9
export const PETDEX_IMG_W = PETDEX_FRAME_W * PETDEX_COLS  // 1536
export const PETDEX_IMG_H = PETDEX_FRAME_H * PETDEX_ROWS  // 1872

// Petdex standard 9 animation states
export const PETDEX_STATES: PetAnimState[] = [
  { id: 'idle',           label: 'Idle',           row: 0, frames: 6, durationMs: 1100 },
  { id: 'running-right',  label: 'Run Right',      row: 1, frames: 8, durationMs: 1060 },
  { id: 'running-left',   label: 'Run Left',       row: 2, frames: 8, durationMs: 1060 },
  { id: 'waving',         label: 'Waving',         row: 3, frames: 4, durationMs: 700 },
  { id: 'jumping',        label: 'Jumping',        row: 4, frames: 5, durationMs: 840 },
  { id: 'failed',         label: 'Failed',         row: 5, frames: 8, durationMs: 1220 },
  { id: 'waiting',        label: 'Waiting',        row: 6, frames: 6, durationMs: 1010 },
  { id: 'running',        label: 'Running',        row: 7, frames: 6, durationMs: 820 },
  { id: 'review',         label: 'Review',         row: 8, frames: 6, durationMs: 1030 },
]

// Map our 9 behavioral states → Petdex animation row (1:1)
// Skins can override this via stateMap in skin.json
export const DEFAULT_STATE_MAP: Record<PetState, PetdexAnimId> = {
  idle: 'idle',
  working: 'running',
  'running-left': 'running-left',
  thinking: 'review',
  happy: 'waving',
  error: 'failed',
  sleeping: 'idle',
  jumping: 'jumping',
  waiting: 'waiting',
}

export interface FileAttachment {
  name: string
  mimeType: string
  size: number
  data: string
  isImage: boolean
}

export interface SendMessagePayload {
  prompt: string
  sessionId?: string
  files?: FileAttachment[]
}

export interface SessionInfo {
  sessionId: string
  title?: string
  lastMessageAt?: string
}

export interface ModelInfo {
  alias: string
  name: string
}

export interface ClaudeConfig {
  model: string
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  cwd: string
  permissionMode: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions'
  provider?: string
}

export type Theme = 'dark' | 'light' | 'aurora'
export type ColorScheme = 'purple' | 'blue' | 'green' | 'pink' | 'orange'

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image' | 'file'
  text?: string
  thinking?: string
  src?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  content?: string | ContentBlock[]
  toolCallId?: string
  is_error?: boolean
  fileName?: string
  fileSize?: number
  mimeType?: string
  fileContent?: string
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: ContentBlock[]
  timestamp: number
  sessionId?: string
  cost?: number
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

// Skin data stored in skin.json
export interface PetSkin {
  id: string
  displayName: string
  description?: string
  spritesheetPath?: string
  frameWidth?: number
  frameHeight?: number
  imageWidth?: number
  imageHeight?: number
  states: PetAnimState[]
  stateMap?: Partial<Record<PetState, PetdexAnimId>>
  isDefault?: boolean
}

// Skill — reusable prompt template invoked as a tool by the agent
export interface Skill {
  id: string
  name: string
  description: string
  prompt: string
  enabled: boolean
}

// Session token usage aggregation
export interface SessionUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  compactionCount: number
  maxContextTokens: number
}

// Aggregate usage stats across all sessions
export interface UsageStats {
  totalSessions: number
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  // ISO date string → { messages, tokens }
  dailyActivity: Record<string, { messages: number; tokens: number }>
  // 24-slot hourly distribution (message counts)
  hourlyDistribution: number[]
  // model alias → message count
  modelUsage: Record<string, number>
  // earliest session timestamp (ms)
  firstSessionAt: number
}

// Provider info
export interface ProviderInfo {
  id: string
  type: string
  baseURL: string
}

// Brain graph data
export interface BrainNode {
  id: string
  name: string
  path: string
  type: string  // identity, cache, episodic, procedural, semantic, schema
  tags?: string[]
  size?: number
}

export interface BrainLink {
  source: string
  target: string
}

export interface BrainGraphData {
  nodes: BrainNode[]
  links: BrainLink[]
}

export interface BrainFileContent {
  path: string
  content: string
  frontmatter?: Record<string, unknown>
}

// Memory Browser (TencentDB 4-layer architecture)
export interface MemoryAtom {
  id: string
  content: string
  type: string
  priority: string
  scene_name: string
  tags: string[]
  created: string
  access_count: number
}

export interface SceneBlock {
  filename: string
  summary: string
  heat: number
  updated: string
}

export interface PersonaCard {
  content: string
  updated: string
}

export interface ConvEntry {
  id: string
  session_key: string
  role: string
  content: string
  created: string
}

export interface MemoryBrowserData {
  L0: ConvEntry[]
  L1: MemoryAtom[]
  L2: SceneBlock[]
  L3: PersonaCard
}

// Git types
export interface GitFile {
  path: string
  index: string
  working_dir: string
}

export interface GitStatus {
  current: string
  tracking: string
  ahead: number
  behind: number
  files: GitFile[]
  staged: string[]
  conflicts: string[]
  created: string[]
  deleted: string[]
  modified: string[]
  renamed: string[]
  not_added: string[]
}

export interface GitBranch {
  name: string
  current: boolean
  commit?: string
  label?: string
}

export interface GitCommit {
  hash: string
  date: string
  message: string
  author_name: string
  author_email: string
}

export interface GitStashEntry {
  hash: string
  message: string
  date: string
  index: number
}
