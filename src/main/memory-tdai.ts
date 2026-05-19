/**
 * MemoryTdaiCore — Nerve's integration point for TencentDB-Agent-Memory.
 *
 * Replaces the old memory.ts (691 lines) with TencentDB's 4-layer architecture.
 * Single point of contact: handleBeforeRecall() + handleTurnCommitted() + destroy().
 */

import { TdaiCore } from '../vendor/tencentdb-memory/core/tdai-core'
import { parseConfig } from '../vendor/tencentdb-memory/config'
import { NerveHostAdapter } from './nerve-host-adapter'
import type { ClaudeSettings } from './settings'
import type { RecallResult, CaptureResult, CompletedTurn } from '../vendor/tencentdb-memory/core/types'

const TAG = '[MemoryTdai]'

export class MemoryTdaiCore {
  private core: TdaiCore
  private adapter: NerveHostAdapter
  private logger = {
    debug: (msg: string) => console.debug(`${TAG} ${msg}`),
    info: (msg: string) => console.log(`${TAG} ${msg}`),
    warn: (msg: string) => console.warn(`${TAG} ${msg}`),
    error: (msg: string) => console.error(`${TAG} ${msg}`),
  }

  constructor(projectDir: string, settings: ClaudeSettings, sessionId?: string) {
    this.adapter = new NerveHostAdapter({
      projectDir,
      sessionId: sessionId || '',
      settings,
    })

    const memSettings = settings.memoryTDAI
    const tdaiConfig = parseConfig({
      capture: { enabled: memSettings?.enabled !== false },
      extraction: {
        enabled: memSettings?.enabled !== false,
        model: memSettings?.extraction?.model,
      },
      recall: {
        enabled: true,
        strategy: memSettings?.recall?.strategy ?? 'keyword',
        maxResults: memSettings?.recall?.maxResults ?? 5,
      },
      embedding: {
        enabled: (memSettings?.embedding?.provider && memSettings.embedding.provider !== 'none') || false,
        provider: memSettings?.embedding?.provider ?? 'none',
        baseUrl: memSettings?.embedding?.baseUrl ?? '',
        apiKey: memSettings?.embedding?.apiKey ?? '',
        model: memSettings?.embedding?.model ?? '',
        dimensions: memSettings?.embedding?.dimensions ?? 0,
      },
      offload: {
        enabled: memSettings?.offload?.enabled ?? false,
        model: memSettings?.offload?.model,
      },
      llm: {
        enabled: true,
        baseUrl: settings.extraction?.baseURL || settings.baseURL?.replace(/\/v1$/, '') || '',
        apiKey: settings.extraction?.authToken || settings.authToken || '',
        model: settings.extraction?.model || 'deepseek-chat',
      },
      storeBackend: 'sqlite',
    })

    this.core = new TdaiCore({
      hostAdapter: this.adapter,
      config: tdaiConfig,
    })
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing TDAI Core...')
    await this.core.initialize()
    this.logger.info('TDAI Core initialized')
  }

  updateSessionId(sessionId: string): void {
    this.adapter.updateSessionId(sessionId)
  }

  async handleBeforeRecall(userText: string, sessionKey: string): Promise<RecallResult> {
    return this.core.handleBeforeRecall(userText, sessionKey)
  }

  async handleTurnCommitted(turn: CompletedTurn): Promise<CaptureResult> {
    return this.core.handleTurnCommitted(turn)
  }

  async searchMemories(query: string, limit?: number) {
    return this.core.searchMemories({ query, limit })
  }

  async searchConversations(query: string, limit?: number) {
    return this.core.searchConversations({ query, limit })
  }

  async destroy(): Promise<void> {
    this.logger.info('Destroying TDAI Core...')
    await this.core.destroy()
    this.logger.info('TDAI Core destroyed')
  }
}
