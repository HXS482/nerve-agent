import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { loadSettings, ClaudeSettings } from './settings'

interface ProviderEntry {
  type: 'anthropic' | 'openai' | 'google'
  baseURL: string
  authToken: string
  cached?: { client: any; providerType: 'anthropic' | 'openai' }
}

export class ProviderRegistry {
  private providers = new Map<string, ProviderEntry>()

  constructor(settings: ClaudeSettings) {
    // Default anthropic provider from settings
    this.providers.set('anthropic', {
      type: 'anthropic',
      baseURL: settings.baseURL,
      authToken: settings.authToken,
    })

    // Load additional providers from settings
    if (settings.providers) {
      for (const [id, config] of Object.entries(settings.providers)) {
        this.providers.set(id, config)
      }
    }
  }

  private createClient(entry: ProviderEntry): { client: any; providerType: 'anthropic' | 'openai' } {
    let sdkBaseURL = entry.baseURL.replace(/\/+$/, '')

    switch (entry.type) {
      case 'anthropic': {
        // Native Anthropic SDK appends /v1/messages automatically
        if (sdkBaseURL.endsWith('/v1')) sdkBaseURL = sdkBaseURL.slice(0, -3)

        const isNative = sdkBaseURL.includes('anthropic.com')

        // No custom fetch — use native fetch like Claude CLI does
        const customFetch = undefined

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
      // Fallback to anthropic for unknown providers
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
    // Intentionally discards all cached clients — callers get fresh SDK
    // clients built from the updated settings on next getClientAndModel() call.
    this.providers.clear()
    this.providers.set('anthropic', {
      type: 'anthropic',
      baseURL: settings.baseURL,
      authToken: settings.authToken,
    })
    if (settings.providers) {
      for (const [id, config] of Object.entries(settings.providers)) {
        this.providers.set(id, config)
      }
    }
  }
}
