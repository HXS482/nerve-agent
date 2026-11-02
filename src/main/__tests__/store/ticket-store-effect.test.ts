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

  // coalesce 必须把 due 收紧到 min(旧, 新)：新 payload 从来没跑过，不该继承
  // 上一次失败留下的退避（最多 60s）。位置（seq）仍然保留，这是另一条契约。
  it('lowers a backing-off due on coalesce instead of keeping the stale delay', () => {
    const now = Date.now()
    store.enqueueEffect('send', 'a', { n: 1 }, { dueAt: now })
    const [claimed] = store.claimDueEffects('send', now, 10)
    // 模拟 execute 失败后的退避：due 被推到 60 秒后
    expect(store.bumpAttempt(claimed.seq, claimed.generation, now + 60_000)).toBe(true)

    // 新活到场：不带 dueAt，即 due = now。
    store.enqueueEffect('send', 'a', { n: 2 })

    const rows = store.rawQuery('SELECT seq, due, payload, attempts, generation FROM effect') as Array<{
      seq: number
      due: number
      payload: string
      attempts: number
      generation: number
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0].seq).toBe(claimed.seq) // 位置不变
    expect(rows[0].due).toBeLessThanOrEqual(Date.now()) // 退避被收紧，不再等 60s
    expect(store.claimDueEffects('send', Date.now(), 10).map(d => d.payload)).toEqual([{ n: 2 }])
  })

  it('never pushes due forward when coalescing onto an already-due row', () => {
    const now = Date.now()
    store.enqueueEffect('send', 'a', { n: 1 }, { dueAt: now })
    // 新 payload 要求一个**更晚**的 due：min 保留更早的那个，不会把已到期的活往后推。
    store.enqueueEffect('send', 'a', { n: 2 }, { dueAt: now + 60_000 })
    const rows = store.rawQuery('SELECT due FROM effect') as Array<{ due: number }>
    expect(rows[0].due).toBe(now)
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

  // claim 只读：行必须留在表里，删除只发生在 deleteEffect。
  it('leaves claimed rows in the table', () => {
    store.enqueueEffect('send', 'a', { n: 1 })
    const first = store.claimDueEffects('send', Date.now(), 10)
    const second = store.claimDueEffects('send', Date.now(), 10)
    expect(first.map(d => d.key)).toEqual(['a'])
    expect(second.map(d => d.key)).toEqual(['a'])
    expect(second[0].seq).toBe(first[0].seq)
  })

  // SQLite 把负 LIMIT 当「不限制」，limit <= 0 必须显式返回空。
  it('returns nothing when the limit is not positive', () => {
    for (const k of ['a', 'b']) store.enqueueEffect('send', k, {})
    expect(store.claimDueEffects('send', Date.now(), 0)).toEqual([])
    expect(store.claimDueEffects('send', Date.now(), -1)).toEqual([])
  })

  it('reports a stale delete when the payload changed while claimed', () => {
    store.enqueueEffect('send', 'a', { n: 1 })
    const [claimed] = store.claimDueEffects('send', Date.now(), 10)
    store.enqueueEffect('send', 'a', { n: 2 })          // arrives mid-flight, merges
    expect(store.deleteEffect(claimed.seq, claimed.generation)).toBe(false)   // stale
    const [again] = store.claimDueEffects('send', Date.now(), 10)
    expect(again.payload).toEqual({ n: 2 })             // the new payload survives
    expect(store.deleteEffect(again.seq, again.generation)).toBe(true)        // fresh delete works
  })

  it('quarantines a malformed payload instead of failing the whole batch', () => {
    store.enqueueEffect('send', 'bad', {})
    store.enqueueEffect('send', 'good', { ok: true })
    store.rawExec("UPDATE effect SET payload = 'not json' WHERE key = 'bad'")
    const due = store.claimDueEffects('send', Date.now(), 10)
    expect(due.map(d => d.key)).toEqual(['good'])
    // 隔离而不是无限重试：坏行被推到 24 小时后，下一轮不会再把整条队列堵死。
    store.deleteEffect(due[0].seq, due[0].generation)
    expect(store.claimDueEffects('send', Date.now(), 10)).toEqual([])
  })
})
