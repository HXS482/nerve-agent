import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 会话级 setter 绝不能落盘到全局 ~/.nerve/settings.json：
// 那是「污染全局」的另一半，测试里把它换成 spy 一并钉住。
vi.mock('../../settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../settings')>()
  return { ...actual, saveRuntimeConfig: vi.fn(async () => {}) }
})

import { AgentCore } from '../../core/agent-core'
import { FileSessionStore } from '../../session-store'
import { saveRuntimeConfig } from '../../settings'

// 语义：传了 sessionId → 只写该会话的 ctx.config；不传 → 写全局 config（旧行为）。
// 全局 config 是单例状态，任何"以为在改会话、其实改了全局"的路径都会让 A 会话的
// 模型选择泄漏到 B 会话。
describe('setModel / setProvider / setEffort / setPermissionMode — 会话级作用域', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nerve-setters-test-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  const makeCore = () =>
    new AgentCore({
      projectDir: tmp,
      sourceDir: tmp,
      settings: { cwd: tmp, modelAliases: {} } as any,
    })

  beforeEach(() => {
    vi.mocked(saveRuntimeConfig).mockReset()
    vi.mocked(saveRuntimeConfig).mockResolvedValue(undefined)
  })

  it('setModel(model, sessionId) 只写该会话的 ctx.config，不污染全局', async () => {
    const core = makeCore()
    const before = core.getConfig().model

    await core.setModel('gpt-4o', 's-scoped')

    expect(core.getSessionContextManager().get('s-scoped')?.config.model).toBe('gpt-4o')
    expect(core.getConfig().model).toBe(before) // 全局原封不动
    expect(saveRuntimeConfig).not.toHaveBeenCalled() // 也没落盘
  })

  it('setProvider / setEffort / setPermissionMode 同样按 sessionId 分流', async () => {
    const core = makeCore()

    await core.setProvider('openai', 's-scoped')
    await core.setEffort('high', 's-scoped')
    await core.setPermissionMode('acceptEdits', 's-scoped')

    const ctx = core.getSessionContextManager().get('s-scoped')
    expect(ctx?.config.provider).toBe('openai')
    expect(ctx?.config.effort).toBe('high')
    expect(ctx?.config.permissionMode).toBe('acceptEdits')

    const global = core.getConfig()
    expect(global.provider).toBeUndefined()
    expect(global.effort).toBe('medium')
    expect(global.permissionMode).toBe('bypassPermissions')
    expect(saveRuntimeConfig).not.toHaveBeenCalled()
  })

  it('多次写同一会话是累加覆盖，不互相清空', async () => {
    const core = makeCore()

    await core.setModel('gpt-4o', 's-merge')
    await core.setProvider('openai', 's-merge')

    const ctx = core.getSessionContextManager().get('s-merge')
    expect(ctx?.config).toEqual({ model: 'gpt-4o', provider: 'openai' })

    await core.setModel('glm-5.3', 's-merge')
    expect(core.getSessionContextManager().get('s-merge')?.config).toEqual({
      model: 'glm-5.3',
      provider: 'openai',
    })
  })

  it('不带 sessionId 时保持旧行为：写全局 config 并落盘', async () => {
    const core = makeCore()

    await core.setModel('claude-opus-4-20250514')
    await core.setEffort('low')

    expect(core.getConfig().model).toBe('claude-opus-4-20250514')
    expect(core.getConfig().effort).toBe('low')
    expect(saveRuntimeConfig).toHaveBeenCalledWith({ model: 'claude-opus-4-20250514' })
    expect(saveRuntimeConfig).toHaveBeenCalledWith({ effort: 'low' })
  })

  it('全局写入不会凭空创建会话上下文', async () => {
    const core = makeCore()

    await core.setModel('gpt-4o')
    await core.setProvider('openai')

    expect(core.getSessionContextManager().size).toBe(0)
  })
})

// Task 5 结转的修复：用量环（ContextRing 读 usage.maxContextTokens）必须按
// **该会话实际用的 model/provider** 解析上下文窗口。原来读的是 this.config，
// 会话覆盖了 model 的会话会在 UI 上报全局模型的窗口大小。
describe('getSessionUsage — 上下文窗口按会话配置解析', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nerve-usage-scope-test-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  const makeCore = (settings?: Record<string, unknown>) =>
    new AgentCore({
      projectDir: tmp,
      sourceDir: tmp,
      settings: { cwd: tmp, modelAliases: {}, ...settings } as any,
    })

  const appendAssistantTurn = async (sessionId: string) => {
    const store = await FileSessionStore.create(join(tmp, '.nerve', 'sessions'))
    await store.append({ sessionId }, [
      { type: 'user', message: { content: '一' }, timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'a' }] },
        timestamp: new Date().toISOString(),
        usage: { inputTokens: 30000, outputTokens: 2000, contextTokens: 32000 },
      },
    ])
  }

  it('会话覆盖 model 时用覆盖后的窗口，未覆盖的会话仍用全局 model 的窗口', async () => {
    const core = makeCore() // 全局 model = sonnet → 200000

    await appendAssistantTurn('u-plain')
    await appendAssistantTurn('u-override')

    // 不覆盖的会话：全局 sonnet 的窗口
    const plain = await core.getSessionUsage('u-plain')
    expect(plain.maxContextTokens).toBe(200_000)

    // 该会话覆盖成 gpt-4o（128000）—— 修复前这里会错误地报 200000
    core.getSessionContextManager().getOrCreate('u-override', { model: 'gpt-4o' })
    const overridden = await core.getSessionUsage('u-override')
    expect(overridden.maxContextTokens).toBe(128_000)

    // 全局没被污染
    expect(core.getConfig().model).toBe('sonnet')
  })

  it('会话同时覆盖 provider 时，provider 级 modelContextWindows 生效', async () => {
    const core = makeCore({
      providers: {
        custom: { type: 'openai', baseURL: 'http://x', authToken: 't', modelContextWindows: { 'my-model': 512_000 } },
      },
    })

    await appendAssistantTurn('u-provider')
    core.getSessionContextManager().getOrCreate('u-provider', { model: 'my-model', provider: 'custom' })

    const usage = await core.getSessionUsage('u-provider')
    expect(usage.maxContextTokens).toBe(512_000)
  })
})
