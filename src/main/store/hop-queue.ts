/**
 * Bot 交接的持久化工作队列。
 *
 * 为什么要有队列，而不是 A 直接 await B：
 * B 是完整的一轮 agent（可能跑几分钟、可能调工具、可能再往下派），把 A 挂在那里等它，
 * 等于把「A 聊到一半突然不动了」变成常态。openbot 的做法也一样：A 只负责把活入队并结束
 * 自己这一轮，B 的答复稍后作为 A 会话里的一条**独立消息**出现，落款是 B。
 *
 * 为什么落盘而不是内存 Map：一次交接横跨两轮 run（A 的、B 的），中间进程可能重启。
 * 内存队列一重启就丢，用户看到的是「Bot 说它问了，然后什么都没有」—— 比直接报错更糟。
 *
 * 租约与退避都是时间戳运算，单进程下不存在两个副本抢同一行的问题，但租约仍然保留：
 * B 那一轮跑挂了却忘了收尾时，租约过期能让这行重新可认领，而不是永远卡在 running。
 */
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'

export type HopStatus = 'queued' | 'running' | 'done' | 'failed'

export interface HopRow {
  key: string
  status: HopStatus
  attempts: number
  availableAt: number
  leaseUntil: number | null
  owner: string | null
  /** HandoffWork 的 JSON。队列不解释它，只负责保管与搬运。 */
  payload: string
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface HopQueueOptions {
  /** 认领后的租约长度。B 跑得比这久时由 runner 续租。 */
  leaseMs?: number
  /** 一次认领最多拿几行。 */
  limit?: number
  /** 同一行最多试几次。 */
  maxAttempts?: number
}

const DEFAULT_LEASE_MS = 120_000
const DEFAULT_LIMIT = 3
const DEFAULT_MAX_ATTEMPTS = 3

type Database = any // better-sqlite3 惰性 require，与 routine-store 同款

export class HopQueue {
  private constructor(
    private db: Database,
    private opts: Required<HopQueueOptions>,
  ) {}

  static open(dbPath: string, options: HopQueueOptions = {}): HopQueue {
    mkdirSync(dirname(dbPath), { recursive: true })
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_hops (
        key TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at INTEGER NOT NULL,
        lease_until INTEGER,
        owner TEXT,
        payload TEXT NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hops_ready ON bot_hops(status, available_at);
    `)
    return new HopQueue(db, {
      leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS,
      limit: options.limit ?? DEFAULT_LIMIT,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    })
  }

  close(): void {
    this.db.close()
  }

  /**
   * 入队。key 是幂等键：同一个 key 再来一次不会变成两跳。
   *
   * 幂等这件事很重要 —— 模型在同一轮里重复调同一个工具是常见行为，
   * 而「一跳是完整的一轮 agent」意味着重复执行是真的花钱。
   */
  offer(key: string, payload: unknown): 'queued' | 'already' {
    const now = Date.now()
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO bot_hops
           (key, status, attempts, available_at, lease_until, owner, payload, last_error, created_at, updated_at)
         VALUES (?, 'queued', 0, ?, NULL, NULL, ?, NULL, ?, ?)`,
      )
      .run(key, now, JSON.stringify(payload), now, now)
    return info.changes > 0 ? 'queued' : 'already'
  }

  /**
   * 认领若干条可执行的跳。
   *
   * 条件：待执行且已到可执行时间，或者「运行中但租约过期」（上一个跑的人死了）。
   * 认领与置 running 在同一个事务里，所以不会出现同一行被认领两次。
   */
  claim(owner: string): HopRow[] {
    const now = Date.now()
    const leaseUntil = now + this.opts.leaseMs
    const take = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT * FROM bot_hops
           WHERE (status = 'queued' AND available_at <= ?)
              OR (status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?)
           ORDER BY available_at ASC
           LIMIT ?`,
        )
        .all(now, now, this.opts.limit) as any[]
      const mark = this.db.prepare(
        `UPDATE bot_hops
         SET status = 'running', owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
         WHERE key = ?`,
      )
      for (const r of rows) mark.run(owner, leaseUntil, now, r.key)
      return rows as HopRow[]
    })
    return take()
  }

  /** 续租。跑到一半的跳不能被别人抢走，否则同一跳会被跑两遍、账单也翻倍。 */
  renew(key: string, owner: string): boolean {
    const now = Date.now()
    const info = this.db
      .prepare(
        `UPDATE bot_hops SET lease_until = ?, updated_at = ?
         WHERE key = ? AND owner = ? AND status = 'running'`,
      )
      .run(now + this.opts.leaseMs, now, key, owner)
    return info.changes > 0
  }

  /** 跑完了（不管 B 说了什么，它都算跑过了 —— 重试只会再问一遍同样的话、收同样的费）。 */
  finish(key: string): void {
    const now = Date.now()
    this.db
      .prepare(
        `UPDATE bot_hops SET status = 'done', lease_until = NULL, updated_at = ? WHERE key = ?`,
      )
      .run(now, key)
  }

  /**
   * 直接判终态失败，不看次数。
   *
   * 给「这行本身是坏的」用（载荷读不出来）：重试多少次都读不出来，
   * 用 release 重试只会让它每轮 sweep 都占一个名额、白花时间。
   */
  fail(key: string, error: string): void {
    const now = Date.now()
    this.db
      .prepare(
        `UPDATE bot_hops SET status = 'failed', lease_until = NULL, last_error = ?, updated_at = ?
         WHERE key = ?`,
      )
      .run(error.slice(0, 500), now, key)
  }

  /**
   * 这一跳没跑成：还有次数就退避重排，没次数就终态失败。
   *
   * 终态失败要让上层知道（它会去 A 的会话里说一句「没回来」），
   * 所以返回值区分这两种结局，而不是一律 void。
   */
  release(key: string, error: string, backoffMs: number): 'retry' | 'failed' {
    const now = Date.now()
    const row = this.db.prepare(`SELECT attempts FROM bot_hops WHERE key = ?`).get(key) as
      | { attempts: number }
      | undefined
    if (!row) return 'failed'
    if (row.attempts >= this.opts.maxAttempts) {
      this.db
        .prepare(
          `UPDATE bot_hops SET status = 'failed', lease_until = NULL, last_error = ?, updated_at = ?
           WHERE key = ?`,
        )
        .run(error.slice(0, 500), now, key)
      return 'failed'
    }
    this.db
      .prepare(
        `UPDATE bot_hops SET status = 'queued', owner = NULL, lease_until = NULL,
           available_at = ?, last_error = ?, updated_at = ? WHERE key = ?`,
      )
      .run(now + backoffMs, error.slice(0, 500), now, key)
    return 'retry'
  }

  /** 丢掉已经结束的行：done/failed 留一天足够查，留着无穷久会让表越滚越大。 */
  reap(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs
    const info = this.db
      .prepare(`DELETE FROM bot_hops WHERE status IN ('done','failed') AND updated_at < ?`)
      .run(cutoff)
    return info.changes
  }

  /** 当前处于 running 的行。启动时用来校准「谁的 Bot 正在干活」的显示状态。 */
  running(): HopRow[] {
    return this.db.prepare(`SELECT * FROM bot_hops WHERE status = 'running'`).all() as HopRow[]
  }

  /** 队列长度（排查用）。 */
  stats(): { queued: number; running: number; done: number; failed: number } {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM bot_hops GROUP BY status`)
      .all() as { status: string; n: number }[]
    const out = { queued: 0, running: 0, done: 0, failed: 0 }
    for (const r of rows) {
      if (r.status in out) (out as any)[r.status] = r.n
    }
    return out
  }

  /** 一次随机但不重复的 worker 标识，写进 owner 列。 */
  static ownerId(): string {
    return 'hop-' + randomUUID().slice(0, 8)
  }
}