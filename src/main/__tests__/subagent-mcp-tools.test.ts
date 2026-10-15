import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runSubagent } from '../subagent'
import { getBuiltinTools } from '../tools'

const { runAgenticLoop } = vi.hoisted(() => ({ runAgenticLoop: vi.fn() }))

vi.mock('../agentic-loop', () => ({ runAgenticLoop }))

// MCP 工具的 def 与 executor 必须成对注册。
// 只推 def 时 agentic-loop 会报 Tool "x" not found，模型随即手搓 curl 绕路。
describe('runSubagent — MCP 工具注册', () => {
  let lastOpts: any

  beforeEach(() => {
    lastOpts = undefined
    runAgenticLoop.mockImplementation(async (opts: any) => {
      lastOpts = opts
      return { stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }
    })
  })

  const baseConfig = {
    client: {},
    modelId: 'test-model',
    providerType: 'anthropic' as const,
    systemPrompt: '',
    projectDir: process.cwd(),
  }

  it('带 execute 的条目同时注册 def 与 executor', async () => {
    const execute = vi.fn(async () => 'ok')

    await runSubagent('task', {
      ...baseConfig,
      mcpTools: { hf_fs: { description: 'Hub 文件系统', parameters: { type: 'object' }, execute } },
    })

    expect(lastOpts.tools.map((t: any) => t.name)).toContain('hf_fs')
    expect(lastOpts.tools.find((t: any) => t.name === 'hf_fs').input_schema).toEqual({ type: 'object' })
    expect(lastOpts.toolExecutors.get('hf_fs')).toBe(execute)
  })

  it('只有元数据、没有 execute 的条目被跳过，不暴露调不动的工具', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await runSubagent('task', {
      ...baseConfig,
      mcpTools: { hf_fs: { description: 'd', parameters: { type: 'object' } } },
    })

    expect(lastOpts.tools.map((t: any) => t.name)).not.toContain('hf_fs')
    expect(lastOpts.toolExecutors.has('hf_fs')).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no executor'))
  })

  it('与内置工具同名的条目被跳过，不覆盖内置 executor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const builtinName = Object.keys(getBuiltinTools(process.cwd()))[0]
    const execute = vi.fn(async () => 'mcp')

    await runSubagent('task', {
      ...baseConfig,
      mcpTools: { [builtinName]: { description: 'd', parameters: {}, execute } },
    })

    // def 不重复，executor 仍是内置的那个（名字被 MCP 抢占会静默改路由）
    expect(lastOpts.tools.filter((t: any) => t.name === builtinName)).toHaveLength(1)
    expect(lastOpts.toolExecutors.get(builtinName)).not.toBe(execute)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('conflicts'))
  })
})
