/**
 * Bot 的状态判定（纯函数）。
 *
 * 与渲染无关：只把「这一轮到底在干嘛」翻译成五个状态之一，所以能脱离 React
 * 单独测。节奏常数集中在这里，改动画节拍时只动这一个文件。
 */

/**
 * 头像的状态。渲染层把它映射成 open-bot-avatar 的 AvatarState：
 *
 *   idle     → idle
 *   thinking → thinking   （三点脉动）
 *   busy     → working    （环带扫过身体）
 *   done     → done       （转几圈、丝带飞一下）
 *   error    → blocked    （身体换成感叹号）
 */
export type BotStatus = 'idle' | 'thinking' | 'busy' | 'done' | 'error'

/** 错误展示时长：够 blocked 播完一轮再落回 idle，不用等用户点掉 */
export const ERROR_HOLD = 4000
/** 收尾展示时长：done 的一次庆祝 + 余量，超时必须回 idle，否则会一直转 */
export const DONE_HOLD = 2600

export interface BotStatusInput {
  isLoading: boolean
  /** 最近一次错误的时间戳，0 = 这一轮还没出过错 */
  errorAt: number
  now: number
  /** done 的展示截止时间戳，0 = 不展示 */
  doneUntil: number
  /** 有 in_progress 的清单项 / 有在跑的子任务：都在"真干活"，环带比脉动准 */
  hasRunningTodo: boolean
  hasRunningSubagent: boolean
}

/** 优先级：error > busy > thinking > done > idle */
export function deriveBotStatus(i: BotStatusInput): BotStatus {
  if (i.errorAt > 0 && i.now - i.errorAt < ERROR_HOLD) return 'error'
  if (i.isLoading) return i.hasRunningTodo || i.hasRunningSubagent ? 'busy' : 'thinking'
  return i.doneUntil > i.now ? 'done' : 'idle'
}
