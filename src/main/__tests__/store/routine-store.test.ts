// src/main/__tests__/store/routine-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RoutineStore } from '../../store/routine-store'

describe('RoutineStore', () => {
  let dir: string, store: RoutineStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rt-'))
    store = RoutineStore.open(join(dir, 'routines.db'))
  })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  const mk = (over: Record<string, string> = {}) =>
    store.create({ botId: 'bot_1', sessionId: 's1', instruction: '每天汇报', schedule: 'interval:15m', createdBy: 'model' as const, ...over } as any)

  it('create 计算 nextRunAt 并落库', () => {
    const r = mk()
    expect(r.id).toMatch(/^rt_/)
    expect(r.enabled).toBe(true)
    expect(r.nextRunAt).toBeGreaterThan(Date.now() - 1000)
    expect(r.consecutiveFailures).toBe(0)
  })

  it('create 非法 schedule 抛错', () => {
    expect(() => mk({ schedule: 'every minute' })).toThrow()
    expect(() => mk({ schedule: 'interval:5m' })).toThrow()
  })

  it('启用数量上限 20', () => {
    for (let i = 0; i < 20; i++) mk({ instruction: `job-${i}` })
    expect(() => mk({ instruction: 'job-21' })).toThrow(/20/)
  })

  it('禁用后不计入上限，重新启用被上限拦住', () => {
    for (let i = 0; i < 20; i++) mk({ instruction: `job-${i}` })
    const first = store.listByBot('bot_1')[0]
    store.update(first.id, { enabled: false })
    const r = mk({ instruction: 'job-21' })
    expect(r.enabled).toBe(true)
    expect(() => store.update(first.id, { enabled: true })).toThrow(/20/)
  })

  it('due 只返回 enabled 且到期的', () => {
    const a = mk()
    const later = new Date(Date.now() + 20 * 60_000)
    mk({ schedule: `daily:${String(later.getHours()).padStart(2, '0')}:${String(later.getMinutes()).padStart(2, '0')}` })
    store.update(a.id, { enabled: false })
    expect(store.due(Date.now() + 16 * 60_000)).toHaveLength(0)
    const b = mk({ instruction: 'live' })
    expect(store.due(Date.now() + 16 * 60_000).map((r) => r.id)).toContain(b.id)
  })

  it('advanceStamp 快进到未来第一个到期点', () => {
    const r = mk()
    const future = Date.now() + 45 * 60_000
    store.advanceStamp(r.id, future)
    const after = store.get(r.id)!
    expect(after.nextRunAt).toBeGreaterThan(future)
    expect(after.nextRunAt).toBeLessThanOrEqual(future + 15 * 60_000 + 1000)
    expect(after.lastRunAt).not.toBeNull()
  })

  it('疲劳规则：首轮失败 notified，第 10 次熄火', () => {
    const r = mk()
    const f1 = store.recordFailure(r.id)
    expect(f1.notified).toBe(true)
    expect(f1.disabled).toBe(false)
    for (let i = 0; i < 8; i++) {
      expect(store.recordFailure(r.id).notified).toBe(false)
    }
    const f10 = store.recordFailure(r.id)
    expect(f10.notified).toBe(false)
    expect(f10.disabled).toBe(true)
    expect(store.get(r.id)!.enabled).toBe(false)
  })

  it('recordFailure 不会复活被手动停用的 routine', () => {
    const r = mk()
    store.update(r.id, { enabled: false })
    store.recordFailure(r.id)
    expect(store.get(r.id)!.enabled).toBe(false)
  })

  it('recordSuccess 清零，重新启用也清零', () => {
    const r = mk()
    store.recordFailure(r.id)
    store.recordSuccess(r.id)
    expect(store.recordFailure(r.id).notified).toBe(true)
    expect(store.get(r.id)!.consecutiveFailures).toBe(1)
    // 熄火后重新启用 → 计数清零
    for (let i = 0; i < 9; i++) store.recordFailure(r.id)
    store.recordFailure(r.id) // 第 10 次 → disabled
    store.update(r.id, { enabled: true })
    expect(store.get(r.id)!.consecutiveFailures).toBe(0)
  })

  it('sweep 心跳读写', () => {
    expect(store.lastSweep()).toBeNull()
    store.recordSweep(1000)
    store.recordSweep(2000)
    expect(store.lastSweep()).toBe(2000)
  })
})
