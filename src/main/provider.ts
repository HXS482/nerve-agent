import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { NERVE_DIR, loadSettings } from './settings'

export async function testConnection(baseURL: string, authToken: string): Promise<{ ok: boolean; error?: string }> {
  const base = baseURL.replace(/\/+$/, '')

  const candidates: string[] = []
  if (base.endsWith('/v1')) {
    candidates.push(base + '/messages')
  } else {
    candidates.push(base + '/v1/messages')
    candidates.push(base + '/messages')
  }

  const settings = loadSettings()
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  let envModel = ''
  try {
    if (existsSync(nerveSettingsPath)) {
      const raw = JSON.parse(readFileSync(nerveSettingsPath, 'utf-8'))
      envModel = raw.env?.ANTHROPIC_MODEL || ''
    }
  } catch { /* ignore */ }
  const model = settings.modelAliases['sonnet'] || settings.modelAliases['current'] || envModel || Object.values(settings.modelAliases)[0] || 'claude-sonnet-4-20250514'

  const body = JSON.stringify({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }],
  })

  const authVariants = [
    { 'x-api-key': authToken, 'anthropic-version': '2023-06-01' },
    { 'Authorization': `Bearer ${authToken}` },
  ]

  let lastError = ''

  for (const url of candidates) {
    for (const auth of authVariants) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth },
          body,
        })

        if (res.ok) return { ok: true }

        const text = await res.text().catch(() => '')
        lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
  }

  return { ok: false, error: lastError }
}

export async function fetchModels(baseURL: string, authToken: string): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const base = baseURL.replace(/\/+$/, '')

  // Build candidate URLs — deduplicated, most likely first
  const seen = new Set<string>()
  const candidates: string[] = []
  const add = (url: string) => { if (!seen.has(url)) { seen.add(url); candidates.push(url) } }

  // 1. Origin + /v1/models (covers proxies where baseURL is a subpath like /anthropic)
  try {
    add(new URL(base).origin + '/v1/models')
  } catch { /* ignore */ }

  if (base.endsWith('/v1')) {
    add(base + '/models')
  } else {
    add(base + '/v1/models')
    add(base + '/models')
  }

  // 2. Strip trailing path segment and try /v1/models
  const lastSlash = base.lastIndexOf('/')
  if (lastSlash > 8) {
    const shorter = base.slice(0, lastSlash)
    add(shorter + '/v1/models')
    add(shorter + '/models')
  }

  const authVariants = [
    { 'Authorization': `Bearer ${authToken}` },
    { 'x-api-key': authToken, 'anthropic-version': '2023-06-01' },
  ]

  let lastError = ''
  console.log('[Nerve] fetchModels candidates:', candidates)

  for (const url of candidates) {
    for (const auth of authVariants) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { ...auth },
        })

        if (res.ok) {
          const data = await res.json() as any
          console.log('[Nerve] fetchModels ok:', url, JSON.stringify(data).slice(0, 300))
          let models: string[] = []
          if (Array.isArray(data)) {
            models = data.map((m: any) => m.id || m.name || String(m)).filter(Boolean)
          } else if (data?.data && Array.isArray(data.data)) {
            models = data.data.map((m: any) => m.id || m.name || String(m)).filter(Boolean)
          } else if (data?.models && Array.isArray(data.models)) {
            models = data.models.map((m: any) => m.id || m.name || String(m)).filter(Boolean)
          } else if (data?.body && typeof data.body === 'string') {
            // Some providers wrap response in body string
            try {
              const inner = JSON.parse(data.body)
              if (inner.data && Array.isArray(inner.data)) {
                models = inner.data.map((m: any) => m.id || m.name || String(m)).filter(Boolean)
              }
            } catch { /* ignore */ }
          }
          if (models.length > 0) return { ok: true, models }
          lastError = `No models found in response: ${JSON.stringify(data).slice(0, 200)}`
        } else {
          const text = await res.text().catch(() => '')
          lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
  }

  return { ok: false, error: lastError }
}
