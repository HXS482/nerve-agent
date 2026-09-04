import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentCore } from '../../core/agent-core'
import { FileSessionStore } from '../../session-store'

// 回放重建：存储层把多 step 拍平成一条 assistant entry（text 在 tool_use 前、图片块在末尾），
// 回放给模型时必须还原真实因果顺序，否则模型会学到"先宣布完成再调工具"并重复执行历史里的旧指令。
describe('loadConversationHistory — 历史回放结构', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nerve-replay-test-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  const appendTurn = async (sessionId: string) => {
    const store = await FileSessionStore.create(join(tmp, '.nerve', 'sessions'))
    await store.append({ sessionId }, [
      { type: 'user', message: { content: '生成一张图' }, timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: '想一下' },
            { type: 'text', text: '图片生成完毕' },
            { type: 'tool_use', id: 't1', name: 'GenerateImage', input: { prompt: 'cat' } },
            { type: 'tool_result', tool_use_id: 't1', content: '{"path":"x.png"}' },
            { type: 'image', src: 'G:\\x\\gallery\\gen-1.png' },
          ],
        },
        timestamp: new Date().toISOString(),
      },
    ])
  }

  it('含工具调用的轮次回放为 工具调用→结果→收尾文本 的真实顺序', async () => {
    await appendTurn('s1')
    const core = new AgentCore({ projectDir: tmp, sourceDir: tmp, settings: { cwd: tmp } as any })
    const messages = await (core as any).loadConversationHistory('s1')

    expect(messages).toHaveLength(4)
    expect(messages[0].role).toBe('user')

    expect(messages[1].role).toBe('assistant')
    expect((messages[1].content as any[]).map((b) => b.type)).toEqual(['thinking', 'tool_use'])

    expect(messages[2].role).toBe('user')
    expect((messages[2].content as any[])[0].type).toBe('tool_result')

    expect(messages[3].role).toBe('assistant')
    const tail = messages[3].content as any[]
    expect(tail[0].text).toBe('图片生成完毕')
    expect(tail[1].text).toBe('[已生成图片: gen-1.png]')
  })

  it('纯文本轮回放保持单条 assistant 不变', async () => {
    const store = await FileSessionStore.create(join(tmp, '.nerve', 'sessions'))
    await store.append({ sessionId: 's2' }, [
      { type: 'user', message: { content: '你好' }, timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: '嗯' }, { type: 'text', text: '你好呀' }] },
        timestamp: new Date().toISOString(),
      },
    ])
    const core = new AgentCore({ projectDir: tmp, sourceDir: tmp, settings: { cwd: tmp } as any })
    const messages = await (core as any).loadConversationHistory('s2')

    expect(messages).toHaveLength(2)
    expect(messages[1].role).toBe('assistant')
    expect((messages[1].content as any[]).map((b) => b.type)).toEqual(['thinking', 'text'])
  })
})
