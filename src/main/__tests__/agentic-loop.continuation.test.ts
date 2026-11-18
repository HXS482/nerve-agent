import { describe, it, expect } from 'vitest'
import { runAgenticLoop } from '../agentic-loop'

// 复现事故：推理模型的 thinking 吃满 max_tokens，整轮没有可见输出，
// 循环却当"正常说完"收工 —— 渲染层于是看到输入框变空闲但任务没做完。
// 现在应当自动续跑；续跑用尽后如实把 max_tokens 报上去。

function thinkingOnlyTruncated() {
  return (async function* () {
    yield { type: 'content_block_start', content_block: { type: 'thinking' } }
    yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '想了很久……' } }
    yield { type: 'content_block_stop' }
    yield { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 16384 } }
  })()
}

function normalAnswer(text: string) {
  return (async function* () {
    yield { type: 'content_block_start', content_block: { type: 'text' } }
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
    yield { type: 'content_block_stop' }
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } }
  })()
}

// factories 而不是现成的流：每次请求都得新建一个生成器（耗尽的生成器再迭代是空的）
function fakeClient(factories: Array<() => unknown>) {
  let call = 0
  return {
    calls: () => call,
    client: {
      messages: {
        create: async () => factories[Math.min(call++, factories.length - 1)](),
      },
    } as any,
  }
}

const base = {
  modelId: 'deepseek-flash',
  providerType: 'anthropic' as const,
  system: 'sys',
  tools: [],
  toolExecutors: new Map<string, (args: any) => Promise<any>>(),
  maxSteps: 10,
}

describe('agentic-loop 截断续跑', () => {
  it('截断且无可见输出：不结束，续跑拿到正文', async () => {
    const { client, calls } = fakeClient([thinkingOnlyTruncated, () => normalAnswer('接着写完了')])
    const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: '写个西湖页面' }]

    const result = await runAgenticLoop({ ...base, client, messages })

    expect(calls()).toBe(2)
    expect(result.stopReason).toBe('end_turn')
    // 截断那条（只有 thinking）保留在 history 里：thinking 块本来就要回传，
    // 也靠它维持 user/assistant 交替
    const assistantTurns = messages.filter((m) => m.role === 'assistant')
    expect(assistantTurns).toHaveLength(2)
    expect(JSON.stringify(assistantTurns[1])).toContain('接着写完了')
    // Anthropic 要求严格交替：不能出现两条连续的 user
    expect(messages.some((m, i) => i > 0 && m.role === 'user' && messages[i - 1].role === 'user')).toBe(false)
  })

  it('连续截断用尽续跑次数后，如实返回 max_tokens（交给上层给用户可见提示）', async () => {
    const { client, calls } = fakeClient([thinkingOnlyTruncated])
    const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: '写个西湖页面' }]

    const result = await runAgenticLoop({ ...base, client, messages })

    // 1 次原始调用 + 3 次续跑
    expect(calls()).toBe(4)
    expect(result.stopReason).toBe('max_tokens')
  })

  it('正常结束不受影响：不做任何续跑', async () => {
    const { client, calls } = fakeClient([() => normalAnswer('一次就好')])
    const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: '你好' }]

    const result = await runAgenticLoop({ ...base, client, messages })

    expect(calls()).toBe(1)
    expect(result.stopReason).toBe('end_turn')
  })
})

// 后台作业结果的自动投递：作业跑完的结果要自己出现在下一步，不能靠模型想起来去取。
// 事故背景：50 步的 run 里 48 次 Bash 调用、0 次带 visit_jobs —— 模型宁可 echo 空转。
describe('agentic-loop 后台作业自动投递', () => {
  it('drainJobs 的内容被拼进下一步的 user 消息', async () => {
    let drainCalls = 0
    const { client } = fakeClient([
      // 第一步：问模型要工具
      () => (async function* () {
        yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'Bash' } }
        yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"command":"sleep 40"}' } }
        yield { type: 'content_block_stop' }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } }
      })(),
      () => normalAnswer('好了'),
    ])

    const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: '跑长命令' }]
    const result = await runAgenticLoop({
      ...base,
      client,
      messages,
      toolExecutors: new Map([['Bash', async () => ({ content: '已转入后台 jobId: abc' })]]),
      drainJobs: () => {
        drainCalls++
        return drainCalls === 1 ? '[后台作业已完成 1 个] 结果正文' : ''
      },
    })

    expect(result.stopReason).toBe('end_turn')
    expect(drainCalls).toBeGreaterThan(0)
    // 注入的那条必须是独立的 text block，不能挂在 tool_result 上（真 Anthropic 会 400）
    const flat = JSON.stringify(messages)
    expect(flat).toContain('后台作业已完成')
    const injected = messages.filter(
      (m) => m.role === 'user' && JSON.stringify(m.content).includes('后台作业已完成'),
    )
    expect(injected).toHaveLength(1)
  })
})
