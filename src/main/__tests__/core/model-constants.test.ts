import { describe, it, expect, afterAll } from 'vitest'
import { lookupContextWindow, FALLBACK_CONTEXT_WINDOW } from '../../core/model-constants'
import { AgentCore } from '../../core/agent-core'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 私有模型名（公司代理网关的 GLM-5.3-Flash）不在表里精确命中，必须靠前缀匹配，
// 否则掉兜底 200000，用量环把 512000 的模型显示成 200000（占用虚高 + 提前染红）。
describe('lookupContextWindow', () => {
  it('精确命中优先', () => {
    expect(lookupContextWindow('glm-5.3')).toBe(512_000)
    expect(lookupContextWindow('gpt-4o')).toBe(128_000)
  })

  it('前缀匹配：GLM-5.3-Flash 命中 glm-5.3-flash / glm-5.3', () => {
    expect(lookupContextWindow('GLM-5.3-Flash')).toBe(512_000)
    expect(lookupContextWindow('glm-5.3-flash')).toBe(512_000)
  })

  it('大小写不敏感', () => {
    expect(lookupContextWindow('GLM-5.3')).toBe(512_000)
    expect(lookupContextWindow('GLM-4')).toBe(128_000)
  })

  it('最长前缀优先，短 key 不会抢走更精确的条目', () => {
    const table = { glm: 1000, 'glm-5.3': 512_000 }
    expect(lookupContextWindow('glm-5.3-flash', table)).toBe(512_000)
  })

  it('未知模型 / 空值返回 undefined（由调用方决定兜底）', () => {
    expect(lookupContextWindow('some-private-model')).toBeUndefined()
    expect(lookupContextWindow('')).toBeUndefined()
    expect(lookupContextWindow(undefined)).toBeUndefined()
    expect(lookupContextWindow(null)).toBeUndefined()
  })

  it('兜底常量是 200000', () => {
    expect(FALLBACK_CONTEXT_WINDOW).toBe(200_000)
  })
})

// AgentCore.resolveContextWindow 的优先级：settings.contextWindow > provider 细分 > 查表 > 兜底。
// 用户的模型是公司代理的 GLM-5.3-Flash，不在表里精确命中，改前一直掉兜底 200000（真实 512000）。
describe('AgentCore.resolveContextWindow', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nerve-ctxwin-test-'))
  const makeCore = (settings: Record<string, unknown>) =>
    new AgentCore({ projectDir: tmp, sourceDir: tmp, settings: { cwd: tmp, modelAliases: {}, ...settings } as any })
  const resolve = (core: AgentCore, model: string, provider?: string) =>
    (core as any).resolveContextWindow(model, provider)

  it('公司代理的 GLM-5.3-Flash 靠前缀匹配拿到 512000，不再掉 200000', () => {
    expect(resolve(makeCore({}), 'GLM-5.3-Flash')).toBe(512_000)
  })

  it('settings.contextWindow 覆盖一切（优先级最高）', () => {
    const core = makeCore({ contextWindow: 700_000 })
    expect(resolve(core, 'GLM-5.3-Flash')).toBe(700_000)
    expect(resolve(core, 'gpt-4o')).toBe(700_000)
  })

  it('provider 级 modelContextWindows 优先于查表', () => {
    const core = makeCore({
      providers: { 'sit-ai': { type: 'openai', baseURL: 'http://x/v1', authToken: 't', modelContextWindows: { 'GLM-5.3-Flash': 400_000 } } },
    })
    expect(resolve(core, 'GLM-5.3-Flash', 'sit-ai')).toBe(400_000)
    // 换个 provider 就没有细分覆盖了，回到查表
    expect(resolve(core, 'GLM-5.3-Flash', 'other')).toBe(512_000)
  })

  it('未知模型掉兜底 200000', () => {
    expect(resolve(makeCore({}), 'totally-private-model')).toBe(FALLBACK_CONTEXT_WINDOW)
  })

  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
})
