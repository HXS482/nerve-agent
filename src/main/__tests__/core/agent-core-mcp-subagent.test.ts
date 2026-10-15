import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentCore } from '../../core/agent-core'

const { runSubagent } = vi.hoisted(() => ({ runSubagent: vi.fn() }))

vi.mock('../../subagent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../subagent')>()
  return { ...actual, runSubagent }
})

// buildTools 交给 Task 子代理的 MCP 条目必须自带 execute：
// 只给元数据的话，子代理「看得见调不动」，模型随即退化成 Bash/curl 手搓 JSON-RPC
describe('buildTools — 传给子代理的 MCP 工具条目', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nerve-mcp-subagent-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('带上可用的 execute，且与主循环用的是同一个执行器', async () => {
    const core = new AgentCore({ projectDir: tmp, sourceDir: tmp, settings: { cwd: tmp } as any })
    const callTool = vi.fn(async () => 'tool-output')
    ;(core as any).mcpPool = {
      getDetailedExecutors: () => [{ serverName: 'huggingface', toolName: 'hf_fs', execute: callTool }],
    }

    const { allToolExecutors, orchestratorTools } = await (core as any).buildTools(
      {}, 'test-model', 'anthropic',
      [{ serverName: 'huggingface', toolName: 'hf_fs', tool: { description: 'd', parameters: { type: 'object' } } }],
      {}, new Map(),
    )

    // 主循环侧行为不变
    expect(allToolExecutors.get('hf_fs')).toBe(callTool)

    // 子代理侧：条目必须带着同一个执行器交下去
    let seen: any
    runSubagent.mockImplementation(async (_task: string, config: any) => {
      seen = config.mcpTools.hf_fs
      return { text: 'ok', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } }
    })

    await orchestratorTools.spawn_subagent.execute({ task: 'do it' })

    expect(seen.execute).toBe(callTool)
    await seen.execute({ path: 'x' })
    expect(callTool).toHaveBeenCalledWith({ path: 'x' })
  })
})
