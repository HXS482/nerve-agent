/**
 * NerveHostAdapter — HostAdapter for Nerve Agent (Electron desktop).
 *
 * Bridges TencentDB's TdaiCore into Nerve's Electron environment.
 */

import { join } from 'path'
import { homedir } from 'os'
import OpenAI from 'openai'
import { NerveLLMRunnerFactory } from './nerve-llm-runner'
import type { ClaudeSettings } from './settings'
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
    const model = extractionConfig?.model || 'deepseek-chat'

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
