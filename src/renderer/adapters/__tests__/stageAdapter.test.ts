import { describe, it, expect } from 'vitest'
import { buildStageView, extractCodeBlocks } from '../stageAdapter'
import type { ChatMessage, ContentBlock } from '../../../shared/types'

const text = (t: string): ContentBlock => ({ type: 'text', text: t })

const msg = (id: string, role: 'user' | 'assistant', ts: number, ...content: ContentBlock[]): ChatMessage => ({
  id,
  role,
  content,
  timestamp: ts,
})

describe('buildStageView — 新一轮发出时的旁白清除', () => {
  const round1 = [
    msg('u1', 'user', 1000, text('第一个问题')),
    msg('a1', 'assistant', 1100, text('第一个回答')),
  ]

  it('回复完成后正常显示该轮旁白', () => {
    const vm = buildStageView(round1)
    expect(vm.narrationText).toBe('第一个回答')
    expect(vm.focusRoundId).toBe('u1')
  })

  it('发出下一条消息（空轮等待回复）时立即清空上一轮旁白', () => {
    const vm = buildStageView([...round1, msg('u2', 'user', 2000, text('第二个问题'))])
    expect(vm.narrationText).toBe('')
  })

  it('新回复文字流入后旁白恢复为新内容', () => {
    const vm = buildStageView([
      ...round1,
      msg('u2', 'user', 2000, text('第二个问题')),
      msg('a2', 'assistant', 2100, text('第二个回答')),
    ])
    expect(vm.narrationText).toBe('第二个回答')
    expect(vm.focusRoundId).toBe('u2')
  })

  it('手动选中旧轮回看时不受新空轮影响', () => {
    const vm = buildStageView([...round1, msg('u2', 'user', 2000, text('第二个问题'))], 'u1')
    expect(vm.narrationText).toBe('第一个回答')
    expect(vm.focusRoundId).toBe('u1')
  })
})

describe('extractCodeBlocks — 代码块抽取', () => {
  it('抽取带语言的代码块并保留剩余文字', () => {
    const { prose, codeBlocks } = extractCodeBlocks('说明文字\n\n```ts\nconst a = 1\n```\n\n结尾')
    expect(codeBlocks).toEqual([{ language: 'ts', code: 'const a = 1' }])
    expect(prose).toBe('说明文字\n\n结尾')
  })

  it('支持无语言标注与多代码块', () => {
    const { prose, codeBlocks } = extractCodeBlocks('```\nplain\n```\n中间\n```python\nprint(1)\n```')
    expect(codeBlocks).toEqual([
      { language: '', code: 'plain' },
      { language: 'python', code: 'print(1)' },
    ])
    expect(prose).toBe('中间')
  })

  it('代码块尾部的换行不进入 code', () => {
    const { codeBlocks } = extractCodeBlocks('```js\nconst a = 1\n\n```')
    expect(codeBlocks[0].code).toBe('const a = 1')
  })

  it('没有代码块时原样返回', () => {
    const src = '纯文字，没有代码'
    const { prose, codeBlocks } = extractCodeBlocks(src)
    expect(codeBlocks).toEqual([])
    expect(prose).toBe(src)
  })
})

describe('buildStageView — 代码块产物卡', () => {
  const CODE = '```ts\nexport async function churnBatch() {\n  return null;\n}\n```'

  it('纯代码回复：代码成卡、不走旁白', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('写个函数')),
      msg('a1', 'assistant', 1100, text(CODE)),
    ])
    expect(vm.narrationText).toBe('')
    expect(vm.cards).toHaveLength(1)
    const { card } = vm.cards[0]
    expect(card.kind).toBe('code')
    expect(card.language).toBe('ts')
    expect(card.code).toContain('churnBatch')
  })

  it('文字 + 代码：代码成卡，文字转为批注', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('写个函数')),
      msg('a1', 'assistant', 1100, text(`实现如下：\n${CODE}\n以上。`)),
    ])
    expect(vm.cards).toHaveLength(1)
    expect(vm.cards[0].card.kind).toBe('code')
    expect(vm.cards[0].annotations?.join('')).toContain('实现如下')
    expect(vm.cards[0].annotations?.join('')).toContain('以上')
    expect(vm.narrationText).toBe('')
  })

  it('无代码回复行为不变（仍走旁白）', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('你好')),
      msg('a1', 'assistant', 1100, text('普通回答')),
    ])
    expect(vm.narrationText).toBe('普通回答')
    expect(vm.cards).toHaveLength(0)
  })
})
