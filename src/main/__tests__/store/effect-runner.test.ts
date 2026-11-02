import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'
import { EffectRunner } from '../../store/effect-runner'

describe('EffectRunner', () => {
  let dir: string, store: TicketStore, runner: EffectRunner
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-'))
    store = TicketStore.open(join(dir, 't.db'))
    runner = new EffectRunner(store, { pollMs: 10 })
  })
  afterEach(async () => { await runner.stop(); store.close(); rmSync(dir, { recursive: true, force: true }) })

  it('runs a due effect and deletes it after success', async () => {
    const seen: unknown[] = []
    runner.register('send', async (p) => { seen.push(p) })
    store.enqueueEffect('send', 'a', { n: 1 })
    runner.start()
    await runner.idle()
    expect(seen).toEqual([{ n: 1 }])
    expect(store.claimDueEffects('send', Date.now(), 10)).toHaveLength(0)
  })

  it('retries with backoff and bumps attempts on failure', async () => {
    let calls = 0
    runner.register('send', async () => { calls++; throw new Error('boom') })
    store.enqueueEffect('send', 'a', {})
    runner.start()
    await runner.idle()
    expect(calls).toBe(1)
    const rows = store.rawQuery('SELECT attempts, due FROM effect') as Array<{ attempts: number; due: number }>
    expect(rows[0].attempts).toBe(1)
    expect(rows[0].due).toBeGreaterThan(Date.now())  // 退避到未来
  })

  it('runs effects of an ordered kind strictly in seq order', async () => {
    const order: string[] = []
    runner.register('send', async (_p, key) => {
      order.push(key)
      await new Promise(r => setTimeout(r, 20))
    }, { ordered: true })
    store.enqueueEffect('send', 'a', {})
    store.enqueueEffect('send', 'b', {})
    runner.start()
    await runner.idle()
    expect(order).toEqual(['a', 'b'])
  })
})
