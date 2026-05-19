/**
 * NerveLLMRunner — wraps existing OpenAI SDK for TencentDB memory operations.
 *
 * Reuses Nerve's existing OpenAI SDK client instead of adding Vercel AI SDK.
 * Supports both text-only (L1 extraction/dedup) and tool-enabled (L2/L3) modes.
 */

import OpenAI from 'openai'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, resolve, isAbsolute } from 'path'
import type {
  LLMRunner,
  LLMRunParams,
  LLMRunnerFactory,
  LLMRunnerCreateOptions,
  Logger,
} from '../vendor/tencentdb-memory/core/types'

const TAG = '[NerveLLMRunner]'
const MAX_TOOL_ITERATIONS = 20

// ============================
// Sandboxed file tools
// ============================

function resolveSandboxedPath(workspaceDir: string, relativePath: string): string | null {
  const resolved = isAbsolute(relativePath) ? relativePath : resolve(workspaceDir, relativePath)
  if (!resolved.startsWith(resolve(workspaceDir))) return null
  return resolved
}

const TOOL_DEFINITIONS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given relative path.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative file path to read.' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_to_file',
      description: 'Write content to a file at the given relative path. Creates or overwrites.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path to write.' },
          content: { type: 'string', description: 'Content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: 'Replace an exact substring in a file with new content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
          old_str: { type: 'string', description: 'Exact string to find and replace.' },
          new_str: { type: 'string', description: 'Replacement string.' },
        },
        required: ['path', 'old_str', 'new_str'],
      },
    },
  },
]

async function executeToolCall(
  name: string,
  args: Record<string, string>,
  workspaceDir: string,
  logger?: Logger,
): Promise<string> {
  const resolved = resolveSandboxedPath(workspaceDir, args.path)
  if (!resolved) return JSON.stringify({ error: `Path "${args.path}" escapes workspace boundary.` })

  try {
    switch (name) {
      case 'read_file':
        return await readFile(resolved, 'utf-8')
      case 'write_to_file':
        await mkdir(dirname(resolved), { recursive: true })
        await writeFile(resolved, args.content, 'utf-8')
        return JSON.stringify({ success: true })
      case 'replace_in_file': {
        if (!args.old_str) return JSON.stringify({ error: 'old_str cannot be empty.' })
        const existing = await readFile(resolved, 'utf-8')
        if (!existing.includes(args.old_str)) {
          return JSON.stringify({ error: `old_str not found in "${args.path}".` })
        }
        await writeFile(resolved, existing.replace(args.old_str, args.new_str), 'utf-8')
        return JSON.stringify({ success: true })
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger?.warn(`${TAG} tool ${name} failed: ${msg}`)
    return JSON.stringify({ error: msg })
  }
}

// ============================
// NerveLLMRunner
// ============================

export class NerveLLMRunner implements LLMRunner {
  private client: OpenAI
  private model: string
  private enableTools: boolean
  private logger?: Logger

  constructor(opts: {
    client: OpenAI
    model: string
    enableTools?: boolean
    logger?: Logger
  }) {
    this.client = opts.client
    this.model = opts.model
    this.enableTools = opts.enableTools ?? false
    this.logger = opts.logger
  }

  async run(params: LLMRunParams): Promise<string> {
    const runStartMs = Date.now()
    const timeoutMs = params.timeoutMs ?? 120_000
    const maxTokens = params.maxTokens ?? 4096
    const workspaceDir = params.workspaceDir ?? process.cwd()

    this.logger?.debug?.(
      `${TAG} run() start: taskId=${params.taskId}, model=${this.model}, tools=${this.enableTools}`,
    )

    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt })
    }
    messages.push({ role: 'user', content: params.prompt })

    const tools = this.enableTools ? TOOL_DEFINITIONS : undefined

    try {
      let fullText = ''

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        let response: OpenAI.ChatCompletion
        try {
          response = await this.client.chat.completions.create(
            {
              model: this.model,
              messages,
              max_tokens: maxTokens,
              tools,
              tool_choice: tools ? 'auto' : undefined,
            },
            { signal: controller.signal },
          )
        } finally {
          clearTimeout(timer)
        }

        const choice = response.choices[0]
        if (!choice) break

        const assistantMsg = choice.message
        messages.push(assistantMsg)

        if (assistantMsg.content) {
          fullText += assistantMsg.content
        }

        // No tool calls → done
        if (!assistantMsg.tool_calls?.length || !this.enableTools) {
          break
        }

        // Execute tool calls
        for (const tc of assistantMsg.tool_calls) {
          let args: Record<string, string> = {}
          try {
            args = JSON.parse(tc.function.arguments)
          } catch {}
          const result = await executeToolCall(tc.function.name, args, workspaceDir, this.logger)
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          })
        }
      }

      const totalMs = Date.now() - runStartMs
      this.logger?.debug?.(`${TAG} run() completed: ${totalMs}ms, output=${fullText.length} chars`)
      return fullText.trim()
    } catch (err) {
      const totalMs = Date.now() - runStartMs
      const errMsg = err instanceof Error ? err.message : String(err)
      this.logger?.error(`${TAG} run() failed after ${totalMs}ms: ${errMsg}`)
      throw err
    }
  }
}

// ============================
// NerveLLMRunnerFactory
// ============================

export interface NerveLLMRunnerFactoryOptions {
  client: OpenAI
  model: string
  logger?: Logger
}

export class NerveLLMRunnerFactory implements LLMRunnerFactory {
  private client: OpenAI
  private model: string
  private logger?: Logger

  constructor(opts: NerveLLMRunnerFactoryOptions) {
    this.client = opts.client
    this.model = opts.model
    this.logger = opts.logger
  }

  createRunner(opts?: LLMRunnerCreateOptions): LLMRunner {
    let model = this.model
    if (opts?.modelRef) {
      const slashIdx = opts.modelRef.indexOf('/')
      model = slashIdx > 0 ? opts.modelRef.slice(slashIdx + 1) : opts.modelRef
    }

    return new NerveLLMRunner({
      client: this.client,
      model,
      enableTools: opts?.enableTools ?? false,
      logger: this.logger,
    })
  }
}
