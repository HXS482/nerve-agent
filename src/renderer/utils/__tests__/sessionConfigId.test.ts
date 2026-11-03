import { describe, it, expect } from 'vitest'
import { isTempSessionId, resolveConfigSessionId } from '../sessionConfigId'

// 渲染层的临时 id（session-<ts>）只活在渲染层，主进程不认识它。
// 拿它当 sessionId 去写会话级配置，等于把覆盖写进一个永远没有 run 读的上下文 ——
// 用户的模型选择会被静默吞掉。所以规则必须是：
//   临时 id 且无别名 → undefined（退回全局写入，新会话从全局默认继承）
//   临时 id 有别名   → 后端真实 id
//   真实 id         → 原样返回

describe('isTempSessionId', () => {
  it('识别 session- 前缀', () => {
    expect(isTempSessionId('session-1712345678901')).toBe(true)
  })

  it('后端 uuid / 其他 id 不算临时', () => {
    expect(isTempSessionId('9f3c1e2a-0b44-4c77-9d51-8a2ef3f0c111')).toBe(false)
    expect(isTempSessionId('sess-123')).toBe(false)
  })

  it('空值不算临时 id', () => {
    expect(isTempSessionId(null)).toBe(false)
    expect(isTempSessionId(undefined)).toBe(false)
    expect(isTempSessionId('')).toBe(false)
  })
})

describe('resolveConfigSessionId', () => {
  const REAL = '9f3c1e2a-0b44-4c77-9d51-8a2ef3f0c111'

  it('无会话 → undefined（全局写入）', () => {
    expect(resolveConfigSessionId(null)).toBeUndefined()
    expect(resolveConfigSessionId(undefined)).toBeUndefined()
    expect(resolveConfigSessionId('')).toBeUndefined()
  })

  it('临时 id 且无别名 → undefined，绝不把临时 id 发给主进程', () => {
    expect(resolveConfigSessionId('session-1712345678901')).toBeUndefined()
    expect(resolveConfigSessionId('session-1712345678901', {})).toBeUndefined()
  })

  it('临时 id 有别名 → 解析成后端真实 id', () => {
    expect(
      resolveConfigSessionId('session-1712345678901', { 'session-1712345678901': REAL }),
    ).toBe(REAL)
  })

  it('真实 id 原样返回', () => {
    expect(resolveConfigSessionId(REAL)).toBe(REAL)
    expect(resolveConfigSessionId(REAL, { 'session-1': REAL })).toBe(REAL)
  })

  it('别名本身仍是临时 id 时退回 undefined（防止二次临时 id 泄漏）', () => {
    expect(
      resolveConfigSessionId('session-1', { 'session-1': 'session-2' }),
    ).toBeUndefined()
  })
})
