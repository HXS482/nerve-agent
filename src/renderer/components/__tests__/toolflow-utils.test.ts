import { describe, it, expect } from 'vitest'
import { groupBlocks } from '../toolflow-utils'
import type { ContentBlock } from '../../../shared/types'

const think = (t: string): ContentBlock => ({ type: 'thinking', thinking: t })
const tuse = (name: string, id: string): ContentBlock => ({ type: 'tool_use', name, id })
const tres = (id: string, err = false): ContentBlock => ({ type: 'tool_result', toolCallId: id, content: '', is_error: err })
const text = (t: string): ContentBlock => ({ type: 'text', text: t })
const img = (): ContentBlock => ({ type: 'image', src: 'x.png' })

describe('groupBlocks', () => {
  it('packs consecutive thinking+tool blocks into one toolflow group', () => {
    const blocks = [think('a'), tuse('Read', '1'), tres('1'), tuse('Bash', '2'), tres('2')]
    const groups = groupBlocks(blocks)
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('toolflow')
    expect(groups[0].kind === 'toolflow' && groups[0].blocks).toHaveLength(5)
  })

  it('splits group when text block appears (produces multiple toolflow groups)', () => {
    const blocks = [think('a'), tuse('Read', '1'), tres('1'), text('正文'), tuse('Bash', '2'), tres('2')]
    const groups = groupBlocks(blocks)
    expect(groups).toHaveLength(3)
    expect(groups[0].kind).toBe('toolflow')
    expect(groups[1].kind).toBe('inline')
    expect(groups[2].kind).toBe('toolflow')
  })

  it('treats image/file as inline group that splits toolflow', () => {
    const groups = groupBlocks([tuse('Read', '1'), img(), tres('1')])
    expect(groups).toHaveLength(3)
    expect(groups[0].kind).toBe('toolflow')
    expect(groups[1].kind).toBe('inline')
    expect(groups[2].kind).toBe('toolflow')
  })

  it('thinking-only blocks form a toolflow group', () => {
    const groups = groupBlocks([think('a'), think('b')])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('toolflow')
  })

  it('text-only content yields only inline groups', () => {
    const groups = groupBlocks([text('a'), text('b')])
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.kind === 'inline')).toBe(true)
  })

  it('empty array yields empty array', () => {
    expect(groupBlocks([])).toEqual([])
  })
})

import { pairTools } from '../toolflow-utils'

describe('pairTools', () => {
  it('pairs tool_use with matching tool_result by id', () => {
    const blocks = [tuse('Read', '1'), tres('1')]
    const { tools } = pairTools(blocks)
    expect(tools).toHaveLength(1)
    expect(tools[0].use.id).toBe('1')
    expect(tools[0].result?.toolCallId).toBe('1')
  })

  it('leaves running status when tool_use has no result', () => {
    const blocks = [tuse('Read', '1')]
    const { tools } = pairTools(blocks)
    expect(tools).toHaveLength(1)
    expect(tools[0].result).toBeUndefined()
  })

  it('accumulates all thinking text into reasoningText', () => {
    const blocks = [think('第一段'), tuse('Read', '1'), tres('1'), think('第二段')]
    const { reasoningText, tools } = pairTools(blocks)
    expect(reasoningText).toBe('第一段\n第二段')
    expect(tools).toHaveLength(1)
  })

  it('handles orphan tool_result (no matching use)', () => {
    const blocks = [tres('orphan')]
    const { tools } = pairTools(blocks)
    expect(tools).toHaveLength(1)
    expect(tools[0].result?.toolCallId).toBe('orphan')
  })

  it('returns empty reasoningText and tools for empty input', () => {
    const { reasoningText, tools } = pairTools([])
    expect(reasoningText).toBe('')
    expect(tools).toEqual([])
  })

  it('pairs parallel tool results correctly regardless of arrival order', () => {
    const blocks = [tuse('Read', '1'), tuse('Read', '2'), tres('2'), tres('1')]
    const { tools } = pairTools(blocks)
    expect(tools).toHaveLength(2)
    expect(tools[0].use.id).toBe('1')
    expect(tools[0].result?.toolCallId).toBe('1')
    expect(tools[1].use.id).toBe('2')
    expect(tools[1].result?.toolCallId).toBe('2')
  })

  it('pairs results arriving in order after parallel uses', () => {
    const blocks = [tuse('Read', '1'), tuse('Read', '2'), tres('1'), tres('2')]
    const { tools } = pairTools(blocks)
    expect(tools).toHaveLength(2)
    expect(tools[0].result?.toolCallId).toBe('1')
    expect(tools[1].result?.toolCallId).toBe('2')
  })
})

import { deriveUnitStatus } from '../toolflow-utils'

describe('deriveUnitStatus', () => {
  it('returns active when a tool_use has no result yet', () => {
    const blocks = [tuse('Read', '1')]
    expect(deriveUnitStatus(blocks)).toBe('active')
  })

  it('returns active when last block is thinking (still streaming)', () => {
    const blocks = [tuse('Read', '1'), tres('1'), think('思考中…')]
    expect(deriveUnitStatus(blocks)).toBe('active')
  })

  it('returns done when all tools have non-error results', () => {
    const blocks = [tuse('Read', '1'), tres('1'), tuse('Bash', '2'), tres('2')]
    expect(deriveUnitStatus(blocks)).toBe('done')
  })

  it('returns error when any tool_result has is_error', () => {
    const blocks = [tuse('Read', '1'), tres('1'), tuse('Bash', '2'), tres('2', true)]
    expect(deriveUnitStatus(blocks)).toBe('error')
  })

  it('returns done for thinking-only blocks (no pending tools)', () => {
    const blocks = [think('a'), think('b')]
    expect(deriveUnitStatus(blocks)).toBe('done')
  })
})
