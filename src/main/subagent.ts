import { getBuiltinTools } from './tools'
import { runAgenticLoop } from './agentic-loop'

export interface SubagentResult {
  text: string
  toolCalls: Array<{ name: string; input: unknown; output?: unknown }>
  usage?: { inputTokens: number; outputTokens: number }
  truncated?: boolean
}

export interface SubagentConfig {
  client: any
  modelId: string
  providerType: 'anthropic' | 'openai'
  systemPrompt: string
  projectDir: string
  mcpTools?: Record<string, unknown>
  effort?: string
  maxSteps?: number
  maxTokens?: number
  abortSignal?: AbortSignal
  onToolCall?: (id: string, name: string, input: unknown) => void
  onToolResult?: (id: string, content: string, isError?: boolean) => void
}

export function formatToolOutput(output: unknown, maxLen = 2000): string {
  if (output == null) return ''
  const s = typeof output === 'string' ? output : JSON.stringify(output)
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
}

const MAX_CHAIN_CONTEXT = 12000

const SUBAGENT_STREAM_TIMEOUT_MS = 120_000

export async function runSubagent(
  task: string,
  config: SubagentConfig,
  steering?: string,
): Promise<SubagentResult> {
  const systemPrompt = [config.systemPrompt, steering].filter(Boolean).join('\n\n')

  // Build tools in native format
  const builtinTools = getBuiltinTools(config.projectDir)
  const toolDefs = Object.entries(builtinTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    input_schema: tool.input_schema,
  }))
  const toolExecutors = new Map<string, (args: any) => Promise<any>>()
  for (const [name, tool] of Object.entries(builtinTools)) {
    toolExecutors.set(name, tool.execute)
  }

  // Add MCP tools if provided
  if (config.mcpTools) {
    for (const [name, tool] of Object.entries(config.mcpTools)) {
      const t = tool as any
      toolDefs.push({
        name,
        description: t.description || '',
        input_schema: t.parameters || t.input_schema || {},
      })
    }
  }

  // Messages array — runAgenticLoop mutates it in place
  const messages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: task },
  ]

  // Combine parent abort signal with timeout
  const localAbort = new AbortController()
  const timeout = setTimeout(() => localAbort.abort(), SUBAGENT_STREAM_TIMEOUT_MS)
  if (config.abortSignal) {
    if (config.abortSignal.aborted) localAbort.abort()
    else config.abortSignal.addEventListener('abort', () => localAbort.abort(), { once: true })
  }

  try {
    const result = await runAgenticLoop({
      client: config.client,
      modelId: config.modelId,
      providerType: config.providerType,
      messages,
      system: systemPrompt || undefined,
      tools: toolDefs,
      toolExecutors,
      maxSteps: config.maxSteps ?? 20,
      maxTokens: config.maxTokens,
      abortSignal: localAbort.signal,
      onToolCall: config.onToolCall,
      onToolResult: config.onToolResult,
    })

    // Extract text and tool calls from accumulated messages
    const textParts: string[] = []
    const toolCalls: SubagentResult['toolCalls'] = []

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue
      const content = msg.content

      if (config.providerType === 'openai') {
        if (typeof content === 'string') {
          textParts.push(content)
        }
      } else {
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') textParts.push(block.text)
            if (block.type === 'tool_use') {
              toolCalls.push({ name: block.name, input: block.input })
            }
          }
        }
      }
    }

    if (config.providerType === 'openai') {
      for (const msg of messages) {
        if (msg.role === 'assistant' && Array.isArray((msg as any).tool_calls)) {
          for (const tc of (msg as any).tool_calls) {
            let input: any
            try { input = JSON.parse(tc.function.arguments) } catch { input = {} }
            toolCalls.push({ name: tc.function.name, input })
          }
        }
      }
    }

    for (const msg of messages) {
      if (config.providerType === 'anthropic' && msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            const tc = toolCalls.find(t => !t.output && (block as any).tool_use_id)
            if (tc) tc.output = (block as any).content
          }
        }
      }
    }

    const truncated = result.stopReason === 'max_tokens'
    if (truncated) {
      console.warn('[Subagent] output truncated (max_tokens reached)')
    }

    return {
      text: textParts.join(''),
      toolCalls,
      usage: result.usage,
      truncated,
    }
  } catch (err: any) {
    return {
      text: `[Subagent error: ${err.message}]`,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function runParallelSubagents(
  tasks: string[] | string,
  config: SubagentConfig,
  steering?: string,
): Promise<SubagentResult[]> {
  const taskArray = Array.isArray(tasks) ? tasks : [tasks]
  return Promise.all(taskArray.map((task) => runSubagent(task, config, steering)))
}

export async function runChainSubagents(
  steps: Array<{ task: string }> | { task: string },
  config: SubagentConfig,
  steering?: string,
): Promise<SubagentResult[]> {
  const stepArray = Array.isArray(steps) ? steps : [steps]
  const results: SubagentResult[] = []
  let context = ''

  for (const step of stepArray) {
    const taskWithContext = context
      ? `${step.task}\n\n[Previous step result]\n${context}`
      : step.task

    const result = await runSubagent(taskWithContext, config, steering)
    results.push(result)

    // Stop chain on error — don't propagate garbage context
    if (result.text.startsWith('[Subagent error:')) {
      console.error('[Chain] step failed, aborting chain:', result.text)
      break
    }

    // Build rich context: text + tool outputs, capped
    const toolSummary = result.toolCalls
      .filter(tc => tc.output != null)
      .map(tc => `[${tc.name}] ${formatToolOutput(tc.output)}`)
      .join('\n')

    const newContext = result.text + (toolSummary ? `\n\n[Tool outputs]\n${toolSummary}` : '')
    context = newContext.length > MAX_CHAIN_CONTEXT
      ? newContext.slice(newContext.length - MAX_CHAIN_CONTEXT)
      : newContext
  }

  return results
}
