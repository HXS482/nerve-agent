/**
 * Ticket 阶段判定。
 *
 * 表自上而下读，第一个命中的行胜出（顺序即优先级）。
 * 设计来源：DSH Super-agent 的 stage table —— 越需要人的阶段排得越前。
 */

import type { AssignmentRow, TicketStage } from '../store/ticket-types'

export interface StageInput {
  /** 最新的 Assignment；没有过 Assignment 时为 undefined */
  assignment?: AssignmentRow
  /** 上一条 Input 投递失败，正在重试 */
  deliveryFailed?: boolean
  /** 有一个等人工回答的问题 */
  hasAttention?: boolean
  /** 最新一次 worker Report */
  lastReport?: 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed'
  /** 自那次 blocked/failed 之后，人是否发过言（发了就解冻） */
  humanMessageSinceReport?: boolean
}

export function computeStage(input: StageInput): TicketStage {
  // 一级：等投递重试。投递都没成功，后面全无意义。
  if (input.deliveryFailed) return 'delivery'

  // 二级：等人工回答。问题没答，既谈不上验收也谈不上继续。
  if (input.hasAttention) return 'answer'

  // 三级：等验收。worker 说 ready 了，人还没看。
  if (input.lastReport === 'ready') return 'review'

  // 四级：卡住了。只有人的消息能解冻 —— 系统消息不解冻，
  // 否则 CI 重跑一次就把 blocked 冲掉，看起来像在正常工作。
  if ((input.lastReport === 'blocked' || input.lastReport === 'failed')
      && !input.humanMessageSinceReport) {
    return 'blocked'
  }

  // 五级：还没有 Assignment，或有 pending 的（排队等槽位）
  if (!input.assignment || input.assignment.status === 'pending') return 'queued'

  // 六级：worker 报 waiting，空闲等 Trigger
  if (input.lastReport === 'waiting') return 'idle'

  // 其余：正在跑
  return 'working'
}
