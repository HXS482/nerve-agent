import { describe, it, expect } from 'vitest'
import {
  SHARED_SCOPE,
  buildScopeKey,
  parseAgentId,
  scopeSessionId,
  visibleAgentIds,
} from '../../../vendor/tencentdb-memory/utils/scope'

describe('buildScopeKey / parseAgentId 往返', () => {
  it('拼出来的 key 能被解析回同一个 botId', () => {
    const key = buildScopeKey('bot-abc', 'sess-1')
    expect(key).toBe('agent:bot-abc:sess-1')
    expect(parseAgentId(key)).toBe('bot-abc')
    expect(scopeSessionId(key)).toBe('sess-1')
  })

  it('botId 缺失时落 shared，不产生 agent::xxx 这种畸形 key', () => {
    for (const bad of [null, undefined, '', '  ']) {
      const key = buildScopeKey(bad, 'sess-1')
      expect(key).toBe('agent:shared:sess-1')
      // 关键：解析出来不能是空串 —— 空串会让 SQL 的 IN 变成 IN ('', 'shared')
      expect(parseAgentId(key)).toBe(SHARED_SCOPE)
    }
  })

  it('裸 UUID（升级前的数据）解析成 shared', () => {
    expect(parseAgentId('94130714-c512-46c3-8637-01082887b89e')).toBe(SHARED_SCOPE)
    expect(parseAgentId('')).toBe(SHARED_SCOPE)
    expect(parseAgentId(null)).toBe(SHARED_SCOPE)
  })

  it('sessionId 里含冒号也能完整取回', () => {
    const key = buildScopeKey('bot-a', 'tg:chat:42')
    expect(scopeSessionId(key)).toBe('tg:chat:42')
    expect(parseAgentId(key)).toBe('bot-a')
  })
})

describe('visibleAgentIds', () => {
  it('普通 Bot = 自己 + shared', () => {
    expect(visibleAgentIds('bot-a')).toEqual(['bot-a', SHARED_SCOPE])
  })

  it('shared 自身只返回 shared（去重）', () => {
    expect(visibleAgentIds(SHARED_SCOPE)).toEqual([SHARED_SCOPE])
  })

  it('空 botId 落到 shared', () => {
    expect(visibleAgentIds('')).toEqual([SHARED_SCOPE])
    expect(visibleAgentIds(null)).toEqual([SHARED_SCOPE])
  })
})

describe('隔离语义（不是权限，是可见性）', () => {
  it('Bot A 看不到 Bot B 的记录', () => {
    const scopeA = visibleAgentIds('bot-a')
    const recordOfB = parseAgentId(buildScopeKey('bot-b', 'sess-9'))
    expect(scopeA.includes(recordOfB)).toBe(false)
  })

  it('但两个 Bot 都能看到 shared 记录', () => {
    const sharedRecord = parseAgentId('94130714-c512-46c3-8637-01082887b89e')
    expect(visibleAgentIds('bot-a').includes(sharedRecord)).toBe(true)
    expect(visibleAgentIds('bot-b').includes(sharedRecord)).toBe(true)
  })
})
