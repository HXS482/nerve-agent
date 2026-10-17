/**
 * MemoryTdaiCore — Nerve's integration point for TencentDB-Agent-Memory.
 *
 * Replaces the old memory.ts (691 lines) with TencentDB's 4-layer architecture.
 * Single point of contact: handleBeforeRecall() + handleTurnCommitted() + destroy().
 */

import { TdaiCore } from '../vendor/tencentdb-memory/core/tdai-core'
import { parseConfig } from '../vendor/tencentdb-memory/config'
import { NerveHostAdapter } from './nerve-host-adapter'
import { resolveModelId, type ClaudeSettings } from './settings'
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
    const memSettings = settings.memoryTDAI

    // 记忆层做 L1/L2/L3 提取时用的模型，优先级：
    //   memoryTDAI.extraction.model（记忆层专用覆盖）
    //   → extraction.model（顶层提取覆盖，与 baseURL/authToken 同组）
    //   → settings.model（主模型）
    // 每一级都要过 resolveModelId：settings.model 存的是别名（如 "fable"），
    // 直接发出去就是 404。原先这一级还硬编码成 'deepseek-chat'，对任何非
    // DeepSeek 端点同样是必然 404 —— 而失败只打一行 error 日志，整条
    // L1→L2→L3 会长期静默 extracted=0。
    const extractionModel =
      resolveModelId(settings, memSettings?.extraction?.model) ||
      resolveModelId(settings, settings.extraction?.model) ||
      resolveModelId(settings, settings.model) ||
      resolveModelId(settings, settings.defaultModel) ||
      ''
    if (!extractionModel) {
      this.logger.warn(
        '未解析出记忆提取模型（settings.model 与 memoryTDAI.extraction.model 均为空），L1 提取会失败',
      )
    }

    this.adapter = new NerveHostAdapter({
      projectDir,
      sessionId: sessionId || '',
      settings,
      extractionModel,
    })

    const tdaiConfig = parseConfig({
      capture: { enabled: memSettings?.enabled !== false },
      extraction: {
        enabled: memSettings?.enabled !== false,
        model: extractionModel,
        maxMessagesPerExtraction: memSettings?.extraction?.maxMessagesPerExtraction,
        maxBackgroundMessages: memSettings?.extraction?.maxBackgroundMessages,
      },
      // 画像重生成阈值。不接出来的话 vendor 默认 50 —— 个人 agent 记忆增长慢，
      // 等于画像一生成就冻住，用户后来讲的都进不去。
      persona: {
        triggerEveryN: memSettings?.persona?.triggerEveryN,
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
        // 主模型的上下文窗口。vendor 侧的 getContextWindow() 依次查
        // config.models.providers[...].contextWindow → config.models.contextWindow
        // → 这里的 defaultContextWindow，都读不到就会拿 200000 去算压缩阈值
        // （mild 0.5 / aggressive 0.85）—— 对 512000 的模型等于提前一半就压缩。
        defaultContextWindow: settings.contextWindow,
      },
      llm: {
        enabled: true,
        baseUrl: settings.extraction?.baseURL || settings.baseURL?.replace(/\/v1$/, '') || '',
        apiKey: settings.extraction?.authToken || settings.authToken || '',
        model: extractionModel,
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
