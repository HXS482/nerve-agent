import { describe, it, expect } from 'vitest'
import { createSessionContext } from '../../core/session-context'
import { mergeConfig, mergeConfigForSession } from '../../core/session-config'

describe('mergeConfig', () => {
  const base = { model: 'claude-sonnet-4', effort: 'medium' as const, cwd: '/p', permissionMode: 'default' as const }

  it('returns base when session overrides nothing', () => {
    expect(mergeConfig(base, createSessionContext('s1'))).toEqual(base)
  })

  it('lets the session override only the fields it sets', () => {
    const ctx = createSessionContext('s1', { model: 'gpt-5' })
    expect(mergeConfig(base, ctx).model).toBe('gpt-5')
    expect(mergeConfig(base, ctx).effort).toBe('medium')  // 未被覆盖
  })

  it('does not mutate the base config', () => {
    const ctx = createSessionContext('s1', { model: 'gpt-5' })
    mergeConfig(base, ctx)
    expect(base.model).toBe('claude-sonnet-4')
  })
})

// getSessionUsage 这类「没有会话上下文也要能读」的路径走这个：ctx 缺席等于纯全局配置。
describe('mergeConfigForSession', () => {
  const base = { model: 'claude-sonnet-4', effort: 'medium' as const, cwd: '/p', permissionMode: 'default' as const }

  it('无会话上下文时返回 base 的副本（不改 base）', () => {
    const merged = mergeConfigForSession(base, undefined)
    expect(merged).toEqual(base)
    expect(merged).not.toBe(base)

    merged.model = 'gpt-5'
    expect(base.model).toBe('claude-sonnet-4')
  })

  it('有会话上下文时该会话的覆盖优先', () => {
    const ctx = createSessionContext('s1', { model: 'gpt-5' })
    expect(mergeConfigForSession(base, ctx).model).toBe('gpt-5')
    expect(mergeConfigForSession(base, ctx).permissionMode).toBe('default')
  })
})
