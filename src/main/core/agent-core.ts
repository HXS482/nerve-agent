/**
 * AgentCore — 无 UI 依赖的 Agent 核心
 *
 * 从 ClaudeService 抽取，去掉所有 BrowserWindow 依赖
 * 通过 OutputChannel 接口输出，支持 Electron IPC / WebSocket / IM 适配器
 */

import { join } from 'path'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { FileSessionStore } from '../session-store'
import { loadSettings, NERVE_DIR, ClaudeSettings } from '../settings'
import { getBuiltinTools } from '../tools'
import { getSkills } from '../skills'
import { ProviderRegistry } from '../provider-registry'
import { McpPool } from '../mcp-pool'
import { getOrchestratorTools } from '../orchestrator'
import { runAgenticLoop } from '../agentic-loop'
import { MemoryTdaiCore } from '../memory-tdai'
import { OffloadBridge } from '../offload-bridge'
import type { OutputChannel } from './output-channel'
import { isElectronChannel } from './output-channel'
import type { ClaudeConfig, SendMessagePayload, FileAttachment, ContentBlock } from '../../shared/types'
import { SessionContext, SessionContextManager, createSessionContext } from './session-context'
import { CONTEXT_WINDOWS, COST_PER_TOKEN } from './model-constants'

// 前向声明，避免循环依赖
export type { OutputChannel }

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
  private projectDir: string
  private sourceDir: string
  private settings: ClaudeSettings
  private registry: ProviderRegistry
  private mcpPool: McpPool
  private flowContentHashes = new Set<string>()
  private memoryCore: MemoryTdaiCore | null = null
  private offloadBridge: OffloadBridge | null = null

  // 会话上下文管理器（用于多 session 并发）
  private sessionContextManager = new SessionContextManager()

  constructor(config: AgentCoreConfig) {
    this.settings = config.settings || loadSettings()
    this.sourceDir = config.sourceDir
    this.projectDir = this.settings.cwd || config.projectDir

    // Initialize config from settings
    if (this.settings.model) this.config.model = this.settings.model
    if (this.settings.defaultProvider) this.config.provider = this.settings.defaultProvider

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
        const content = e.message?.content
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

          const parts = content
            .filter((c: any) => c.type === 'text' || c.type === 'tool_use' || c.type === 'thinking')
            .map((c: any) => {
              if (c.type === 'text') return { type: 'text' as const, text: c.text }
              if (c.type === 'thinking') return { type: 'thinking' as const, thinking: c.thinking }
              if (c.type === 'tool_use') return { type: 'tool_use' as const, id: c.id, name: c.name, input: c.input }
              return c
            })
          if (parts.length > 0) {
            messages.push({ role: 'assistant', content: parts })
          }
          // tool_result 必须放在紧跟 assistant 的 user 消息中
          if (toolResults.length > 0) {
            messages.push({ role: 'user', content: toolResults })
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
      const { messages, systemPrompt, mcpTools } = await this.prepareMessages(payload, sessionId)

      // 解析 provider 和 model
      const providerId = this.resolveProvider()
      const modelId = this.resolveModel(this.config.model, providerId)
      console.log('[AgentCore] send model:', this.config.model, '→', modelId, 'provider:', providerId)

      // 获取 client
      const { client, modelId: resolvedModelId, providerType } = await this.registry.getClientAndModel(providerId, modelId)

      // 构建工具
      const routeImagesRef: { fn: ((toolName: string | undefined, resultContent: string) => void) | null } = { fn: null }
      const { allToolDefs, allToolExecutors, orchestratorTools } = await this.buildTools(
        client, resolvedModelId, providerType, mcpTools, channel, pendingToolCalls,
        (toolName, content) => { routeImagesRef.fn?.(toolName, content) }
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

      // 运行 Agent 循环
      const result = await this.runAgentLoop(
        client, resolvedModelId, providerType, messages, systemPrompt,
        allToolDefs, allToolExecutors, ctx, channel, pendingToolCalls, pendingApprovals, routeImages
      )

      // 处理结果
      await this.handleResult(result, sessionId, payload, channel, ctx)
    } catch (err: unknown) {
      if (ctx.abort.signal.aborted) {
        channel.sendDone(sessionId, 0, 0)
        if (isElectronChannel(channel)) channel.sendPetState('idle')
        return
      }
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[AgentCore] sendMessage error:', errorMsg)
      channel.sendError(errorMsg)
      if (isElectronChannel(channel)) channel.sendPetState('error')
    } finally {
      // 清理会话上下文（如果不再需要）
      // 注意：不删除上下文，因为可能还有后续消息
    }
  }

  /**
   * 准备消息和系统提示
   */
  private async prepareMessages(payload: SendMessagePayload, sessionId: string) {
    // 获取 MCP 工具
    let mcpTools: Record<string, any> = {}
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

    // 构建系统提示
    let systemPrompt = ''
    const nerveClaudeMd = join(homedir(), '.nerve', 'CLAUDE.md')
    if (existsSync(nerveClaudeMd)) {
      systemPrompt = readFileSync(nerveClaudeMd, 'utf-8')
    }

    if (payload.prompt.startsWith('[语音指令]')) {
      systemPrompt += '\n\n## Voice Command Mode\nThe user is speaking via voice input. The message is prefixed with [语音指令]. Treat this as a direct command to execute — do NOT explain what you would do. Just do it. If the request is clear, execute it immediately. If ambiguous, ask a brief clarifying question.'
    }

    // Memory recall via TencentDB (500ms timeout to avoid blocking user input)
    if (this.memoryCore) {
      try {
        const recall = await Promise.race([
          this.memoryCore.handleBeforeRecall(payload.prompt, sessionId),
          new Promise<{ prependContext?: string; appendSystemContext?: string }>((r) =>
            setTimeout(() => r({}), 500),
          ),
        ])
        if (recall.appendSystemContext) systemPrompt += '\n\n' + recall.appendSystemContext
        if (recall.prependContext) messages.push({ role: 'user', content: recall.prependContext })
      } catch (err) {
        console.warn('[Nerve] memory recall failed:', err)
      }
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

    // 注入 Skills
    const skills = (await getSkills(this.sourceDir)).filter((s) => s.enabled)
    if (skills.length > 0) {
      const skillsDir = join(this.sourceDir, '.agents', 'skills')
      for (const skill of skills) {
        const skillDir = join(skillsDir, skill.id)
        const resolvedPrompt = skill.prompt
          .replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
          .replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId)
        systemPrompt += `\n\n---\n\n# Skill: ${skill.name}\n\nBase directory for this skill: ${skillDir}\n\n${resolvedPrompt}`
      }
    }

    return { messages, systemPrompt, mcpTools }
  }

  /**
   * 解析 provider
   */
  private resolveProvider(): string {
    return this.config.provider
      || (this.config.model.startsWith('gpt') || this.config.model.startsWith('o1') || this.config.model.startsWith('o3') || this.config.model.startsWith('o4')
        ? 'openai'
        : this.config.model.startsWith('gemini')
          ? 'google'
          : this.settings.defaultProvider || 'anthropic')
  }

  /**
   * 构建工具定义和执行器
   */
  private async buildTools(
    client: any,
    modelId: string,
    providerType: string,
    mcpTools: Record<string, any>,
    channel: OutputChannel,
    pendingToolCalls: Map<string, { name: string; input: any }>,
    routeImages?: (toolName: string | undefined, resultContent: string) => void
  ) {
    const allToolCalls: Array<{ id: string; name: string; input: unknown }> = []
    const allToolResults: Array<{ toolCallId: string; content: string; is_error?: boolean }> = []

    const orchestratorTools = getOrchestratorTools({
      client,
      modelId,
      providerType,
      projectDir: this.projectDir,
      mcpTools,
      effort: this.config.effort,
      createClient: async () => {
        const fresh = this.registry.createFreshClient(this.resolveProvider())
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

    // Build tools
    const builtinTools = getBuiltinTools(this.projectDir, {
      refresh: () => {
        if (isElectronChannel(channel)) channel.sendGitRefresh()
      },
    }, this.sourceDir)

    const allToolDefs = [
      ...Object.entries(builtinTools).map(([name, tool]) => ({
        name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
      ...Object.entries(mcpTools).map(([name, tool]) => ({
        name,
        description: (tool as any).description || '',
        input_schema: (tool as any).input_schema || (tool as any).parameters || {},
      })),
      ...Object.entries(orchestratorTools).map(([name, tool]) => ({
        name,
        description: (tool as any).description || '',
        input_schema: (tool as any).input_schema || {},
      })),
    ]

    const allToolExecutors = new Map<string, (args: any) => Promise<any>>()
    for (const [name, tool] of Object.entries(builtinTools)) {
      allToolExecutors.set(name, tool.execute)
    }
    for (const [name, tool] of Object.entries(orchestratorTools)) {
      allToolExecutors.set(name, (tool as any).execute)
    }
    for (const [name, executor] of this.mcpPool.getAllToolExecutors()) {
      allToolExecutors.set(name, executor)
    }

    return { allToolDefs, allToolExecutors, orchestratorTools, allToolCalls, allToolResults }
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
    routeImages: (toolName: string | undefined, resultContent: string) => void
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
      onToolApproval: this.config.permissionMode === 'bypassPermissions'
        ? undefined
        : async (id, name, input) => {
            if (!this.needsApproval(name)) return true
            const approvalId = `approve-${id}`
            if (isElectronChannel(channel)) {
              channel.sendToolApprovalRequest(approvalId, name, input)
            }
            return new Promise<boolean>((resolve) => {
              pendingApprovals.set(approvalId, { resolve })
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
    })

    return {
      usage: result.usage,
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
    result: { usage: { inputTokens: number; outputTokens: number }; textDeltas: string[]; fullThinkingParts: string[]; allToolCalls: Array<{ id: string; name: string; input: unknown }>; allToolResults: Array<{ toolCallId: string; content: string; is_error?: boolean }> },
    sessionId: string,
    payload: SendMessagePayload,
    channel: OutputChannel,
    ctx: SessionContext
  ) {
    const store = await this.ensureSessionStore()
    const { usage, textDeltas, fullThinkingParts, allToolCalls, allToolResults } = result

    const content: Array<Record<string, unknown>> = []
    const fullThinking = fullThinkingParts.join('')
    if (fullThinking) content.push({ type: 'thinking', thinking: fullThinking })
    let fullText = textDeltas.join('')

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
    for (const tc of allToolCalls) {
      content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
    }
    for (const tr of allToolResults) {
      content.push({ type: 'tool_result', tool_use_id: tr.toolCallId, content: tr.content, is_error: tr.is_error })
    }

    await store.append({ sessionId }, [{
      type: 'assistant',
      message: { content },
      timestamp: new Date().toISOString(),
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    }])
    await store.append({ sessionId }, [{ type: 'tag', tag: 'gui' }])

    // Memory capture
    if (fullText && this.memoryCore) {
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

    const pricing = COST_PER_TOKEN[this.resolveModel(this.config.model)] || { input: 0.003, output: 0.015 }
    const cost = ((usage.inputTokens) * pricing.input + (usage.outputTokens) * pricing.output) / 1000
    const maxContextTokens = CONTEXT_WINDOWS[this.resolveModel(this.config.model)] || 200000

    channel.sendDone(sessionId, cost, maxContextTokens)
    if (isElectronChannel(channel)) channel.sendPetState('happy')
  }

  /**
   * 取消所有会话
   */
  cancel() {
    for (const sessionId of this.sessionContextManager.getSessionIds()) {
      this.cancelSession(sessionId)
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
  getSessionContextManager(): SessionContextManager {
    return this.sessionContextManager
  }

  // Tool risk classification
  private static READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep'])
  private static WRITE_TOOLS = new Set(['Write', 'Edit', 'GitStageAll', 'GitCommit', 'GitPull', 'GitInit'])

  private needsApproval(toolName: string): boolean {
    const mode = this.config.permissionMode
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

  setModel(model: string) { this.config.model = model }
  setProvider(providerId: string) { this.config.provider = providerId }
  setEffort(effort: ClaudeConfig['effort']) { this.config.effort = effort }
  setPermissionMode(mode: ClaudeConfig['permissionMode']) { this.config.permissionMode = mode }

  async setCwd(cwd: string) {
    this.config.cwd = cwd
    this.projectDir = cwd
    this.sessionStore = await FileSessionStore.create(join(cwd, '.nerve', 'sessions'))
    const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
    try {
      const existing = existsSync(nerveSettingsPath) ? JSON.parse(readFileSync(nerveSettingsPath, 'utf-8')) : {}
      existing.cwd = cwd
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
        return
      }
    }

    if (toolName === 'GenerateImage' && !resultText.startsWith('{')) return
    try {
      const parsed = JSON.parse(resultText)
      if (parsed.path && parsed.filename && /\.(png|jpg|jpeg|gif|webp)$/i.test(parsed.filename)) {
        channel.sendFlowItem('image', `file://${parsed.path}`, {
          label: parsed.prompt || parsed.source || parsed.filename,
        })
      }
    } catch {}
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

  async getSessionUsage(sessionId: string) {
    const store = await this.ensureSessionStore()
    const entries = await store.load({ sessionId })
    let inputTokens = 0
    let outputTokens = 0
    let compactionCount = 0

    if (entries) {
      for (const e of entries as any[]) {
        if (e.type === 'assistant' && e.usage) {
          inputTokens += e.usage.inputTokens || 0
          outputTokens += e.usage.outputTokens || 0
        }
        if (e.type === 'summary') {
          compactionCount++
        }
      }
    }

    const modelId = this.resolveModel(this.config.model)

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      compactionCount,
      maxContextTokens: CONTEXT_WINDOWS[modelId] || 200000,
    }
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
    await this.mcpPool.close()
  }
}
