import { describe, it, expect } from 'vitest'
import { parseSchedule, nextRunAt, MIN_INTERVAL_MINUTES } from '../../core/schedule-time'

describe('parseSchedule', () => {
  it('解析 interval', () => {
    expect(parseSchedule('interval:15m')).toEqual({ ok: true, value: { kind: 'interval', minutes: 15 } })
    expect(parseSchedule('interval:60m')).toEqual({ ok: true, value: { kind: 'interval', minutes: 60 } })
  })
  it('interval 小于下限拒绝', () => {
    const r = parseSchedule('interval:5m')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('15')
  })
  it('interval 非数字/零/负数拒绝', () => {
    expect(parseSchedule('interval:abc').ok).toBe(false)
    expect(parseSchedule('interval:0m').ok).toBe(false)
    expect(parseSchedule('interval:-3m').ok).toBe(false)
  })
  it('解析 daily', () => {
    expect(parseSchedule('daily:09:30')).toEqual({ ok: true, value: { kind: 'daily', hour: 9, minute: 30 } })
  })
  it('daily 非法时间拒绝', () => {
    expect(parseSchedule('daily:24:00').ok).toBe(false)
    expect(parseSchedule('daily:09:60').ok).toBe(false)
    expect(parseSchedule('daily:9:30').ok).toBe(false) // 必须两位
  })
  it('解析 weekly 区间', () => {
    expect(parseSchedule('weekly:1-5:09:00')).toEqual({ ok: true, value: { kind: 'weekly', days: [1, 2, 3, 4, 5], hour: 9, minute: 0 } })
  })
  it('weekly 单日与乱序区间', () => {
    expect(parseSchedule('weekly:3-3:23:59')).toEqual({ ok: true, value: { kind: 'weekly', days: [3], hour: 23, minute: 59 } })
    expect(parseSchedule('weekly:0-6:08:00').ok).toBe(true)
  })
  it('weekly 非法 day 拒绝', () => {
    expect(parseSchedule('weekly:1-7:09:00').ok).toBe(false)
    expect(parseSchedule('weekly:5-1:09:00').ok).toBe(false)
  })
  it('未知格式拒绝', () => {
    expect(parseSchedule('every other tuesday').ok).toBe(false)
    expect(parseSchedule('').ok).toBe(false)
  })
  it('下限常量是 15', () => {
    expect(MIN_INTERVAL_MINUTES).toBe(15)
  })
})

describe('nextRunAt', () => {
  // 固定基准：2026-11-12 10:00:00 本地时间（周四）
  const base = new Date(2026, 10, 12, 10, 0, 0).getTime()

  it('interval：严格大于 after', () => {
    const spec = parseSchedule('interval:15m')
    expect(spec.ok && nextRunAt(spec.value, base)).toBe(base + 15 * 60_000)
    // after 恰好落在整点时也不能等于
    const later = nextRunAt({ kind: 'interval', minutes: 15 }, base + 15 * 60_000)
    expect(later).toBe(base + 30 * 60_000)
  })
  it('interval：after 在未来某次触发之后，快进到下一个', () => {
    // base + 2h，应快进到 base + 2h15m（跳过不补）
    const spec = { kind: 'interval', minutes: 15 } as const
    expect(nextRunAt(spec, base + 120 * 60_000)).toBe(base + 135 * 60_000)
  })
  it('daily：当天时间未过用今天，已过用明天', () => {
    const spec = { kind: 'daily', hour: 9, minute: 30 }
    // base 10:00 > 09:30 → 明天 09:30
    expect(nextRunAt(spec, base)).toBe(new Date(2026, 10, 13, 9, 30).getTime())
    const spec2 = { kind: 'daily', hour: 10, minute: 30 }
    expect(nextRunAt(spec2, base)).toBe(new Date(2026, 10, 12, 10, 30).getTime())
  })
  it('weekly：跳到下一个命中的日子', () => {
    // 2026-11-12 是周四(4)。weekly:1-5:11:00 → 今天周四还没到 11:00，用今天
    const spec = { kind: 'weekly', days: [1, 2, 3, 4, 5], hour: 11, minute: 0 }
    expect(nextRunAt(spec, base)).toBe(new Date(2026, 10, 12, 11, 0).getTime())
    // weekly:5-5:09:00（周五 9 点）→ 今天 10 点已过 9 点，明天周五 9 点
    const spec2 = { kind: 'weekly', days: [5], hour: 9, minute: 0 }
    expect(nextRunAt(spec2, base)).toBe(new Date(2026, 10, 13, 9, 0).getTime())
    // weekly:1-1:09:00（周一）→ 下周一 2026-11-16
    const spec3 = { kind: 'weekly', days: [1], hour: 9, minute: 0 }
    expect(nextRunAt(spec3, base)).toBe(new Date(2026, 10, 16, 9, 0).getTime())
  })
})
