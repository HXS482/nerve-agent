/**
 * TicketRouter —— 把「一个人的一条消息」变成「一件有独立上下文的活」。
 *
 * 与 SessionRouter 的分工：
 * - SessionRouter：platform:user → 会话映射（谁在跟我说话）
 * - TicketRouter：threadKey → Ticket + Assignment + 槽位执行（我在干什么活）
 *
 * 关键语义（都是踩过坑才定下的）：
 * 1. 不同 Ticket **并行**执行。串行是上一版最大的毛病：一个人的第二件事
 *    必须等第一件跑完，长任务直接把对话堵死。
 * 2. 同一个 Ticket 内部仍然**串行**（per-ticket promise chain），
 *    否则同一份上下文会被两个 run 同时改。
 * 3. 人的消息走 human 槽位，后台活走 normal 槽位 —— 人永远不排在后台活后面。
 * 4. 每次状态变化都 emit 出去，UI 靠它刷新，不用轮询。
 */

import { randomUUID } from 'crypto'
import type { AgentCore } from '../core/agent-core'
import type { OutputChannel } from '../core/output-channel'
import type { FileAttachment } from '../../shared/types'
import type { TicketStore } from '../store/ticket-store'
import type { AssignmentRow, TicketRow } from '../store/ticket-types'
import { computeStage } from './ticket-stage'
import type { SlotScheduler } from './slot-scheduler'

export interface DispatchMessage {
  platform: string
  userId: string
  chatId: string
  threadKey: string
  text: string
  cwd: string
  files?: FileAttachment[]
  /** 人的消息占 human 槽位；system/CI 走 normal。默认按 human 处理。 */
  kind?: 'human' | 'system'
}

export interface TicketRouterDeps {
  store: TicketStore
  scheduler: SlotScheduler
  agentCore: Pick<AgentCore, 'sendMessage' | 'cancelSession' | 'getSessionContextManager'>
}

export class TicketRouter {
  private readonly store: TicketStore
  private readonly scheduler: SlotScheduler
  private readonly agentCore: TicketRouterDeps['agentCore']

  /** sessionId → 该 Ticket 的消息投递通道。进程重启后为空（旧通道已死）。 */
  private readonly channels = new Map<string, OutputChannel>()

  /** ticketId → 串行链，保证同一 Ticket 内不并发 */
  private readonly chains = new Map<string, Promise<void>>()

  /** ticketId → 正在跑的 Assignment id，用于 stop() 精确取消 */
  private readonly running = new Map<string, string>()

  /** sessionId → 是否有活正在跑（给 activeSessionCount 用） */
  private readonly inFlight = new Set<string>()

  private listeners: Array<(t: TicketRow) => void> = []

  constructor(deps: TicketRouterDeps) {
    this.store = deps.store
    this.scheduler = deps.scheduler
    this.agentCore = deps.agentCore
  }

  /** 订阅 Ticket 变化（UI 推送用）。 */
  onChanged(fn: (t: TicketRow) => void): void {
    this.listeners.push(fn)
  }

  private emit(t: TicketRow): void {
    for (const fn of this.listeners) {
      try { fn(t) } catch { /* 单个订阅者出错不能影响其他人 */ }
    }
  }

  get activeTicketCount(): number {
    return this.running.size
  }

  /**
   * 进程重启后的恢复。
   *
   * running 状态的 Assignment 必须退回 pending，否则它永远等不到结束，
   * 阶段判定里 working 会一直命中 —— Ticket 看着在跑，其实没人管。
   */
  start(): number {
    const n = this.store.recoverRunningAssignments(Date.now())
    if (n > 0) console.warn(`[TicketRouter] recovered ${n} interrupted assignment(s)`)
    return n
  }

  /**
   * 投递一条消息。同步返回：真正的执行在后台跑，调用方不等待。
   *
   * 为什么不能 await：这条链路上有个长任务时，调用方（IM adapter / WS）会被
   * 卡在同一轮里，后续消息进不来 —— 那就退化成改造前的样子了。
   */
  dispatch(msg: DispatchMessage, channel: OutputChannel): void {
    const ticket = this.resolveTicket(msg)
    this.channels.set(ticket.sessionId, channel)

    const kind = msg.kind ?? 'human'
    const seq = this.store.nextInputSeq(ticket.id)
    this.store.insertInput({
      id: randomUUID(),
      ticketId: ticket.id,
      kind,
      body: msg.text,
      seq,
    })

    const updated = { ...ticket, stage: 'queued' as const, lastActiveAt: Date.now() }
    this.store.updateTicketStage(ticket.id, 'queued', updated.lastActiveAt)
    this.emit(updated)

    this.enqueueRun(updated, msg, channel, kind)
  }

  /** 找到该 threadKey 上未结束的 Ticket，没有就开一个。 */
  private resolveTicket(msg: DispatchMessage): TicketRow {
    const existing = this.store.findTicketByThread(msg.threadKey)
    if (existing) {
      // 同一条线索的后续消息：沿用同一个 Ticket 和同一个 session，
      // 这样上下文是连续的 —— 用户换了渠道接着说，agent 也知道在说什么。
      return existing
    }

    const now = Date.now()
    const ticket: TicketRow = {
      id: randomUUID(),
      title: titleFrom(msg.text),
      cwd: msg.cwd,
      sessionId: randomUUID(),
      platform: msg.platform,
      userId: msg.userId,
      chatId: msg.chatId,
      threadKey: msg.threadKey,
      stage: 'queued',
      createdAt: now,
      lastActiveAt: now,
    }
    this.store.insertTicket(ticket)

    const assignment: AssignmentRow = {
      id: randomUUID(),
      ticketId: ticket.id,
      status: 'pending',
      createdAt: now,
    }
    this.store.insertAssignment(assignment)
    return ticket
  }

  /** 把一次执行挂到该 Ticket 的串行链上（不同 Ticket 之间互不等待）。 */
  private enqueueRun(
    ticket: TicketRow,
    msg: DispatchMessage,
    channel: OutputChannel,
    kind: 'human' | 'system',
  ): void {
    const prev = this.chains.get(ticket.id) ?? Promise.resolve()
    const next = prev
      .then(() => this.runOnce(ticket, msg, channel, kind))
      .catch((err) => {
        // 链上任何一环出错都不能断链，否则这个 Ticket 后续所有消息都进不来。
        console.error(`[TicketRouter] ticket ${ticket.id} run failed:`, err)
      })
    this.chains.set(ticket.id, next)
    // 链跑完就清掉，避免 map 无限增长
    void next.finally(() => {
      if (this.chains.get(ticket.id) === next) this.chains.delete(ticket.id)
    })
  }

  private async runOnce(
    ticket: TicketRow,
    msg: DispatchMessage,
    channel: OutputChannel,
    kind: 'human' | 'system',
  ): Promise<void> {
    // 槽位是「占用哪档容量」，kind 是「这条消息谁发的」——两者语义不同。
    //
    // ⚠️ 人发的消息**不**一律走 human 槽位。human 槽位只有 1 个，如果所有人类
    // 消息都挤它，一个人同时办两件事就会互相阻塞 —— 正好退化成改造前的串行。
    // human 槽位的真实用途是：normal 被后台活占满时，人还能插一句话进来。
    // 所以规则是「normal 有空就走 normal，没空才抢 human」。
    const release = await this.acquireSlot(kind)

    const assignmentId = randomUUID()
    this.store.insertAssignment({ id: assignmentId, ticketId: ticket.id, status: 'running', createdAt: Date.now() })
    this.store.updateTicketStage(ticket.id, 'working', Date.now())
    this.emit({ ...ticket, stage: 'working' })

    this.running.set(ticket.id, assignmentId)
    this.inFlight.add(ticket.sessionId)

    try {
      const ctx = this.agentCore.getSessionContextManager().getOrCreate(ticket.sessionId)
      await this.agentCore.sendMessage(
        {
          prompt: msg.text,
          sessionId: ticket.sessionId,
          files: msg.files,
          cwd: msg.cwd,
        },
        channel,
        ctx,
      )
      this.store.updateAssignmentStatus(assignmentId, 'ended')
      const stage = computeStage({
        assignment: { id: assignmentId, ticketId: ticket.id, status: 'ended', createdAt: 0 },
        lastReport: 'waiting',
      })
      this.store.updateTicketStage(ticket.id, stage, Date.now())
      this.emit({ ...ticket, stage, lastActiveAt: Date.now() })
    } catch (err) {
      // AgentCore.sendMessage 内部已经 catch 了大部分错误，能走到这里的多半是
      // 上下文/调度层面的问题。记成 failed，让人能在 UI 上看见。
      const message = err instanceof Error ? err.message : String(err)
      this.store.updateAssignmentStatus(assignmentId, 'ended', message)
      this.store.updateTicketStage(ticket.id, 'blocked', Date.now())
      this.emit({ ...ticket, stage: 'blocked', lastActiveAt: Date.now() })
      channel.sendError(message)
    } finally {
      this.running.delete(ticket.id)
      this.inFlight.delete(ticket.sessionId)
      release()
    }
  }

  /**
   * 取槽位：normal 有空位就正常排队；只有 normal 满了、且这条是人发的，
   * 才降到 human 槽位插队。
   *
   * 为什么不是「人发的一律 human」：human 只有 1 个，一个人同时办两件事就会
   * 自己挡住自己。而 human 槽位真正要保的是「后台活占满时人还能说话」。
   */
  private async acquireSlot(kind: 'human' | 'system'): Promise<() => void> {
    if (kind !== 'human') return this.scheduler.acquire('normal')

    // 先试 normal：不阻塞就直接走，多个并行的人任务互不影响
    const normal = await this.scheduler.tryAcquire('normal')
    if (normal) return normal

    // normal 满了：人有优先权，抢那个预留槽位
    return this.scheduler.acquire('human')
  }

  /**
   * 停掉一个 Ticket：取消它的 run，清掉它的排队消息。
   *
   * 只动这一个 —— 其他 Ticket 和其他 session 完全不受影响，
   * 这是「停止」按钮能安全存在的前提。
   */
  stop(ticketId: string): void {
    const ticket = this.store.getTicket(ticketId)
    if (!ticket) return

    this.store.rawExec(
      `DELETE FROM effect WHERE kind = 'gateway.message' AND key = ?`,
      ticket.sessionId,
    )
    try { this.agentCore.cancelSession(ticket.sessionId) } catch { /* 没在跑就算了 */ }
    this.store.endTicket(ticketId, Date.now())
    this.channels.delete(ticket.sessionId)
    this.emit({ ...ticket, stage: 'idle', endedAt: Date.now() })
  }

  /** 进程停止时清掉内存里的通道（旧通道已死，重启后走 NullOutputChannel 分支）。 */
  resetChannels(): void {
    this.channels.clear()
  }

  /** 取该 session 的投递通道；没有则返回 undefined，由调用方决定降级策略。 */
  channelFor(sessionId: string): OutputChannel | undefined {
    return this.channels.get(sessionId)
  }
}

/** 从首条消息里取一个短标题，给 UI 列表用。 */
function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return '未命名任务'
  return line.length > 40 ? `${line.slice(0, 40)}…` : line
}
