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

describe('bot 层', () => {
  it('bot instructions 拼在 soul 之后 persona 之前', () => {
    const p = composeSystemPrompt({ soul: 'S', bot: 'B', persona: 'P', memoryContext: 'M' })
    const si = p.indexOf('S'), bi = p.indexOf('B'), pi = p.indexOf('P'), mi = p.indexOf('M')
    expect(si).toBeLessThan(bi)
    expect(bi).toBeLessThan(pi)
    expect(pi).toBeLessThan(mi)
  })
  it('bot 为空时不产生空层', () => {
    const p = composeSystemPrompt({ soul: 'S', persona: 'P' })
    expect(p).not.toContain('<bot>')
  })
})
