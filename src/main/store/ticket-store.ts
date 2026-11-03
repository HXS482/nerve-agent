import { mkdirSync } from 'fs'
import { dirname } from 'path'

import type {
  AssignmentRow,
  AssignmentStatus,
  InputRow,
  TicketRow,
  TicketStage,
} from './ticket-types'

type Database = any // better-sqlite3 类型，惰性 require

export class TicketStore {
  private constructor(private readonly db: Database) {}

  static open(dbPath: string): TicketStore {
    mkdirSync(dirname(dbPath), { recursive: true })
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    // 全部 IF NOT EXISTS：已有用户库里只有 effect 表，升级时补建其余表，不能假设是空库。
    db.exec(`
      CREATE TABLE IF NOT EXISTS effect (
        kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL,
        seq INTEGER PRIMARY KEY AUTOINCREMENT, attempts INTEGER DEFAULT 0,
        due INTEGER NOT NULL, generation INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_effect_due ON effect(kind, due, seq);

      CREATE TABLE IF NOT EXISTS ticket (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, cwd TEXT NOT NULL,
        session_id TEXT NOT NULL, platform TEXT, user_id TEXT, chat_id TEXT,
        thread_key TEXT NOT NULL, stage TEXT NOT NULL, mandate TEXT,
        created_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL,
        ended_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS assignment (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, status TEXT NOT NULL,
        error TEXT, created_at INTEGER NOT NULL, ended_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS input (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, kind TEXT NOT NULL,
        body TEXT NOT NULL, seq INTEGER NOT NULL, delivered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ticket_thread ON ticket(thread_key, ended_at);
      CREATE INDEX IF NOT EXISTS idx_assignment_ticket ON assignment(ticket_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_input_ticket ON input(ticket_id, seq);
    `)
    return new TicketStore(db)
  }

  /**
   * 入队一个待执行项。同 (kind, key) 视为同一待执行项：新 payload 覆盖旧 payload，
   * 保留原 seq（队列位置），generation + 1，due 收紧为 `min(旧 due, 新 due)`。
   * `ordered` 由 EffectRunner 按 kind 注册时决定，队列本身不持久化该标记。
   *
   * due 为什么取 min 而不是保留旧的：合并进来的是一份**新活**，旧行的 due 可能已经被
   * 上一次失败的退避推到 60s 之后。原样保留会让这份从没跑过的新 payload 平白等一段
   * 属于别人的退避时间。取 min 既不会把已到期的新活往后推，也不会提前别人的退避。
   *
   * 注意：合并是**无条件**的，包括合并进一行已被 claimDueEffects 取走、正在执行中的行。
   * 这是有意的——它保住队列位置（新消息不排到队尾）。但这种合并改变的是 payload，
   * 所以执行方必须用 generation 校验自己删的是不是自己取走的那份：
   * `deleteEffect` 返回 `false` 表示「我跑的时候 payload 变了」，此时**不要**当作已消费，
   * 应重新 claim（或重新入队）再执行。
   */
  enqueueEffect(
    kind: string,
    key: string,
    payload: unknown,
    opts: { ordered?: boolean; dueAt?: number } = {},
  ): void {
    const json = JSON.stringify(payload)
    const dueAt = opts.dueAt ?? Date.now()
    this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT seq FROM effect WHERE kind = ? AND key = ? ORDER BY seq LIMIT 1')
        .get(kind, key) as { seq: number } | undefined
      if (existing) {
        // MIN(旧, 新)：新 payload 不该继承旧行（可能正在退避）的更晚 due。
        this.db
          .prepare(
            `UPDATE effect SET payload = ?, generation = generation + 1, due = MIN(due, ?) WHERE seq = ?`,
          )
          .run(json, dueAt, existing.seq)
      } else {
        this.db
          .prepare('INSERT INTO effect (kind, key, payload, due) VALUES (?, ?, ?, ?)')
          .run(kind, key, json, dueAt)
      }
    })()
  }

  /**
   * 取到期项。不删除——删除只在执行成功（deleteEffect）后发生。
   *
   * 每行都带 `generation`，必须原样传给 `deleteEffect`：它记录的是这一份 payload 的版本。
   * payload 解析失败的行不会让整批失败，而是被隔离（attempts+1，due 推到 24 小时后）
   * 并从返回值里排除，否则同一条坏行会被反复取出、反复抛错，把整条队列堵死。
   */
  claimDueEffects(
    kind: string,
    now: number,
    limit: number,
  ): Array<{ seq: number; key: string; payload: unknown; attempts: number; generation: number }> {
    // SQLite 把负的 LIMIT 视为「不限制」，这里显式挡住，避免 limit <= 0 变成全量返回。
    if (!(limit > 0)) return []
    const rows = this.db
      .prepare(
        `SELECT seq, kind, key, payload, attempts, generation FROM effect
         WHERE kind = ? AND due <= ? ORDER BY seq LIMIT ?`,
      )
      .all(kind, now, limit) as Array<{
      seq: number
      kind: string
      key: string
      payload: string
      attempts: number
      generation: number
    }>
    const out: Array<{
      seq: number
      key: string
      payload: unknown
      attempts: number
      generation: number
    }> = []
    for (const r of rows) {
      let payload: unknown
      try {
        payload = JSON.parse(r.payload)
      } catch {
        // 隔离坏行：推到 24 小时后，让后面的行先跑，坏行留给人工/日志排查。
        // 带 generation：读出来到写回去之间若被合并过，那是新 payload，不该替这条坏行挨罚。
        this.bumpAttempt(r.seq, r.generation, Date.now() + 24 * 60 * 60 * 1000)
        console.warn(
          `[ticket-store] quarantined effect with unparseable payload (seq=${r.seq}, kind=${r.kind})`,
        )
        continue
      }
      out.push({
        seq: r.seq,
        key: r.key,
        payload,
        attempts: r.attempts,
        generation: r.generation,
      })
    }
    return out
  }

  /**
   * 执行成功后删除。必须同时给出 claim 时拿到的 `generation`。
   *
   * 返回 `false` 表示「我跑的时候 payload 变了」（期间有一次 enqueueEffect 合并进来，
   * 把 generation 加了 1），本次执行结果已经过时：调用方**不得**当作已消费，
   * 应重新 `claimDueEffects`（或重新入队）再跑一遍新 payload。
   */
  deleteEffect(seq: number, generation: number): boolean {
    const info = this.db
      .prepare('DELETE FROM effect WHERE seq = ? AND generation = ?')
      .run(seq, generation)
    return info.changes > 0
  }

  /**
   * 重排一次尝试（execute 失败时调用），等 nextDue 之后再取。
   *
   * 必须带上 claim 时拿到的 `generation`：`seq` 会被 coalesce 复用，只按 seq 更新的话，
   * 一旦 payload 在执行期间被新的一次 enqueue 覆盖，失败的是**旧**活、涨 attempts 和
   * 后退避的却是**新**活（新活根本没跑过，却要替别人的失败等最多 60s）。
   *
   * 返回 `false` 表示这一行已经不属于本次执行了（generation 变了），调用方什么都不该做。
   */
  bumpAttempt(seq: number, generation: number, nextDue: number): boolean {
    const info = this.db
      .prepare('UPDATE effect SET attempts = attempts + 1, due = ? WHERE seq = ? AND generation = ?')
      .run(nextDue, seq, generation)
    return info.changes > 0
  }


  // ── Ticket ────────────────────────────────────────────────

  insertTicket(t: TicketRow): void {
    this.db
      .prepare(
        `INSERT INTO ticket (id, title, cwd, session_id, platform, user_id, chat_id,
           thread_key, stage, mandate, created_at, last_active_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.id, t.title, t.cwd, t.sessionId, t.platform ?? null, t.userId ?? null,
        t.chatId ?? null, t.threadKey, t.stage, t.mandate ?? null,
        t.createdAt, t.lastActiveAt, t.endedAt ?? null,
      )
  }

  /** 按 threadKey 找**未结束**的 Ticket。已结束的不返回——同一条线索再来消息应开新 Ticket。 */
  findTicketByThread(threadKey: string): TicketRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM ticket WHERE thread_key = ? AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1')
      .get(threadKey)
    return row ? mapTicket(row) : undefined
  }

  getTicket(id: string): TicketRow | undefined {
    const row = this.db.prepare('SELECT * FROM ticket WHERE id = ?').get(id)
    return row ? mapTicket(row) : undefined
  }

  listTickets(opts: { includeEnded?: boolean; limit?: number } = {}): TicketRow[] {
    const where = opts.includeEnded ? '' : 'WHERE ended_at IS NULL'
    const limit = opts.limit && opts.limit > 0 ? `LIMIT ${opts.limit}` : ''
    return (this.db
      .prepare(`SELECT * FROM ticket ${where} ORDER BY last_active_at DESC ${limit}`)
      .all() as any[]).map(mapTicket)
  }

  updateTicketStage(id: string, stage: TicketStage, lastActiveAt: number): void {
    this.db
      .prepare('UPDATE ticket SET stage = ?, last_active_at = ? WHERE id = ?')
      .run(stage, lastActiveAt, id)
  }

  endTicket(id: string, at: number, outcome?: string): void {
    this.db
      .prepare('UPDATE ticket SET ended_at = ?, stage = ? , mandate = COALESCE(?, mandate) WHERE id = ?')
      .run(at, 'idle', outcome ?? null, id)
  }

  // ── Assignment ────────────────────────────────────────────

  insertAssignment(a: AssignmentRow): void {
    this.db
      .prepare('INSERT INTO assignment (id, ticket_id, status, error, created_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(a.id, a.ticketId, a.status, a.error ?? null, a.createdAt, a.endedAt ?? null)
  }

  latestAssignment(ticketId: string): AssignmentRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM assignment WHERE ticket_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(ticketId)
    return row ? mapAssignment(row) : undefined
  }

  updateAssignmentStatus(id: string, status: AssignmentStatus, error?: string): void {
    const endedAt = status === 'ended' ? Date.now() : null
    this.db
      .prepare('UPDATE assignment SET status = ?, error = COALESCE(?, error), ended_at = COALESCE(?, ended_at) WHERE id = ?')
      .run(status, error ?? null, endedAt, id)
  }

  /**
   * 进程重启后把「跑到一半」的 Assignment 退回 pending，并把 Ticket 阶段拉回 queued。
   *
   * 不做这一步的话，重启前 running 的 Assignment 会永远停在 running，
   * Ticket 看上去在跑、实际没人管——阶段判定里 working 会一直命中。
   */
  recoverRunningAssignments(now: number): number {
    return this.db.transaction(() => {
      const rows = this.db
        .prepare("SELECT id, ticket_id FROM assignment WHERE status = 'running'")
        .all() as Array<{ id: string; ticket_id: string }>
      for (const r of rows) {
        this.db.prepare("UPDATE assignment SET status = 'pending' WHERE id = ?").run(r.id)
        this.db
          .prepare('UPDATE ticket SET stage = ?, last_active_at = ? WHERE id = ? AND ended_at IS NULL')
          .run('queued', now, r.ticket_id)
      }
      return rows.length
    })()
  }

  // ── Input ─────────────────────────────────────────────────

  insertInput(i: InputRow): void {
    this.db
      .prepare('INSERT INTO input (id, ticket_id, kind, body, seq, delivered_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(i.id, i.ticketId, i.kind, i.body, i.seq, i.deliveredAt ?? null)
  }

  /** 下一个 Input 序号（per ticket 单调递增）。 */
  nextInputSeq(ticketId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM input WHERE ticket_id = ?')
      .get(ticketId) as { next: number }
    return row.next
  }

  markInputDelivered(id: string, at: number): void {
    this.db.prepare('UPDATE input SET delivered_at = ? WHERE id = ?').run(at, id)
  }

  /** 该 Ticket 还有多少条 Input 未投递。用于判断通道是否可以淘汰。 */
  pendingInputCount(ticketId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM input WHERE ticket_id = ? AND delivered_at IS NULL')
      .get(ticketId) as { n: number }
    return row.n
  }

  rawQuery(sql: string, ...params: unknown[]): unknown[] {
    return this.db.prepare(sql).all(...params)
  }

  /** 执行写语句（测试里用来直接改表，比如造一条坏 payload）。 */
  rawExec(sql: string, ...params: unknown[]): void {
    this.db.prepare(sql).run(...params)
  }

  close(): void {
    this.db.close()
  }
}

// ── 行映射：SQLite 用 snake_case，领域模型用 camelCase ──────────

interface RawTicket {
  id: string; title: string; cwd: string; session_id: string
  platform: string | null; user_id: string | null; chat_id: string | null
  thread_key: string; stage: string; mandate: string | null
  created_at: number; last_active_at: number; ended_at: number | null
}

function mapTicket(r: RawTicket): TicketRow {
  return {
    id: r.id, title: r.title, cwd: r.cwd, sessionId: r.session_id,
    platform: r.platform ?? undefined, userId: r.user_id ?? undefined,
    chatId: r.chat_id ?? undefined, threadKey: r.thread_key,
    stage: r.stage as TicketStage, mandate: r.mandate ?? undefined,
    createdAt: r.created_at, lastActiveAt: r.last_active_at,
    endedAt: r.ended_at ?? undefined,
  }
}

interface RawAssignment {
  id: string; ticket_id: string; status: string
  error: string | null; created_at: number; ended_at: number | null
}

function mapAssignment(r: RawAssignment): AssignmentRow {
  return {
    id: r.id, ticketId: r.ticket_id, status: r.status as AssignmentStatus,
    error: r.error ?? undefined, createdAt: r.created_at,
    endedAt: r.ended_at ?? undefined,
  }
}
