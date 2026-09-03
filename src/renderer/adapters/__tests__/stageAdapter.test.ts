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

describe('buildStageView — 图片生成卡全生命周期', () => {
  const genUse: ContentBlock = {
    type: 'tool_use',
    id: 'toolu_1',
    name: 'GenerateImage',
    input: { prompt: 'a calm mountain lake at dawn', size: '1024x1792' },
  }
  const genResult: ContentBlock = { type: 'tool_result', toolCallId: 'toolu_1', content: '{"path":"/gallery/a.png"}' }

  it('GenerateImage 未出结果时落生成中占位卡（kind image、无 block）', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('画张图')),
      msg('a1', 'assistant', 1100, genUse),
    ])
    expect(vm.cards).toHaveLength(1)
    const { card } = vm.cards[0]
    expect(card.kind).toBe('image')
    expect(card.block).toBeUndefined()
    expect(card.prompt).toBe('a calm mountain lake at dawn')
    expect(card.resolution).toBe('1024 × 1792')
    expect(vm.narrationText).toBe('')
  })

  it('结果到达后同 id 换为真实图片卡（不重挂载）', () => {
    const pending = buildStageView([
      msg('u1', 'user', 1000, text('画张图')),
      msg('a1', 'assistant', 1100, genUse),
    ])
    const done = buildStageView([
      msg('u1', 'user', 1000, text('画张图')),
      msg('a1', 'assistant', 1100, genUse, genResult, { type: 'image', src: '/gallery/a.png' }),
    ])
    expect(done.cards).toHaveLength(1)
    const { card } = done.cards[0]
    expect(card.id).toBe(pending.cards[0].card.id)
    expect(card.kind).toBe('image')
    expect(card.block?.src).toBe('/gallery/a.png')
    expect(card.prompt).toBe('a calm mountain lake at dawn')
  })

  it('IPC 空窗（结果已到、图片块未流入）占位卡保持生成中且 id 不变', () => {
    const pending = buildStageView([
      msg('u1', 'user', 1000, text('画张图')),
      msg('a1', 'assistant', 1100, genUse),
    ])
    const gap = buildStageView([
      msg('u1', 'user', 1000, text('画张图')),
      msg('a1', 'assistant', 1100, genUse, genResult),
    ])
    expect(gap.cards).toHaveLength(1)
    const { card } = gap.cards[0]
    expect(card.id).toBe(pending.cards[0].card.id)
    expect(card.kind).toBe('image')
    expect(card.block).toBeUndefined()
  })

  it('非队尾的历史消息不补空窗占位卡', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('画张图')),
      msg('a1', 'assistant', 1100, genUse, genResult),
      msg('u2', 'user', 2000, text('再说点啥')),
      msg('a2', 'assistant', 2100, text('好的')),
    ])
    expect(vm.cards.filter(({ card }) => card.id.startsWith('a1:gen'))).toHaveLength(0)
  })

  it('GenerateImage 失败（error result）时占位卡消失', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('画张图')),
      msg('a1', 'assistant', 1100, genUse, { ...genResult, is_error: true, content: '{"error":"boom"}' }),
    ])
    expect(vm.cards).toHaveLength(0)
  })

  it('其他工具的未配对调用不产生占位卡', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('跑个命令')),
      msg('a1', 'assistant', 1100, { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'ls' } }),
    ])
    expect(vm.cards).toHaveLength(0)
  })

  it('无 GenerateImage 的普通图片不附带 prompt，维持 im 卡 id', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('看图')),
      msg('a1', 'assistant', 1100, { type: 'image', src: '/gallery/b.png' }),
    ])
    expect(vm.cards).toHaveLength(1)
    const { card } = vm.cards[0]
    expect(card.kind).toBe('image')
    expect(card.id).toContain(':im')
    expect(card.prompt).toBeUndefined()
  })
})

describe('buildStageView — Write .html 网页产物卡', () => {
  const htmlUse: ContentBlock = {
    type: 'tool_use',
    id: 'toolu_w1',
    name: 'Write',
    input: { file_path: 'G:\\work\\game.html', content: '<!DOCTYPE html><html><body>game</body></html>' },
  }
  const writeResult: ContentBlock = { type: 'tool_result', toolCallId: 'toolu_w1', content: '{"file_path":"G:\\\\work\\\\game.html"}' }

  it('Write 写入 .html 完成后落 web 卡（含 HTML 全文与文件名）', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('写个小游戏')),
      msg('a1', 'assistant', 1100, htmlUse, writeResult),
    ])
    expect(vm.cards).toHaveLength(1)
    const { card } = vm.cards[0]
    expect(card.kind).toBe('web')
    expect(card.html).toContain('game')
    expect(card.label).toBe('game.html')
  })

  it('Write 未完成 / 写入非 html 文件时不落 web 卡', () => {
    const pending = buildStageView([
      msg('u1', 'user', 1000, text('写个小游戏')),
      msg('a1', 'assistant', 1100, htmlUse),
    ])
    expect(pending.cards).toHaveLength(0)

    const tsFile = buildStageView([
      msg('u1', 'user', 1000, text('写个脚本')),
      msg('a1', 'assistant', 1100,
        { type: 'tool_use', id: 'toolu_w2', name: 'Write', input: { file_path: 'a.ts', content: 'const a = 1' } },
        { type: 'tool_result', toolCallId: 'toolu_w2', content: '{}' }),
    ])
    expect(tsFile.cards).toHaveLength(0)
  })
})
