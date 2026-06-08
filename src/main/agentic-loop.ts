import Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface AgenticLoopParams {
  client: Anthropic | OpenAI
  modelId: string
  providerType: 'anthropic' | 'openai'
  messages: Array<{ role: string; content: unknown }>
  system?: string
  tools: ToolDefinition[]
  toolExecutors: Map<string, (args: any) => Promise<any>>
  maxSteps?: number
  maxTokens?: number
  abortSignal?: AbortSignal
  onTextDelta?: (text: string) => void
  onThinkingDelta?: (thinking: string) => void
  onToolCall?: (id: string, name: string, input: unknown) => void
  onToolResult?: (id: string, content: string, isError?: boolean) => void
  onToolApproval?: (id: string, name: string, input: Record<string, unknown>) => Promise<boolean>
  onBeforeStep?: (messages: Array<{ role: string; content: unknown }>) => Promise<void>
  onAfterToolCall?: (toolName: string, toolCallId: string, params: unknown, result: unknown) => void
  hookRegistry?: import('./hook-registry').HookRegistry
  sessionId?: string
}

export interface AgenticLoopResult {
  stopReason: 'end_turn' | 'tool_use' | 'max_steps'
  usage: { inputTokens: number; outputTokens: number }
}

/**
 * Run the agentic tool-use loop.
 * @param params.messages — mutable; the array is modified in-place (assistant/tool messages appended).
 */
export async function runAgenticLoop(params: AgenticLoopParams): Promise<AgenticLoopResult> {
  if (params.providerType === 'openai') {
    return runOpenAILoop(params)
  }
  return runAnthropicLoop(params)
}

const API_TIMEOUT_MS = 180_000 // 3 min per API call
const TOOL_TIMEOUT_MS = 120_000 // 2 min per tool execution
const MAX_RETRIES = 2

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms)
    promise.then(
      val => { clearTimeout(timer); resolve(val) },
      err => { clearTimeout(timer); reject(err) },
    )
  })
}

// --- Anthropic streaming + non-streaming fallback ---

async function runAnthropicLoop(params: AgenticLoopParams): Promise<AgenticLoopResult> {
  const { client, modelId, messages, system, tools, toolExecutors, abortSignal, onTextDelta, onThinkingDelta, onToolCall, onToolResult, onToolApproval, onBeforeStep, onAfterToolCall } = params
  const maxSteps = params.maxSteps ?? 50
  const anthropic = client as Anthropic

  let totalInput = 0
  let totalOutput = 0

  for (let step = 0; step < maxSteps; step++) {
    if (abortSignal?.aborted) break

    // Offload: compress old messages before LLM call
    await onBeforeStep?.(messages)

    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }))

    console.log('[AgenticLoop] step', step, 'model:', modelId, 'msgs:', messages.length, 'tools:', anthropicTools.length)

    // Keep thinking blocks — MiMo requires reasoning_content to be passed back.
    // Convert SDK's 'thinking' field back to MiMo's 'reasoning_content' field.
    const apiMessages = messages.map((msg: any) => {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map((b: any) => {
            if (b.type === 'thinking' && b.thinking) {
              return { type: 'thinking', thinking: b.thinking, reasoning_content: b.thinking }
            }
            return b
          }),
        }
      }
      return msg
    })

    const apiParams = {
      model: modelId,
      max_tokens: params.maxTokens ?? 16384,
      system: system || undefined,
      messages: apiMessages as any,
      tools: anthropicTools as any,
    }

    // Try streaming first — fall back to non-streaming if proxy doesn't support it
    const result = await callWithRetry(anthropic, apiParams, abortSignal, {
      onTextDelta,
      onThinkingDelta,
    })

    totalInput += result.usage.inputTokens
    totalOutput += result.usage.outputTokens

    // Append assistant message to history
    if (result.content.length > 0) {
      messages.push({ role: 'assistant', content: result.content })
    }

    // If not tool_use, we're done
    if (result.stopReason !== 'tool_use') {
      return {
        stopReason: result.stopReason,
        usage: { inputTokens: totalInput, outputTokens: totalOutput },
      }
    }

    // Execute tool calls with timeout
    const toolUseBlocks = result.content.filter((b: any) => b.type === 'tool_use')
    const toolResults: any[] = []

    for (const block of toolUseBlocks) {
      if (abortSignal?.aborted) break

      onToolCall?.(block.id, block.name, block.input)

      // onToolCall hook — plugins can intercept
      if (params.hookRegistry && params.sessionId) {
        const hookResult = await params.hookRegistry.execute('onToolCall', {
          toolCall: { id: block.id, name: block.name, input: block.input },
        }, params.sessionId)
        if (hookResult.handled) {
          const hookContent = typeof hookResult.modified?.toolCall?.result === 'string'
            ? hookResult.modified.toolCall.result
            : 'intercepted by hook'
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: hookContent })
          onToolResult?.(block.id, hookContent, false)
          continue
        }
      }

      // Approval gate — ask user before executing (if onToolApproval is set)
      if (onToolApproval) {
        const approved = await onToolApproval(block.id, block.name, block.input)
        if (!approved) {
          const denyContent = `Tool "${block.name}" was denied by user`
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: denyContent, is_error: true })
          onToolResult?.(block.id, denyContent, true)
          continue
        }
      }

      if ((block as any)._jsonParseError) {
        const errorContent = `Tool "${block.name}" received malformed arguments from model (JSON parse failed)`
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: errorContent, is_error: true })
        onToolResult?.(block.id, errorContent, true)
        continue
      }

      const executor = toolExecutors.get(block.name)

      if (!executor) {
        const errorContent = `Tool "${block.name}" not found`
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: errorContent, is_error: true })
        onToolResult?.(block.id, errorContent, true)
        continue
      }

      try {
        const result = await withTimeout(
          executor(block.input),
          TOOL_TIMEOUT_MS,
          `tool:${block.name}`,
        )
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
        const isToolError = typeof result === 'object' && result !== null && 'error' in result

        // onToolComplete hook — plugins can modify result
        let finalResultStr = resultStr
        if (params.hookRegistry && params.sessionId) {
          const hookResult = await params.hookRegistry.execute('onToolComplete', {
            toolCall: { id: block.id, name: block.name, input: block.input, result: resultStr, isError: isToolError },
          }, params.sessionId)
          if (hookResult.modified?.toolCall?.result !== undefined) {
            finalResultStr = hookResult.modified.toolCall.result
          }
        }

        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: finalResultStr.slice(0, 50000), ...(isToolError ? { is_error: true } : {}) })
        onToolResult?.(block.id, finalResultStr.slice(0, 50000), isToolError || undefined)
        onAfterToolCall?.(block.name, block.id, block.input, result)
      } catch (err: any) {
        const errMsg = err.message || 'Tool execution failed'
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: errMsg, is_error: true })
        onToolResult?.(block.id, errMsg, true)
      }
    }

    messages.push({ role: 'user', content: toolResults })
  }

  return {
    stopReason: 'max_steps',
    usage: { inputTokens: totalInput, outputTokens: totalOutput },
  }
}

interface CallResult {
  content: any[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage: { inputTokens: number; outputTokens: number }
}

interface StreamCallbacks {
  onTextDelta?: (text: string) => void
  onThinkingDelta?: (thinking: string) => void
}

async function callWithRetry(
  anthropic: Anthropic,
  apiParams: any,
  abortSignal: AbortSignal | undefined,
  callbacks: StreamCallbacks,
): Promise<CallResult> {
  let lastError: any

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (abortSignal?.aborted) {
      return { content: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
    }

    try {
      // Try streaming first
      return await callStreaming(anthropic, apiParams, abortSignal, callbacks)
    } catch (streamErr: any) {
      if (streamErr?.name === 'AbortError' || abortSignal?.aborted) {
        return { content: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
      }

      // If streaming fails (proxy doesn't support SSE), fall back to non-streaming
      const isStreamError = streamErr?.message?.includes('stream') ||
        streamErr?.message?.includes('SSE') ||
        streamErr?.type === 'stream' ||
        !streamErr?.status // network-level error, might affect both modes

      if (streamErr?.status && streamErr.status < 500 && streamErr.status !== 429) {
        // API validation error — don't retry, don't fall back
        throw streamErr
      }

      console.warn('[AgenticLoop] streaming failed, trying non-streaming:', streamErr.message)

      try {
        return await callNonStreaming(anthropic, apiParams, abortSignal, callbacks)
      } catch (nonStreamErr: any) {
        lastError = nonStreamErr

        if (nonStreamErr?.name === 'AbortError' || abortSignal?.aborted) {
          return { content: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
        }

        const isRetryable = !nonStreamErr?.status || nonStreamErr.status >= 500 || nonStreamErr.status === 429
        if (attempt < MAX_RETRIES && isRetryable) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000)
          console.warn(`[AgenticLoop] attempt ${attempt + 1} failed, retrying in ${delay}ms:`, nonStreamErr.message)
          await sleep(delay)
          continue
        }
        throw nonStreamErr
      }
    }
  }

  throw lastError
}

async function callStreaming(
  anthropic: Anthropic,
  apiParams: any,
  abortSignal: AbortSignal | undefined,
  callbacks: StreamCallbacks,
): Promise<CallResult> {
  const callAbort = new AbortController()
  const timeout = setTimeout(() => callAbort.abort(), API_TIMEOUT_MS)
  const onParentAbort = () => callAbort.abort()
  abortSignal?.addEventListener('abort', onParentAbort, { once: true })

  const content: any[] = []
  let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn'
  let inputTokens = 0
  let outputTokens = 0

  // Current block being accumulated
  let currentBlock: any = null
  let currentText = ''
  let currentThinking = ''
  let currentJsonInput = ''

  try {
    const stream = await anthropic.messages.create(
      { ...apiParams, stream: true },
      { signal: callAbort.signal },
    )

    let eventCount = 0
    const eventTypes: string[] = []
    for await (const event of stream) {
      if (callAbort.signal.aborted) break
      eventCount++
      eventTypes.push(event.type)

      // Log first 3, last 3, and any non-standard events
      if (eventCount <= 3 || event.type !== 'content_block_start' && event.type !== 'content_block_delta' && event.type !== 'content_block_stop' && event.type !== 'message_start' && event.type !== 'message_delta') {
        console.log('[Stream]', eventCount, event.type, JSON.stringify((event as any).delta || (event as any).content_block || (event as any).message || '').slice(0, 150))
      }

      if (event.type === 'content_block_start') {
        const block = event.content_block
        if (block.type === 'text') {
          currentBlock = { type: 'text', text: '' }
          currentText = ''
        } else if (block.type === 'thinking') {
          currentBlock = { type: 'thinking', thinking: '' }
          currentThinking = ''
        } else if (block.type === 'tool_use') {
          currentBlock = { type: 'tool_use', id: block.id, name: block.name, input: '' }
          currentJsonInput = ''
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          currentText += event.delta.text
          callbacks.onTextDelta?.(event.delta.text)
        } else if (event.delta.type === 'thinking_delta') {
          const t = (event.delta as any).thinking || (event.delta as any).reasoning_content || ''
          currentThinking += t
          callbacks.onThinkingDelta?.(t)
        } else if (event.delta.type === 'input_json_delta') {
          currentJsonInput += event.delta.partial_json
        }
      } else if (event.type === 'content_block_stop') {
        if (currentBlock) {
          if (currentBlock.type === 'text') {
            content.push({ type: 'text', text: currentText || currentBlock.text || '' })
          } else if (currentBlock.type === 'thinking') {
            const thinkingText = currentThinking || currentBlock.thinking || ''
            content.push({ type: 'thinking', thinking: thinkingText, reasoning_content: thinkingText })
          } else if (currentBlock.type === 'tool_use') {
            let parsedInput: any = {}
            let jsonOk = true
            try { parsedInput = currentJsonInput ? JSON.parse(currentJsonInput) : {} } catch { jsonOk = false; console.error(`[Stream] tool_use JSON parse failed: ${currentBlock.name}`, currentJsonInput.slice(0, 200)) }
            content.push({ type: 'tool_use', id: currentBlock.id, name: currentBlock.name, input: parsedInput, ...(jsonOk ? {} : { _jsonParseError: true }) })
          }
          currentBlock = null
        }
      } else if (event.type === 'message_delta') {
        stopReason = (event.delta.stop_reason as any) || 'end_turn'
        outputTokens += event.usage?.output_tokens ?? 0
      } else if (event.type === 'message_start') {
        inputTokens += event.message?.usage?.input_tokens ?? 0
      }
    }

    // MiMo proxy may not send content_block_stop — flush pending block on stream end
    if (currentBlock) {
      if (currentBlock.type === 'text') {
        content.push({ type: 'text', text: currentText || '' })
      } else if (currentBlock.type === 'thinking') {
        const t = currentThinking || ''
        content.push({ type: 'thinking', thinking: t, reasoning_content: t })
      } else if (currentBlock.type === 'tool_use') {
        let parsedInput: any = {}
        let jsonOk = true
        try { parsedInput = currentJsonInput ? JSON.parse(currentJsonInput) : {} } catch { jsonOk = false; console.error(`[Stream] tool_use JSON parse failed (flush): ${currentBlock.name}`, currentJsonInput.slice(0, 200)) }
        content.push({ type: 'tool_use', id: currentBlock.id, name: currentBlock.name, input: parsedInput, ...(jsonOk ? {} : { _jsonParseError: true }) })
      }
      currentBlock = null
    }
  } finally {
    clearTimeout(timeout)
    abortSignal?.removeEventListener('abort', onParentAbort)
  }

  return { content, stopReason, usage: { inputTokens, outputTokens } }
}

async function callNonStreaming(
  anthropic: Anthropic,
  apiParams: any,
  abortSignal: AbortSignal | undefined,
  callbacks: StreamCallbacks,
): Promise<CallResult> {
  const callAbort = new AbortController()
  const timeout = setTimeout(() => callAbort.abort(), API_TIMEOUT_MS)
  const onParentAbort = () => callAbort.abort()
  abortSignal?.addEventListener('abort', onParentAbort, { once: true })

  try {
    const response = await anthropic.messages.create(apiParams, { signal: callAbort.signal })

    const rawContent: any[] = response.content || []
    const stopReason = (response.stop_reason as any) || 'end_turn'
    const inputTokens = response.usage?.input_tokens ?? 0
    const outputTokens = response.usage?.output_tokens ?? 0

    // Add reasoning_content field for MiMo compatibility
    const content = rawContent.map((b: any) => {
      if (b.type === 'thinking' && b.thinking && !b.reasoning_content) {
        return { ...b, reasoning_content: b.thinking }
      }
      return b
    })

    // Emit text/thinking callbacks
    for (const block of content) {
      if (block.type === 'text') callbacks.onTextDelta?.(block.text)
      if (block.type === 'thinking') callbacks.onThinkingDelta?.(block.thinking)
    }

    return { content, stopReason, usage: { inputTokens, outputTokens } }
  } finally {
    clearTimeout(timeout)
    abortSignal?.removeEventListener('abort', onParentAbort)
  }
}

// --- OpenAI streaming loop ---

async function runOpenAILoop(params: AgenticLoopParams): Promise<AgenticLoopResult> {
  const { client, modelId, messages, system, tools, toolExecutors, abortSignal, onTextDelta, onToolCall, onToolResult, onToolApproval, onBeforeStep, onAfterToolCall } = params
  const maxSteps = params.maxSteps ?? 50
  const openai = client as OpenAI

  let totalInput = 0
  let totalOutput = 0

  for (let step = 0; step < maxSteps; step++) {
    if (abortSignal?.aborted) break

    // Offload: compress old messages before LLM call
    await onBeforeStep?.(messages)
    if (abortSignal?.aborted) break

    const openaiTools = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }))

    const oaiMessages: any[] = []
    if (system) oaiMessages.push({ role: 'system', content: system })
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const textParts = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        const toolCalls = msg.content.filter((b: any) => b.type === 'tool_use').map((b: any) => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }))
        const oaiMsg: any = { role: 'assistant' }
        if (textParts) oaiMsg.content = textParts
        if (toolCalls.length > 0) oaiMsg.tool_calls = toolCalls
        oaiMessages.push(oaiMsg)
      } else if (msg.role === 'user' && Array.isArray(msg.content)) {
        const toolResults = msg.content.filter((b: any) => b.type === 'tool_result')
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            oaiMessages.push({
              role: 'tool',
              tool_call_id: tr.tool_use_id,
              content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
            })
          }
        } else {
          oaiMessages.push(msg)
        }
      } else {
        oaiMessages.push(msg)
      }
    }

    // Per-call timeout — covers both create() and stream consumption
    const callAbort = new AbortController()
    const timeout = setTimeout(() => callAbort.abort(), API_TIMEOUT_MS)
    const onParentAbort = () => callAbort.abort()
    abortSignal?.addEventListener('abort', onParentAbort, { once: true })

    let stream: any
    try {
      stream = await openai.chat.completions.create({
        model: modelId,
        messages: oaiMessages,
        tools: openaiTools,
        stream: true,
        stream_options: { include_usage: true },
      }, { signal: callAbort.signal })
    } catch (err: any) {
      clearTimeout(timeout)
      abortSignal?.removeEventListener('abort', onParentAbort)
      if (err?.name === 'AbortError' || abortSignal?.aborted) {
        return { stopReason: 'end_turn', usage: { inputTokens: totalInput, outputTokens: totalOutput } }
      }
      throw err
    }

    let fullContent = ''
    let finishReason: string | null = null
    const toolCallAccumulators = new Map<number, { id: string; name: string; arguments: string }>()

    try {
    for await (const chunk of stream) {
      if (abortSignal?.aborted || callAbort.signal.aborted) break

      // Usage-only chunk (final chunk with include_usage) has empty choices
      totalInput += chunk.usage?.prompt_tokens ?? 0
      totalOutput += chunk.usage?.completion_tokens ?? 0

      const choice = chunk.choices[0]
      if (!choice) continue
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta
      if (!delta) continue

      if (delta.content) {
        fullContent += delta.content
        onTextDelta?.(delta.content)
      }

      if ((delta as any).reasoning_content) {
        params.onThinkingDelta?.((delta as any).reasoning_content)
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolCallAccumulators.has(idx)) {
            toolCallAccumulators.set(idx, { id: tc.id || '', name: '', arguments: '' })
          }
          const acc = toolCallAccumulators.get(idx)!
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name = tc.function.name
          if (tc.function?.arguments) acc.arguments += tc.function.arguments
        }
      }

    }
    } finally {
      clearTimeout(timeout)
      abortSignal?.removeEventListener('abort', onParentAbort)
    }

    // Build assistant message for history
    const assistantMsg: any = { role: 'assistant' }
    if (fullContent) assistantMsg.content = fullContent

    if (toolCallAccumulators.size === 0) {
      messages.push({ role: 'assistant', content: fullContent || '' })
      return {
        stopReason: finishReason === 'length' ? 'max_tokens' : 'end_turn',
        usage: { inputTokens: totalInput, outputTokens: totalOutput },
      }
    }

    // If stream was aborted or truncated, skip executing partial tool calls
    if (abortSignal?.aborted || finishReason === 'length') {
      messages.push(assistantMsg)
      return {
        stopReason: abortSignal?.aborted ? 'end_turn' : 'max_tokens',
        usage: { inputTokens: totalInput, outputTokens: totalOutput },
      }
    }

    // Execute tool calls with timeout
    assistantMsg.tool_calls = []
    const toolMessages: any[] = []

    for (const [, acc] of toolCallAccumulators) {
      let input: any
      let jsonOk = true
      try { input = JSON.parse(acc.arguments) } catch { jsonOk = false; input = {}; console.error(`[AgenticLoop] tool_call JSON parse failed: ${acc.name}`, acc.arguments.slice(0, 200)) }

      assistantMsg.tool_calls.push({
        id: acc.id,
        type: 'function',
        function: { name: acc.name, arguments: acc.arguments },
      })

      onToolCall?.(acc.id, acc.name, input)

      // Approval gate
      if (onToolApproval) {
        const approved = await onToolApproval(acc.id, acc.name, input)
        if (!approved) {
          const denyContent = `Tool "${acc.name}" was denied by user`
          toolMessages.push({ role: 'tool', tool_call_id: acc.id, content: denyContent })
          onToolResult?.(acc.id, denyContent, true)
          continue
        }
      }

      if (!jsonOk) {
        const errorContent = `Tool "${acc.name}" received malformed arguments from model (JSON parse failed)`
        toolMessages.push({ role: 'tool', tool_call_id: acc.id, content: errorContent })
        onToolResult?.(acc.id, errorContent, true)
        continue
      }

      const executor = toolExecutors.get(acc.name)
      if (!executor) {
        const errorContent = `Tool "${acc.name}" not found`
        toolMessages.push({ role: 'tool', tool_call_id: acc.id, content: errorContent })
        onToolResult?.(acc.id, errorContent, true)
        continue
      }
      try {
        const result = await withTimeout(executor(input), TOOL_TIMEOUT_MS, `tool:${acc.name}`)
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
        const isToolError = typeof result === 'object' && result !== null && 'error' in result
        toolMessages.push({ role: 'tool', tool_call_id: acc.id, content: resultStr.slice(0, 50000) })
        onToolResult?.(acc.id, resultStr.slice(0, 50000), isToolError || undefined)
        onAfterToolCall?.(acc.name, acc.id, input, result)
      } catch (err: any) {
        const errMsg = err.message || 'Tool execution failed'
        toolMessages.push({ role: 'tool', tool_call_id: acc.id, content: errMsg })
        onToolResult?.(acc.id, errMsg, true)
      }
    }

    messages.push(assistantMsg)
    messages.push(...toolMessages)
  }

  return {
    stopReason: 'max_steps',
    usage: { inputTokens: totalInput, outputTokens: totalOutput },
  }
}
