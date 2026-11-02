import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentCore } from '../../core/agent-core'
import { FileSessionStore } from '../../session-store'
import { createSessionContext } from '../../core/session-context'

// handleResult 上报的 maxContextTokens 必须和 getSessionUsage 一致。
//
// 历史实现用的是**原始** cfg.provider：会话没显式指定 provider 时它是 undefined，
// 于是 providers[真实 provider].modelContextWindows 被整个跳过，只留下内置表的值
// （gpt-4o-mini → 128000），而 getSessionUsage 先 resolveProvider 再查，拿到的是
// 配置里的值。同一个会话，WS 客户端看到 128k、用量面板看到 999k。
describe('handleResult 与 getSessionUsage 的上下文窗口必须一致', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nerve-ctxwindow-test-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  /** 内置表里 gpt-4o-mini 是 128000；这里配一个完全不同的值，认出到底读了哪张表。 */
  const CONFIGURED_WINDOW = 999_000

  const makeCore = () =>
    new AgentCore({
      projectDir: tmp,
      sourceDir: tmp,
      settings: {
        cwd: tmp,
        modelAliases: {},
        // 刻意不设 defaultProvider / provider：只有靠 model 前缀推断这条路才能命中
        model: 'gpt-4o-mini',
        providers: {
          openai: {
            type: 'openai',
            baseURL: 'https://example.invalid',
            authToken: 'x',
            modelContextWindows: { 'gpt-4o-mini': CONFIGURED_WINDOW },
          },
        },
      } as any,
    })

  it('推断 provider 时也用 provider 级 modelContextWindows 来报窗口', async () => {
    const core = makeCore()

    const dones: Array<{ maxContextTokens: number }> = []
    const channel: any = { sendDone: (_s: string, _c: number, max: number) => { dones.push({ maxContextTokens: max }) } }
    const ctx = createSessionContext('ctx1')

    await (core as any).handleResult(
      {
        usage: { inputTokens: 1000, outputTokens: 100, contextTokens: 1100 },
        stopReason: 'end',
        textDeltas: ['hi'],
        fullThinkingParts: [],
        allToolCalls: [],
        allToolResults: [],
      },
      'ctx1',
      { prompt: 'hi', sessionId: 'ctx1' },
      channel,
      ctx,
      undefined,
      // 本轮有效配置：provider 留空，让 resolveProvider 去推断（这正是 bug 触发的形状）
      { model: 'gpt-4o-mini', effort: 'medium', cwd: tmp, permissionMode: 'bypassPermissions' } as any,
    )

    expect(dones).toHaveLength(1)
    expect(dones[0].maxContextTokens).toBe(CONFIGURED_WINDOW)
  })

  it('与 getSessionUsage 对同一个会话报同一个窗口', async () => {
    const core = makeCore()
    const store = await FileSessionStore.create(join(tmp, '.nerve', 'sessions'))
    await store.append({ sessionId: 'ctx2' }, [
      { type: 'user', message: { content: 'hi' }, timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'ok' }] },
        timestamp: new Date().toISOString(),
        usage: { inputTokens: 1000, outputTokens: 100, contextTokens: 1100 },
      },
    ])

    const dones: number[] = []
    const channel: any = { sendDone: (_s: string, _c: number, max: number) => { dones.push(max) } }
    await (core as any).handleResult(
      {
        usage: { inputTokens: 1000, outputTokens: 100, contextTokens: 1100 },
        stopReason: 'end',
        textDeltas: ['ok'],
        fullThinkingParts: [],
        allToolCalls: [],
        allToolResults: [],
      },
      'ctx2',
      { prompt: 'hi', sessionId: 'ctx2' },
      channel,
      createSessionContext('ctx2'),
      undefined,
      { model: 'gpt-4o-mini', effort: 'medium', cwd: tmp, permissionMode: 'bypassPermissions' } as any,
    )

    const usage = await core.getSessionUsage('ctx2')
    expect(dones[0]).toBe(usage.maxContextTokens)
    expect(dones[0]).toBe(CONFIGURED_WINDOW)
  })
})
