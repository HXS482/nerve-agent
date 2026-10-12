import type { BotStatus } from './GrokBot'

/**
 * Grok Bot 的状态判定是纯函数（时间窗 + 三个布尔量），单独放这里：
 * 一是不用为了测它去拉起 store 和 React，二是把"多久算还在出错"这类
 * 节奏常数集中在一处，改动画节奏时只动这里。
 */

/** 错误展示时长：够 `alert` 播完一轮（2.4s）再落回 idle，不用等用户点掉 */
export const ERROR_HOLD = 4000
/** 收尾展示时长：`wink` 一次（1.6s）+ 余量，超时必须回 idle，否则会反复眨眼 */
export const DONE_HOLD = 2600

export interface BotStatusInput {
  isLoading: boolean
  /** 最近一次错误的时间戳，0 = 这一轮还没出过错 */
  errorAt: number
  now: number
  /** done 的展示截止时间戳，0 = 不展示 */
  doneUntil: number
  /** 有 in_progress 的清单项 / 有在跑的子任务：都在"真干活"，转环比脉动准 */
  hasRunningTodo: boolean
  hasRunningSubagent: boolean
}

/** 优先级：error > busy > thinking > done > idle */
export function deriveBotStatus(i: BotStatusInput): BotStatus {
  if (i.errorAt > 0 && i.now - i.errorAt < ERROR_HOLD) return 'error'
  if (i.isLoading) return i.hasRunningTodo || i.hasRunningSubagent ? 'busy' : 'thinking'
  return i.doneUntil > i.now ? 'done' : 'idle'
}
