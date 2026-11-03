/**
 * config.set 的会话级参数
 *
 * 回归点：ConfigSetRequestSchema 若没有 `sessionId` 字段，zod 会静默剥掉它，
 * gateway.handleConfigSet 里拿到的 params.sessionId 永远是 undefined ——
 * 外部 agent 传了 sessionId 也会退化成"改全局配置"，把别人的模型一起改掉。
 */

import { describe, it, expect } from 'vitest'
import { ConfigSetRequestSchema, RequestSchema } from '../../gateway/protocol'

const baseRequest = {
  type: 'req' as const,
  id: 'cfg-1',
  method: 'config.set' as const,
}

describe('ConfigSetRequestSchema — sessionId', () => {
  it('保留 params.sessionId（zod 不能把它剥掉）', () => {
    const parsed = ConfigSetRequestSchema.parse({
      ...baseRequest,
      params: { model: 'opus', sessionId: 'sess-123' },
    })

    expect(parsed.params.sessionId).toBe('sess-123')
    expect(parsed.params.model).toBe('opus')
  })

  it('provider / effort 与 sessionId 可同时携带', () => {
    const parsed = ConfigSetRequestSchema.parse({
      ...baseRequest,
      params: { provider: 'p1', effort: 'high', sessionId: 'sess-9' },
    })

    expect(parsed.params).toMatchObject({ provider: 'p1', effort: 'high', sessionId: 'sess-9' })
  })

  it('不带 sessionId 时保持 undefined（全局写入的向后兼容路径）', () => {
    const parsed = ConfigSetRequestSchema.parse({
      ...baseRequest,
      params: { model: 'sonnet' },
    })

    expect(parsed.params.sessionId).toBeUndefined()
  })

  it('sessionId 非字符串时拒绝请求', () => {
    const result = ConfigSetRequestSchema.safeParse({
      ...baseRequest,
      params: { model: 'sonnet', sessionId: 42 },
    })

    expect(result.success).toBe(false)
  })

  it('RequestSchema 判别联合体同样保留 sessionId', () => {
    const parsed = RequestSchema.parse({
      ...baseRequest,
      params: { model: 'opus', sessionId: 'sess-abc' },
    })

    expect(parsed.method).toBe('config.set')
    expect((parsed.params as { sessionId?: string }).sessionId).toBe('sess-abc')
  })
})
