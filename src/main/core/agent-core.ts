/**
 * AgentCore — 无 UI 依赖的 Agent 核心
 *
 * 从 ClaudeService 抽取，去掉所有 BrowserWindow 依赖
 * 通过 OutputChannel 接口输出，支持 Electron IPC / WebSocket / IM 适配器
 */

import { join } from 'path'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { randomUUID, createHash } from 'crypto'
import { FileSessionStore } from '../session-store'
import { loadSettings, NERVE_DIR, ClaudeSettings, togglePluginSetting, getDisabledPlugins, saveRuntimeConfig } from '../settings'
import { getBuiltinTools, formatJobResult } from '../tools'
import { JobRegistry } from './job-registry'
import { SkillRegistry } from '../skill-registry'
import { PluginBus } from '../plugin-bus'
import { ProviderRegistry } from '../provider-registry'
import { McpPool, McpToolEntry, resolveMcpToolNames } from '../mcp-pool'
import { getOrchestratorTools } from '../orchestrator'
import { buildRoutineTools } from '../routine-tools'
import {
  buildBotHandoffTools,
  readHandoffCaps,
  scratchSessionId,
  type HandoffCtx,
} from './bot-handoff'
import { createHandoffRunner, type HandoffWork } from './handoff-runner'
import { HopQueue } from '../store/hop-queue'
import type { BotInfo } from './bot-registry'
import { RoutineStore } from '../store/routine-store'
import { runAgenticLoop } from '../agentic-loop'
import { MemoryTdaiCore } from '../memory-tdai'
import { createMemoryTools } from '../memory-tools'
import { OffloadBridge } from '../offload-bridge'
import { HookRegistry } from '../hook-registry'
import type { OutputChannel } from './output-channel'
import { isElectronChannel } from './output-channel'
import type { ClaudeConfig, SendMessagePayload, FileAttachment, ContentBlock, BotActivity } from '../../shared/types'
import { SessionContext, SessionContextManager, createSessionContext } from './session-context'
import { mergeConfig, mergeConfigForSession } from './session-config'
import { resolveCwd } from './session-cwd'
import { composeSystemPrompt } from './system-prompt'
import { COST_PER_TOKEN, FALLBACK_CONTEXT_WINDOW, lookupContextWindow } from './model-constants'

// 前向声明，避免循环依赖
export type { OutputChannel }

// 长任务心跳间隔：渲染层按"连续多个间隔没心跳"判定卡死，而不是拿固定时长猜
const HEARTBEAT_MS = 5000

// 工具审批等待上限：超过就按拒绝处理，别让整轮永久挂起（人不在 / 窗口卡住）
const APPROVAL_TIMEOUT_MS = 300_000

function buildUserContentBlocks(files: FileAttachment[], prompt: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const file of files) {
    if (file.isImage) {
      blocks.push({
        type: 'image',
        src: `data:${file.mimeType};base64,${file.data}`,
        mimeType: file.mimeType,
        fileName: file.name,
        fileSize: file.size,
      })
    } else {
      blocks.push({
        type: 'file',
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.mimeType,
        fileContent: file.data,
      })
    }
  }
  blocks.push({ type: 'text', text: prompt })
  return blocks
}

export interface AgentCoreConfig {
  projectDir: string
  sourceDir: string
  settings?: ClaudeSettings
}

export class AgentCore {
  private config: ClaudeConfig = {
    model: 'sonnet',
    effort: 'medium',
    cwd: process.cwd(),
    permissionMode: 'bypassPermissions',
  }

  private sessionStore: FileSessionStore | null = null

  private botRegistry: import('./bot-registry').BotRegistry | null = null

  private async getBotRegistry() {
    if (!this.botRegistry) {
      const { BotRegistry } = await import('./bot-registry')
      const { NERVE_DIR } = await import('../settings')
      this.botRegistry = await BotRegistry.create(join(NERVE_DIR, 'bots'))
    }
    return this.botRegistry
  }

  /** 解析会话所属 Bot：session 元数据 botId 优先，失效回落默认 Bot（设计文档 §1）。 */
  private async resolveBot(sessionId: string, explicitBotId?: string): Promise<import('./bot-registry').BotInfo> {
    const reg = await this.getBotRegistry()
    // 显式指定的 Bot（渲染层按侧栏选中的 Bot 发消息）优先于会话历史绑定
    const botId = explicitBotId || (await this.getSessionBotId(sessionId))
    if (botId) {
      const bot = await reg.get(botId)
      if (bot) return bot
    }
    return reg.getDefault()
  }

  /** 读 session 元数据里的 botId；没有就返回 null（由 resolveBot 回落默认 Bot）。 */
  private async getSessionBotId(sessionId: string): Promise<string | null> {
    if (!this.sessionStore || !sessionId) return null
    const meta = await this.sessionStore.getMeta(sessionId) as { botId?: string }
    return meta.botId ?? null
  }

  /** 会话绑定 Bot（IPC 层调用；默认 Bot 顺带补 homeSessionId）。 */
  async setSessionBot(sessionId: string, botId: string): Promise<void> {
    if (!this.sessionStore) throw new Error('session store 未初始化')
    // 典型误用是传了拼错/尚未创建的会话 id：那会在磁盘上留一个孤立的 meta 文件，
    // 而且界面上看不出来。宁可在这里明确拒绝。
    if (!(await this.sessionStore.exists(sessionId))) throw new Error('会话不存在: ' + sessionId)
    const reg = await this.getBotRegistry()
    const bot = await reg.get(botId)
    if (!bot) throw new Error(`Bot not found: ${botId}`)
    await this.sessionStore.setMeta(sessionId, { botId })
    if (bot.isDefault && !bot.homeSessionId) {
      await reg.update(bot.id, { homeSessionId: sessionId })
    }
  }

  /**
   * Scheduler 的投递通道。
   *
   * 刻意**不**走 Gateway 的 Ticket 队列：那条路会给 routine 新开一个 session id，
   * Bot 身份和"回复落在原会话"的语义全部丢失（routine 会以默认 Bot 在侧栏新会话里跑），
   * 而且 dispatch 只表示"已入队"，疲劳规则永远收不到失败信号。
   * routine 最低 15 分钟一次，并发压力可以忽略，直连是正确的取舍。
   */
  async dispatchRoutine(d: { text: string; sessionId: string; botId?: string }): Promise<boolean> {
    const { NullOutputChannel } = await import('./output-channel')

    // 会话可能已被删除：回落到 Bot 的 home 会话；仍没有就留在原 id（sendMessage 会重建它）。
    let sessionId = d.sessionId
    let botId = d.botId ?? ''
    try {
      if (this.sessionStore && !(await this.sessionStore.exists(sessionId))) {
        const reg = await this.getBotRegistry()
        const bot = (botId ? await reg.get(botId) : null) ?? (await reg.getDefault())
        if (bot.homeSessionId) sessionId = bot.homeSessionId
        botId = bot.id
      }
      // 把归属写回 meta：routine 以创建它的 Bot 的身份跑，而不是回落默认 Bot。
      if (this.sessionStore && botId) {
        await this.sessionStore.setMeta(sessionId, { botId })
      }
    } catch (err) {
      console.warn('[AgentCore] routine 会话解析失败，按原样投递:', err)
    }

    // sendMessage 内部把错误交给 channel 而不是抛出，所以用会记下 sendError 的通道
    // 判断本轮成败；否则失败永远被记成成功、疲劳规则形同虚设。
    class ErrorCapturingChannel extends NullOutputChannel {
      errored = false
      sendError(message: string, _runId?: string): void {
        this.errored = true
        console.warn('[AgentCore] routine run reported error:', message)
      }
    }
    const channel = new ErrorCapturingChannel()
    try {
      const ctx = this.getSessionContextManager().getOrCreate(sessionId)
      await this.sendMessage({ prompt: d.text, sessionId, cwd: this.config.cwd }, channel, ctx)
      return !channel.errored
    } catch (err) {
      console.error('[AgentCore] dispatchRoutine failed:', err)
      return false
    }
  }

  /**
   * 后台作业注册表。刻意是**进程级**的，不是会话级 ——
   * 一条 npm install 跑在哪个会话里不重要，重要的是进程退出时能把它们全杀掉。
   */
  private jobs = new JobRegistry()
  private projectDir: string
  private sourceDir: string
  private settings: ClaudeSettings
  private registry: ProviderRegistry
  private mcpPool: McpPool
  /** AskUser 挂起中的提问：askId → resolve */
  private pendingAsks = new Map<string, { resolve: (answers: import('../../shared/types').AskUserAnswers) => void }>()
  private flowContentHashes = new Set<string>()
  private memoryCore: MemoryTdaiCore | null = null
  private offloadBridge: OffloadBridge | null = null
  private skillRegistry: SkillRegistry = new SkillRegistry()
  private pluginBus: PluginBus
  private hookRegistry: HookRegistry = new HookRegistry()

  // 会话上下文管理器（用于多 session 并发）
  private sessionContextManager = new SessionContextManager()

  /** Bot 交接队列。惰性打开：不用交接的人不该多一个 sqlite 句柄。 */
  private hopQueue: HopQueue | null = null
  private hopQueueBroken = false
  /** 交接 sweep 的定时器。只在真正用到交接时才起。 */
  private hopTimer: ReturnType<typeof setInterval> | null = null
  /** 正在 sweep 中：避免上一轮还没跑完就叠上下一轮（B 可能跑几分钟）。 */
  private hopping = false

  constructor(config: AgentCoreConfig) {
    this.settings = config.settings || loadSettings()
    this.sourceDir = config.sourceDir
    this.projectDir = this.settings.cwd || config.projectDir

    // Initialize config from settings
    if (this.settings.model) this.config.model = this.settings.model
    if (this.settings.defaultProvider) this.config.provider = this.settings.defaultProvider
    if (this.settings.effort) this.config.effort = this.settings.effort as ClaudeConfig['effort']
    if (this.settings.permissionMode) this.config.permissionMode = this.settings.permissionMode as ClaudeConfig['permissionMode']

    if (!this.settings.cwd) {
      const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
      try {
        const existing = existsSync(nerveSettingsPath) ? JSON.parse(readFileSync(nerveSettingsPath, 'utf-8')) : {}
        existing.cwd = this.projectDir
        writeFileSync(nerveSettingsPath, JSON.stringify(existing, null, 2), 'utf-8')
      } catch { /* ignore */ }
    }

    this.registry = new ProviderRegistry(this.settings)
    this.mcpPool = new McpPool()
    this.pluginBus = new PluginBus(this.sourceDir, this.projectDir)
  }

  private async ensureSessionStore(): Promise<FileSessionStore> {
    if (!this.sessionStore) {
      this.sessionStore = await FileSessionStore.create(join(this.sourceDir, '.nerve', 'sessions'))
    }
    return this.sessionStore
  }

  setMemoryCore(core: MemoryTdaiCore) {
    this.memoryCore = core
  }

  setOffloadBridge(bridge: OffloadBridge) {
    this.offloadBridge = bridge
  }

  async initPlugins(): Promise<void> {
    const disabledPlugins = getDisabledPlugins()
    const result = await this.pluginBus.loadAll(disabledPlugins)
    if (result.errors.length > 0) {
      console.warn('[PluginBus] Load errors:', result.errors)
    }
    console.log(`[PluginBus] Loaded ${result.loaded.length} plugins:`, result.loaded)
    this.pluginBus.startWatching()
  }

  private resolveModel(modelAlias: string, providerId?: string): string {
    if (this.settings.modelAliases[modelAlias]) {
      return this.settings.modelAliases[modelAlias]
    }
    const aliasMap: Record<string, string> = {
      'sonnet': 'claude-sonnet-4-20250514',
      'opus': 'claude-opus-4-20250514',
      'haiku': 'claude-haiku-4-5-20251001',
    }
    const resolved = aliasMap[modelAlias] || modelAlias
    if (resolved.startsWith('claude-') && this.settings.defaultModel && (!providerId || providerId === 'anthropic')) {
      return this.settings.defaultModel
    }
    return resolved
  }

  /**
   * 解析当前模型的上下文窗口（token）。优先级：
   *   1. settings.contextWindow —— 全局覆盖，公司代理/自建网关的私有模型走这条
   *   2. settings.providers[provider].modelContextWindows[model] —— 按 provider 细分
   *   3. CONTEXT_WINDOWS 查表（支持前缀匹配，如 'GLM-5.3-Flash' 命中 'glm-5.3'）
   *   4. FALLBACK_CONTEXT_WINDOW
   *
   * 历史实现直接 CONTEXT_WINDOWS[model] || 200000，模型不在表里就静默兜底，
   * 用量环把 512000 的模型当 200000 显示（占用看起来偏高、且提前染红）。
   */
  private resolveContextWindow(modelId: string, providerId?: string): number {
    const s = this.settings as unknown as {
      contextWindow?: number
      providers?: Record<string, { modelContextWindows?: Record<string, number> }>
    }
    if (typeof s.contextWindow === 'number' && s.contextWindow > 0) return s.contextWindow

    const byProvider = providerId ? s.providers?.[providerId]?.modelContextWindows : undefined
    if (byProvider) {
      const exact = byProvider[modelId]
      if (typeof exact === 'number' && exact > 0) return exact
    }

    return lookupContextWindow(modelId) ?? FALLBACK_CONTEXT_WINDOW
  }

  private async loadConversationHistory(sessionId: string): Promise<Array<{ role: string; content: unknown }>> {
    const store = await this.ensureSessionStore()
    const entries = await store.load({ sessionId })
    if (!entries) return []

    const messages: Array<{ role: string; content: unknown }> = []

    for (const e of entries) {
      if (e.type === 'summary') {
        messages.push({ role: 'user', content: `[Context Summary] ${e.summary}` })
        continue
      }
      if (e.type === 'user') {
        const content = e.message?.content
        if (typeof content === 'string') {
          messages.push({ role: 'user', content })
        } else if (Array.isArray(content)) {
          const apiBlocks: any[] = []
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              apiBlocks.push({ type: 'text', text: block.text })
            } else if (block.type === 'image' && block.src) {
              const match = block.src.match(/^data:([^;]+);base64,(.+)$/)
              if (match) {
                apiBlocks.push({
                  type: 'image',
                  source: { type: 'base64', media_type: match[1], data: match[2] },
                })
              }
            } else if (block.type === 'file' && block.fileContent) {
              apiBlocks.push({
                type: 'text',
                text: `[File: ${block.fileName}]\n\`\`\`\n${block.fileContent}\n\`\`\``,
              })
            }
          }
          if (apiBlocks.length === 1 && apiBlocks[0].type === 'text') {
            messages.push({ role: 'user', content: apiBlocks[0].text })
          } else if (apiBlocks.length > 0) {
            messages.push({ role: 'user', content: apiBlocks })
          }
        }
      } else if (e.type === 'assistant') {
        // entries 是 unknown[]（存储层不认识消息形状），这里一次性收窄成本地视图，
        // 免得每读一个字段都要 as 一遍（也免得 e.message 直接取字段时报 unknown）。
        const msg = e.message as
          | { content?: unknown; answeredBy?: unknown; answeredByName?: unknown; speakerIsAsker?: unknown }
          | undefined
        const content = msg?.content
        const answeredBy = msg?.answeredBy
        const speakerIsAsker = msg?.speakerIsAsker
        /*
         * 另一个 Bot 的交接答复，回放时必须当成「别人说的话」，不能当成自己说的。
         *
         * 存储层把它记成 assistant（只有 assistant 能落进别人的会话），但如果原样回放，
         * 模型会读到自己「说过」一段它从没说过的话 —— 之后被问到「你上次说什么」，
         * 它会照着这段认领。所以这里改写成一条**带署名**的 user 消息：
         * 谁说的、原话是什么，都写清楚，并且明确标成外部内容。
         *
         * 发起方自己的通知（speakerIsAsker）不走这条路：那本来就是它该说的话。
         */
        if (Array.isArray(content) && typeof answeredBy === 'string' && answeredBy && speakerIsAsker !== true) {
          const said = content
            .filter((c: any) => c.type === 'text' && c.text)
            .map((c: any) => c.text as string)
            .join('\n')
            .trim()
          const name =
            typeof msg?.answeredByName === 'string' && msg.answeredByName
              ? msg.answeredByName
              : answeredBy
          if (said) {
            messages.push({
              role: 'user',
              content:
                `[交接答复] ${name}（另一个 Bot）回答了你先前派给它的那件事。` +
                `这不是你说的话，也不是用户说的话，是它自己的原话：

` +
                said,
            })
          }
          continue
        }
        if (Array.isArray(content)) {
          // 先提取 tool_result（需要放到单独的 user 消息中）
          const toolResults = content
            .filter((c: any) => c.type === 'tool_result')
            .map((c: any) => ({
              type: 'tool_result' as const,
              tool_use_id: c.tool_use_id || c.toolCallId,
              content: c.content,
              is_error: c.is_error,
            }))

          const thinkingParts = content
            .filter((c: any) => c.type === 'thinking')
            .map((c: any) => ({ type: 'thinking' as const, thinking: c.thinking }))
          const toolUses = content
            .filter((c: any) => c.type === 'tool_use')
            .map((c: any) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input }))
          const texts = content
            .filter((c: any) => c.type === 'text' && c.text)
            .map((c: any) => ({ type: 'text' as const, text: c.text }))
          // 图片块回放为文本标记：让模型知道已生成过什么，避免核对无据而重复生成
          const imageMarkers = content
            .filter((c: any) => c.type === 'image' && c.src)
            .map((c: any) => ({ type: 'text' as const, text: `[已生成图片: ${String(c.src).split(/[/\\]/).pop()}]` }))

          if (toolUses.length > 0) {
            // 回放必须还原真实的因果顺序：工具调用在前，收尾总结文本在工具结果之后。
            // 存储层是把多 step 拍平成一条 entry（text 在 tool_use 前），若原样回放，
            // 模型会学到"先宣布完成、再调工具"的错误模式，并在工具结果回来后翻找历史里的旧需求继续执行。
            messages.push({ role: 'assistant', content: [...thinkingParts, ...toolUses] })
            // tool_result 必须放在紧跟 assistant 的 user 消息中
            if (toolResults.length > 0) {
              messages.push({ role: 'user', content: toolResults })
            }
            const tail = [...texts, ...imageMarkers]
            if (tail.length > 0) {
              messages.push({ role: 'assistant', content: tail })
            }
          } else {
            const parts = [...thinkingParts, ...texts, ...imageMarkers]
            if (parts.length > 0) {
              messages.push({ role: 'assistant', content: parts })
            }
          }
        }
      }
    }

    return messages
  }

  /**
   * 发送消息并处理 Agent 循环
   * @param payload 消息内容
   * @param channel 输出通道（解耦具体输出目标）
   * @param sessionContext 可选的会话上下文（用于多 session 并发）
   */
  async sendMessage(payload: SendMessagePayload, channel: OutputChannel, sessionContext?: SessionContext): Promise<void> {
    // 获取或创建会话上下文
    const sessionId = payload.sessionId || randomUUID()
    const ctx = sessionContext || this.sessionContextManager.getOrCreate(sessionId)

    // 本轮的工具工作目录：会话自带的目录优先，老会话（无 cwd / 空串）回落到全局
    const cwd = resolveCwd(this.projectDir, payload.cwd)

    // 取消该会话的前一个请求（不影响其他会话）
    this.cancelSession(ctx.sessionId)
    ctx.abort = new AbortController()

    // 使用会话级的 pendingToolCalls 和 pendingApprovals
    const pendingToolCalls = ctx.pendingToolCalls
    const pendingApprovals = ctx.pendingApprovals

    // 通知通道开始
    if (isElectronChannel(channel)) channel.sendPetState('jumping')

    try {
      // 准备消息和系统提示
      const { messages, systemPrompt, mcpTools, bot } = await this.prepareMessages(payload, sessionId)

      // Promote pending tool snapshot (if hot-reload happened between messages)
      this.pluginBus.promotePending()

      // 解析 provider 和 model
      // 本轮有效配置 = 全局配置 + 会话级覆盖（ctx.config）。整轮只算一次，
      // 后面的 model / provider / effort 都读它，避免半截会话配置。
      const cfg = mergeConfig(this.config, ctx)
      const providerId = this.resolveProvider(cfg)
      const modelId = this.resolveModel(cfg.model, providerId)
      console.log('[AgentCore] send model:', cfg.model, '→', modelId, 'provider:', providerId)

      // 获取 client
      const { client, modelId: resolvedModelId, providerType } = await this.registry.getClientAndModel(providerId, modelId)

      // 构建工具
      const routeImagesRef: { fn: ((toolName: string | undefined, resultContent: string) => void) | null } = { fn: null }
      const { allToolDefs, allToolExecutors, orchestratorTools, pluginSnapshot } = await this.buildTools(
        client, resolvedModelId, providerType, mcpTools, channel, pendingToolCalls,
        (toolName, content) => { routeImagesRef.fn?.(toolName, content) },
        sessionId,
        cfg,
        cwd,
        bot.id,
        payload.handoff
      )

      // 图片工具结果路由
      const sentImages = new Set<string>()
      const routeImages = (toolName: string | undefined, resultContent: string) => {
        try {
          const result = JSON.parse(resultContent)
          const images: string[] = []

          if (toolName === 'GenerateImage' && result.path && !result.error) {
            images.push(result.path)
          } else if (toolName === 'Bash' && Array.isArray(result.savedImages)) {
            images.push(...result.savedImages)
          } else if (toolName === 'moveImageToGallery' && result.galleryPath && !result.error) {
            images.push(result.galleryPath)
          } else if (toolName === 'Write' && result.savedTo === 'gallery' && result.file_path) {
            images.push(result.file_path)
          }

          for (const p of images) {
            if (sentImages.has(p)) continue
            sentImages.add(p)
            channel.sendImage(p)
          }
        } catch {
          // resultContent 不是 JSON，忽略
        }
      }
      routeImagesRef.fn = routeImages

      // 心跳：run 期间定期告诉渲染层"主进程还活着"，跑得久 ≠ 卡死
      const heartbeat = isElectronChannel(channel)
        ? setInterval(() => { try { channel.sendHeartbeat() } catch { /* 窗口关了就算了 */ } }, HEARTBEAT_MS)
        : null

      try {
        // 运行 Agent 循环
        const result = await this.runAgentLoop(
          client, resolvedModelId, providerType, messages, systemPrompt,
          allToolDefs, allToolExecutors, ctx, channel, pendingToolCalls, pendingApprovals, routeImages, cfg
        )

        // 处理结果
        await this.handleResult(result, sessionId, payload, channel, ctx, sentImages, cfg)
      } finally {
        if (heartbeat) clearInterval(heartbeat)
        pluginSnapshot.unref()
      }
    } catch (err: unknown) {
      if (ctx.abort.signal.aborted) {
        // 被中断（用户取消 / 超时 / 同会话重发顶掉）≠ 跑完，收尾原因要如实上报
        channel.sendDone(sessionId, 0, 0, 'cancelled', payload.runId)
        if (isElectronChannel(channel)) channel.sendPetState('idle')
        return
      }
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[AgentCore] sendMessage error:', errorMsg)
      channel.sendError(errorMsg, payload.runId)
      if (isElectronChannel(channel)) channel.sendPetState('error')
    } finally {
      // 清理会话上下文（如果不再需要）
      // 注意：不删除上下文，因为可能还有后续消息
    }
  }
  /**
   * 这个 Bot 能看见的技能。
   *
   * 语义是**索引过滤**，不是权限：不在白名单的技能不会出现在系统提示里，
   * 也不能被 load_skill 加载。为什么不是权限 —— 技能本身不提供能力，它只是
   * 「怎么用现有工具」的说明书（image-generator 要 Bash，svg 要 Write）。
   * 承诺「加载了就能用」会误导：缺工具照样跑不起来。
   *
   * 空数组 = 不过滤（全部可见）。这个默认值很重要：现有 Bot 的 boundSkills 都是 []，
   * 解释成「一个都没有」会让升级后所有 Bot 立刻失去全部技能。
   */
  private visibleSkills(bot: { boundSkills?: string[] } | null | undefined) {
    const enabled = this.skillRegistry.getEnabled()
    const allow = bot?.boundSkills ?? []
    if (allow.length === 0) return enabled
    return enabled.filter((s) => allow.includes(s.id))
  }


  /**
   * 准备消息和系统提示
   */
  private async prepareMessages(payload: SendMessagePayload, sessionId: string) {
    // 获取 MCP 工具
    let mcpTools: McpToolEntry[] = []
    try {
      mcpTools = await this.mcpPool.ensureConnected()
    } catch (mcpErr) {
      console.warn('[AgentCore] MCP connection failed, continuing without MCP tools:', mcpErr)
    }

    // 加载历史消息
    const history = payload.sessionId
      ? await this.loadConversationHistory(payload.sessionId)
      : []

    // 保存用户消息
    const store = await this.ensureSessionStore()
    const userContent = (payload.files && payload.files.length > 0)
      ? buildUserContentBlocks(payload.files, payload.prompt)
      : payload.prompt
    await store.append({ sessionId }, [
      { type: 'user', message: { content: userContent }, timestamp: new Date().toISOString() },
    ])

    const messages = [...history]

    // 系统提示按四层组装（见 system-prompt.ts）：
    //   Soul（手写内核）→ Bot（当前 Bot 的角色指令）→ Persona（记忆层演化）→ 记忆上下文（场景导航/工具说明）
    let memoryContext = ''
    let recalledPersona = ''

    // Memory recall via TencentDB (3s timeout to allow sqlite-vec init + FTS5 + file I/O)
    if (this.memoryCore) {
      // 兜底定时器必须在 recall 正常返回后清掉。Promise.race 不会取消败者，
      // 原先没有 clearTimeout，于是每轮都会在 3 秒后打印一条「timed out」，
      // 而实际 recall 往往只要几毫秒 —— 排障时这条假日志会把人带偏。
      let recallTimer: ReturnType<typeof setTimeout> | undefined
      try {
        const start = Date.now()
        const recall = await Promise.race([
          this.memoryCore.handleBeforeRecall(payload.prompt, sessionId),
          new Promise<{ prependContext?: string; appendSystemContext?: string; recalledL3Persona?: string | null }>((r) => {
            recallTimer = setTimeout(() => {
              console.warn(`[Nerve] memory recall timed out after 3000ms — no memories injected this turn`)
              r({})
            }, 3000)
          }),
        ])
        const elapsed = Date.now() - start
        if (elapsed > 1000) console.log(`[Nerve] memory recall took ${elapsed}ms`)
        if (recall.appendSystemContext) memoryContext = recall.appendSystemContext
        if (recall.recalledL3Persona) recalledPersona = recall.recalledL3Persona
        if (recall.prependContext) messages.push({ role: 'user', content: recall.prependContext })
      } catch (err) {
        console.warn('[Nerve] memory recall failed:', err)
      } finally {
        if (recallTimer) clearTimeout(recallTimer)
      }
    }

    const bot = await this.resolveBot(payload.sessionId ?? '', payload.botId)
    // 把归属写进会话 meta：下次不带 botId 打开时也能解析到同一个 Bot，侧栏分组也靠它
    if (payload.botId && this.sessionStore && sessionId) {
      try { await this.sessionStore.setMeta(sessionId, { botId: payload.botId }) } catch { /* 元数据失败不阻断本轮 */ }
    }
    /*
     * 同事名单：只有真的能派活（有授权的其他人）才写进提示。
     *
     * 判定和 handoffToolCtx 同一份逻辑，但这里独立算一次 —— prepareMessages 在工具构建
     * 之前跑，顺序上拿不到 ctx。重复读一次 registry 是几十微秒，比把两个阶段耦合成
     * 「提示依赖工具构建结果」划算得多。
     *
     * 一个都没有时整段不出现：没有可派的同事，却在提示里教模型怎么交接，
     * 只会让它去找不存在的工具。
     */
    let coworkers: { name: string; role?: string }[] = []
    try {
      const reg = await this.getBotRegistry()
      const self = await reg.get(bot.id)
      const grant = self?.canAskBots
      const caps = readHandoffCaps()
      if (caps.maxDepth > 0 && caps.maxPerRun > 0) {
        coworkers = (await reg.list())
          .filter((b) => {
            if (b.id === bot.id) return false
            if (grant === null || grant === undefined) return true
            return grant.includes(b.id)
          })
          .map((b) => ({
            name: b.name,
            // 角色只取第一句：整段 instructions 塞进系统提示会挤掉真正重要的东西，
            // 而这句话的作用只是让模型知道「该找谁」，不是替它写人设。
            ...(b.instructions ? { role: (b.instructions.split(/[\n。]/)[0] || '').slice(0, 80) } : {}),
          }))
      }
    } catch (err) {
      console.warn('[AgentCore] 读取同事名单失败，本轮不注入:', err)
    }

    let systemPrompt = composeSystemPrompt({
      soul: this.settings.soul,
      bot: bot.instructions || undefined,
      botName: bot.name,
      persona: recalledPersona,
      memoryContext,
      coworkers,
    })

    // 语音指令是当前轮的临时指令，接在四层之后
    if (payload.prompt.startsWith('[语音指令]')) {
      const voiceNote = '## Voice Command Mode\nThe user is speaking via voice input. The message is prefixed with [语音指令]. Treat this as a direct command to execute — do NOT explain what you would do. Just do it. If the request is clear, execute it immediately. If ambiguous, ask a brief clarifying question.'
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${voiceNote}` : voiceNote
    }

    // 构建用户消息
    if (payload.files && payload.files.length > 0) {
      console.log('[AgentCore] sendMessage with', payload.files.length, 'file(s):', payload.files.map(f => `${f.name}(${f.mimeType},${f.size}bytes,isImage:${f.isImage})`).join(', '))
      const contentBlocks: Array<Record<string, unknown>> = []
      for (const file of payload.files) {
        if (file.isImage) {
          contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: file.mimeType, data: file.data },
          })
        } else if (file.mimeType === 'application/pdf') {
          contentBlocks.push({
            type: 'document',
            source: { type: 'base64', media_type: file.mimeType, data: file.data },
          })
        } else {
          contentBlocks.push({
            type: 'text',
            text: `[File: ${file.name}]\n\`\`\`\n${file.data}\n\`\`\``,
          })
        }
      }
      contentBlocks.push({ type: 'text', text: payload.prompt })
      console.log('[AgentCore] user content blocks:', contentBlocks.map(b => b.type).join(', '))
      messages.push({ role: 'user', content: contentBlocks })
    } else {
      messages.push({ role: 'user', content: payload.prompt })
    }

    // 注入 Skills（两层模型 or eager 兼容模式）
    const disabledSkills: string[] = (this.settings as any).disabledSkills || []
    this.skillRegistry.discoverFromDirs(
      [this.sourceDir, join(homedir(), '.nerve'), join(homedir(), '.claude')],
      disabledSkills
    )
    this.skillRegistry.setSessionId(sessionId)
    // 同一轮里 load_skill 也要守同一个白名单，否则模型能绕过索引直接加载
    this.skillRegistry.setAllowedSkills(bot?.boundSkills ?? [])

    const skillLoading = (this.settings as any).skillLoading || 'lazy'

    if (skillLoading === 'eager') {
      // 兼容模式：全量注入（现有行为）
      const skills = this.visibleSkills(bot)
      for (const skill of skills) {
        const resolvedPrompt = this.skillRegistry.resolvePrompt(skill, sessionId)
        systemPrompt += `\n\n---\n\n# Skill: ${skill.name}\n\nBase directory for this skill: ${skill.skillDir}\n\n${resolvedPrompt}`
      }
    } else {
      // 两层模型：只注入 index，LLM 通过 load_skill 按需加载
      const skillIndex = this.visibleSkills(bot).map((s) => ({ name: s.name, description: s.description }))
      if (skillIndex.length > 0) {
        const indexText = skillIndex
          .map(s => `- **${s.name}**: ${s.description}`)
          .join('\n')
        systemPrompt += `\n\n## Available Skills\n\n${indexText}\n\nUse the \`load_skill\` tool to access a skill's full instructions when relevant to the user's request.`
      }
    }

    // TodoWrite 指引：长任务先拆解清单，逐项推进并实时更新状态。
    // 实测模型会攒批（16 次工具调用只更新 2 次，卡片长时间停在第一项），
    // 所以这里用硬措辞明确禁止攒到最后一起标。
    systemPrompt += '\n\n## Task List (TodoWrite)\nFor long-running work (multi-file edits, refactors, batch operations, anything with 3+ steps), first call `TodoWrite` with a breakdown of 3-10 concrete todos and mark exactly one as `in_progress`. Then keep the list current as you work: the moment a step is finished, call `TodoWrite` again with that item flipped to `completed` and the next one set to `in_progress`. Do NOT batch status updates — never let several finished steps pile up, and never leave the list showing the first item while you are actually working on later ones. Skip it for simple single-step requests.'

    // Write 工具纪律：仅当用户明确要求保存/创建/修改文件时才落盘；
    // 文稿、文章、草稿等阅读型内容默认直接输出正文，不写文件
    systemPrompt += '\n\n## File Writing Discipline\nUse the `Write` tool ONLY when the user explicitly asks to save, create, or modify a file (or when doing coding work on files in the project). For essays, drafts, articles, plans, letters, and other readable content, output the full text directly in your reply as the response — do NOT write it to a file unless the user asks. Temporary or one-off content lives in the conversation, not on disk. When unsure whether to save, just reply with the content; the user can ask you to save it afterwards.'

    return { messages, systemPrompt, mcpTools, bot }
  }

  /**
   * 解析 provider
   *
   * 返回的必须是 registry 里真实存在的 provider id。早先的实现按 model 名前缀直接
   * 返回 'openai' / 'google'，但 settings.json 的 providers 一般不会用这两个 id，
   * 于是 getClientAndModel 找不到就兜底到 anthropic —— 拿 Anthropic SDK 去打一个
   * OpenAI 兼容端点。现在改成按 type 从已注册的 provider 里挑。
   */
  private resolveProvider(cfg: ClaudeConfig = this.config): string {
    if (cfg.provider) return cfg.provider

    const providers = this.registry.listProviders()
    const preferred = this.settings.defaultProvider
      ? providers.find((p) => p.id === this.settings.defaultProvider)
      : undefined

    // model 名前缀 → provider type 推断
    const guessedType: 'openai' | 'google' | undefined =
      /^(gpt|o[134])/.test(cfg.model) ? 'openai'
        : cfg.model.startsWith('gemini') ? 'google'
          : undefined

    if (guessedType) {
      // defaultProvider 类型对得上就优先用它，否则取第一个同类型的 provider
      if (preferred?.type === guessedType) return preferred.id
      const sameType = providers.find((p) => p.type === guessedType)
      if (sameType) return sameType.id
    }

    return preferred?.id || 'anthropic'
  }

  /**
   * Routine 工具的上下文工厂：把「当前会话 + 所属 Bot」钉在这一次工具调用上。
   * 模型调 create_routine 时用它决定 botId 和默认投递会话。
   */
  private routineToolCtx(botId: string, sessionId: string | undefined) {
    const store = this.routineStoreForTools()
    if (!store) return null
    const boundSessionId = sessionId ?? ''
    return {
      store,
      getSession: () => ({ sessionId: boundSessionId, botId }),
      resolveSession: async (requested: string): Promise<string> => {
        // 指定的会话存在就用它；否则回落到 Bot 的 home 会话（routine 仍要有地方投递）
        if (requested && this.sessionStore && (await this.sessionStore.exists(requested))) return requested
        try {
          const bot = await (await this.getBotRegistry()).get(botId)
          if (bot?.homeSessionId) return bot.homeSessionId
        } catch { /* registry 不可用：按空处理 */ }
        return requested === '' ? '' : requested
      },
    }
  }

  /**
   * Bot 交接的工具上下文。
   *
   * 返回 null 的情形只有一个：这个 Bot 谁都问不了（授权是空数组，或者名单里只剩它自己）。
   * 这时整块工具都不注册 —— 授权是「能不能看见这个工具」，不是「调了之后被拒」。
   */
  private async handoffToolCtx(
    botId: string,
    sessionId: string | undefined,
    cwd: string,
    handoff: { depth: number; chain: string[] } | undefined
  ): Promise<HandoffCtx | null> {
    // 没有 Bot 身份就没有「谁在问」，深度链也断了：这种情况不给工具。
    if (!botId) return null
    const caps = readHandoffCaps()
    // 能力被关掉（上限为 0）时连 registry 都不用碰。
    if (caps.maxDepth <= 0 || caps.maxPerRun <= 0) return null

    const reg = await this.getBotRegistry()

    // 授权每次现读，不缓存：刚被收回的授权应该在下一次交接就失效，而不是等重启。
    // 名单已经按「自己 / 不可见 / 已删除」过滤过，工具那一侧不用再判一遍。
    const reachableNow = async (): Promise<BotInfo[]> => {
      const self = await reg.get(botId)
      if (!self) return []
      const grant = self.canAskBots
      return (await reg.list()).filter((b) => {
        if (b.id === botId) return false
        // null / undefined = 所有其他 Bot 都能问（老 Bot 文件没这个字段）
        if (grant === null || grant === undefined) return true
        return grant.includes(b.id)
      })
    }

    /*
     * 读一次就够：这份快照既用于「有没有人能问」的判断，也用来生成 schema 里的枚举。
     * 它**只**决定这一次工具长什么样；真正派发时仍然由 listReachable 现读，
     * 所以刚被收回的授权下一次交接就失效，而不是等下次重建工具。
     */
    const reachable = await reachableNow()
    // 授权为空就等于没有这个能力：不注册工具。
    if (reachable.length === 0) return null

    return {
      fromBotId: botId,
      sessionId: sessionId ?? '',
      cwd,
      // 深度来自载荷（递归交接时由派发方 +1），不是模型报的数。
      depth: handoff?.depth ?? 0,
      chain: handoff?.chain ?? [],
      caps,
      reachable,
      listReachable: reachableNow,
      getBot: async (id: string) => reg.get(id),
      enqueue: async (input) => this.enqueueHop({
        kind: 'hop',
        threadId: input.threadId,
        fromBotId: input.fromBotId,
        ...(input.fromName ? { fromName: input.fromName } : {}),
        toBotId: input.toBotId,
        ...(input.toName ? { toName: input.toName } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        envelope: input.envelope,
        ...(input.deliver ? { deliver: input.deliver } : {}),
        depth: input.depth,
        chain: input.chain,
      }),
    }
  }

  /**
   * 交接队列。惰性打开 + 失败后不再重试。
   *
   * 和 routines.db 一样的取舍：better-sqlite3 的原生绑定坏掉时，抛出去会让**每一条聊天
   * 消息**都失败，而 bot 交接只是附加能力。打不开就当作没有这个能力。
   */
  private hopQueueFor(): HopQueue | null {
    if (this.hopQueue) return this.hopQueue
    if (this.hopQueueBroken) return null
    try {
      this.hopQueue = HopQueue.open(join(NERVE_DIR, 'hops.db'))
      return this.hopQueue
    } catch (err) {
      this.hopQueueBroken = true
      console.warn('[AgentCore] hops.db 打开失败，本次运行不提供 bot 交接:', err)
      return null
    }
  }

  /**
   * 入队一跳，并保证 worker 在跑。
   *
   * 幂等键由「发起会话 + 双端 Bot + 任务三件套」算出：模型在一轮里重复调同一个工具是
   * 常见行为，而一跳就是完整的一轮 agent，重复执行真的花钱。同一次交接只入队一次，
   * 第二次静默返回 —— 既不重复跑，也不骗模型说「又发了一次」。
   */
  private async enqueueHop(work: HandoffWork): Promise<void> {
    const queue = this.hopQueueFor()
    if (!queue) throw new Error('交接队列不可用')

    const key =
      'hop:' +
      createHash('sha256')
        .update(
          JSON.stringify([
            work.threadId,
            work.fromBotId,
            work.toBotId,
            work.envelope.task,
            work.envelope.constraints ?? '',
            work.envelope.expecting ?? '',
          ]),
        )
        .digest('hex')
        .slice(0, 24)

    const offered = queue.offer(key, work)
    if (offered === 'queued') {
      this.ensureHopWorker()
      // 别等那 2 秒：刚派出去的活，界面上要马上看见那个 Bot 动起来。
      this.sweepNow()
    }
  }

  /** sweep 的 runner 与定时器。分开存是为了「入队后立刻催一把」。 */
  private hopRunner: ReturnType<typeof createHandoffRunner> | null = null

  /**
   * 立刻扫一轮。
   *
   * 定时器是 2 秒一次，但「我刚派了活」这个时刻不该等那 2 秒：
   * 用户点完发送，界面上要马上看见那个 Bot 开始动。空扫一次是几毫秒的查询，代价可以忽略。
   * 已经在扫的时候不叠（B 可能跑几分钟，叠上去会白跑同一跳）。
   */
  private sweepNow(): void {
    if (this.hopping) return
    const runner = this.hopRunner
    if (!runner) return
    this.hopping = true
    void runner
      .sweep()
      .catch((err) => console.warn('[AgentCore] handoff sweep 失败:', err))
      .finally(() => {
        this.hopping = false
      })
  }

  /** 起 sweep 定时器（幂等）。有活就跑，没活就是一次空查询。 */
  private ensureHopWorker(): void {
    if (this.hopTimer) return
    const queue = this.hopQueueFor()
    if (!queue) return

    const runner = createHandoffRunner({
      queue,
      owner: HopQueue.ownerId(),
      delivery: {
        run: async ({ work, prompt, depth, chain }) => {
          /*
           * 起止各广播一次，finally 里收 —— 跑失败也要收。
           *
           * 收不掉的后果不是「多一个小转圈」：侧栏那个 Bot 会一直画成正在干活，
           * 用户会以为它卡住了，然后去点它、去重启。
           */
          this.notifyBotActivity({
            botId: work.toBotId,
            botName: work.toName ?? '',
            threadId: work.threadId,
            working: true,
          })
          try {
            return await this.runHandoffTurn({
              botId: work.toBotId,
              prompt,
              depth,
              chain,
              // 沿用发起方会话的目录；老行没有这个字段就退回全局目录。
              cwd: work.cwd || this.projectDir,
            })
          } finally {
            this.notifyBotActivity({
              botId: work.toBotId,
              botName: work.toName ?? '',
              threadId: work.threadId,
              working: false,
            })
          }
        },
        appendBotMessage: async (input) => this.appendBotMessage(input),
        resolveBotSession: async (botId, fallback) => this.resolveBotSession(botId, fallback),
      },
      onSettled: (work) => this.notifySessionUpdated(work.threadId),
    })

    this.hopRunner = runner

    /*
     * 把库里「正在跑」的跳补一次 working 广播。
     *
     * 进程重启后 resumeHandoffQueue() 会接上上一轮没跑完的跳，但那条跳的「开始」
     * 发生在上一个进程里 —— 界面收不到，那个 Bot 的头像就不会有动静，
     * 而它其实正在干活。反过来，上次没收到「结束」的话它会一直转。
     * 两种都靠这一段按库里的实际情况校准。
     */
    void (async () => {
      try {
        for (const row of queue.running()) {
          const work = JSON.parse(row.payload) as HandoffWork
          if (work.kind !== 'hop') continue
          this.notifyBotActivity({
            botId: work.toBotId,
            botName: work.toName ?? '',
            threadId: work.threadId,
            working: true,
          })
        }
      } catch (err) {
        console.warn('[AgentCore] 校准交接活动状态失败:', err)
      }
    })()

    this.hopTimer = setInterval(() => this.sweepNow(), 2000)
    // 定时器不该把进程吊住（测试里尤其明显）。
    this.hopTimer.unref?.()
  }

  /**
   * 启动时把上次没跑完的交接接上。
   *
   * 队列是落盘的，但 worker 是进程内的：上次退出时可能还有 queued 的跳，
   * 或者是「hop 跑完了、relay 还没落地」这种半步状态。不接的话它们永远不会被执行，
   * 用户看到的是「Bot 说它问了，然后什么都没有」—— 而这条路已经有答案躺在库里了。
   *
   * 只有真的有活才起定时器：不用交接的人不该多一个每 2 秒的查询。
   */
  resumeHandoffQueue(): void {
    const queue = this.hopQueueFor()
    if (!queue) return
    try {
      const stats = queue.stats()
      if (stats.queued === 0 && stats.running === 0) return
      console.log(
        `[AgentCore] 接上未完成的 bot 交接: queued=${stats.queued} running=${stats.running}`,
      )
      this.ensureHopWorker()
    } catch (err) {
      console.warn('[AgentCore] 读取交接队列状态失败:', err)
    }
  }

  /** 关掉 worker（退出时调用；不关也不影响正确性，只是留个定时器）。 */
  stopHopWorker(): void {
    if (this.hopTimer) {
      clearInterval(this.hopTimer)
      this.hopTimer = null
    }
    this.hopRunner = null
  }

  /**
   * 把一段文本作为某个 Bot 说的话写进会话。
   *
   * answeredBy 是渲染层唯一的依据：有它就画成那个 Bot 的头像 + 名字，没有就还是当前 Bot。
   * 这就是「B 的原话出现在 A 的会话里」的全部实现 —— 不跑模型，不转述。
   */
  private async appendBotMessage(input: {
    sessionId: string
    botId: string
    botName?: string
    text: string
    speakerIsAsker: boolean
  }): Promise<void> {
    const store = await this.ensureSessionStore()
    await store.append({ sessionId: input.sessionId }, [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: input.text }],
          // 消息级元数据，不动 content 结构：历史回放只认 content 里的块类型，
          // 往 content 里塞自定义块会让模型看到它不认识的东西。
          answeredBy: input.botId,
          answeredByName: input.botName ?? '',
          speakerIsAsker: input.speakerIsAsker,
        },
        timestamp: new Date().toISOString(),
      },
    ])
    await store.append({ sessionId: input.sessionId }, [{ type: 'tag', tag: 'gui' }])
    /*
     * 这里刻意**不**通知。
     *
     * 通知由 runner 的 onSettled 统一发，它手里有「这一行最终写进了哪个会话」
     * （deliver=message 时会和发起方会话不同）。两处都发等于同一个会话被强制重载
     * 两次，用户正在看的时候内容会闪一下。
     */
  }

  /**
   * 某个 Bot 自己的会话 —— deliver=message 的答复落到这里。
   *
   * 三级回退，每一级都有它存在的理由：
   *   1. 登记过的 home 会话还在 → 用它。这是 B 的「收件箱」，越稳定越好：
   *      用户切到 B 的窗口，历次收到的消息该在同一个地方，而不是每次一个新会话。
   *   2. 没登记（旧数据）或已被用户删掉 → 找 B 名下最近那个会话，顺手补登记。
   *   3. 一个都没有 → 新建。此时 jsonl 还不存在，appendBotMessage 会用 flag:a
   *      把第一条写出来；先写 meta 是为了让它一出生就归属正确的 Bot。
   *
   * 返回 fallback（发起方会话）是最后一招：答错地方也比把答复丢掉好，
   * 至少用户看得到有人在说话。
   */
  async resolveBotSession(botId: string, fallback: string): Promise<string> {
    const reg = await this.getBotRegistry()
    const bot = await reg.get(botId)
    if (!bot) return fallback
    const store = await this.ensureSessionStore()

    if (bot.homeSessionId && (await store.exists(bot.homeSessionId))) return bot.homeSessionId

    try {
      const summaries = await store.listSessionSummaries()
      const mine = summaries.filter((x) => x.botId === botId)
      if (mine.length > 0) {
        mine.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0))
        const latest = mine[0].sessionId
        await reg.update(botId, { homeSessionId: latest })
        return latest
      }
    } catch (err) {
      console.warn('[AgentCore] 查找 Bot 已有会话失败:', botId, err)
    }

    const fresh = randomUUID()
    try {
      /*
       * 带上 customTitle，否则侧栏那个会话显示 Untitled。
       *
       * 这条会话没有用户提问 —— 它是「别的 Bot 发消息给你」落地的收件箱，
       * 标题只能由我们自己给。firstPrompt 是空的，兜底逻辑给不出东西。
       */
      await store.setMeta(fresh, { botId, customTitle: `${bot.name} 的消息` })
      await reg.update(botId, { homeSessionId: fresh })
    } catch (err) {
      console.warn('[AgentCore] 新建 Bot 会话失败:', botId, err)
      return fallback
    }
    return fresh
  }

  /** 订阅会话内容变化（IPC / gateway 用来把变化推给自己的客户端）。 */
  private sessionUpdatedListeners = new Set<(sessionId: string) => void>()

  /**
   * 订阅「某个 Bot 正在/不再跑一跳」。
   *
   * 交接是异步的：用户下发任务后，A 那一轮几秒就结束了，B 还在后台跑。
   * 不给一个状态信号的话，界面上「问了 → 一片空白 → 突然冒出一段话」，
   * 中间那段等待完全不可见 —— 而这恰恰是最需要「它在动」的时刻。
   */
  private botActivityListeners = new Set<(a: BotActivity) => void>()

  onSessionUpdated(fn: (sessionId: string) => void): () => void {
    this.sessionUpdatedListeners.add(fn)
    return () => {
      this.sessionUpdatedListeners.delete(fn)
    }
  }

  onBotActivity(fn: (a: BotActivity) => void): () => void {
    this.botActivityListeners.add(fn)
    return () => {
      this.botActivityListeners.delete(fn)
    }
  }

  private notifyBotActivity(a: BotActivity): void {
    for (const fn of this.botActivityListeners) {
      try {
        fn(a)
      } catch {
        /* 监听方的错误不该影响队列 */
      }
    }
  }

  private notifySessionUpdated(sessionId: string): void {
    for (const fn of this.sessionUpdatedListeners) {
      try {
        fn(sessionId)
      } catch {
        /* 监听方的错误不该影响队列 */
      }
    }
  }

  /**
   * 以目标 Bot 的身份，在一个一次性会话里跑完整一轮，把它说的话取回来。
   *
   * 为什么必须开独立会话：sendMessage() 一进来就会 cancelSession(它自己的 sessionId)，
   * 拿发起方 A 的会话去跑 B，等于 A 把自己掐掉。独立 sessionId + 独立 SessionContext，
   * 两边互不影响。
   *
   * 为什么要删会话：一次交接一个会话的话，侧栏会被 handoff-xxxx 塞满。它跑完就没用了，
   * 失败也要删 —— 半截会话比没有更糟。
   */
  private async runHandoffTurn(input: {
    botId: string
    prompt: string
    depth: number
    chain: string[]
    cwd: string
  }): Promise<string> {
    // 捕获通道：只收正文（thinking / 工具调用不进答复），sendError 记下来让这一跳变成失败。
    //
    // 写成完整的 OutputChannel 而不是继承 NullOutputChannel：基类把方法声明成无参，
    // 子类带参数的覆写在结构化类型下不兼容（dispatchRoutine 的 ErrorCapturingChannel
    // 就是这么一直在报错的）。这里明确列出每个方法，多几行但一眼能读懂它到底拦了什么。
    const answer: string[] = []
    let errored = ''
    const captureChannel: OutputChannel = {
      sendStreamDelta(text: string): void {
        answer.push(text)
      },
      sendThinkingDelta(): void {},
      sendToolCall(): void {},
      sendToolResult(): void {},
      sendDone(): void {},
      sendError(message: string): void {
        errored = message
      },
      sendImage(): void {},
      isReady(): boolean {
        return true
      },
    }

    const scratchId = scratchSessionId()
    const store = await this.ensureSessionStore()

    try {
      // 独立上下文：绝不复用发起方的 SessionContext（见方法注释）。
      const ctx = createSessionContext(scratchId)
      await this.sendMessage(
        {
          prompt: input.prompt,
          sessionId: scratchId,
          botId: input.botId,
          cwd: input.cwd,
          // 深度一路带下去：目标 Bot 若继续交接，闸门接着数。
          handoff: { depth: input.depth, chain: input.chain },
        },
        captureChannel,
        ctx,
      )
      if (errored) throw new Error(errored)

      const streamed = answer.join('').trim()
      if (streamed) return streamed

      // 流式正文是空的：这一轮可能只做了工具调用，而 handleResult 会把 "Done. Bash → x"
      // 这类总结**直接写进落盘内容**、不再走 sendStreamDelta。直接读刚落盘的会话，
      // 比让发起方收到一句「它什么都没说」诚实 —— 它其实做了事，只是没说话。
      const entries = (await store.load({ sessionId: scratchId })) ?? []
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as { type?: string; message?: { content?: unknown } }
        if (e.type !== 'assistant') continue
        const content = e.message?.content
        if (!Array.isArray(content)) continue
        const text = content
          .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text as string)
          .join('\n')
        if (text.trim()) return text.trim()
      }
      return ''
    } finally {
      // 无论成败都收掉这个一次性会话（sendMessage 失败也会留下半个文件）。
      try {
        if (await store.exists(scratchId)) await store.delete({ sessionId: scratchId })
      } catch (err) {
        console.warn('[AgentCore] 清理 handoff 会话失败:', scratchId, err)
      }
    }
  }

  /** 工具侧用的 RoutineStore（与 index.ts 的 Scheduler 共用同一个 db 文件）。 */
  private toolsRoutineStore: import('../store/routine-store').RoutineStore | null = null
  private toolsStoreBroken = false
  /**
   * 惰性打开；失败返回 null 并记住，不再重试。
   *
   * 这里刻意不抛：better-sqlite3 的原生绑定坏掉时，抛出去会让**每一条聊天消息**
   * 都失败，而 routine 只是附加能力。打不开就整套 routine 工具不注册。
   */
  private routineStoreForTools(): import('../store/routine-store').RoutineStore | null {
    if (this.toolsRoutineStore) return this.toolsRoutineStore
    if (this.toolsStoreBroken) return null
    try {
      this.toolsRoutineStore = RoutineStore.open(join(NERVE_DIR, 'routines.db'))
      return this.toolsRoutineStore
    } catch (err) {
      this.toolsStoreBroken = true
      console.warn('[AgentCore] routines.db 打开失败，本次会话不提供 routine 工具:', err)
      return null
    }
  }

  /** 退出时关掉工具侧的 routine 连接（与 Scheduler 的是两个独立句柄）。 */
  closeToolStores(): void {
    if (this.toolsRoutineStore) {
      try { this.toolsRoutineStore.close() } catch { /* 已关闭或不可用 */ }
      this.toolsRoutineStore = null
    }
  }
  /**
   * 构建工具定义和执行器
   */
  private async buildTools(
    client: any,
    modelId: string,
    providerType: string,
    mcpTools: McpToolEntry[],
    channel: OutputChannel,
    pendingToolCalls: Map<string, { name: string; input: any }>,
    // 这两个原本是 `?` 可选参数。改成显式 `| undefined` 是为了让末尾的 `cwd` 能是必填 ——
    // TS 不允许必填参数跟在 `?` 可选参数后面（TS1016）。语义没变：调用方照样传 undefined。
    routeImages: ((toolName: string | undefined, resultContent: string) => void) | undefined,
    sessionId: string | undefined,
    // cfg 的默认值保留（TS 允许必填参数跟在带默认值的参数后面），只有 cwd 必须去掉默认
    cfg: ClaudeConfig = this.config,
    // 必填，不给默认值：这个参数就是本任务的修复本体。原先默认成 this.projectDir，
    // 于是调用点漏传也照样编译、照样全绿，工具却悄悄退回全局目录 —— 正是要根除的 bug。
    cwd: string,
    // 本轮所属 Bot。显式传参而不是读实例字段：同一进程里 routine 轮次与用户轮次
    // 可能交错，共享字段会让 A 轮的工具把 routine 写到 B 轮的 Bot 名下。
    botId: string,
    // Bot 交接链（只有被别的 Bot 派起来的一轮才带）。没给默认值：默认成 0 看起来方便，
    // 实际会让「忘了传」和「真的是根」长得一模一样，深度闸就永远关着了。
    handoff: { depth: number; chain: string[] } | undefined
  ) {
    const allToolCalls: Array<{ id: string; name: string; input: unknown }> = []
    const allToolResults: Array<{ toolCallId: string; content: string; is_error?: boolean }> = []

    // Build tools
    // AskUser 卡片只有 Electron 渲染端能展示回应，其他通道（gateway/IM）不注册该工具，
    // 否则工具 promise 永远等不到回答
    const askChannel = isElectronChannel(channel) ? channel : undefined
    const builtinTools = getBuiltinTools(cwd, {
      refresh: () => {
        if (isElectronChannel(channel)) channel.sendGitRefresh()
      },
    }, this.sourceDir, this.skillRegistry, askChannel ? {
      askUser: (questions) => new Promise((resolve) => {
        const askId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        this.pendingAsks.set(askId, { resolve })
        askChannel.sendAskUserRequest(askId, questions)
      }),
      // TodoWrite → FLOW_ITEM('todo')：渲染端 todoStore 消费，Stage TaskRows 卡片展示
      onTodos: (todos) => {
        askChannel.sendFlowItem('todo', JSON.stringify(todos), { sessionId })
      },
    } : undefined, this.jobs)
    const routineCtx = this.routineToolCtx(botId, sessionId)
    if (routineCtx) Object.assign(builtinTools, buildRoutineTools(routineCtx))

    // Bot 交接：拿不到上下文（= 这个 Bot 谁都不能问）就整块不注册，
    // 而不是注册了每次都被拒 —— 后者会让模型对用户说「我试了但失败了」。
    const handoffCtx = await this.handoffToolCtx(botId, sessionId, cwd, handoff)
    if (handoffCtx) Object.assign(builtinTools, buildBotHandoffTools(handoffCtx))

    // TDAI 记忆工具：auto-recall 早就把它们写进了系统提示词，却从未注册 ——
    // 模型被明确告知可以调，实际撞空。合并进 builtinTools 后，下面的
    // 冲突判定（拿 Object.keys(builtinTools) 做保留名）与 executor 注册会一并带上。
    if (this.memoryCore) {
      Object.assign(builtinTools, createMemoryTools(this.memoryCore))
    }

    // MCP 工具名冲突解决：与内置工具或其他 MCP 工具重名时加 serverName__ 前缀
    const resolvedMcp = resolveMcpToolNames(mcpTools, new Set(Object.keys(builtinTools)))
    const mcpExecByKey = new Map(
      this.mcpPool.getDetailedExecutors().map((e) => [`${e.serverName}::${e.toolName}`, e.execute] as const)
    )
    // 子代理（Task）拿的就是这一份：条目必须带上 execute，
    // 否则 runSubagent 只注册 def 不注册 executor，子代理看得见调不动
    const mcpToolsRecord = Object.fromEntries(
      resolvedMcp.map((r) => [
        r.finalName,
        { ...(r.tool as Record<string, unknown>), execute: mcpExecByKey.get(`${r.serverName}::${r.toolName}`) },
      ])
    )

    const orchestratorTools = getOrchestratorTools({
      client,
      modelId,
      providerType,
      projectDir: cwd,
      mcpTools: mcpToolsRecord,
      effort: cfg.effort,
      createClient: async () => {
        const fresh = this.registry.createFreshClient(this.resolveProvider(cfg))
        return { client: fresh.client }
      },
      onToolCall: (id, name, input) => {
        allToolCalls.push({ id, name, input })
        pendingToolCalls.set(id, { name, input })
        channel.sendToolCall(id, name, input)
      },
      onToolResult: (id, content, isError) => {
        allToolResults.push({ toolCallId: id, content: content.slice(0, 50000), is_error: isError })
        const toolInfo = pendingToolCalls.get(id)
        if (toolInfo) {
          this.emitFlowItem(channel, toolInfo.name, toolInfo.input, content)
          pendingToolCalls.delete(id)
        }
        channel.sendToolResult(id, content.slice(0, 50000), isError)
        // 图片工具结果路由
        if (!isError && toolInfo && routeImages) {
          routeImages(toolInfo.name, content)
        }
      },
    })

    // MCP 与 orchestrator 工具重名（极少见）：MCP 侧跳过，不覆盖 orchestrator
    const orchestratorNames = new Set(Object.keys(orchestratorTools))
    const keptMcp = resolvedMcp.filter((r) => {
      if (orchestratorNames.has(r.finalName)) {
        console.warn(`[AgentCore] MCP tool "${r.finalName}" (${r.serverName}) conflicts with an orchestrator tool; skipped`)
        return false
      }
      return true
    })

    // Plugin tools via snapshot (pinned for this conversation)
    const pluginSnapshot = this.pluginBus.getSnapshot()
    pluginSnapshot.ref()

    const allToolDefs = [
      ...Object.entries(builtinTools).map(([name, tool]) => ({
        name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
      ...keptMcp.map(({ finalName, tool }) => ({
        name: finalName,
        description: (tool as any).description || '',
        input_schema: (tool as any).input_schema || (tool as any).parameters || {},
      })),
      ...Object.entries(orchestratorTools).map(([name, tool]) => ({
        name,
        description: (tool as any).description || '',
        input_schema: (tool as any).input_schema || {},
      })),
      ...pluginSnapshot.toolDefs,
    ]

    const allToolExecutors = new Map<string, (args: any) => Promise<any>>()
    for (const [name, tool] of Object.entries(builtinTools)) {
      allToolExecutors.set(name, tool.execute)
    }
    for (const [name, tool] of Object.entries(orchestratorTools)) {
      allToolExecutors.set(name, (tool as any).execute)
    }
    for (const r of keptMcp) {
      const exec = mcpExecByKey.get(`${r.serverName}::${r.toolName}`)
      if (exec) allToolExecutors.set(r.finalName, exec)
    }
    for (const [name, executor] of pluginSnapshot.toolExecutors) {
      allToolExecutors.set(name, executor)
    }

    return { allToolDefs, allToolExecutors, orchestratorTools, allToolCalls, allToolResults, pluginSnapshot }
  }

  /**
   * 运行 Agent 循环
   */
  private async runAgentLoop(
    client: any,
    modelId: string,
    providerType: string,
    messages: Array<{ role: string; content: unknown }>,
    systemPrompt: string,
    allToolDefs: any[],
    allToolExecutors: Map<string, (args: any) => Promise<any>>,
    ctx: SessionContext,
    channel: OutputChannel,
    pendingToolCalls: Map<string, { name: string; input: any }>,
    pendingApprovals: Map<string, { resolve: (approved: boolean) => void }>,
    routeImages: (toolName: string | undefined, resultContent: string) => void,
    cfg: ClaudeConfig = this.config
  ) {
    const textDeltas: string[] = []
    const fullThinkingParts: string[] = []
    const allToolCalls: Array<{ id: string; name: string; input: unknown }> = []
    const allToolResults: Array<{ toolCallId: string; content: string; is_error?: boolean }> = []

    const result = await runAgenticLoop({
      client,
      modelId,
      providerType,
      messages,
      system: systemPrompt || undefined,
      tools: allToolDefs,
      toolExecutors: allToolExecutors,
      maxSteps: 50,
      /*
       * 后台作业结果自动投递。
       *
       * 不接这一根的话，Bash 转后台之后模型永远看不到输出 —— 它会以为任务挂了，
       * 然后放弃。实测表现是 echo p2…p38 空转。
       */
      drainJobs: () => {
        const done = this.jobs.drainFinished()
        if (done.length === 0) return ''
        const head = `\n\n[后台作业已完成 ${done.length} 个，以下是结果]`
        return head + '\n\n' + done.map((j) => formatJobResult(j)).join('\n\n---\n\n')
      },
      effort: cfg.effort,
      abortSignal: ctx.abort.signal,
      onTextDelta: (text) => {
        textDeltas.push(text)
        channel.sendStreamDelta(text)
        if (isElectronChannel(channel)) channel.sendPetState('working')
      },
      onThinkingDelta: (thinking) => {
        fullThinkingParts.push(thinking)
        channel.sendThinkingDelta(thinking)
      },
      onToolCall: (id, name, input) => {
        allToolCalls.push({ id, name, input })
        pendingToolCalls.set(id, { name, input })
        channel.sendToolCall(id, name, input)
        if (isElectronChannel(channel)) channel.sendPetState('running-left')
      },
      onToolApproval: cfg.permissionMode === 'bypassPermissions'
        ? undefined
        : async (id, name, input) => {
            if (!this.needsApproval(name, cfg.permissionMode)) return true
            const approvalId = `approve-${id}`
            if (isElectronChannel(channel)) {
              channel.sendToolApprovalRequest(approvalId, name, input, id)
            }
            return new Promise<boolean>((resolve) => {
              // 渲染层一直不响应（窗口卡住/人不在）时不能把整轮挂死：超时当拒绝，让模型自己决定下一步
              const timer = setTimeout(() => {
                if (!pendingApprovals.delete(approvalId)) return
                console.warn('[AgentCore] tool approval timed out, denying:', name)
                resolve(false)
              }, APPROVAL_TIMEOUT_MS)
              pendingApprovals.set(approvalId, {
                resolve: (approved) => { clearTimeout(timer); resolve(approved) },
              })
            })
          },
      onToolResult: (id, content, isError) => {
        allToolResults.push({ toolCallId: id, content: content.slice(0, 50000), is_error: isError })
        const toolInfo = pendingToolCalls.get(id)
        if (toolInfo) {
          this.emitFlowItem(channel, toolInfo.name, toolInfo.input, content)
          pendingToolCalls.delete(id)
        }
        channel.sendToolResult(id, content.slice(0, 50000), isError)
        // 图片工具结果路由
        if (!isError && toolInfo) {
          routeImages(toolInfo.name, content)
        }
      },
      onBeforeStep: async (msgs) => {
        await this.offloadBridge?.onBeforeStep(msgs)
      },
      onAfterToolCall: (toolName, toolCallId, params, result) => {
        this.offloadBridge?.onAfterToolCall(toolName, toolCallId, params, result)
      },
      hookRegistry: this.hookRegistry,
      sessionId: ctx.sessionId,
    })

    return {
      usage: result.usage,
      stopReason: result.stopReason,
      textDeltas,
      fullThinkingParts,
      allToolCalls,
      allToolResults,
    }
  }

  /**
   * 处理结果和保存
   */
  private async handleResult(
    result: { usage: { inputTokens: number; outputTokens: number; contextTokens: number }; stopReason: string; textDeltas: string[]; fullThinkingParts: string[]; allToolCalls: Array<{ id: string; name: string; input: unknown }>; allToolResults: Array<{ toolCallId: string; content: string; is_error?: boolean }> },
    sessionId: string,
    payload: SendMessagePayload,
    channel: OutputChannel,
    ctx: SessionContext,
    sentImages?: Set<string>,
    cfg: ClaudeConfig = this.config
  ) {
    const store = await this.ensureSessionStore()
    const { usage, stopReason, textDeltas, fullThinkingParts, allToolCalls, allToolResults } = result

    const content: Array<Record<string, unknown>> = []
    const fullThinking = fullThinkingParts.join('')
    if (fullThinking) content.push({ type: 'thinking', thinking: fullThinking })
    let fullText = textDeltas.join('')

    // 被截断 / 撞步数上限：必须让用户看见，否则和"正常说完"长得一模一样
    // （下面还会伪造一句 "Done. ... completed."，不标出来就是明着骗人）。
    // 单独成块，不混进 fullText（记忆捕获读的是 fullText）
    const incompleteNote = stopReason === 'max_tokens'
      ? '\n\n> ⚠️ 本轮输出达到 max_tokens 上限被截断（自动续跑后仍截断），任务可能没做完 —— 回一句「继续」可以接着往下做。'
      : stopReason === 'max_steps'
        ? '\n\n> ⚠️ 已达到单轮步数上限（50 步），任务可能没做完 —— 回一句「继续」可以接着往下做。'
        : ''
    if (incompleteNote) channel.sendStreamDelta(incompleteNote)

    if (!fullText && allToolCalls.length > 0) {
      const toolNames = [...new Set(allToolCalls.map((t) => t.name))]
      const fileOps = allToolResults
        .filter((r) => !r.is_error)
        .map((r) => { try { const p = JSON.parse(r.content); return p.filename || p.path || null } catch { return null } })
        .filter(Boolean)
      if (fileOps.length > 0) {
        fullText = `Done. ${toolNames.join(', ')} → ${fileOps.join(', ')}`
      } else {
        fullText = `Done. ${toolNames.join(', ')} completed.`
      }
    }
    if (fullText) content.push({ type: 'text', text: fullText })
    if (incompleteNote) content.push({ type: 'text', text: incompleteNote })
    for (const tc of allToolCalls) {
      content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
    }
    for (const tr of allToolResults) {
      content.push({ type: 'tool_result', tool_use_id: tr.toolCallId, content: tr.content, is_error: tr.is_error })
    }
    // 产物图片写入消息内容：消息流是唯一真相源，chat/stage 两种模式都从这里渲染
    if (sentImages) {
      for (const p of sentImages) content.push({ type: 'image', src: p })
    }

    await store.append({ sessionId }, [{
      type: 'assistant',
      message: { content },
      timestamp: new Date().toISOString(),
      // contextTokens = 最后一次 LLM 调用的实际上下文占用（input+output），用量环读它；
      // inputTokens/outputTokens 保持累计消耗语义，供 Usage 面板统计
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        contextTokens: usage.contextTokens ?? (usage.inputTokens + usage.outputTokens),
      },
    }])
    await store.append({ sessionId }, [{ type: 'tag', tag: 'gui' }])

    // Memory capture
    //
    // 交接轮（payload.handoff 存在）不写记忆：那是一段「另一个 Bot 请求我做某事」的
    // 机器对话，写进长期记忆后会被当成用户说过的话召回，污染后续每一轮。
    if (fullText && this.memoryCore && !payload.handoff) {
      this.memoryCore.handleTurnCommitted({
        userText: payload.prompt,
        assistantText: fullText,
        messages: [
          { role: 'user', content: payload.prompt },
          { role: 'assistant', content: fullText },
        ],
        sessionKey: sessionId,
        sessionId,
      }).catch((err) => console.error('[TDAI] capture failed:', err))
    }

    const pricing = COST_PER_TOKEN[this.resolveModel(cfg.model)] || { input: 0.003, output: 0.015 }
    const cost = ((usage.inputTokens) * pricing.input + (usage.outputTokens) * pricing.output) / 1000
    // 上下文窗口按本轮**实际用的** model/provider 算（会话覆盖了 model 时不能用全局值）。
    // provider 必须和 getSessionUsage 走同一条解析：cfg.provider 为空（按 model 前缀推断，
    // 比如 gpt-* → openai）时，直接用原始 cfg.provider 会跳过
    // providers[真实 provider].modelContextWindows，于是 WS 客户端的窗口被永久低估，
    // 而同一会话的 getSessionUsage 报的是另一个数。
    const providerId = this.resolveProvider(cfg)
    const maxContextTokens = this.resolveContextWindow(this.resolveModel(cfg.model, providerId), providerId)

    // 循环在步边界被 break（用户取消）也会走到这里：别报成 complete
    const cancelled = ctx.abort.signal.aborted
    channel.sendDone(sessionId, cost, maxContextTokens, cancelled ? 'cancelled' : 'complete', payload.runId)
    if (isElectronChannel(channel)) channel.sendPetState(cancelled ? 'idle' : 'happy')
  }

  /**
   * 取消会话：给了后端认识的 sessionId 就只取消它；否则（没给 / 给的是渲染层
   * 临时 id session-<ts>）退回全量取消 —— 否则"停止"按钮在首轮会失效。
   */
  cancel(sessionId?: string) {
    if (sessionId && this.sessionContextManager.cancel(sessionId)) return
    for (const id of this.sessionContextManager.getSessionIds()) {
      this.cancelSession(id)
    }
  }

  /**
   * 取消指定会话
   */
  cancelSession(sessionId: string) {
    this.sessionContextManager.cancel(sessionId)
  }

  /**
   * 获取会话上下文管理器
   */
  /** 进程退出时杀掉所有后台作业，避免留下孤儿进程。 */
  killAllJobs(): void {
    this.jobs.killAll()
  }

  getSessionContextManager(): SessionContextManager {
    return this.sessionContextManager
  }

  // Tool risk classification
  private static READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep'])
  private static WRITE_TOOLS = new Set(['Write', 'Edit', 'GitStageAll', 'GitCommit', 'GitPull', 'GitInit'])

  private needsApproval(toolName: string, mode: ClaudeConfig['permissionMode'] = this.config.permissionMode): boolean {
    if (mode === 'bypassPermissions') return false
    if (AgentCore.READ_ONLY_TOOLS.has(toolName)) return false
    if (mode === 'auto') return false
    if (mode === 'acceptEdits') {
      return !AgentCore.WRITE_TOOLS.has(toolName)
    }
    return true
  }

  /**
   * 处理工具审批响应
   */
  handleToolApprovalResponse(approvalId: string, approved: boolean, sessionId?: string) {
    // 指定 sessionId 时精确查找
    if (sessionId) {
      const ctx = this.sessionContextManager.get(sessionId)
      if (ctx) {
        const pending = ctx.pendingApprovals.get(approvalId)
        if (pending) {
          pending.resolve(approved)
          ctx.pendingApprovals.delete(approvalId)
          return
        }
      }
    }

    // 遍历所有会话查找（兼容未传 sessionId 的场景）
    for (const ctx of this.sessionContextManager.getAll()) {
      const pending = ctx.pendingApprovals.get(approvalId)
      if (pending) {
        pending.resolve(approved)
        ctx.pendingApprovals.delete(approvalId)
        return
      }
    }
  }

  /**
   * 四个 setter 都支持可选的 `sessionId`：
   *   传了 → 只写该会话的 `ctx.config`（不碰全局、不落盘）
   *   没传 → 写全局 `this.config` 并落盘（历史行为，渲染层全局设置走这条）
   *
   * 会话级写入用 getOrCreate：会话可能还没跑过第一轮消息（用户先在侧栏把模型改好
   * 再发第一条），若是纯查找就会把这次选择静默丢掉。
   */
  async setModel(model: string, sessionId?: string) {
    if (sessionId) {
      this.writeSessionConfig(sessionId, { model })
      return
    }
    this.config.model = model
    await saveRuntimeConfig({ model })
  }
  async setProvider(providerId: string, sessionId?: string) {
    if (sessionId) {
      this.writeSessionConfig(sessionId, { provider: providerId })
      return
    }
    this.config.provider = providerId
    await saveRuntimeConfig({ provider: providerId })
  }
  async setEffort(effort: ClaudeConfig['effort'], sessionId?: string) {
    if (sessionId) {
      this.writeSessionConfig(sessionId, { effort })
      return
    }
    this.config.effort = effort
    await saveRuntimeConfig({ effort })
  }
  async setPermissionMode(mode: ClaudeConfig['permissionMode'], sessionId?: string) {
    if (sessionId) {
      this.writeSessionConfig(sessionId, { permissionMode: mode })
      return
    }
    this.config.permissionMode = mode
    await saveRuntimeConfig({ permissionMode: mode })
  }

  /** 会话级配置写入：替换对象而不是就地改，避免跑着的一轮拿到半截配置。 */
  private writeSessionConfig(sessionId: string, patch: Partial<ClaudeConfig>): void {
    const ctx = this.sessionContextManager.getOrCreate(sessionId)
    ctx.config = { ...ctx.config, ...patch }
  }

  /**
   * 切换项目目录。
   *
   * 只换「跑在哪」——`this.config.cwd`（工具 cwd）、`this.projectDir`（插件看到的项目）
   * 和 settings 里的当前项目/最近项目。
   *
   * **不碰 `this.sessionStore`**：会话存储根目录固定为 `sourceDir/.nerve/sessions`，
   * 由 `ensureSessionStore()` 惰性创建一次。原先这里 reassign 成 `<cwd>/.nerve/sessions`，
   * 导致切到项目 B 后项目 A 的会话全部从列表里消失（文件还在，只是 store 指错了目录）。
   */
  async setCwd(cwd: string) {
    this.config.cwd = cwd
    this.projectDir = cwd
    const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
    try {
      const existing = existsSync(nerveSettingsPath) ? JSON.parse(readFileSync(nerveSettingsPath, 'utf-8')) : {}
      existing.cwd = cwd
      // 最近项目：去重后置顶，最多留 20 条（项目选择器读这个列表）
      const recents: string[] = Array.isArray(existing.recentProjects) ? existing.recentProjects : []
      existing.recentProjects = [cwd, ...recents.filter((p) => p !== cwd)].slice(0, 20)
      writeFileSync(nerveSettingsPath, JSON.stringify(existing, null, 2), 'utf-8')
    } catch { /* ignore */ }
  }

  private emitFlowItem(channel: OutputChannel, toolName: string, input: any, resultText: string) {
    if (!isElectronChannel(channel)) return

    if ((toolName === 'Write' || toolName === 'Bash') && input) {
      const filePath = input.file_path || input.path || ''
      if (/\.html?$/i.test(filePath) && input.content) {
        const hash = input.content.length + ':' + input.content.slice(0, 200)
        if (!this.flowContentHashes.has(hash)) {
          this.flowContentHashes.add(hash)
          let savedPath = filePath
          try { savedPath = JSON.parse(resultText).file_path || filePath } catch {}
          channel.sendFlowItem('html', input.content, {
            label: filePath.split(/[/\\]/).pop(),
            savedPath,
          })
        }
      }
    }
  }

  getConfig(): ClaudeConfig { return { ...this.config } }
  getSettings(): ClaudeSettings { return { ...this.settings } }
  getSourceDir(): string { return this.sourceDir }

  reloadProvider() {
    this.settings = loadSettings()
    this.registry.reload(this.settings)
  }

  async listSessions() {
    const store = await this.ensureSessionStore()
    const summaries = await store.listSessionSummaries()
    return summaries.map((s) => ({
      sessionId: s.sessionId,
      summary: s.summary || s.firstPrompt?.slice(0, 80) || '',
      firstPrompt: s.firstPrompt,
      customTitle: s.customTitle,
      lastModified: s.lastModified,
      createdAt: s.createdAt,
      tag: s.tag,
      botId: s.botId,
    }))
  }

  async getSessionMessages(sessionId: string) {
    const store = await this.ensureSessionStore()
    const entries = await store.load({ sessionId })
    if (!entries) return []
    return entries.filter((e: any) => e.type === 'user' || e.type === 'assistant')
  }

  async deleteSession(sessionId: string) {
    const store = await this.ensureSessionStore()
    await store.delete({ sessionId })
  }

  async tagSession(sessionId: string, tag: string) {
    const store = await this.ensureSessionStore()
    await store.append({ sessionId }, [{ type: 'tag', tag }])
  }

  async branchSession(sessionId: string, fromEntryId: string, branchName?: string) {
    const store = await this.ensureSessionStore()
    return store.branch(sessionId, fromEntryId, branchName)
  }

  async switchBranch(sessionId: string, branchName: string) {
    const store = await this.ensureSessionStore()
    return store.switchBranch(sessionId, branchName)
  }

  async listBranches(sessionId: string) {
    const store = await this.ensureSessionStore()
    return store.listBranches(sessionId)
  }

  /**
   * 当前**上下文占用** —— 用量环（ContextRing）读的就是这个值。
   *
   * 取最后一条 assistant 条目的 contextTokens（= 最后一次 LLM 调用的 input+output）。
   * 历史实现是把整个会话所有 assistant 条目的 usage 累加，那是「会话累计消耗」而非
   * 「当前占用」：它单调增长、必然超过 context window，被渲染层 Math.min(ratio, 1)
   * 夹到 1 之后就会永久显示 100% 红。
   *
   * 旧数据没有 contextTokens 字段，回退用该条的 inputTokens + outputTokens。
   *
   * 跳过零值条目：被用户取消 / 调用超时的轮次会落一条 usage 全 0 的空回复，
   * 它没有消耗任何上下文，若恰好是最后一条会误报成 0%。
   *
   * 上下文窗口必须按**该会话实际用的** model/provider 解析（`this.config` + 会话覆盖），
   * 否则会话把模型切成 gpt-4o（128k）时，用量环仍按全局 sonnet（200k）算分母，
   * 占用比例被永久低估。
   */
  async getSessionUsage(sessionId: string) {
    const store = await this.ensureSessionStore()
    const entries = await store.load({ sessionId })

    let inputTokens = 0
    let outputTokens = 0
    let contextTokens = 0

    if (entries) {
      for (let i = (entries as any[]).length - 1; i >= 0; i--) {
        const e = (entries as any[])[i]
        if (e.type !== 'assistant' || !e.usage) continue
        const inp = e.usage.inputTokens || 0
        const out = e.usage.outputTokens || 0
        const ctxTokens = e.usage.contextTokens ?? (inp + out)
        if (ctxTokens <= 0) continue // 空回复（取消/超时），无实际占用
        inputTokens = inp
        outputTokens = out
        contextTokens = ctxTokens
        break
      }
    }

    // 全局配置 + 该会话的覆盖 —— 与会话不存在时等价于全局配置。
    // provider 走和 sendMessage 同一个解析（cfg.provider 为空时按 model 前缀推断），
    // 否则 provider 级 modelContextWindows 会在会话没显式指定 provider 时被跳过。
    const cfg = this.resolveSessionConfig(sessionId)
    const providerId = this.resolveProvider(cfg)
    const modelId = this.resolveModel(cfg.model, providerId)

    return {
      inputTokens,
      outputTokens,
      totalTokens: contextTokens,
      maxContextTokens: this.resolveContextWindow(modelId, providerId),
    }
  }

  /** 该会话本轮的有效配置 = 全局 config + `ctx.config` 覆盖（非创建式查找）。 */
  private resolveSessionConfig(sessionId: string): ClaudeConfig {
    return mergeConfigForSession(this.config, this.sessionContextManager.get(sessionId))
  }

  getProviders() {
    return this.registry.listProviders()
  }

  async getUsageStats() {
    const store = await this.ensureSessionStore()
    return store.getUsageStats()
  }

  async close() {
    if (this.memoryCore) {
      await this.memoryCore.destroy().catch((err) => console.error('[TDAI] destroy failed:', err))
    }
    // 交接的 sweep 定时器和 sqlite 句柄：不关进程会留一个悬着的定时器和一条打开的文件。
    this.stopHopWorker()
    if (this.hopQueue) {
      try {
        this.hopQueue.close()
      } catch {
        /* 已经关了 */
      }
      this.hopQueue = null
    }
    await this.mcpPool.close()
  }

  // Plugins
  getPlugins() {
    const disabled = new Set<string>(getDisabledPlugins())
    return this.pluginBus.listPlugins(disabled)
  }

  async togglePlugin(pluginId: string, enabled: boolean) {
    await togglePluginSetting(pluginId, enabled)
    return { success: true }
  }

  async reloadPlugin(pluginId: string) {
    await this.pluginBus.reloadPlugin(pluginId)
    return { success: true }
  }

  async rollbackMcp(serverId: string) {
    const result = await this.mcpPool.rollbackServer(serverId)
    return { success: result }
  }

  /** 设置面板保存 MCP 配置后热同步连接池 */
  async reloadMcpServers() {
    await this.mcpPool.syncWithConfig()
    return { success: true }
  }

  /** MCP 服务器连接状态（设置面板状态指示） */
  getMcpStatus() {
    return this.mcpPool.getStatus()
  }

  /** AskUser 挂起中的提问：askId → resolve */
  handleAskUserResponse(askId: string, answers: import('../../shared/types').AskUserAnswers) {
    const pending = this.pendingAsks.get(askId)
    if (pending) {
      pending.resolve(answers)
      this.pendingAsks.delete(askId)
    }
  }
}
