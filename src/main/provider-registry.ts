import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { loadSettings, ClaudeSettings } from './settings'

interface ProviderEntry {
  type: 'anthropic' | 'openai' | 'google'
  baseURL: string
  authToken: string
  /** 该 provider 下可选的模型名，UI / gateway 读它来列模型 */
  models?: string[]
  cached?: { client: any; providerType: 'anthropic' | 'openai' }
}

export class ProviderRegistry {
  private providers = new Map<string, ProviderEntry>()

  constructor(settings: ClaudeSettings) {
    this.loadFromSettings(settings)
  }

  /**
   * 唯一的装载路径 —— constructor 与 reload() 共用，避免两条路径行为不一致。
   *
   * 'anthropic' 的 baseURL/authToken 只认 settings（来自 env.ANTHROPIC_BASE_URL /
   * ANTHROPIC_AUTH_TOKEN），settings.json 里 providers.anthropic 的 baseURL 可能是
   * 缺 /v1 后缀的旧值，所以这里跳过它，别让它覆盖 env。
   */
  private loadFromSettings(settings: ClaudeSettings) {
    this.providers.clear()

    this.providers.set('anthropic', {
      type: 'anthropic',
      baseURL: settings.baseURL,
      authToken: settings.authToken,
    })

    for (const [id, config] of Object.entries(settings.providers || {})) {
      if (id === 'anthropic') continue
      this.providers.set(id, config)
    }
  }

  private createClient(entry: ProviderEntry): { client: any; providerType: 'anthropic' | 'openai' } {
    let sdkBaseURL = entry.baseURL.replace(/\/+$/, '')

    switch (entry.type) {
      case 'anthropic': {
        // Native Anthropic SDK appends /v1/messages automatically
        if (sdkBaseURL.endsWith('/v1')) sdkBaseURL = sdkBaseURL.slice(0, -3)

        const isNative = sdkBaseURL.includes('anthropic.com')

        // For proxy endpoints, strip the internal 'authorization' header that the SDK
        // auto-injects from Claude Code auth — it conflicts with the proxy's x-api-key check
        const customFetch = isNative ? undefined : async (url: string | URL | Request, init?: RequestInit) => {
          if (init?.headers) {
            const h = new Headers(init.headers)
            h.delete('authorization')
            init = { ...init, headers: h }
          }
          return fetch(url, init)
        }

        const client = new Anthropic({
          apiKey: entry.authToken,
          baseURL: sdkBaseURL,
          ...(customFetch ? { fetch: customFetch } : {}),
        })
        return { client, providerType: 'anthropic' }
      }
      case 'openai': {
        const client = new OpenAI({
          apiKey: entry.authToken,
          baseURL: sdkBaseURL,
        })
        return { client, providerType: 'openai' }
      }
      case 'google':
        throw new Error('Google native SDK not yet supported')
      default:
        throw new Error(`Unknown provider type: ${entry.type}`)
    }
  }

  async getClientAndModel(providerId: string, modelId: string): Promise<{ client: any; modelId: string; providerType: 'anthropic' | 'openai' }> {
    const entry = this.providers.get(providerId)
    if (!entry) {
      if (providerId === 'anthropic') {
        throw new Error(`Provider "${providerId}" not configured`)
      }
      // Fallback to anthropic for unknown providers — 打日志，别静默换
      console.warn(`[ProviderRegistry] provider "${providerId}" not configured, falling back to "anthropic"`)
      if (this.providers.has('anthropic')) {
        return this.getClientAndModel('anthropic', modelId)
      }
      throw new Error(`Provider "${providerId}" not configured and no "anthropic" fallback available`)
    }

    if (!entry.cached) {
      entry.cached = this.createClient(entry)
    }

    return { client: entry.cached.client, modelId, providerType: entry.cached.providerType }
  }

  createFreshClient(providerId: string): { client: any; providerType: 'anthropic' | 'openai' } {
    const entry = this.providers.get(providerId)
    if (!entry) throw new Error(`Provider "${providerId}" not configured`)
    return this.createClient(entry)
  }

  async addProvider(id: string, config: Omit<ProviderEntry, 'cached'>) {
    // Clear cached client so it gets re-created with the new config
    this.providers.delete(id)
    this.providers.set(id, config)
  }

  removeProvider(id: string) {
    this.providers.delete(id)
  }

  isNativeAnthropic(providerId: string): boolean {
    const entry = this.providers.get(providerId)
    if (!entry) return false
    return entry.type === 'anthropic' && entry.baseURL.includes('anthropic.com')
  }

  listProviders(): Array<{ id: string; type: string; baseURL: string }> {
    return Array.from(this.providers.entries()).map(([id, entry]) => ({
      id,
      type: entry.type,
      baseURL: entry.baseURL,
    }))
  }

  reload(settings: ClaudeSettings) {
    // 丢弃所有缓存 client —— 下次 getClientAndModel() 会用新 settings 重建 SDK client。
    this.loadFromSettings(settings)
  }
}
