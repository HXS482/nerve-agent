/**
 * Ticket 领域模型的类型定义（阶段 3）。
 *
 * 与阶段 0-2 的 effect 队列同库不同表：effect 负责"待执行的活"，
 * ticket/assignment/input 负责"这是谁的活、干到哪了"。
 */

/** Ticket 所处阶段。判定见 gateway/ticket-stage.ts，自上而下第一个命中者胜。 */
export type TicketStage =
  | 'delivery' // 上一条 Input 投递失败，等重试
  | 'answer' // 有待人工回答的问题
  | 'review' // 最近一次 Report = ready，等人验收
  | 'blocked' // blocked/failed 且此后无人发言
  | 'queued' // 没有 Assignment，或有 pending 的
  | 'idle' // 最近一次 Report = waiting
  | 'working' // 其余

export type AssignmentStatus = 'pending' | 'running' | 'ended'

export type InputKind = 'human' | 'system'

export interface TicketRow {
  id: string
  title: string
  cwd: string
  sessionId: string
  platform?: string
  userId?: string
  chatId?: string
  threadKey: string
  stage: TicketStage
  mandate?: string
  createdAt: number
  lastActiveAt: number
  endedAt?: number
}

export interface AssignmentRow {
  id: string
  ticketId: string
  status: AssignmentStatus
  error?: string
  createdAt: number
  endedAt?: number
}

export interface InputRow {
  id: string
  ticketId: string
  kind: InputKind
  body: string
  seq: number
  deliveredAt?: number
}
