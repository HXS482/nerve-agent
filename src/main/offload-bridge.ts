/**
 * OffloadBridge — Simplified context compression for Nerve.
 *
 * Captures the core value of TencentDB's offload module:
 * when conversations get long, compress old tool results into summaries.
 *
 * Does NOT use the full OpenClaw plugin infrastructure (SessionRegistry,
 * BackendClient, L1.5 task judgment, L2 Mermaid, etc.). Those are
 * overkill for a desktop Electron app.
 */

import type OpenAI from 'openai'
import { estimateTokens } from './core/token-estimator'

const TAG = '[Offload]'

interface ToolPair {
  toolName: string
  toolCallId: string
  params: unknown
  result: unknown
  timestamp: number
}

interface OffloadBridgeOptions {
  /** OpenAI client for summarization */
  client: OpenAI
  /** Model to use for summarization */
  model: string
  /** Context window size (default: 128000) */
  contextWindow?: number
  /** Token ratio to trigger compression (default: 0.6) */
  compressRatio?: number
}

function estimateMessageTokens(messages: Array<{ role: string; content: unknown }>): number {
  let total = 0
  for (const msg of messages) {
    const text = extractText(msg.content)
    total += estimateTokens(text)
    total += 4 // role + separators
  }
  return total
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: any) => {
      if (typeof b === 'string') return b
      if (b.type === 'text') return b.text || ''
      if (b.type === 'tool_result') return typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '')
      if (b.type === 'tool_use') return `[${b.name}(${JSON.stringify(b.input || {}).slice(0, 100)})]`
      return ''
    }).join('')
  }
  return JSON.stringify(content || '')
}

export class OffloadBridge {
  private client: OpenAI
  private model: string
  private contextWindow: number
  private compressRatio: number
  private pendingPairs: ToolPair[] = []
  private compressedIds = new Set<string>()

  constructor(opts: OffloadBridgeOptions) {
    this.client = opts.client
    this.model = opts.model
    this.contextWindow = opts.contextWindow ?? 128_000
    this.compressRatio = opts.compressRatio ?? 0.6
  }

  /**
   * Called before each agentic loop step.
   * Checks if context is getting long and compresses old tool results.
   */
  async onBeforeStep(messages: Array<{ role: string; content: unknown }>): Promise<void> {
    const tokens = estimateMessageTokens(messages)
    const threshold = Math.floor(this.contextWindow * this.compressRatio)

    if (tokens < threshold) return

    console.log(`${TAG} Context too long (${tokens} tokens >= ${threshold}), compressing...`)

    // Find old tool_result messages that can be compressed
    const candidates: { index: number; text: string; id?: string }[] = []
    for (let i = 0; i < messages.length - 4; i++) { // keep last 4 messages untouched
      const msg = messages[i]
      if (msg.role !== 'user') continue
      const text = extractText(msg.content)
      if (text.length < 500) continue // don't compress small results

      // Skip already compressed
      const id = this.extractToolCallId(msg)
      if (id && this.compressedIds.has(id)) continue

      candidates.push({ index: i, text, id })
    }

    if (candidates.length === 0) return

    // Comsume oldest candidates first, target ~30% reduction
    const targetReduction = Math.floor(tokens * 0.3)
    let reduced = 0
    const toCompress: typeof candidates = []

    for (const c of candidates) {
      if (reduced >= targetReduction) break
      toCompress.push(c)
      reduced += estimateTokens(c.text)
    }

    if (toCompress.length === 0) return

    // Batch summarize
    const summaries = await this.summarizeBatch(toCompress.map(c => c.text))

    // Apply summaries
    for (let i = 0; i < toCompress.length; i++) {
      const c = toCompress[i]
      const summary = summaries[i] || c.text.slice(0, 200) + '...'
      const msg = messages[c.index]
      const toolName = this.extractToolName(msg)

      // Replace content with summary
      if (typeof msg.content === 'string') {
        msg.content = `[Offload summary of ${toolName}]: ${summary}`
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            block.content = `[Offload summary of ${toolName}]: ${summary}`
          }
        }
      }

      if (c.id) this.compressedIds.add(c.id)
    }

    const newTokens = estimateMessageTokens(messages)
    console.log(`${TAG} Compressed ${toCompress.length} messages: ${tokens} → ${newTokens} tokens (-${tokens - newTokens})`)
  }

  /**
   * Called after tool execution to buffer tool pairs for potential summarization.
   */
  onAfterToolCall(toolName: string, toolCallId: string, params: unknown, result: unknown): void {
    this.pendingPairs.push({
      toolName,
      toolCallId,
      params,
      result,
      timestamp: Date.now(),
    })

    // Keep buffer bounded
    if (this.pendingPairs.length > 50) {
      this.pendingPairs = this.pendingPairs.slice(-30)
    }
  }

  private extractToolCallId(msg: { role: string; content: unknown }): string | undefined {
    if (!Array.isArray(msg.content)) return undefined
    for (const block of msg.content) {
      if (block.type === 'tool_result' && block.tool_use_id) return block.tool_use_id
    }
    return undefined
  }

  private extractToolName(msg: { role: string; content: unknown }): string {
    if (!Array.isArray(msg.content)) return 'tool'
    for (const block of msg.content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        const pair = this.pendingPairs.find(p => p.toolCallId === block.tool_use_id)
        if (pair) return pair.toolName
      }
    }
    return 'tool'
  }

  private async summarizeBatch(texts: string[]): Promise<string[]> {
    if (texts.length === 0) return []

    try {
      // Combine texts for a single LLM call
      const combined = texts.map((t, i) => `[${i}]\n${t.slice(0, 2000)}`).join('\n\n---\n\n')

      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'Summarize each numbered block concisely in 1-2 sentences. Keep the key facts. Output format: one summary per block, numbered.',
          },
          { role: 'user', content: combined },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      })

      const output = res.choices[0]?.message?.content || ''
      // Parse numbered summaries
      const summaries = output.split(/\n/).filter(l => l.trim()).map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
      return summaries
    } catch (err) {
      console.error(`${TAG} summarizeBatch failed:`, err)
      return texts.map(t => t.slice(0, 200) + '...')
    }
  }
}
