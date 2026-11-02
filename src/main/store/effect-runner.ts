import { TicketStore } from './ticket-store'

export type EffectHandler = (payload: unknown, key: string) => Promise<void>

type Claimed = {
  seq: number
  key: string
  payload: unknown
  attempts: number
  generation: number
}

type Registration = {
  handler: EffectHandler
  concurrency: number
  ordered: boolean
}

const MAX_BACKOFF_MS = 60_000

/**
 * 把 TicketStore 里的 effect 队列跑起来。
 *
 * 约定：
 * - `register` 决定 kind 的并发上限；`ordered: true` 的 kind 全局只允许一个 in-flight，
 *   并且按 `seq` 从老到新逐个取（下一条要等上一条跑完）。
 * - `claimDueEffects` 只读，同一行可能被不同轮 dispatch 重复取到，所以 runner 自己记录
 *   正在跑的 `seq`，不会把同一行同时跑两遍。
 * - `deleteEffect` 返回 `false` 表示这份 payload 已被新的一次 enqueue 覆盖（generation 变了）：
 *   此时**不是**错误、也**不是**已消费，runner 什么都不做，把行留给下一轮 dispatch 重新 claim。
 * - 失败只走 `bumpAttempt`（`min(2^attempts * 1000, 60s)` 后退避），不删除。
 *   同样要带 `generation`：payload 在执行期间被覆盖时 `bumpAttempt` 返回 `false`，
 *   这时什么都不做——退避额度属于新活，不能替旧活的失败买单。
 */
export class EffectRunner {
  private readonly pollMs: number
  private readonly registry = new Map<string, Registration>()
  /** seq -> 正在跑的那次执行。claim 不做标记，靠它防止同一行被并行跑两遍。 */
  private readonly inFlight = new Map<number, { kind: string; done: Promise<void> }>()
  private timer: ReturnType<typeof setInterval> | null = null
  private active = false

  constructor(private readonly store: TicketStore, opts: { pollMs?: number } = {}) {
    this.pollMs = opts.pollMs ?? 250
  }

  register(
    kind: string,
    handler: EffectHandler,
    opts: { concurrency?: number; ordered?: boolean } = {},
  ): void {
    const raw = opts.concurrency ?? 1
    const concurrency = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1
    this.registry.set(kind, { handler, concurrency, ordered: opts.ordered ?? false })
  }

  /** 立刻 dispatch 一次，之后每 `pollMs` 一次。重复调用无副作用。 */
  start(): void {
    if (this.active) return
    this.active = true
    this.dispatch()
    this.timer = setInterval(() => {
      if (!this.active) return
      this.dispatch()
    }, this.pollMs)
    // 轮询定时器不该把进程吊着不退出。
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref()
  }

  /** 停止发起新的执行，并等待 in-flight 结束。 */
  async stop(): Promise<void> {
    this.active = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.drain()
  }

  /**
   * 测试用：反复「dispatch + 等 in-flight 清空」，直到没有可跑的行。
   * 给了 `kind` 就只关心这个 kind，否则所有已注册的 kind 一起。
   */
  async idle(kind?: string): Promise<void> {
    const kinds = kind === undefined ? [...this.registry.keys()] : [kind]
    for (;;) {
      const started = this.dispatch(kinds)
      const pending = this.pendingFor(kinds)
      if (pending.length === 0) {
        if (started === 0) return
        continue
      }
      await Promise.all(pending)
    }
  }

  private pendingFor(kinds: string[]): Array<Promise<void>> {
    const out: Array<Promise<void>> = []
    for (const entry of this.inFlight.values()) {
      if (kinds.includes(entry.kind)) out.push(entry.done)
    }
    return out
  }

  private async drain(): Promise<void> {
    // in-flight 里可能有执行中又触发的新的执行，取快照后反复等，直到真的空。
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight.values()].map(e => e.done))
    }
  }

  private dispatch(kinds?: string[]): number {
    let started = 0
    for (const kind of kinds ?? [...this.registry.keys()]) {
      const reg = this.registry.get(kind)
      if (reg) started += this.dispatchKind(kind, reg)
    }
    return started
  }

  private dispatchKind(kind: string, reg: Registration): number {
    const limit = reg.ordered ? 1 : reg.concurrency
    let running = 0
    for (const entry of this.inFlight.values()) if (entry.kind === kind) running++
    const free = limit - running
    if (free <= 0) return 0

    // 正在跑的行也算在「最老的那批」里，所以多取 running 条，跳过它们后刚好够填满空位。
    const claims: Claimed[] = this.store.claimDueEffects(kind, Date.now(), running + free)
    let started = 0
    for (const claim of claims) {
      if (started >= free) break
      if (this.inFlight.has(claim.seq)) continue
      this.run(kind, reg.handler, claim)
      started++
    }
    return started
  }

  private run(kind: string, handler: EffectHandler, claim: Claimed): void {
    const done = this.execute(kind, handler, claim).finally(() => {
      this.inFlight.delete(claim.seq)
    })
    this.inFlight.set(claim.seq, { kind, done })
  }

  private async execute(kind: string, handler: EffectHandler, claim: Claimed): Promise<void> {
    try {
      await handler(claim.payload, claim.key)
    } catch (err) {
      const backoff = Math.min(2 ** claim.attempts * 1000, MAX_BACKOFF_MS)
      // 带 generation：跑的过程中行可能已被新 payload 合并（generation + 1）。
      // 那样这次失败是旧活的失败，不该给新活涨 attempts、也不该把新活的 due 推后。
      const bumped = this.store.bumpAttempt(claim.seq, claim.generation, Date.now() + backoff)
      if (!bumped) {
        console.warn(
          `[effect-runner] ${kind}/${claim.key} failed (attempt ${claim.attempts + 1}) but its payload was ` +
          `replaced while running; not bumping the new payload:`,
          err,
        )
        return
      }
      console.warn(
        `[effect-runner] ${kind}/${claim.key} failed (attempt ${claim.attempts + 1}, retry in ${backoff}ms):`,
        err,
      )
      return
    }

    const deleted = this.store.deleteEffect(claim.seq, claim.generation)
    if (!deleted) {
      // 跑的过程中有新 payload 合并进来了：这一行现在装的是新活，不是我的，也还没被消费。
      // 什么都不做，下一轮 dispatch 会用新的 generation 重新 claim 它。
      console.warn(
        `[effect-runner] ${kind}/${claim.key} payload was replaced while running; leaving it for the next dispatch`,
      )
    }
  }
}
