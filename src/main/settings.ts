import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs'
import { readFile, writeFile, mkdir, rename } from 'fs/promises'
import { ModelInfo, GatewayChannel, GatewayProxy } from '../shared/types'

async function atomicWriteFile(filePath: string, data: string, encoding: BufferEncoding = 'utf-8') {
  const tmpPath = filePath + '.tmp'
  await writeFile(tmpPath, data, encoding)
  await rename(tmpPath, filePath)
}

export const NERVE_DIR = join(homedir(), '.nerve')

function ensureNerveDirSync() {
  mkdirSync(NERVE_DIR, { recursive: true })
}

async function ensureNerveDir() {
  await mkdir(NERVE_DIR, { recursive: true })
}

// --- Settings ---

export interface ClaudeSettings {
  baseURL: string
  authToken: string
  modelAliases: Record<string, string>
  defaultModel?: string
  cwd?: string
  model?: string
  provider?: string
  providers?: Record<string, { type: 'anthropic' | 'openai' | 'google'; baseURL: string; authToken: string; models?: string[] }>
  defaultProvider?: string
  extraction?: { baseURL: string; authToken: string; model: string }
  memoryTDAI?: {
    enabled: boolean
    embedding?: { provider: string; baseUrl: string; apiKey: string; model: string; dimensions: number }
    extraction?: { model?: string }
    recall?: { strategy: 'embedding' | 'keyword' | 'hybrid'; maxResults: number }
    offload?: { enabled: boolean; model?: string }
  }
}

// Sync version — used by ClaudeService constructor (can't be async)
export function loadSettings(): ClaudeSettings {
  const defaults: ClaudeSettings = {
    baseURL: 'https://api.anthropic.com/v1',
    authToken: '',
    modelAliases: {},
  }

  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  const claudeSettingsPath = join(homedir(), '.claude', 'settings.json')

  // Auto-migrate from Claude's config if Nerve config doesn't exist
  if (!existsSync(nerveSettingsPath) && existsSync(claudeSettingsPath)) {
    try {
      ensureNerveDirSync()
      copyFileSync(claudeSettingsPath, nerveSettingsPath)
    } catch { /* ignore */ }
  }

  const settingsPath = existsSync(nerveSettingsPath) ? nerveSettingsPath : claudeSettingsPath
  if (!existsSync(settingsPath)) return defaults

  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    const data = JSON.parse(raw)
    const env = data.env || {}

    const modelAliases: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) {
      const match = key.match(/^ANTHROPIC_DEFAULT_([\w.-]+)_MODEL$/)
      if (match && typeof value === 'string') {
        modelAliases[match[1].toLowerCase()] = value
      }
    }

    // Ensure baseURL ends with /v1 — the SDK appends /messages to it
    let baseURL = env.ANTHROPIC_BASE_URL || defaults.baseURL
    if (baseURL && !baseURL.endsWith('/v1')) {
      baseURL = baseURL.replace(/\/+$/, '') + '/v1'
    }

    return {
      baseURL,
      authToken: env.ANTHROPIC_AUTH_TOKEN || defaults.authToken,
      modelAliases,
      defaultModel: env.ANTHROPIC_MODEL || undefined,
      cwd: data.cwd || undefined,
      model: data.model || undefined,
      provider: data.provider || undefined,
      providers: data.providers || undefined,
      defaultProvider: data.defaultProvider || undefined,
      extraction: data.extraction || undefined,
    }
  } catch {
    return defaults
  }
}

export function injectSettingsEnv(): void {
  try {
    const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
    const claudeSettingsPath = join(homedir(), '.claude', 'settings.json')
    const settingsPath = existsSync(nerveSettingsPath) ? nerveSettingsPath : claudeSettingsPath
    if (!existsSync(settingsPath)) return
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    if (data.env) {
      for (const [key, value] of Object.entries(data.env)) {
        if (typeof value === 'string' && !process.env[key]) {
          process.env[key] = value
        }
      }
    }
  } catch { /* ignore */ }
}

// --- MCP ---

export interface McpServerConfig {
  type: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export async function loadMcpServerConfigs(): Promise<Record<string, McpServerConfig>> {
  const nerveMcpPath = join(NERVE_DIR, 'mcp.json')
  const claudeJsonPath = join(homedir(), '.claude.json')

  // Auto-migrate from Claude's config if Nerve MCP config doesn't exist
  if (!existsSync(nerveMcpPath) && existsSync(claudeJsonPath)) {
    try {
      const raw = await readFile(claudeJsonPath, 'utf-8')
      const data = JSON.parse(raw)
      if (data.mcpServers && Object.keys(data.mcpServers).length > 0) {
        await ensureNerveDir()
        await atomicWriteFile(nerveMcpPath, JSON.stringify({ mcpServers: data.mcpServers }, null, 2))
      }
    } catch { /* ignore */ }
  }

  // Read from Nerve config
  if (existsSync(nerveMcpPath)) {
    try {
      const raw = await readFile(nerveMcpPath, 'utf-8')
      const data = JSON.parse(raw)
      return data.mcpServers || data || {}
    } catch { /* fall through */ }
  }

  // Fallback to Claude's config
  if (existsSync(claudeJsonPath)) {
    try {
      const raw = await readFile(claudeJsonPath, 'utf-8')
      const data = JSON.parse(raw)
      return data.mcpServers || {}
    } catch { /* ignore */ }
  }

  return {}
}

// --- Settings I/O ---

export async function getNerveSettings() {
  const settings = loadSettings()
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  let raw: Record<string, string> = {}
  let stt: Record<string, string> = {}
  let providers: Record<string, { type: string; baseURL: string; authToken: string; models?: string[] }> = {}
  let defaultProvider = ''
  if (existsSync(nerveSettingsPath)) {
    try {
      const data = JSON.parse(await readFile(nerveSettingsPath, 'utf-8'))
      raw = data.env || {}
      stt = data.stt || {}
      providers = data.providers || {}
      defaultProvider = data.defaultProvider || ''
    } catch { /* ignore */ }
  }
  return {
    baseURL: raw.ANTHROPIC_BASE_URL || '',
    authToken: raw.ANTHROPIC_AUTH_TOKEN || '',
    modelAliases: settings.modelAliases,
    sttEndpoint: stt.endpoint || '',
    sttApiKey: stt.apiKey || '',
    sttModel: stt.model || 'whisper-1',
    providers,
    defaultProvider,
  }
}

export async function saveNerveSettings(settings: { baseURL?: string; authToken?: string; modelAliases?: Record<string, string>; sttEndpoint?: string; sttApiKey?: string; sttModel?: string; providers?: Record<string, { type: string; baseURL: string; authToken: string; models?: string[] }>; defaultProvider?: string }) {
  await ensureNerveDir()
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')

  // Read existing or start fresh
  let existing: Record<string, unknown> = {}
  if (existsSync(nerveSettingsPath)) {
    try { existing = JSON.parse(await readFile(nerveSettingsPath, 'utf-8')) } catch { /* ignore */ }
  }

  const env = (existing.env as Record<string, string>) || {}

  if (settings.baseURL !== undefined) env.ANTHROPIC_BASE_URL = settings.baseURL
  if (settings.authToken !== undefined) env.ANTHROPIC_AUTH_TOKEN = settings.authToken

  // Sync model aliases
  if (settings.modelAliases) {
    // Remove old alias keys
    for (const key of Object.keys(env)) {
      if (key.match(/^ANTHROPIC_DEFAULT_[\w.-]+_MODEL$/)) delete env[key]
    }
    // Write new ones
    for (const [alias, modelId] of Object.entries(settings.modelAliases)) {
      env[`ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`] = modelId
    }
  }

  existing.env = env

  // STT config
  const stt = (existing.stt as Record<string, string>) || {}
  if (settings.sttEndpoint !== undefined) stt.endpoint = settings.sttEndpoint
  if (settings.sttApiKey !== undefined) stt.apiKey = settings.sttApiKey
  if (settings.sttModel !== undefined) stt.model = settings.sttModel
  existing.stt = stt

  // Providers config
  if (settings.providers !== undefined) existing.providers = settings.providers
  if (settings.defaultProvider !== undefined) existing.defaultProvider = settings.defaultProvider

  await atomicWriteFile(nerveSettingsPath, JSON.stringify(existing, null, 2))
}

export async function getMcpServers(): Promise<Record<string, McpServerConfig>> {
  return loadMcpServerConfigs()
}

export async function saveMcpServers(servers: Record<string, McpServerConfig>) {
  await ensureNerveDir()
  const nerveMcpPath = join(NERVE_DIR, 'mcp.json')
  await atomicWriteFile(nerveMcpPath, JSON.stringify({ mcpServers: servers }, null, 2))
}

// --- Models ---

export async function getAvailableModels(): Promise<ModelInfo[]> {
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  const claudeSettingsPath = join(homedir(), '.claude', 'settings.json')
  const settingsPath = existsSync(nerveSettingsPath) ? nerveSettingsPath : claudeSettingsPath
  if (!existsSync(settingsPath)) return []

  try {
    const raw = await readFile(settingsPath, 'utf-8')
    const settings = JSON.parse(raw)
    if (!settings.env) return []

    const models: ModelInfo[] = []
    const seen = new Set<string>()

    // Parse ANTHROPIC_DEFAULT_*_MODEL env vars
    const modelEnvKeys = Object.keys(settings.env).filter(
      (k: string) => k.startsWith('ANTHROPIC_DEFAULT_') && k.endsWith('_MODEL')
    )
    for (const key of modelEnvKeys) {
      const alias = key.replace('ANTHROPIC_DEFAULT_', '').replace('_MODEL', '').toLowerCase()
      const name = settings.env[key]
      if (name && !seen.has(name)) {
        seen.add(name)
        models.push({ alias, name })
      }
    }

    // Also include ANTHROPIC_MODEL if set
    const currentModel = settings.env['ANTHROPIC_MODEL']
    if (currentModel && !seen.has(currentModel)) {
      seen.add(currentModel)
      models.push({ alias: 'current', name: currentModel })
    }

    return models
  } catch {
    return []
  }
}

// --- Gateway Channels ---

export async function getChannels(): Promise<GatewayChannel[]> {
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  if (!existsSync(nerveSettingsPath)) return []
  try {
    const data = JSON.parse(await readFile(nerveSettingsPath, 'utf-8'))
    return data.channels || []
  } catch {
    return []
  }
}

export async function saveChannels(channels: GatewayChannel[]): Promise<void> {
  await ensureNerveDir()
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  let existing: Record<string, unknown> = {}
  if (existsSync(nerveSettingsPath)) {
    try { existing = JSON.parse(await readFile(nerveSettingsPath, 'utf-8')) } catch { /* ignore */ }
  }
  existing.channels = channels
  await atomicWriteFile(nerveSettingsPath, JSON.stringify(existing, null, 2))
}

// --- Gateway Proxy ---

export async function getProxy(): Promise<GatewayProxy> {
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  if (!existsSync(nerveSettingsPath)) return { enabled: false, host: '127.0.0.1', port: 7890, protocol: 'http' }
  try {
    const data = JSON.parse(await readFile(nerveSettingsPath, 'utf-8'))
    return data.proxy || { enabled: false, host: '127.0.0.1', port: 7890, protocol: 'http' }
  } catch {
    return { enabled: false, host: '127.0.0.1', port: 7890, protocol: 'http' }
  }
}

export async function getGatewayPublicAccess(): Promise<boolean> {
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  if (!existsSync(nerveSettingsPath)) return false
  try {
    const data = JSON.parse(await readFile(nerveSettingsPath, 'utf-8'))
    return data.gateway?.publicAccess === true
  } catch {
    return false
  }
}

export async function saveProxy(proxy: GatewayProxy): Promise<void> {
  await ensureNerveDir()
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  let existing: Record<string, unknown> = {}
  if (existsSync(nerveSettingsPath)) {
    try { existing = JSON.parse(await readFile(nerveSettingsPath, 'utf-8')) } catch { /* ignore */ }
  }
  existing.proxy = proxy
  await atomicWriteFile(nerveSettingsPath, JSON.stringify(existing, null, 2))
}
