import { describe, it, expect } from 'vitest'
import { runAgenticLoop } from '../agentic-loop'

// 模型会攒批更新 todo（全历史 4 个带清单的运行，0 个按步更新），
// 提示词只是软约束，所以按步数兜底提醒。这里锁住三条边界：
// 建过清单才提醒 / 隔够步数才提醒 / 提醒后重新计数。

function toolTurn(id: string, name: string, input: unknown = {}) {
  return (async function* () {
    yield { type: 'content_block_start', content_block: { type: 'tool_use', id, name } }
    yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }
    yield { type: 'content_block_stop' }
    yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }
  })()
}

function answer(text: string) {
  return (async function* () {
    yield { type: 'content_block_start', content_block: { type: 'text' } }
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
    yield { type: 'content_block_stop' }
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }
  })()
}

function runWith(turns: Array<() => unknown>, names: string[]) {
  let call = 0
  const client = {
    messages: { create: async () => turns[Math.min(call++, turns.length - 1)]() },
  } as any
  const executors = new Map(names.map((n) => [n, async () => ({ ok: true })]))
  const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: '干活' }]
  return runAgenticLoop({
    client, modelId: 'test', providerType: 'anthropic', system: 's',
    tools: [], toolExecutors: executors, messages, maxSteps: 20,
  }).then(() => messages)
}

const nudges = (messages: Array<{ role: string; content: unknown }>) =>
  messages.filter((m) => JSON.stringify(m.content || '').includes('任务清单该更新了')).length

describe('agentic-loop 清单提醒', () => {
  it('没建过清单的运行不打扰（简单任务）', async () => {
    const messages = await runWith(
      [() => toolTurn('a', 'Bash'), () => toolTurn('b', 'Bash'), () => toolTurn('c', 'Bash'),
       () => toolTurn('d', 'Bash'), () => toolTurn('e', 'Bash'), () => toolTurn('f', 'Bash'),
       () => answer('好了')],
      ['Bash'],
    )
    expect(nudges(messages)).toBe(0)
  })

  it('建过清单且连续 5 步未更新 → 提醒一次', async () => {
    const messages = await runWith(
      [() => toolTurn('t0', 'TodoWrite', { todos: [{ content: 'x', status: 'in_progress' }] }),
       () => toolTurn('a', 'Bash'), () => toolTurn('b', 'Bash'), () => toolTurn('c', 'Bash'),
       () => toolTurn('d', 'Bash'), () => toolTurn('e', 'Bash'),
       () => answer('好了')],
      ['Bash', 'TodoWrite'],
    )
    expect(nudges(messages)).toBe(1)
  })

  it('中途更新过清单，计数会重置 → 不提醒', async () => {
    const messages = await runWith(
      [() => toolTurn('t0', 'TodoWrite', { todos: [] }),
       () => toolTurn('a', 'Bash'), () => toolTurn('b', 'Bash'),
       () => toolTurn('t1', 'TodoWrite', { todos: [] }),
       () => toolTurn('c', 'Bash'), () => toolTurn('d', 'Bash'),
       () => answer('好了')],
      ['Bash', 'TodoWrite'],
    )
    expect(nudges(messages)).toBe(0)
  })
})
