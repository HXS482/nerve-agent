import { BrowserWindow } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { IPC_CHANNELS, ClaudeConfig, SendMessagePayload, PetState, SessionUsage, ProviderInfo, ContentBlock, FileAttachment } from '../shared/types'

function buildUserContentBlocks(payload: SendMessagePayload): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const file of payload.files!) {
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
  blocks.push({ type: 'text', text: payload.prompt })
  return blocks
}
import { FileSessionStore } from './session-store'
import { loadSettings, NERVE_DIR, ClaudeSettings } from './settings'
import { getBuiltinTools } from './tools'
import { getSkills } from './skills'
import { ProviderRegistry } from './provider-registry'
import { McpPool } from './mcp-pool'
import { getOrchestratorTools } from './orchestrator'
import { runAgenticLoop } from './agentic-loop'
import { MemoryTdaiCore } from './memory-tdai'
import { OffloadBridge } from './offload-bridge'

export { testConnection, fetchModels } from './provider'
export { transcribeAudio } from './stt'
export { getSkills, toggleSkill } from './skills'

const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'o1': 200000,
  'o3': 200000,
  'gemini-2.5-pro': 1000000,
  'gemini-2.5-flash': 1000000,
}

export class ClaudeService {
  private config: ClaudeConfig = {
    model: 'sonnet',
    effort: 'medium',
    cwd: process.cwd(),
    permissionMode: 'bypassPermissions',
  }

  private currentAbort: AbortController | null = null
  private window: BrowserWindow
  private petWindow: BrowserWindow | null = null
  private sessionStore: FileSessionStore | null = null
  private projectDir: string
  private sourceDir: string
  private settings: ClaudeSettings
  private registry: ProviderRegistry
  private mcpPool: McpPool
  private pendingToolCalls = new Map<string, { name: string; input: any }>()
  private flowContentHashes = new Set<string>()
  private memoryCore: MemoryTdaiCore | null = null
  private offloadBridge: OffloadBridge | null = null

  constructor(window: BrowserWindow, projectDir: string) {
    this.window = window
    this.settings = loadSettings()
    this.sourceDir = projectDir
    this.projectDir = this.settings.cwd || projectDir

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

  setPetWindow(petWin: BrowserWindow) {
    this.petWindow = petWin
  }

  setMemoryCore(core: MemoryTdaiCore) {
    this.memoryCore = core
  }

  setOffloadBridge(bridge: OffloadBridge) {
    this.offloadBridge = bridge
  }

  private send(channel: string, data: unknown) {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(channel, data)
    }
  }

  private sendPetState(state: PetState) {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.webContents.send(IPC_CHANNELS.PET_STATE_CHANGE, state)
    }
  }

  private resolveModel(modelAlias: string): string {
    if (this.settings.modelAliases[modelAlias]) {
      return this.settings.modelAliases[modelAlias]
    }
    const aliasMap: Record<string, string> = {
      'sonnet': 'claude-sonnet-4-20250514',
      'opus': 'claude-opus-4-20250514',
      'haiku': 'claude-haiku-4-5-20251001',
    }
    const resolved = aliasMap[modelAlias] || modelAlias
    // If resolved to a standard Claude name but the proxy uses a different model,
    // fall back to ANTHROPIC_MODEL from settings (e.g. mimo-v2.5-pro)
    if (resolved.startsWith('claude-') && this.settings.defaultModel) {
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
          // Keep text + tool_use + thinking blocks for multi-turn context.
          // Drop tool_result (must follow tool_use exactly, hard to reconstruct).
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
        }
      }
    }

    return messages
  }

  async sendMessage(payload: SendMessagePayload) {
    this.cancel()
    this.send(IPC_CHANNELS.STREAM_CLEAR, {})
    const abort = new AbortController()
    this.currentAbort = abort
    this.sendPetState('jumping')

    const sessionId = payload.sessionId || randomUUID()

    try {
      let mcpTools: Record<string, any> = {}
      try {
        mcpTools = await this.mcpPool.ensureConnected()
      } catch (mcpErr) {
        console.warn('[ClaudeService] MCP connection failed, continuing without MCP tools:', mcpErr)
      }

      const history = payload.sessionId
        ? await this.loadConversationHistory(payload.sessionId)
        : []

      const store = await this.ensureSessionStore()

      const userContent = (payload.files && payload.files.length > 0)
        ? buildUserContentBlocks(payload)
        : payload.prompt
      await store.append({ sessionId }, [
        { type: 'user', message: { content: userContent }, timestamp: new Date().toISOString() },
      ])

      const messages = [...history]

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
      if (payload.files && payload.files.length > 0) {
        console.log('[Nerve] sendMessage with', payload.files.length, 'file(s):', payload.files.map(f => `${f.name}(${f.mimeType},${f.size}bytes,isImage:${f.isImage})`).join(', '))
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
        console.log('[Nerve] user content blocks:', contentBlocks.map(b => b.type).join(', '))
        messages.push({ role: 'user', content: contentBlocks })
      } else {
        messages.push({ role: 'user', content: payload.prompt })
      }

      const modelId = this.resolveModel(this.config.model)
      console.log('[Nerve] send model:', this.config.model, '→', modelId, 'provider:', this.config.provider || '(auto)')

      // Resolve provider: explicit selection > prefix detection > defaultProvider > anthropic
      const providerId = this.config.provider
        || (this.config.model.startsWith('gpt') || this.config.model.startsWith('o1') || this.config.model.startsWith('o3') || this.config.model.startsWith('o4')
          ? 'openai'
          : this.config.model.startsWith('gemini')
            ? 'google'
            : this.settings.defaultProvider || 'anthropic')

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

      const { client, modelId: resolvedModelId, providerType } = await this.registry.getClientAndModel(providerId, modelId)

      const textDeltas: string[] = []
      const fullThinkingParts: string[] = []
      const allToolCalls: Array<{ id: string; name: string; input: unknown }> = []
      const allToolResults: Array<{ toolCallId: string; content: string; is_error?: boolean }> = []

      const orchestratorTools = getOrchestratorTools({
        client,
        modelId: resolvedModelId,
        providerType,
        projectDir: this.projectDir,
        mcpTools,
        effort: this.config.effort,
        createClient: async () => {
          const fresh = this.registry.createFreshClient(providerId)
          return { client: fresh.client }
        },
        onToolCall: (id, name, input) => {
          allToolCalls.push({ id, name, input })
          this.pendingToolCalls.set(id, { name, input })
          this.send(IPC_CHANNELS.MESSAGE, {
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id, name, input }] },
          })
        },
        onToolResult: (id, content, isError) => {
          allToolResults.push({ toolCallId: id, content: content.slice(0, 50000), is_error: isError })
          const toolInfo = this.pendingToolCalls.get(id)
          if (toolInfo) {
            this.emitFlowItem(toolInfo.name, toolInfo.input, content)
            this.pendingToolCalls.delete(id)
          }
          this.send(IPC_CHANNELS.MESSAGE, {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_result', toolCallId: id, content: content.slice(0, 50000), is_error: isError }],
            },
          })
        },
      })

      // Build tools in native format
      const builtinTools = getBuiltinTools(this.projectDir, {
        refresh: () => {
          if (!this.window.isDestroyed()) {
            this.window.webContents.send(IPC_CHANNELS.GIT_REFRESH)
          }
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

      const allUsage = { inputTokens: 0, outputTokens: 0 }
      let streamError: Error | null = null

      try {
        const result = await runAgenticLoop({
          client,
          modelId: resolvedModelId,
          providerType,
          messages,
          system: systemPrompt || undefined,
          tools: allToolDefs,
          toolExecutors: allToolExecutors,
          maxSteps: 50,
          abortSignal: abort.signal,
          onTextDelta: (text) => {
            textDeltas.push(text)
            this.send(IPC_CHANNELS.MESSAGE, {
              type: 'stream_event',
              event: { delta: { text } },
            })
            this.sendPetState('working')
          },
          onThinkingDelta: (thinking) => {
            fullThinkingParts.push(thinking)
            this.send(IPC_CHANNELS.MESSAGE, {
              type: 'stream_event',
              event: { delta: { thinking } },
            })
          },
          onToolCall: (id, name, input) => {
            allToolCalls.push({ id, name, input })
            this.pendingToolCalls.set(id, { name, input })
            this.send(IPC_CHANNELS.MESSAGE, {
              type: 'assistant',
              message: {
                content: [{ type: 'tool_use', id, name, input }],
              },
            })
            this.sendPetState('running-left')
          },
          onToolResult: (id, content, isError) => {
            allToolResults.push({ toolCallId: id, content: content.slice(0, 50000), is_error: isError })
            const toolInfo = this.pendingToolCalls.get(id)
            if (toolInfo) {
              this.emitFlowItem(toolInfo.name, toolInfo.input, content)
              this.pendingToolCalls.delete(id)
            }
            this.send(IPC_CHANNELS.MESSAGE, {
              type: 'assistant',
              message: {
                content: [{ type: 'tool_result', toolCallId: id, content: content.slice(0, 50000), is_error: isError }],
              },
            })
          },
          onBeforeStep: async (msgs) => {
            await this.offloadBridge?.onBeforeStep(msgs)
          },
          onAfterToolCall: (toolName, toolCallId, params, result) => {
            this.offloadBridge?.onAfterToolCall(toolName, toolCallId, params, result)
          },
        })

        allUsage.inputTokens = result.usage.inputTokens
        allUsage.outputTokens = result.usage.outputTokens
      } catch (streamErr: unknown) {
        streamError = streamErr instanceof Error ? streamErr : new Error(String(streamErr))
        console.error('[ClaudeService] stream interrupted:', streamError.message)
      }

      // If stream was interrupted but we have partial content, save it and send DONE
      if (streamError && !abort.signal.aborted) {
        const hasContent = textDeltas.length > 0 || allToolCalls.length > 0
        if (hasContent) {
          const content: Array<Record<string, unknown>> = []
          const fullThinking = fullThinkingParts.join('')
          if (fullThinking) content.push({ type: 'thinking', thinking: fullThinking })
          const fullText = textDeltas.join('')
          if (fullText) content.push({ type: 'text', text: fullText })
          for (const tc of allToolCalls) {
            content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
          }
          for (const tr of allToolResults) {
            content.push({ type: 'tool_result', toolCallId: tr.toolCallId, content: tr.content, is_error: tr.is_error })
          }

          await store.append({ sessionId }, [{
            type: 'assistant',
            message: { content },
            timestamp: new Date().toISOString(),
            usage: { inputTokens: allUsage.inputTokens, outputTokens: allUsage.outputTokens },
          }])
          await store.append({ sessionId }, [{ type: 'tag', tag: 'gui' }])

          const costPerToken: Record<string, { input: number; output: number }> = {
            'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
            'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
            'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
            'gpt-4o': { input: 0.005, output: 0.015 },
            'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
            'gemini-2.5-pro': { input: 0.00125, output: 0.01 },
            'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
          }
          const pricing = costPerToken[modelId] || { input: 0.003, output: 0.015 }
          const cost = ((allUsage.inputTokens) * pricing.input + (allUsage.outputTokens) * pricing.output) / 1000
          const maxContextTokens = CONTEXT_WINDOWS[modelId] || 200000

          this.send(IPC_CHANNELS.DONE, { sessionId, cost, maxContextTokens })
          this.sendPetState('happy')

          // Memory capture even on partial response
          const fullTextForExtraction = textDeltas.join('')
          if (fullTextForExtraction && this.memoryCore) {
            this.memoryCore.handleTurnCommitted({
              userText: payload.prompt,
              assistantText: fullTextForExtraction,
              messages: [
                { role: 'user', content: payload.prompt },
                { role: 'assistant', content: fullTextForExtraction },
              ],
              sessionKey: sessionId,
              sessionId,
            }).catch((err) => console.error('[TDAI] capture failed:', err))
          }
          return
        }
        // No content at all — re-throw as normal error
        throw streamError
      }

      // Path A fix: if stream errored AND was aborted, throw so outer catch sends DONE
      if (streamError && abort.signal.aborted) {
        throw streamError
      }

      if (!abort.signal.aborted) {
        const content: Array<Record<string, unknown>> = []
        const fullThinking = fullThinkingParts.join('')
        if (fullThinking) content.push({ type: 'thinking', thinking: fullThinking })
        let fullText = textDeltas.join('')
        // If model only called tools without text, generate a brief summary
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
          content.push({ type: 'tool_result', toolCallId: tr.toolCallId, content: tr.content, is_error: tr.is_error })
        }

        await store.append({ sessionId }, [
          {
            type: 'assistant',
            message: { content },
            timestamp: new Date().toISOString(),
            usage: {
              inputTokens: allUsage.inputTokens,
              outputTokens: allUsage.outputTokens,
            },
          },
        ])

        await store.append({ sessionId }, [{ type: 'tag', tag: 'gui' }])

        // Memory capture via TencentDB (fire-and-forget)
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

        const costPerToken: Record<string, { input: number; output: number }> = {
          'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
          'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
          'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
          'gpt-4o': { input: 0.005, output: 0.015 },
          'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
          'gemini-2.5-pro': { input: 0.00125, output: 0.01 },
          'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
        }
        const pricing = costPerToken[modelId] || { input: 0.003, output: 0.015 }
        const cost = ((allUsage.inputTokens) * pricing.input + (allUsage.outputTokens) * pricing.output) / 1000

        const maxContextTokens = CONTEXT_WINDOWS[modelId] || 200000

        this.send(IPC_CHANNELS.DONE, { sessionId, cost, maxContextTokens })
        this.sendPetState('happy')
      }
    } catch (err: unknown) {
      if (abort.signal.aborted) {
        // Still send DONE so the renderer resets isLoading
        this.send(IPC_CHANNELS.DONE, { sessionId })
        this.sendPetState('idle')
        return
      }
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[ClaudeService] sendMessage error:', errorMsg)
      this.send(IPC_CHANNELS.ERROR, { message: errorMsg })
      this.sendPetState('error')
    } finally {
      if (this.currentAbort === abort) this.currentAbort = null
    }
  }

  cancel() {
    if (this.currentAbort) {
      this.currentAbort.abort()
      this.pendingToolCalls.clear()
      this.sendPetState('idle')
    }
  }

  setModel(model: string) {
    this.config.model = model
  }

  setProvider(providerId: string) {
    this.config.provider = providerId
  }

  setEffort(effort: ClaudeConfig['effort']) {
    this.config.effort = effort
  }

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

  setPermissionMode(mode: ClaudeConfig['permissionMode']) {
    this.config.permissionMode = mode
  }

  setWindow(window: BrowserWindow) {
    this.window = window
  }

  setPetSkin(id: string) {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.webContents.send(IPC_CHANNELS.PET_SKIN_CHANGED, id)
    }
  }

  pushFlowItem(type: string, content: string, meta?: Record<string, any>) {
    this.send(IPC_CHANNELS.FLOW_ITEM, { type, content, meta })
  }

  private emitFlowItem(toolName: string, input: any, resultText: string) {
    // Write/Bash writing .html files → push HTML to Flow (skip duplicates)
    if ((toolName === 'Write' || toolName === 'Bash') && input) {
      const filePath = input.file_path || input.path || ''
      if (/\.html?$/i.test(filePath) && input.content) {
        // Dedup: skip if identical content already pushed
        const hash = input.content.length + ':' + input.content.slice(0, 200)
        if (!this.flowContentHashes.has(hash)) {
          this.flowContentHashes.add(hash)
          // Parse actual saved path from tool result
          let savedPath = filePath
          try { savedPath = JSON.parse(resultText).file_path || filePath } catch {}
          this.pushFlowItem('html', input.content, {
            label: filePath.split(/[/\\]/).pop(),
            savedPath,
          })
        }
        return
      }
    }

    // Image generation results → push image to Flow
    if (toolName === 'GenerateImage' && !resultText.startsWith('{')) return
    try {
      const parsed = JSON.parse(resultText)
      if (parsed.path && parsed.filename && /\.(png|jpg|jpeg|gif|webp)$/i.test(parsed.filename)) {
        this.pushFlowItem('image', `file://${parsed.path}`, {
          label: parsed.prompt || parsed.source || parsed.filename,
        })
      }
    } catch {}
  }

  getConfig(): ClaudeConfig {
    return { ...this.config }
  }

  getSettings(): ClaudeSettings {
    return { ...this.settings }
  }

  getSourceDir(): string {
    return this.sourceDir
  }

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

  async getSessionUsage(sessionId: string): Promise<SessionUsage> {
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

  getProviders(): ProviderInfo[] {
    return this.registry.listProviders()
  }

  async close() {
    if (this.memoryCore) {
      await this.memoryCore.destroy().catch((err) => console.error('[TDAI] destroy failed:', err))
    }
    await this.mcpPool.close()
  }
}
