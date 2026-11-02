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

  /** 取到期项。不删除——删除只在执行成功（deleteEffect）后发生。 */
  claimDueEffects(
    kind: string,
    now: number,
    limit: number,
  ): Array<{ seq: number; key: string; payload: unknown; attempts: number }> {
    const rows = this.db
      .prepare(
        'SELECT seq, key, payload, attempts FROM effect WHERE kind = ? AND due <= ? ORDER BY seq LIMIT ?',
      )
      .all(kind, now, limit) as Array<{
      seq: number
      key: string
      payload: string
      attempts: number
    }>
    return rows.map((r) => ({
      seq: r.seq,
      key: r.key,
      payload: JSON.parse(r.payload),
      attempts: r.attempts,
    }))
  }

  deleteEffect(seq: number): void {
    this.db.prepare('DELETE FROM effect WHERE seq = ?').run(seq)
  }

  bumpAttempt(seq: number, nextDue: number): void {
    this.db
      .prepare('UPDATE effect SET attempts = attempts + 1, due = ? WHERE seq = ?')
      .run(nextDue, seq)
  }

  rawQuery(sql: string, ...params: unknown[]): unknown[] {
    return this.db.prepare(sql).all(...params)
  }

  close(): void {
    this.db.close()
  }
}
