import { describe, it, expect } from 'vitest'
import { composeSystemPrompt } from '../../core/system-prompt'

describe('composeSystemPrompt', () => {
  it('orders soul → persona → memory and declares precedence', () => {
    const out = composeSystemPrompt({ soul: 'SOUL', persona: 'PERSONA', memoryContext: 'MEMORY' })
    expect(out.indexOf('<soul>')).toBeLessThan(out.indexOf('<user-persona>'))
    expect(out.indexOf('<user-persona>')).toBeLessThan(out.indexOf('MEMORY'))
    expect(out).toContain('<layer-order>')
  })

  it('omits empty layers', () => {
    expect(composeSystemPrompt({ soul: '  ' })).toBe('')
    const soulOnly = composeSystemPrompt({ soul: 'SOUL' })
    expect(soulOnly).toContain('<soul>')
    expect(soulOnly).not.toContain('<user-persona>')
  })
})
