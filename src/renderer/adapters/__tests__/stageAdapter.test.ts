import { describe, it, expect } from 'vitest'
import { buildStageView, extractCodeBlocks, extractImageRefs, listSessionImageCards } from '../stageAdapter'
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

  it('围栏前的引导短句（冒号结尾）绑定为该块的 caption，从正文剥离', () => {
    const { prose, codeBlocks } = extractCodeBlocks('结果如下：\n\n输出：\n```text\nhello\n```\n')
    expect(codeBlocks).toEqual([{ language: 'text', code: 'hello', caption: '输出：' }])
    expect(prose).toBe('结果如下：')
  })

  it('围栏前是普通句子（句号结尾）时不抢作 caption', () => {
    const { prose, codeBlocks } = extractCodeBlocks('这是一个回文函数。\n```python\ndef f():\n    pass\n```')
    expect(codeBlocks[0].caption).toBeUndefined()
    expect(prose).toBe('这是一个回文函数。')
  })
})

describe('buildStageView — 代码块随正文渲染（不落独立代码卡）', () => {
  const CODE = '```ts\nexport async function churnBatch() {\n  return null;\n}\n```'

  it('纯代码回复：代码随正文走旁白，不落卡', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('写个函数')),
      msg('a1', 'assistant', 1100, text(CODE)),
    ])
    expect(vm.narrationText).toContain('churnBatch')
    expect(vm.cards).toHaveLength(0)
  })

  it('文字 + 代码：整体走旁白，不落卡、无批注', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('写个函数')),
      msg('a1', 'assistant', 1100, text(`实现如下：\n${CODE}\n以上。`)),
    ])
    expect(vm.cards).toHaveLength(0)
    expect(vm.narrationText).toContain('实现如下：')
    expect(vm.narrationText).toContain('以上')
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

describe('buildStageView — 正文图片路径引用抽卡（skill/Bash 生图路径）', () => {
  it('正文提及带目录的图片路径 → 落图片卡，路径从旁白剥离', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('生成一张服务器的图片')),
      msg('a1', 'assistant', 1100, text('图片生成完毕 ✅\n\n已保存至画廊：`.nerve\\gallery\\server-rack-datacenter.png`\n\n极简黑白风格。')),
    ])
    expect(vm.cards).toHaveLength(1)
    const { card } = vm.cards[0]
    expect(card.kind).toBe('image')
    expect(card.block?.src).toBe('.nerve\\gallery\\server-rack-datacenter.png')
    // 有产物卡 → 文字走批注而非旁白，且批注里不含路径
    expect(vm.narrationText).toBe('')
    expect(vm.cards[0].annotations?.join('')).toContain('极简黑白风格')
    expect(vm.cards[0].annotations?.join('')).not.toContain('.png')
  })

  it('裸文件名（无目录分隔符）不抽卡', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('说件事')),
      msg('a1', 'assistant', 1100, text('文件 server-rack.png 已经在那了')),
    ])
    expect(vm.cards).toHaveLength(0)
    expect(vm.narrationText).toContain('server-rack.png')
  })

  it('正文引用与图片块同 src 时不重复落卡', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('看图')),
      msg('a1', 'assistant', 1100,
        text('保存在 .nerve/gallery/a.png 里'),
        { type: 'image', src: '.nerve/gallery/a.png' }),
    ])
    expect(vm.cards).toHaveLength(1)
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

  it('同一轮对同一 html 迭代 Write 只落一张卡（内容为最后一次覆盖）', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('写个页面')),
      msg('a1', 'assistant', 1100,
        { type: 'tool_use', id: 'toolu_w1', name: 'Write', input: { file_path: 'game.html', content: '<html>v1</html>' } },
        { type: 'tool_result', toolCallId: 'toolu_w1', content: '{}' },
        { type: 'tool_use', id: 'toolu_w2', name: 'Write', input: { file_path: 'game.html', content: '<html>v2</html>' } },
        { type: 'tool_result', toolCallId: 'toolu_w2', content: '{}' }),
    ])
    expect(vm.cards).toHaveLength(1)
    expect(vm.cards[0].card.kind).toBe('web')
    expect(vm.cards[0].card.html).toContain('v2')
    expect(vm.cards[0].card.label).toBe('game.html')
  })

  it('Write 未完成不落 web 卡；写入代码文件改道 codingOps（不落画布卡）', () => {
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
    // 代码文件走 coding 控制台（codingOps），画布不落卡
    expect(tsFile.cards).toHaveLength(0)
  })
})

describe('buildStageView — 画布只展示焦点轮（新指令清空画布）', () => {
  const CODE = '```ts\nconst a = 1\n```'
  const twoRounds = [
    msg('u1', 'user', 1000, text('第一个任务')),
    msg('a1', 'assistant', 1100, text(CODE)),
    msg('u2', 'user', 2000, text('第二个任务')),
    msg('a2', 'assistant', 2100, text('```ts\nconst b = 2\n```')),
  ]

  it('默认只显示最新轮的旁白内容，旧轮不堆积', () => {
    const vm = buildStageView(twoRounds)
    expect(vm.narrationText).toContain('const b')
  })

  it('发出新指令等待回复时画布清空', () => {
    const vm = buildStageView([
      ...twoRounds,
      msg('u3', 'user', 3000, text('第三个任务')),
    ])
    expect(vm.cards).toHaveLength(0)
    expect(vm.narrationText).toBe('')
  })

  it('选中旧轮可回看该轮正文', () => {
    const vm = buildStageView(twoRounds, 'u1')
    expect(vm.narrationText).toContain('const a')
  })

  it('listSessionImageCards 不受画布清空影响，返回全量图片卡', () => {
    const withImages = [
      msg('u1', 'user', 1000, text('图一')),
      msg('a1', 'assistant', 1100, { type: 'image', src: '/gallery/1.png' }),
      msg('u2', 'user', 2000, text('图二')),
      msg('a2', 'assistant', 2100, { type: 'image', src: '/gallery/2.png' }),
      msg('u3', 'user', 3000, text('等待中')),
    ]
    const cards = listSessionImageCards(withImages)
    expect(cards).toHaveLength(2)
    expect(cards.map((c) => c.block?.src)).toEqual(['/gallery/1.png', '/gallery/2.png'])
  })
})

describe('buildStageView — 用户消息列表行的产物标记 artifactKinds', () => {
  it('按轮去重汇总产物卡类型；纯文字轮为空数组', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('画图兼写代码')),
      msg('a1', 'assistant', 1100,
        { type: 'image', src: '/gallery/a.png' },
        text('```ts\nconst a = 1\n```')),
      msg('u2', 'user', 2000, text('随便聊聊')),
      msg('a2', 'assistant', 2100, text('好的')),
    ])
    const r1 = vm.rounds.find((r) => r.id === 'u1')
    const r2 = vm.rounds.find((r) => r.id === 'u2')
    // 围栏代码不再落卡，随正文走旁白 → 该轮只有 image 一种产物卡
    expect(r1?.artifactKinds).toEqual(['image'])
    expect(r2?.artifactKinds).toEqual([])
  })

  it('同类型多张卡只出现一次', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('两张图')),
      msg('a1', 'assistant', 1100,
        { type: 'image', src: '/gallery/1.png' },
        { type: 'image', src: '/gallery/2.png' }),
    ])
    expect(vm.rounds[0].artifactKinds).toEqual(['image'])
  })
})

describe('buildStageView — coding 轮（Write 代码文件）的围栏改道', () => {
  const CODE = 'def is_palindrome(s):\n    return s == s[::-1]'
  const writePy: ContentBlock = {
    type: 'tool_use',
    id: 'toolu_f1',
    name: 'Write',
    input: { file_path: 'G:/work/palindrome.py', content: CODE },
  }
  const writeOk: ContentBlock = { type: 'tool_result', toolCallId: 'toolu_f1', content: '{"file_path":"G:\\work\\palindrome.py"}' }

  it('coding 轮的围栏代码改道 codingOps，不落画布卡（正文保留原文）', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('写个回文函数')),
      msg('a1', 'assistant', 1100, writePy, writeOk, text(`已写入：\n\n\`\`\`python\n${CODE}\n\`\`\``)),
    ])
    // coding 轮：围栏代码并入 codingOps（供控制台参考），画布不落代码卡；
    // 正文保留原文（含围栏），走旁白展示
    expect(vm.cards.filter(({ card }) => card.kind === 'code')).toHaveLength(0)
    expect(vm.narrationText).toContain('已写入')
    expect(vm.narrationText).toContain('is_palindrome')
  })

  it('无 Write 活动的纯围栏轮走旁白正文', () => {
    const vm = buildStageView([
      msg('u1', 'user', 1000, text('写个回文函数')),
      msg('a1', 'assistant', 1100, text(`\`\`\`python\n${CODE}\n\`\`\``)),
    ])
    expect(vm.cards).toHaveLength(0)
    expect(vm.narrationText).toContain('is_palindrome')
  })
})
