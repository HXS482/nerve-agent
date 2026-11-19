import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RoutineStore } from '../../store/routine-store'
import { BotRegistry } from '../../core/bot-registry'
import { Scheduler, type RoutineDispatch } from '../../core/scheduler'

describe('Scheduler', () => {
  let dir: string, store: RoutineStore, bots: BotRegistry
  let dispatched: RoutineDispatch[]
  let accept: boolean

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sched-'))
    store = RoutineStore.open(join(dir, 'r.db'))
    bots = await BotRegistry.create(join(dir, 'bots'))
    dispatched = []
    accept = true
  })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  const mkSched = () => new Scheduler({
    store, bots,
    dispatch: async (d) => { dispatched.push(d); return accept },
  })

  it('到期 routine 被触发，stamp 先快进', async () => {
    const bot = await bots.getDefault()
    const r = store.create({ botId: bot.id, sessionId: 's1', instruction: '汇报天气', schedule: 'interval:15m', createdBy: 'model' })
    store.advanceStamp(r.id, Date.now() - 17 * 60_000)
    const n = await mkSched().sweep()
    expect(n).toBe(1)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].text).toBe('[Routine 触发] 汇报天气')
    expect(dispatched[0].source).toBe(`routine:${r.id}`)
    expect(dispatched[0].sessionId).toBe('s1')
    expect(dispatched[0].kind).toBe('system')
    expect(store.get(r.id)!.nextRunAt).toBeGreaterThan(Date.now())
  })

  it('dispatch 拒绝计入失败，首轮失败标记 notified', async () => {
    const bot = await bots.getDefault()
    const r = store.create({ botId: bot.id, sessionId: 's1', instruction: 'x', schedule: 'interval:15m', createdBy: 'model' })
    store.advanceStamp(r.id, Date.now() - 17 * 60_000)
    accept = false
    await mkSched().sweep()
    const after = store.get(r.id)!
    expect(after.consecutiveFailures).toBe(1)
    expect(after.failureNotified).toBe(true)
    expect(after.enabled).toBe(true)
  })

  it('dispatch 抛错同样计入失败', async () => {
    const bot = await bots.getDefault()
    store.create({ botId: bot.id, sessionId: 's1', instruction: 'x', schedule: 'interval:15m', createdBy: 'model' })
    store.advanceStamp(store.listByBot(bot.id)[0].id, Date.now() - 17 * 60_000)
    const s = new Scheduler({ store, bots, dispatch: async () => { throw new Error('boom') } })
    await s.sweep()
    expect(store.listByBot(bot.id)[0].consecutiveFailures).toBe(1)
  })

  it('Bot 已删除的 routine 计入失败（否则它永远挂着一个到不了的下次触发时间）', async () => {
    const bot = await bots.create({ name: 'temp' })
    const r = store.create({ botId: bot.id, sessionId: 's1', instruction: 'x', schedule: 'interval:15m', createdBy: 'model' })
    store.advanceStamp(r.id, Date.now() - 17 * 60_000)
    await bots.remove(bot.id)
    const n = await mkSched().sweep()
    expect(n).toBe(1)
    expect(store.get(r.id)!.consecutiveFailures).toBe(1)
    expect(dispatched).toHaveLength(0)
  })

  it('成功清零失败计数', async () => {
    const bot = await bots.getDefault()
    const r = store.create({ botId: bot.id, sessionId: 's1', instruction: 'x', schedule: 'interval:15m', createdBy: 'model' })
    store.advanceStamp(r.id, Date.now() - 17 * 60_000)
    accept = false
    await mkSched().sweep()
    accept = true
    store.advanceStamp(r.id, Date.now() - 17 * 60_000)
    await mkSched().sweep()
    expect(store.get(r.id)!.consecutiveFailures).toBe(0)
  })

  it('sweep 记录心跳', async () => {
    await mkSched().sweep()
    expect(store.lastSweep()).not.toBeNull()
  })

  it('start/stop 管理定时器', () => {
    vi.useFakeTimers()
    const s = mkSched()
    s.start()
    expect(s.isRunning).toBe(true)
    s.stop()
    expect(s.isRunning).toBe(false)
    vi.useRealTimers()
  })
})
