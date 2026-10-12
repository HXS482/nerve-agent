import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderRegistry } from '../provider-registry'
import { AgentCore } from '../core/agent-core'
import type { ClaudeSettings } from '../settings'

const makeSettings = (over: Partial<ClaudeSettings> = {}): ClaudeSettings => ({
  baseURL: 'https://env.example/v1',
  authToken: 'sk-env',
  modelAliases: {},
  ...over,
})

const OPENAI_PROVIDER = {
  type: 'openai' as const,
  baseURL: 'http://sit-ai.h3c.com/v1',
  authToken: 'sk-provider',
}

describe('ProviderRegistry 装载路径一致性', () => {
  it('constructor 与 reload 结果一致', () => {
    const settings = makeSettings({
      providers: { 'sit-ai': { ...OPENAI_PROVIDER, models: ['GLM-5.3-Flash'] } },
      defaultProvider: 'sit-ai',
    })

    const fresh = new ProviderRegistry(settings).listProviders()

    const reloaded = new ProviderRegistry(makeSettings())
    reloaded.reload(settings)

    expect(reloaded.listProviders()).toEqual(fresh)
    expect(reloaded.listProviders().map((p) => p.id).sort()).toEqual(['anthropic', 'sit-ai'])
  })

  it('reload 后新增的 provider 生效、移除的消失', () => {
    const reg = new ProviderRegistry(
      makeSettings({ providers: { 'sit-ai': OPENAI_PROVIDER } })
    )
    expect(reg.listProviders().map((p) => p.id).sort()).toEqual(['anthropic', 'sit-ai'])

    reg.reload(makeSettings({ providers: { deepseek: OPENAI_PROVIDER } }))
    expect(reg.listProviders().map((p) => p.id).sort()).toEqual(['anthropic', 'deepseek'])
  })

  it('settings.json 里 providers.anthropic 的旧 baseURL 不覆盖 env', async () => {
    const reg = new ProviderRegistry(
      makeSettings({
        providers: {
          // 缺 /v1 后缀的旧值，不应该赢
          anthropic: { type: 'anthropic', baseURL: 'https://stale.example', authToken: 'sk-stale' },
        },
      })
    )

    const entry = reg.listProviders().find((p) => p.id === 'anthropic')!
    expect(entry.baseURL).toBe('https://env.example/v1')

    const { client } = await reg.getClientAndModel('anthropic', 'sonnet')
    expect(client.apiKey).toBe('sk-env')
    // anthropic 类型会砍掉尾部 /v1（SDK 自己补 /v1/messages），所以这里看到的是 origin
    expect(client.baseURL).toBe('https://env.example')
  })

  it('未注册的 provider 兜底到 anthropic 时打告警，不静默', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reg = new ProviderRegistry(makeSettings())

    const res = await reg.getClientAndModel('openai', 'sonnet')

    expect(res.providerType).toBe('anthropic')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not configured'))
  })
})

describe('AgentCore.resolveProvider 只返回已注册的 provider id', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nerve-provider-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  function makeCore(over: Partial<ClaudeSettings> = {}): AgentCore {
    return new AgentCore({
      projectDir: tmp,
      sourceDir: tmp,
      settings: makeSettings({ cwd: tmp, ...over }),
    })
  }

  function resolve(core: AgentCore): string {
    // config.provider 已由 defaultProvider 初始化时清掉，强制走 resolveProvider 的推断分支
    ;(core as any).config.provider = undefined
    return (core as any).resolveProvider()
  }

  it('gpt-* 模型解析到已注册的 openai 类型 provider，而不是硬编码 "openai"', () => {
    const core = makeCore({
      model: 'gpt-4o',
      providers: { 'sit-ai': OPENAI_PROVIDER },
    })

    const resolved = resolve(core)

    expect(resolved).toBe('sit-ai')
    expect(core.getProviders().map((p) => p.id)).toContain(resolved)
  })

  it('类型匹配的 defaultProvider 优先', () => {
    const core = makeCore({
      model: 'gpt-4o',
      defaultProvider: 'deepseek',
      providers: {
        'sit-ai': OPENAI_PROVIDER,
        deepseek: OPENAI_PROVIDER,
      },
    })

    expect(resolve(core)).toBe('deepseek')
  })

  it('gemini 模型且无 google provider 时落到 defaultProvider，而不是不存在的 "google"', () => {
    const core = makeCore({
      model: 'gemini-3-pro',
      defaultProvider: 'sit-ai',
      providers: { 'sit-ai': OPENAI_PROVIDER },
    })

    const resolved = resolve(core)

    expect(resolved).toBe('sit-ai')
    expect(core.getProviders().map((p) => p.id)).toContain(resolved)
  })

  it('没有类型匹配的 provider 时回到 anthropic', () => {
    const core = makeCore({ model: 'gpt-4o' })
    expect(resolve(core)).toBe('anthropic')
  })

  it('非 claude/gpt/gemini 的模型走 defaultProvider', () => {
    const core = makeCore({
      model: 'GLM-5.3-Flash',
      defaultProvider: 'sit-ai',
      providers: { 'sit-ai': OPENAI_PROVIDER },
    })
    expect(resolve(core)).toBe('sit-ai')
  })
})
