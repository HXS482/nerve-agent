// src/main/store/routine-store.ts
/**
 * Routine 数据层（设计文档 §2）。独立 routines.db，不进 tickets.db。
 * 护栏（下限/上限）与疲劳规则的判定在这里，调用方只消费结果。
 */
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import { parseSchedule, nextRunAt } from '../core/schedule-time'

export interface RoutineRow {
  id: string
  botId: string
  sessionId: string
  instruction: string
  schedule: string
  nextRunAt: number
  enabled: boolean
  consecutiveFailures: number
  failureNotified: boolean
  lastRunAt: number | null
  createdBy: 'user' | 'model'
  createdAt: number
  updatedAt: number
}

export const MAX_ENABLED_PER_BOT = 20
const FAILURE_LIMIT = 10

type Database = any // better-sqlite3 惰性 require，与 ticket-store 同款

export class RoutineStore {
  private constructor(private db: Database) {}

  static open(dbPath: string): RoutineStore {
    mkdirSync(dirname(dbPath), { recursive: true })
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, session_id TEXT NOT NULL,
        instruction TEXT NOT NULL, schedule TEXT NOT NULL,
        next_run_at INTEGER NOT NULL, enabled INTEGER DEFAULT 1,
        consecutive_failures INTEGER DEFAULT 0, failure_notified INTEGER DEFAULT 0,
        last_run_at INTEGER, created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_routines_bot ON routines(bot_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_routines_due ON routines(enabled, next_run_at);
      CREATE TABLE IF NOT EXISTS routine_sweeps (
        id INTEGER PRIMARY KEY AUTOINCREMENT, swept_at INTEGER NOT NULL
      );
    `)
    return new RoutineStore(db)
  }

  close(): void {
    this.db.close()
  }

  private rowToRoutine(r: any): RoutineRow {
    return {
      id: r.id, botId: r.bot_id, sessionId: r.session_id,
      instruction: r.instruction, schedule: r.schedule,
      nextRunAt: r.next_run_at, enabled: !!r.enabled,
      consecutiveFailures: r.consecutive_failures, failureNotified: !!r.failure_notified,
      lastRunAt: r.last_run_at, createdBy: r.created_by,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }
  }

  private countEnabled(botId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM routines WHERE bot_id = ? AND enabled = 1').get(botId) as { n: number }).n
  }

  create(input: { botId: string; sessionId: string; instruction: string; schedule: string; createdBy: 'user' | 'model' }): RoutineRow {
    // 空 sessionId 会让所有 routine 共用一个投递目标，必须由调用方先解析出真实会话
    if (!input.sessionId) throw new Error('routine 必须绑定一个投递会话')
    const parsed = parseSchedule(input.schedule)
    if (!parsed.ok) throw new Error(`schedule 非法: ${parsed.error}`)
    if (this.countEnabled(input.botId) >= MAX_ENABLED_PER_BOT) {
      throw new Error(`该 Bot 启用中的 routine 已达上限 ${MAX_ENABLED_PER_BOT} 个`)
    }
    const now = Date.now()
    const row = {
      id: `rt_${randomUUID()}`,
      bot_id: input.botId, session_id: input.sessionId,
      instruction: input.instruction, schedule: input.schedule,
      next_run_at: nextRunAt(parsed.value, now),
      enabled: 1, consecutive_failures: 0, failure_notified: 0,
      last_run_at: null, created_by: input.createdBy,
      created_at: now, updated_at: now,
    }
    this.db.prepare(`INSERT INTO routines (id, bot_id, session_id, instruction, schedule, next_run_at, enabled, consecutive_failures, failure_notified, last_run_at, created_by, created_at, updated_at)
      VALUES (@id, @bot_id, @session_id, @instruction, @schedule, @next_run_at, @enabled, @consecutive_failures, @failure_notified, @last_run_at, @created_by, @created_at, @updated_at)`).run(row)
    return this.rowToRoutine(row)
  }

  get(id: string): RoutineRow | null {
    const r = this.db.prepare('SELECT * FROM routines WHERE id = ?').get(id)
    return r ? this.rowToRoutine(r) : null
  }

  listByBot(botId: string, opts: { includeDisabled?: boolean } = {}): RoutineRow[] {
    const sql = opts.includeDisabled
      ? 'SELECT * FROM routines WHERE bot_id = ? ORDER BY enabled DESC, next_run_at'
      : 'SELECT * FROM routines WHERE bot_id = ? AND enabled = 1 ORDER BY next_run_at'
    return (this.db.prepare(sql).all(botId) as any[]).map((r) => this.rowToRoutine(r))
  }

  listAll(): RoutineRow[] {
    return (this.db.prepare('SELECT * FROM routines').all() as any[]).map((r) => this.rowToRoutine(r))
  }

  due(now: number): RoutineRow[] {
    return (this.db.prepare('SELECT * FROM routines WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at').all(now) as any[]).map((r) => this.rowToRoutine(r))
  }

  update(id: string, patch: { instruction?: string; schedule?: string; enabled?: boolean }): RoutineRow {
    const cur = this.get(id)
    if (!cur) throw new Error(`routine not found: ${id}`)
    let nextAt = cur.nextRunAt
    if (patch.schedule !== undefined && patch.schedule !== cur.schedule) {
      const parsed = parseSchedule(patch.schedule)
      if (!parsed.ok) throw new Error(`schedule 非法: ${parsed.error}`)
      nextAt = nextRunAt(parsed.value, Date.now())
    }
    if (patch.enabled === true && !cur.enabled) {
      if (this.countEnabled(cur.botId) >= MAX_ENABLED_PER_BOT) {
        throw new Error(`该 Bot 启用中的 routine 已达上限 ${MAX_ENABLED_PER_BOT} 个`)
      }
      // 重新启用视为重新开始计数
      this.db.prepare('UPDATE routines SET consecutive_failures = 0, failure_notified = 0 WHERE id = ?').run(id)
    }
    this.db.prepare(`UPDATE routines SET
      instruction = COALESCE(?, instruction), schedule = COALESCE(?, schedule),
      next_run_at = ?, enabled = COALESCE(?, enabled), updated_at = ?
      WHERE id = ?`).run(
        patch.instruction ?? null, patch.schedule ?? null,
        nextAt, patch.enabled === undefined ? null : (patch.enabled ? 1 : 0),
        Date.now(), id)
    return this.get(id)!
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM routines WHERE id = ?').run(id).changes > 0
  }

  /** 快进 stamp 到未来第一个到期点（跳过不补，设计文档 §5）。 */
  advanceStamp(id: string, now: number): void {
    const cur = this.get(id)
    if (!cur) return
    const parsed = parseSchedule(cur.schedule)
    if (!parsed.ok) return
    this.db.prepare('UPDATE routines SET next_run_at = ?, last_run_at = ?, updated_at = ? WHERE id = ?')
      .run(nextRunAt(parsed.value, now), now, Date.now(), id)
  }

  recordSuccess(id: string): void {
    this.db.prepare('UPDATE routines SET consecutive_failures = 0, failure_notified = 0, updated_at = ? WHERE id = ?').run(Date.now(), id)
  }

  /** notified=本轮首次失败（调用方发通知）；disabled=连续失败达上限已熄火。 */
  recordFailure(id: string): { notified: boolean; disabled: boolean } {
    const cur = this.get(id)
    if (!cur) return { notified: false, disabled: false }
    const count = cur.consecutiveFailures + 1
    const first = !cur.failureNotified
    const disable = count >= FAILURE_LIMIT
    this.db.prepare('UPDATE routines SET consecutive_failures = ?, failure_notified = ?, enabled = ?, updated_at = ? WHERE id = ?')
      .run(count, first || cur.failureNotified ? 1 : 0, cur.enabled && !disable ? 1 : 0, Date.now(), id)
    return { notified: first, disabled: disable }
  }

  recordSweep(now: number): void {
    this.db.prepare('INSERT INTO routine_sweeps (swept_at) VALUES (?)').run(now)
  }

  lastSweep(): number | null {
    const r = this.db.prepare('SELECT MAX(swept_at) AS t FROM routine_sweeps').get() as { t: number | null }
    return r.t
  }
}
