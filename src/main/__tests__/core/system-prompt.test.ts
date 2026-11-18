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

describe('botName 自我认知', () => {
  it('botName 出现在 <bot> 层里，且排在 instructions 之前', () => {
    const p = composeSystemPrompt({ botName: 'nerve', bot: '你负责工程' })
    const nameIdx = p.indexOf('你的名字是「nerve」')
    const roleIdx = p.indexOf('你负责工程')
    expect(nameIdx).toBeGreaterThan(0)
    expect(roleIdx).toBeGreaterThan(0)
    // 名字比职责更基础：它得先出现
    expect(nameIdx).toBeLessThan(roleIdx)
  })

  it('只有 botName 没有 instructions 时也会产生 bot 层', () => {
    const p = composeSystemPrompt({ botName: 'nerve' })
    expect(p).toContain('<bot>')
    expect(p).toContain('nerve')
  })

  it('botName 和 bot 都为空时不产生 bot 层', () => {
    const p = composeSystemPrompt({ soul: 'S' })
    expect(p).not.toContain('<bot>')
  })

  it('layer-order 说明 soul 里的名字是工作台名，自己的名字以 bot 层为准', () => {
    const p = composeSystemPrompt({ soul: 'S', botName: 'nerve' })
    expect(p).toContain('你自己的名字以 bot 层为准')
  })
})

  it('soul 旁边有名字冲突纠正，且明确否定「挂名」说法', () => {
    const p = composeSystemPrompt({ soul: '你叫咕嘎', botName: 'nerve' })
    const soulIdx = p.indexOf('</soul>')
    const noteIdx = p.indexOf('<soul-name-note>')
    expect(noteIdx).toBeGreaterThan(soulIdx)
    expect(p).toContain('不是你的名字')
    expect(p).toContain('「挂名」')
  })

  it('没有 botName 时不产生 soul-name-note（避免无意义噪音）', () => {
    const p = composeSystemPrompt({ soul: '你叫咕嘎' })
    expect(p).not.toContain('<soul-name-note>')
  })
