import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'

describe('TicketStore', () => {
  let dir: string
  let store: TicketStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ticket-store-'))
    store = TicketStore.open(join(dir, 'tickets.db'))
  })

  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the effect table on open', () => {
    const rows = store.rawQuery(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='effect'",
    )
    expect(rows).toHaveLength(1)
  })

  it('is idempotent: opening the same path twice does not throw', () => {
    const second = TicketStore.open(join(dir, 'tickets.db'))
    expect(() => second.close()).not.toThrow()
  })
})
