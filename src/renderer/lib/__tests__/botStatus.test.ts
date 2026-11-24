import { describe, expect, it } from 'vitest'
import { DONE_HOLD, ERROR_HOLD, deriveBotStatus, type BotStatusInput } from '../botStatus'

const T = 1_000_000

const base: BotStatusInput = {
  isLoading: false,
  errorAt: 0,
  now: T,
  doneUntil: 0,
  hasRunningTodo: false,
  hasRunningSubagent: false,
}

describe('deriveBotStatus', () => {
  it('空闲：没在跑、也没刚跑完', () => {
    expect(deriveBotStatus(base)).toBe('idle')
  })

  it('thinking：模型在跑但还没有实际动作', () => {
    expect(deriveBotStatus({ ...base, isLoading: true })).toBe('thinking')
  })

  it('busy：有 in_progress 清单项或子任务在跑 → 转环', () => {
    expect(deriveBotStatus({ ...base, isLoading: true, hasRunningTodo: true })).toBe('busy')
    expect(deriveBotStatus({ ...base, isLoading: true, hasRunningSubagent: true })).toBe('busy')
  })

  it('done：跑完的窗口内眨眼，窗口过了回 idle', () => {
    expect(deriveBotStatus({ ...base, doneUntil: T + DONE_HOLD })).toBe('done')
    expect(deriveBotStatus({ ...base, doneUntil: T })).toBe('idle')
  })

  it('error：错误窗口内优先于一切，超时自然回落', () => {
    const errorAt = T - ERROR_HOLD + 1
    expect(deriveBotStatus({ ...base, errorAt })).toBe('error')
    // 出错时即便还有动作在跑，也先闪红点
    expect(deriveBotStatus({ ...base, errorAt, isLoading: true, hasRunningTodo: true })).toBe('error')
    expect(deriveBotStatus({ ...base, errorAt: T - ERROR_HOLD })).toBe('idle')
  })
})
