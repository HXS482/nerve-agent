import { randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { ClaudeSettings } from './settings'

const CHARS_PER_TOKEN = 4
const COMPACTION_THRESHOLD = 0.75

const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-20250514': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
}

export interface CompactedRange {
  from: number
  to: number
}

// Cache token estimates for objects that haven't changed
const tokenCache = new WeakMap<object, number>()

function estimateTokens(obj: unknown): number {
  if (obj !== null && typeof obj === 'object') {
    const cached = tokenCache.get(obj)
    if (cached !== undefined) return cached
    const tokens = Math.ceil(JSON.stringify(obj).length / CHARS_PER_TOKEN)
    tokenCache.set(obj, tokens)
    return tokens
  }
  return Math.ceil(JSON.stringify(obj).length / CHARS_PER_TOKEN)
}

function getContextWindow(modelId: string): number {
  return CONTEXT_WINDOWS[modelId] || 200_000
}

function findCutPoint(entries: unknown[]): number {
  const MIN_KEPT = 4
  // Walk backwards from the end, find the last toolResult boundary.
  // We want to keep recent messages and compact older ones.
  // Cut after a toolResult so the kept portion has complete tool call/result pairs.
  for (let i = entries.length - 1; i >= MIN_KEPT; i--) {
    const e = entries[i] as Record<string, unknown>
    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      const content = e.message.content as Array<Record<string, unknown>>
      const lastPart = content[content.length - 1]
      if (lastPart?.type === 'tool_result') {
        return i + 1 // keep entries[0..i], compact entries[i+1..end]
      }
    }
  }
  // Fallback: keep last 4 entries
  return Math.max(0, entries.length - MIN_KEPT)
}

export function needsCompaction(
  entries: unknown[],
  modelId: string,
): boolean {
  if (entries.length < 6) return false
  const budget = Math.floor(getContextWindow(modelId) * COMPACTION_THRESHOLD)
  let totalTokens = 0
  for (const e of entries) {
    totalTokens += estimateTokens(e)
    if (totalTokens > budget) return true
  }
  return false
}

export async function compactMessages(
  entries: unknown[],
  modelId: string,
  settings: ClaudeSettings,
): Promise<{ compacted: unknown[]; range: CompactedRange } | null> {
  if (!needsCompaction(entries, modelId)) return null

  const cutAt = findCutPoint(entries)
  if (cutAt < 2) return null // not enough to compact

  const toCompact = entries.slice(0, cutAt)
  const kept = entries.slice(cutAt)

  // Truncate tool results in kept messages to free more space
  const trimmedKept = kept.map((e) => {
    const entry = { ...(e as Record<string, unknown>) }
    if (entry.type === 'assistant' && entry.message) {
      const msg = { ...entry.message } as Record<string, unknown>
      if (Array.isArray(msg.content)) {
        msg.content = msg.content.map((c: Record<string, unknown>) => {
          if (c.type === 'tool_result' && typeof c.content === 'string' && c.content.length > 2000) {
            return { ...c, content: c.content.slice(0, 2000) + '\n...[truncated]' }
          }
          return c
        })
      }
      entry.message = msg
    }
    return entry
  })

  // Extract facts for summarization
  const facts = toCompact
    .filter((e: any) => e.type === 'user' || (e.type === 'assistant' && e.message?.content))
    .map((e: any) => {
      if (e.type === 'user') {
        const c = e.message?.content
        const text = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x: any) => x.type === 'text') as any)?.text || '' : ''
        return `User: ${text.slice(0, 500)}`
      }
      const content = e.message?.content as Array<Record<string, unknown>>
      const texts = content
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text?.slice(0, 300))
        .join(' ')
      const tools = content
        ?.filter((c: any) => c.type === 'tool_use')
        .map((c: any) => `[Tool: ${c.name}]`)
        .join(' ')
      return `Assistant: ${texts || ''} ${tools || ''}`.trim()
    })
    .join('\n')

  // Use cheap model to summarize
  let sdkBaseURL = (settings.baseURL || 'https://api.anthropic.com').replace(/\/+$/, '')
  if (sdkBaseURL.endsWith('/v1')) sdkBaseURL = sdkBaseURL.slice(0, -3)
  const client = new Anthropic({
    apiKey: settings.authToken,
    baseURL: sdkBaseURL,
  })

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: `Summarize this conversation segment concisely. Preserve: key decisions, file paths modified, current task state, unresolved questions. Output 3-5 sentences max.\n\n${facts}` }],
    temperature: 0,
  })
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')

  const summaryId = randomUUID()
  const summaryEntry = {
    type: 'summary',
    summary: text,
    timestamp: new Date().toISOString(),
    id: summaryId,
    parentId: (toCompact[0] as any)?.parentId ?? null,
  }

  // Fix parent chain: first kept entry's parent becomes the summary
  if (trimmedKept.length > 0) {
    trimmedKept[0] = { ...trimmedKept[0], parentId: summaryId }
  }

  return {
    compacted: [summaryEntry, ...trimmedKept],
    range: { from: 0, to: cutAt - 1 },
  }
}
