import { describe, it, expect } from 'vitest'
import { buildStageView } from '../stageAdapter'
import type { ChatMessage } from '../../../shared/types'

// WebSearch 卡片映射：插件工具 websearch__web_search 的调用/结果要变成 stage 卡片。
// 判据：无结果 → streaming（searching）；有结果 → sources 解析出来；出错 → 不 streaming 且无 sources。
describe('stageAdapter — WebSearch 卡片', () => {
  const msg = (content: ChatMessage['content']): ChatMessage => ({
    id: 'm1',
    role: 'assistant',
    content,
    timestamp: 1000,
    sessionId: 's1',
  })

  const userMsg: ChatMessage = {
    id: 'u1',
    role: 'user',
    content: [{ type: 'text', text: '搜一下 rust async' }],
    timestamp: 900,
    sessionId: 's1',
  }

  const resultBlock = (payload: unknown, isError = false) => ({
    type: 'tool_result' as const,
    toolCallId: 't1',
    content: JSON.stringify(payload),
    is_error: isError || undefined,
  })

  it('无结果时落 searching 卡（streaming=true）', () => {
    const view = buildStageView([
      userMsg,
      msg([{ type: 'tool_use', id: 't1', name: 'websearch__web_search', input: { query: 'rust async' } }]),
    ])
    const card = view.cards.map((c) => c.card).find((c) => c.kind === 'websearch')
    expect(card).toBeTruthy()
    expect(card!.streaming).toBe(true)
    expect(card!.query).toBe('rust async')
  })

  it('有结果时解析出 sources，streaming=false', () => {
    const sources = [
      { id: 's1', title: 'Tokio', url: 'https://tokio.rs/', snippet: 'async runtime', favicon: 'https://x/f.ico' },
      { id: 's2', title: 'async-std', url: 'https://async.rs/', snippet: 'std', favicon: 'https://x/g.ico' },
    ]
    const view = buildStageView([
      userMsg,
      msg([
        { type: 'tool_use', id: 't1', name: 'websearch__web_search', input: { query: 'rust async' } },
        resultBlock({ query: 'rust async', count: 2, provider: 'duckduckgo', sources }),
      ]),
    ])
    const card = view.cards.map((c) => c.card).find((c) => c.kind === 'websearch')
    expect(card).toBeTruthy()
    expect(card!.sources).toHaveLength(2)
    expect(card!.sources![0].url).toBe('https://tokio.rs/')
    expect(card!.streaming).toBe(false)
  })

  it('出错时不出 sources 且不显示 searching', () => {
    const view = buildStageView([
      userMsg,
      msg([
        { type: 'tool_use', id: 't1', name: 'websearch__web_search', input: { query: 'x' } },
        resultBlock({ error: 'network' }, true),
      ]),
    ])
    const card = view.cards.map((c) => c.card).find((c) => c.kind === 'websearch')
    expect(card).toBeTruthy()
    expect(card!.sources ?? []).toHaveLength(0)
    expect(card!.streaming).toBe(false)
  })
})
