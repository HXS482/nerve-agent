import { mkdirSync } from 'fs'
import { dirname } from 'path'

type Database = any // better-sqlite3 类型，惰性 require

export class TicketStore {
  private constructor(private readonly db: Database) {}

  static open(dbPath: string): TicketStore {
    mkdirSync(dirname(dbPath), { recursive: true })
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS effect (
        kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL,
        seq INTEGER PRIMARY KEY AUTOINCREMENT, attempts INTEGER DEFAULT 0,
        due INTEGER NOT NULL, generation INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_effect_due ON effect(kind, due, seq);
    `)
    return new TicketStore(db)
  }

  /**
   * 入队一个待执行项。同 (kind, key) 视为同一待执行项：新 payload 覆盖旧 payload，
   * 保留原 seq（队列位置）与 due，generation + 1。
   * `ordered` 由 EffectRunner 按 kind 注册时决定，队列本身不持久化该标记。
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
        this.db
          .prepare('UPDATE effect SET payload = ?, generation = generation + 1 WHERE seq = ?')
          .run(json, existing.seq)
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
        this.bumpAttempt(r.seq, Date.now() + 24 * 60 * 60 * 1000)
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

  /** 重排一次尝试（execute 失败时调用），等 nextDue 之后再取。 */
  bumpAttempt(seq: number, nextDue: number): void {
    this.db
      .prepare('UPDATE effect SET attempts = attempts + 1, due = ? WHERE seq = ?')
      .run(nextDue, seq)
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
