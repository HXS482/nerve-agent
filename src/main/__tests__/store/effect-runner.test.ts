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

  it('keeps an ordered kind to one in-flight effect even when concurrency is higher', async () => {
    let live = 0
    let peak = 0
    const ran: string[] = []
    // concurrency: 3 是 ordered 被忽略时才会用到的上限；两者同时给出，
    // 只有真的把 ordered 翻成 limit = 1，峰值才会是 1。
    runner.register('mail', async (_p, key) => {
      live++
      peak = Math.max(peak, live)
      ran.push(key)
      await new Promise(r => setTimeout(r, 20))
      live--
    }, { ordered: true, concurrency: 3 })
    store.enqueueEffect('mail', 'a', {})
    store.enqueueEffect('mail', 'b', {})
    runner.start()
    await runner.idle()
    expect(ran).toEqual(['a', 'b'])
    expect(peak).toBe(1)
    expect(live).toBe(0)
  })

  // 失败路径也有 generation 语义：旧活跑挂了，不能给顶替它的新 payload 涨 attempts / 推后 due。
  it('does not bump the new payload when the superseded one fails', async () => {
    let releaseFirst!: () => void
    const gate = new Promise<void>(resolve => { releaseFirst = resolve })
    let calls = 0
    runner.register('send', async () => {
      calls++
      if (calls === 1) {
        await gate
        throw new Error('old payload blew up')
      }
    })

    const bumpSpy = vi.spyOn(store, 'bumpAttempt')

    store.enqueueEffect('send', 'a', { n: 1 })
    runner.start()
    expect(calls).toBe(1) // 第一条已 claim，卡在 gate 上

    // 跑的过程中来了新 payload：generation 0 → 1，行现在装的是新活
    store.enqueueEffect('send', 'a', { n: 2 })

    releaseFirst()
    await runner.stop() // 等旧活（失败）跑完；active 已 false，不会有新 dispatch

    // 带了 generation：更新命中 0 行，返回 false
    expect(bumpSpy).toHaveBeenCalledTimes(1)
    expect(bumpSpy.mock.calls[0]).toEqual([1, 0, expect.any(Number)])
    expect(bumpSpy.mock.results[0].value).toBe(false)

    const rows = store.rawQuery('SELECT attempts, due, payload, generation FROM effect') as Array<{
      attempts: number
      due: number
      payload: string
      generation: number
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0].generation).toBe(1)
    expect(JSON.parse(rows[0].payload)).toEqual({ n: 2 })
    expect(rows[0].attempts).toBe(0) // 新活没跑过，attempts 不该被旧活的失败推高
    expect(rows[0].due).toBeLessThanOrEqual(Date.now()) // 也没被推后 1 秒
  })

  it('leaves a superseded row for the next dispatch instead of consuming it', async () => {
    let releaseFirst!: () => void
    const gate = new Promise<void>(resolve => { releaseFirst = resolve })
    const seen: unknown[] = []
    let calls = 0
    runner.register('send', async (p) => {
      seen.push(p)
      calls++
      if (calls === 1) await gate
    })
    const deleteSpy = vi.spyOn(store, 'deleteEffect')

    store.enqueueEffect('send', 'a', { n: 1 })
    runner.start()
    expect(calls).toBe(1) // 第一条已经 claim 到、跑起来了，卡在 gate 上

    // 跑的过程中同一个 (kind, key) 又来了新 payload：合并进这一行，generation + 1。
    store.enqueueEffect('send', 'a', { n: 2 })

    releaseFirst()
    await runner.stop() // 等第一条跑完；active 已置 false，不会再有新 dispatch 抢跑

    // 第一条跑完时的 deleteEffect 得以 generation 不匹配而失败：既不是成功、也不算已消费。
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy.mock.calls[0]).toEqual([1, 0]) // seq 1，claim 时的旧 generation 0
    expect(deleteSpy.mock.results[0].value).toBe(false)

    const rows = store.rawQuery('SELECT seq, payload, attempts, generation FROM effect') as Array<{
      seq: number
      payload: string
      attempts: number
      generation: number
    }>
    expect(rows).toHaveLength(1) // 行还在
    expect(JSON.parse(rows[0].payload)).toEqual({ n: 2 }) // 装的是新 payload
    expect(rows[0].generation).toBe(1) // 新 generation 等着被重新 claim
    expect(rows[0].attempts).toBe(0) // 没有被误当成失败 bump

    // 下一轮 dispatch 用新 generation 重新 claim，把新 payload 跑掉。
    await runner.idle()
    expect(seen).toEqual([{ n: 1 }, { n: 2 }])
    expect(store.rawQuery('SELECT seq FROM effect')).toHaveLength(0)
  })
})
