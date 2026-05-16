import { z } from 'zod'
import { zodToInputSchema } from './tool-schema'
import { runSubagent, runParallelSubagents, runChainSubagents, SubagentConfig } from './subagent'

export interface OrchestratorConfig {
  client: any
  modelId: string
  providerType: 'anthropic' | 'openai'
  projectDir: string
  mcpTools?: Record<string, unknown>
  effort?: string
  createClient?: () => Promise<{ client: any }>
  onToolCall?: (id: string, name: string, input: unknown) => void
  onToolResult?: (id: string, content: string, isError?: boolean) => void
}

export function getOrchestratorTools(config: OrchestratorConfig) {
  const subagentConfig: SubagentConfig = {
    client: config.client,
    modelId: config.modelId,
    providerType: config.providerType,
    systemPrompt: [
      'You are a focused subagent. Complete the task precisely. Output your final result clearly.',
      'IMPORTANT: To generate images, use the GenerateImage tool — do NOT use Bash, curl, or Write to save images. GenerateImage saves to the internal gallery automatically.',
    ].join('\n'),
    projectDir: config.projectDir,
    mcpTools: config.mcpTools,
    effort: config.effort,
    onToolCall: config.onToolCall,
    onToolResult: config.onToolResult,
  }

  const spawnSchema = z.object({
    task: z.string().describe('Task description for the subagent'),
    steering: z.string().optional().describe('Additional instructions to guide the subagent'),
  })

  const parallelSchema = z.object({
    tasks: z.array(z.union([
      z.string(),
      z.object({ task: z.string() }),
    ])).describe('Tasks as an array: ["task1", "task2"] or [{"task":"task1"}, {"task":"task2"}]. MUST be an actual array, not a JSON string.'),
    steering: z.string().optional().describe('Shared instructions for all subagents'),
  })

  const chainSchema = z.object({
    steps: z.array(z.union([
      z.string(),
      z.object({ task: z.string() }),
    ])).optional().describe('Steps as an array: ["task1", "task2"] or [{"task":"task1"}, {"task":"task2"}]. MUST be an actual array, not a JSON string.'),
    tasks: z.array(z.union([
      z.string(),
      z.object({ task: z.string() }),
    ])).optional().describe('Alias for steps — same format. Use "steps" instead.'),
    steering: z.string().optional().describe('Shared instructions for all subagents'),
  })

  return {
    spawn_subagent: {
      description: 'Spawn a subagent to handle a task independently. Returns the subagent\'s text result.',
      input_schema: zodToInputSchema(spawnSchema),
      execute: async ({ task, steering }: { task: string; steering?: string }) => {
        try {
          const result = await runSubagent(task, subagentConfig, steering)
          return {
            result: result.text,
            toolCalls: result.toolCalls.length,
            usage: result.usage,
            ...(result.truncated ? { warning: 'Subagent output was truncated (max_tokens). The task may be incomplete — consider splitting it.' } : {}),
          }
        } catch (err: any) {
          return { error: err?.message || String(err) }
        }
      },
    },
    parallel_subagents: {
      description: 'Run multiple subagents in parallel. Each task runs independently. Returns all results.',
      input_schema: zodToInputSchema(parallelSchema),
      execute: async ({ tasks, steering }: { tasks: Array<string | { task: string }> | string; steering?: string }) => {
        try {
          let safeTasks: Array<string | { task: string }> = []
          if (Array.isArray(tasks)) {
            safeTasks = tasks
          } else if (typeof tasks === 'string') {
            try {
              const parsed = JSON.parse(tasks)
              safeTasks = Array.isArray(parsed) ? parsed : [parsed]
            } catch {
              safeTasks = [{ task: tasks }]
            }
          } else if (tasks && typeof tasks === 'object' && 'task' in tasks) {
            safeTasks = [tasks as { task: string }]
          } else {
            return { error: `Invalid tasks format: expected array, got ${typeof tasks}` }
          }
          const taskStrings = safeTasks.map(t => typeof t === 'string' ? t : t.task)

          // Create independent clients for each parallel subagent to avoid
          // concurrent SSE connection conflicts on the same client instance
          let results: import('./subagent').SubagentResult[]
          if (config.createClient && taskStrings.length > 1) {
            const configs = await Promise.all(
              taskStrings.map(async () => {
                const { client } = await config.createClient!()
                return { ...subagentConfig, client }
              }),
            )
            results = await Promise.all(
              taskStrings.map((task, i) => runSubagent(task, configs[i], steering)),
            )
          } else {
            results = await runParallelSubagents(taskStrings, subagentConfig, steering)
          }
          const truncated = results.filter(r => r.truncated)
          return {
            results: results.map((r) => ({
              text: r.text,
              toolCalls: r.toolCalls.length,
              ...(r.truncated ? { warning: 'truncated (max_tokens)' } : {}),
            })),
            totalUsage: {
              inputTokens: results.reduce((s, r) => s + (r.usage?.inputTokens ?? 0), 0),
              outputTokens: results.reduce((s, r) => s + (r.usage?.outputTokens ?? 0), 0),
            },
            ...(truncated.length > 0 ? { warning: `${truncated.length}/${results.length} subagent(s) truncated. Tasks may be incomplete — consider splitting.` } : {}),
          }
        } catch (err: any) {
          return { error: err?.message || String(err) }
        }
      },
    },
    chain_subagents: {
      description: 'Run subagents in sequence. Each step receives the previous step\'s full result (text + tool outputs) as context. Use for multi-stage workflows where later steps depend on earlier findings. Parameter name is "steps" (array of tasks).',
      input_schema: zodToInputSchema(chainSchema),
      execute: async (params: { steps?: Array<string | { task: string }> | string; tasks?: Array<string | { task: string }> | string; steering?: string }) => {
        try {
          // MiMo confuses chain_subagents(steps) with parallel_subagents(tasks)
          const raw = params.steps ?? params.tasks
          if (raw == null) {
            return { error: 'Missing "steps" parameter — pass an array of tasks like ["task1", "task2"]' }
          }
          // Defensive: MiMo sometimes passes steps as a string or single object
          let safeSteps: Array<string | { task: string }> = []
          if (Array.isArray(raw)) {
            safeSteps = raw
          } else if (typeof raw === 'string') {
            try {
              const parsed = JSON.parse(raw)
              safeSteps = Array.isArray(parsed) ? parsed : [parsed]
            } catch {
              safeSteps = [{ task: raw }]
            }
          } else if (raw && typeof raw === 'object' && 'task' in raw) {
            safeSteps = [raw as { task: string }]
          } else {
            return { error: `Invalid steps format: expected array, got ${typeof raw}` }
          }
          const normalized = safeSteps.map(s => typeof s === 'string' ? { task: s } : s)
          const chainResults = await runChainSubagents(normalized, subagentConfig, steering)
          const truncated = chainResults.filter(r => r.truncated)
          return {
            results: chainResults.map((r, i) => ({
              step: i + 1,
              text: r.text,
              toolCalls: r.toolCalls.length,
              ...(r.truncated ? { warning: 'truncated (max_tokens)' } : {}),
            })),
            ...(truncated.length > 0 ? { warning: `${truncated.length}/${chainResults.length} step(s) truncated.` } : {}),
          }
        } catch (err: any) {
          return { error: err?.message || String(err) }
        }
      },
    },
  }
}
