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

  rawQuery(sql: string, ...params: unknown[]): unknown[] {
    return this.db.prepare(sql).all(...params)
  }

  close(): void {
    this.db.close()
  }
}
