/**
 * 槽位调度器。
 *
 * 两档槽位：
 * - normal：普通容量，默认 3。后台任务、CI 回调等走这里。
 * - human：**恒定 1 个**，只给人发的消息用。
 *
 * 为什么要单独留一个人工槽位：normal 全被长任务占满时，人再发一句话
 * 会排进队尾等几分钟——这正是这次改造要消灭的体验。人永远不该排在后台活后面。
 *
 * 释放时先发放 human 等待者，再按 FIFO 发放 normal。
 */

export type SlotKind = 'human' | 'normal'

interface Waiter {
  kind: SlotKind
  resolve: (release: () => void) => void
}

export class SlotScheduler {
  private normalCap: number
  private normalActive = 0
  private humanActive = 0
  private waiters: Waiter[] = []

  constructor(opts: { concurrency: number }) {
    this.normalCap = opts.concurrency > 0 ? opts.concurrency : 1
  }

  /** 当前占用情况，给健康面板用。 */
  get active(): { normal: number; human: number } {
    return { normal: this.normalActive, human: this.humanActive }
  }

  setConcurrency(n: number): void {
    this.normalCap = n > 0 ? n : 1
    this.pump()
  }

  /**
   * 有空位就立刻占，没有就返回 null（不排队）。
   *
   * 给「先试普通槽位，满了才降级抢预留槽位」这种两段式用法准备的：
   * 用 acquire 试的话会变成排队，而后面的 fallback 永远轮不到。
   */
  tryAcquire(kind: SlotKind): (() => void) | null {
    if (!this.canGrant(kind)) return null
    return this.grant(kind)
  }

  /**
   * 占一个槽位。返回一个 release 函数——**调用方必须在 finally 里调用它**，
   * 否则槽位永久泄漏，后续 work 全部阻塞。
   */
  acquire(kind: SlotKind): Promise<() => void> {
    if (this.canGrant(kind)) {
      return Promise.resolve(this.grant(kind))
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push({ kind, resolve })
    })
  }

  private canGrant(kind: SlotKind): boolean {
    if (kind === 'human') return this.humanActive < 1
    return this.normalActive < this.normalCap
  }

  private grant(kind: SlotKind): () => void {
    if (kind === 'human') this.humanActive++
    else this.normalActive++

    let released = false
    return () => {
      // 双调用保护：重复 release 会把计数打成负数，槽位容量凭空变大。
      if (released) return
      released = true
      if (kind === 'human') this.humanActive--
      else this.normalActive--
      this.pump()
    }
  }

  /** 有空位就把等待者叫醒。human 优先。 */
  private pump(): void {
    for (;;) {
      const idx = this.waiters.findIndex((w) => this.canGrant(w.kind))
      if (idx === -1) return
      const [w] = this.waiters.splice(idx, 1)
      w.resolve(this.grant(w.kind))
    }
  }
}
