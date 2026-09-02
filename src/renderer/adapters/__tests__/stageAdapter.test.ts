import { describe, it, expect } from 'vitest'
import { buildStageView } from '../stageAdapter'
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
