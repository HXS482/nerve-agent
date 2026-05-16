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
  // Images / Gallery
  IMAGE_SAVE: 'nerve:image-save',
  IMAGE_LIST: 'nerve:image-list',
  IMAGE_DELETE: 'nerve:image-delete',
  IMAGE_GET_PATH: 'nerve:image-get-path',
  // Brain
  BRAIN_SCAN: 'nerve:brain-scan',
  BRAIN_READ_FILE: 'nerve:brain-read-file',
  // Flow
  FLOW_ITEM: 'nerve:flow-item',
  OPEN_IN_BROWSER: 'nerve:open-in-browser',
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

export interface SendMessagePayload {
  prompt: string
  sessionId?: string
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
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image'
  text?: string
  thinking?: string
  src?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  content?: string | ContentBlock[]
  toolCallId?: string
  is_error?: boolean
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
