import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'

describe('effect queue', () => {
  let dir: string
  let store: TicketStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'effect-'))
    store = TicketStore.open(join(dir, 't.db'))
  })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  it('coalesces same (kind, key) keeping the original queue position', () => {
    store.enqueueEffect('send', 'a', { n: 1 })
    store.enqueueEffect('send', 'b', { n: 2 })
    store.enqueueEffect('send', 'a', { n: 3 })   // 覆盖 a 的 payload，位置不变
    const due = store.claimDueEffects('send', Date.now(), 10)
    expect(due.map(d => d.key)).toEqual(['a', 'b'])
    expect(due[0].payload).toEqual({ n: 3 })
  })

  it('does not return effects whose due time is in the future', () => {
    store.enqueueEffect('send', 'later', {}, { dueAt: Date.now() + 60_000 })
    expect(store.claimDueEffects('send', Date.now(), 10)).toHaveLength(0)
  })

  it('respects the limit', () => {
    for (const k of ['a', 'b', 'c']) store.enqueueEffect('send', k, {})
    expect(store.claimDueEffects('send', Date.now(), 2)).toHaveLength(2)
  })

  it('survives a close/reopen cycle', () => {
    store.enqueueEffect('send', 'p', { x: 1 })
    store.close()
    store = TicketStore.open(join(dir, 't.db'))
    expect(store.claimDueEffects('send', Date.now(), 10)).toHaveLength(1)
  })
})
