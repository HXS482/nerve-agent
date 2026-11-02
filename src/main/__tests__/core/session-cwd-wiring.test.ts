import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 接线测试：resolveCwd 自身的正确性由 session-cwd.test.ts 保证，这里只钉「接线」——
// sendMessage 解析出的 cwd 必须真的传进工具构建。原来的 bug 就发生在这一跳：
// buildTools 里的 `getBuiltinTools(this.projectDir, …)` 读全局目录，而 cwd 参数
// 只加在签名上、调用点没传，测试全绿但每个工具都跑在全局目录里。
//
// 所以断言点选在最深的那一跳（getBuiltinTools 收到的第一个参数），而不是
// buildTools 收到的第 10 个参数：前者同时覆盖「sendMessage 传了」和
// 「buildTools 用了」，删掉任一处的 cwd 都会让它变红。
const { seenBuiltinCwd, seenOrchestratorProjectDir } = vi.hoisted(() => ({
  seenBuiltinCwd: [] as unknown[],
  seenOrchestratorProjectDir: [] as unknown[],
}))

vi.mock('../../tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tools')>()
  return {
    ...actual,
    getBuiltinTools: (cwd: string, ...rest: unknown[]) => {
      seenBuiltinCwd.push(cwd)
      return (actual.getBuiltinTools as any)(cwd, ...rest)
    },
  }
})

vi.mock('../../orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../orchestrator')>()
  return {
    ...actual,
    getOrchestratorTools: (config: any) => {
      seenOrchestratorProjectDir.push(config?.projectDir)
      return actual.getOrchestratorTools(config)
    },
  }
})

// 不真的打 LLM：循环本身不是本测试的对象
vi.mock('../../agentic-loop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agentic-loop')>()
  return {
    ...actual,
    runAgenticLoop: vi.fn(async () => ({
      usage: { inputTokens: 1, outputTokens: 1, contextTokens: 2 },
      stopReason: 'end_turn' as const,
    })),
  }
})

import { AgentCore } from '../../core/agent-core'
import { NullOutputChannel } from '../../core/output-channel'

describe('sendMessage — 把会话 cwd 接线到工具构建', () => {
  const globalDir = mkdtempSync(join(tmpdir(), 'nerve-cwd-global-'))
  const sessionDir = mkdtempSync(join(tmpdir(), 'nerve-cwd-session-'))
  afterAll(() => {
    rmSync(globalDir, { recursive: true, force: true })
    rmSync(sessionDir, { recursive: true, force: true })
  })

  const makeCore = () => {
    // globalDir 是构造期的全局目录；sessionDir 只可能来自 payload.cwd
    const core = new AgentCore({
      projectDir: globalDir,
      sourceDir: globalDir,
      settings: { cwd: globalDir, modelAliases: {} } as any,
    })
    // 绕开真实 provider / MCP：两者都与 cwd 无关，留着会让用例依赖网络与外部配置
    ;(core as any).registry = {
      listProviders: () => [],
      getClientAndModel: async () => ({ client: {}, modelId: 'm', providerType: 'anthropic' }),
      createFreshClient: () => ({ client: {} }),
    }
    ;(core as any).mcpPool = {
      ensureConnected: async () => [],
      getDetailedExecutors: () => [],
    }
    return core
  }

  beforeEach(() => {
    seenBuiltinCwd.length = 0
    seenOrchestratorProjectDir.length = 0
  })

  it('payload.cwd 一路传到 getBuiltinTools 与 orchestrator，而不是全局目录', async () => {
    await makeCore().sendMessage(
      { prompt: 'pwd', sessionId: 's-cwd', cwd: sessionDir } as any,
      new NullOutputChannel(),
    )

    expect(seenBuiltinCwd).toEqual([sessionDir])
    expect(seenOrchestratorProjectDir).toEqual([sessionDir])
    // 反向断言：全局目录一次都不该出现在工具构建里
    expect(seenBuiltinCwd).not.toContain(globalDir)
  })

  it('老会话没有 cwd 字段时回落到全局目录（不回归成 undefined）', async () => {
    await makeCore().sendMessage(
      { prompt: 'pwd', sessionId: 's-old' } as any,
      new NullOutputChannel(),
    )

    expect(seenBuiltinCwd).toEqual([globalDir])
    expect(seenOrchestratorProjectDir).toEqual([globalDir])
  })

  it('cwd 是纯空白时同样回落，不让工具跑在空白路径上', async () => {
    await makeCore().sendMessage(
      { prompt: 'pwd', sessionId: 's-blank', cwd: '  ' } as any,
      new NullOutputChannel(),
    )

    expect(seenBuiltinCwd).toEqual([globalDir])
  })
})
