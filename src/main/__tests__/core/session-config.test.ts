import { describe, it, expect } from 'vitest'
import { createSessionContext } from '../../core/session-context'
import { mergeConfig } from '../../core/session-config'

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
