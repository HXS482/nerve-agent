import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentCore } from '../../core/agent-core'
import { FileSessionStore } from '../../session-store'

// getSessionUsage 报告的是「当前上下文占用」= 最后一次 LLM 调用的 input+output，
// 不是整个会话的累计消耗。历史实现把所有 assistant 条目的 usage 累加，值单调增长、
// 必然超过 context window，被用量环 Math.min(ratio, 1) 夹到 1 后永久显示 100% 红。
describe('getSessionUsage — 报告当前上下文占用而非累计消耗', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nerve-usage-test-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  const makeCore = () =>
    new AgentCore({
      projectDir: tmp,
      sourceDir: tmp,
      // getSessionUsage 会调 resolveModel，settings.modelAliases 必须存在
      settings: { cwd: tmp, modelAliases: {} } as any,
    })

  it('返回最后一条 assistant 的占用，而不是全部条目累加', async () => {
    const store = await FileSessionStore.create(join(tmp, '.nerve', 'sessions'))
    await store.append({ sessionId: 'u1' }, [
      { type: 'user', message: { content: '一' }, timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'a' }] },
        timestamp: new Date().toISOString(),
        usage: { inputTokens: 30000, outputTokens: 2000, contextTokens: 32000 },
      },
      { type: 'user', message: { content: '二' }, timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'b' }] },
        timestamp: new Date().toISOString(),
        usage: { inputTokens: 50000, outputTokens: 4000, contextTokens: 54000 },
      },
    ])

    const usage = await makeCore().getSessionUsage('u1')

    // 累计会是 30000+50000 / 2000+4000 = 80000/6000 —— 那正是 bug 的行为
    expect(usage.totalTokens).toBe(54000)
    expect(usage.inputTokens).toBe(50000)
    expect(usage.outputTokens).toBe(4000)
    expect(usage.maxContextTokens).toBeGreaterThan(0)
  })

  it('旧条目没有 contextTokens 时回退为 inputTokens + outputTokens', async () => {
    const store = await FileSessionStore.create(join(tmp, '.nerve', 'sessions'))
    await store.append({ sessionId: 'u2' }, [
      { type: 'user', message: { content: '旧' }, timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'legacy' }] },
        timestamp: new Date().toISOString(),
        usage: { inputTokens: 7000, outputTokens: 500 },
      },
    ])

    const usage = await makeCore().getSessionUsage('u2')
    expect(usage.totalTokens).toBe(7500)
  })

  it('跳过最后一条零值空回复（取消/超时），回落到上一条真实占用', async () => {
    const store = await FileSessionStore.create(join(tmp, '.nerve', 'sessions'))
    await store.append({ sessionId: 'u4' }, [
      { type: 'user', message: { content: '一' }, timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'a' }] },
        timestamp: new Date().toISOString(),
        usage: { inputTokens: 12345, outputTokens: 678, contextTokens: 13023 },
      },
      { type: 'user', message: { content: '二' }, timestamp: new Date().toISOString() },
      {
        // 被取消的轮次：没有正文，usage 全 0
        type: 'assistant',
        message: { content: [] },
        timestamp: new Date().toISOString(),
        usage: { inputTokens: 0, outputTokens: 0, contextTokens: 0 },
      },
    ])

    const usage = await makeCore().getSessionUsage('u4')
    expect(usage.totalTokens).toBe(13023)
    expect(usage.inputTokens).toBe(12345)
  })
  it('没有 assistant 条目时为 0，不抛错', async () => {
    const store = await FileSessionStore.create(join(tmp, '.nerve', 'sessions'))
    await store.append({ sessionId: 'u3' }, [
      { type: 'user', message: { content: '只有用户消息' }, timestamp: new Date().toISOString() },
    ])

    const usage = await makeCore().getSessionUsage('u3')
    expect(usage.totalTokens).toBe(0)
  })
})
