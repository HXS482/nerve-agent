/**
 * 渲染层用的 routine 时间工具。
 *
 * 主进程已经有 schedule-time.ts，但它不跨界（renderer 只拿到 schedule 字符串）。
 * 这里保留同一套三种格式的解析 + 中文描述 + 未来若干次触发点的枚举，
 * 供「即将运行」列表使用。格式若在主进程扩展，这里也要同步。
 */

export type ScheduleSpec =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; days: number[]; hour: number; minute: number }

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function parseSchedule(raw: string): ScheduleSpec | null {
  const s = raw.trim()
  if (s.startsWith('interval:')) {
    const m = /^(\d+)m$/.exec(s.slice(9).trim())
    if (!m) return null
    return { kind: 'interval', minutes: Number(m[1]) }
  }
  if (s.startsWith('daily:')) {
    const m = /^(\d{2}):(\d{2})$/.exec(s.slice(6).trim())
    if (!m) return null
    return { kind: 'daily', hour: Number(m[1]), minute: Number(m[2]) }
  }
  if (s.startsWith('weekly:')) {
    const m = /^(\d)-(\d):(\d{2}):(\d{2})$/.exec(s.slice(7).trim())
    if (!m) return null
    const days: number[] = []
    for (let d = Number(m[1]); d <= Number(m[2]); d++) days.push(d)
    return { kind: 'weekly', days, hour: Number(m[3]), minute: Number(m[4]) }
  }
  return null
}

/** 中文描述：每天 09:00 / 每 30 分钟 / 每周一至周五 09:00 */
export function describeSchedule(raw: string): string {
  const spec = parseSchedule(raw)
  if (!spec) return raw
  const hh = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  if (spec.kind === 'interval') {
    if (spec.minutes % 60 === 0) return `每 ${spec.minutes / 60} 小时`
    return `每 ${spec.minutes} 分钟`
  }
  const time = hh(spec.hour, spec.minute)
  if (spec.kind === 'daily') return `每天 ${time}`
  // weekly
  if (spec.days.length === 7) return `每天 ${time}`
  if (spec.days.join() === '1,2,3,4,5') return `工作日 ${time}`
  if (spec.days.length === 1) return `每周${WEEKDAYS[spec.days[0]]} ${time}`
  return `每周${WEEKDAYS[spec.days[0]]}至${WEEKDAYS[spec.days[spec.days.length - 1]]} ${time}`
}

function nextRunAt(spec: ScheduleSpec, afterMs: number): number {
  if (spec.kind === 'interval') {
    const step = spec.minutes * 60_000
    return (Math.floor(afterMs / step) + 1) * step
  }
  const after = new Date(afterMs)
  for (let i = 0; i < 8; i++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i)
    if (spec.kind === 'weekly' && !spec.days.includes(day.getDay())) continue
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), spec.hour, spec.minute).getTime()
    if (at > afterMs) return at
  }
  return afterMs + 86_400_000
}

/** 从 now 起算的未来 n 次触发点。 */
export function upcomingRuns(schedule: string, now: number, n: number): number[] {
  const spec = parseSchedule(schedule)
  if (!spec) return []
  const out: number[] = []
  let cursor = now
  for (let i = 0; i < n; i++) {
    const at = nextRunAt(spec, cursor)
    out.push(at)
    cursor = at
  }
  return out
}

/** 「明天 9:00」/「今天 9:00」/「11月15日周日 9:00」 */
export function formatWhen(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.round((startOf(d) - startOf(today)) / 86_400_000)
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  if (dayDiff === 0) return `今天 ${hm}`
  if (dayDiff === 1) return `明天 ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日周${WEEKDAYS[d.getDay()]} ${hm}`
}
