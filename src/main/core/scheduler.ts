/**
 * Routine 触发器（设计文档 §3）。main 进程内 setInterval，每 30s 一轮：
 * 写心跳 → 取到期 routine → 先快进 stamp 再 dispatch。
 *
 * 不直接依赖 TicketRouter：dispatch 是注入的回调（index.ts 里接
 * Gateway 的 TicketRouter，未启动时接 AgentCore 兜底）。
 * 满足 “routine 触发不依赖 Gateway 启动” 的红线，且本模块可独立单测。
 */
import type { RoutineStore } from '../store/routine-store'
import type { BotRegistry } from './bot-registry'

export interface RoutineDispatch {
  kind: 'system'
  text: string
  sessionId: string
  /** 审计标记：routine:<id> */
  source: string
  botId: string
}

const SWEEP_INTERVAL_MS = 30_000

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private sweeping = false

  constructor(
    private deps: {
      store: RoutineStore
      bots: BotRegistry
      dispatch: (d: RoutineDispatch) => Promise<boolean>
      /** 测试注入用；生产固定 30s */
      intervalMs?: number
    },
  ) {}

  get isRunning(): boolean {
    return this.timer !== null
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.sweep().catch((err) => console.error('[Scheduler] sweep failed:', err))
    }, this.deps.intervalMs ?? SWEEP_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 一轮扫描。返回处理的到期 routine 数。 */
  async sweep(): Promise<number> {
    if (this.sweeping) return 0 // 防御重入
    this.sweeping = true
    try {
      const now = Date.now()
      this.deps.store.recordSweep(now)
      const due = this.deps.store.due(now)
      let fired = 0
      for (const r of due) {
        // 先快进 stamp：执行慢/失败都不至于重复触发（错过窗口跳过不补）
        this.deps.store.advanceStamp(r.id, now)
        const bot = await this.deps.bots.get(r.botId)
        if (!bot) {
          console.warn(`[Scheduler] routine ${r.id} 的 Bot ${r.botId} 不存在，跳过`)
          continue
        }
        try {
          const ok = await this.deps.dispatch({
            kind: 'system',
            text: `[Routine 触发] ${r.instruction}`,
            sessionId: r.sessionId,
            source: `routine:${r.id}`,
            botId: r.botId,
          })
          // record* 自身如果抛错，不能让它冒泡打断整轮：后面的 routine 还要跑，
          // 而且原始 dispatch 错误会被它盖住。状态记不上比整轮停摆可控。
          try {
            if (ok) this.deps.store.recordSuccess(r.id)
            else this.deps.store.recordFailure(r.id)
          } catch (err) {
            console.error(`[Scheduler] 记录 routine ${r.id} 的执行结果失败:`, err)
          }
        } catch {
          try {
            this.deps.store.recordFailure(r.id)
          } catch (err) {
            console.error(`[Scheduler] 记录 routine ${r.id} 的执行结果失败:`, err)
          }
        }
        fired++
      }
      return fired
    } finally {
      this.sweeping = false
    }
  }
}
