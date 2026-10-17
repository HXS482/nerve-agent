/**
 * NerveHostAdapter — HostAdapter for Nerve Agent (Electron desktop).
 *
 * Bridges TencentDB's TdaiCore into Nerve's Electron environment.
 */

import { join } from 'path'
import { homedir } from 'os'
import OpenAI from 'openai'
import { NerveLLMRunnerFactory } from './nerve-llm-runner'
import { resolveModelId, type ClaudeSettings } from './settings'
import type {
  HostAdapter,
  RuntimeContext,
  Logger,
  LLMRunnerFactory,
} from '../vendor/tencentdb-memory/core/types'

export interface NerveHostAdapterOptions {
  projectDir: string
  sessionId: string
  settings: ClaudeSettings
  /** 记忆提取用的模型 id，由 MemoryTdaiCore 统一解析后传入（见 memory-tdai.ts） */
  extractionModel?: string
}

export class NerveHostAdapter implements HostAdapter {
  readonly hostType = 'standalone' as const

  private dataDir: string
  private projectDir: string
  private sessionId: string
  private logger: Logger
  private runnerFactory: NerveLLMRunnerFactory

  constructor(opts: NerveHostAdapterOptions) {
    this.dataDir = join(homedir(), '.nerve', 'memory-tdai')
    this.projectDir = opts.projectDir
    this.sessionId = opts.sessionId

    this.logger = {
      debug: (msg) => console.debug(`[TDAI] ${msg}`),
      info: (msg) => console.log(`[TDAI] ${msg}`),
      warn: (msg) => console.warn(`[TDAI] ${msg}`),
      error: (msg) => console.error(`[TDAI] ${msg}`),
    }

    // Create OpenAI client for memory operations using extraction config
    const extractionConfig = opts.settings.extraction
    const client = new OpenAI({
      baseURL: extractionConfig?.baseURL || opts.settings.baseURL?.replace(/\/v1$/, '') || 'https://api.openai.com/v1',
      apiKey: extractionConfig?.authToken || opts.settings.authToken || '',
    })
    // 不再在这里兜底一个硬编码模型名 —— 那正是 L1 提取 404 的来源。
    // 调用方不传时，按 settings 里的覆盖项/主模型回落，且一律过 resolveModelId
    // （settings.model 是别名如 "fable"，不是可发给网关的 id）。
    const model =
      opts.extractionModel ||
      resolveModelId(opts.settings, extractionConfig?.model) ||
      resolveModelId(opts.settings, opts.settings.model) ||
      resolveModelId(opts.settings, opts.settings.defaultModel) ||
      ''

    this.runnerFactory = new NerveLLMRunnerFactory({
      client,
      model,
      logger: this.logger,
    })
  }

  getRuntimeContext(): RuntimeContext {
    return {
      userId: 'nerve_user',
      sessionId: this.sessionId,
      sessionKey: this.sessionId,
      platform: 'nerve-electron',
      workspaceDir: this.projectDir,
      dataDir: this.dataDir,
    }
  }

  updateSessionId(sessionId: string): void {
    this.sessionId = sessionId
  }

  getLogger(): Logger {
    return this.logger
  }

  getLLMRunnerFactory(): LLMRunnerFactory {
    return this.runnerFactory
  }
}
