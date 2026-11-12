/**
 * Routine schedule 的解析与触发计算。纯函数、无依赖，方便单测。
 *
 * 格式（设计文档 §4）：
 *   interval:<N>m      每 N 分钟，N >= MIN_INTERVAL_MINUTES
 *   daily:HH:mm        每天
 *   weekly:<d>-<d>:HH:mm  每周 [d1..d2] 天，d ∈ 0-6，0=周日
 */

export const MIN_INTERVAL_MINUTES = 15

export type ScheduleSpec =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; days: number[]; hour: number; minute: number }

export type ParseResult =
  | { ok: true; value: ScheduleSpec }
  | { ok: false; error: string }

const TIME_RE = /^(\d{2}):(\d{2})$/

function parseHhMm(s: string): { hour: number; minute: number } | null {
  const m = TIME_RE.exec(s)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export function parseSchedule(raw: string): ParseResult {
  const s = raw.trim()
  if (s.startsWith('interval:')) {
    const m = /^(\d+)m$/.exec(s.slice('interval:'.length).trim())
    if (!m) return { ok: false, error: 'interval 格式应为 interval:<N>m，如 interval:15m' }
    const minutes = Number(m[1])
    if (minutes < MIN_INTERVAL_MINUTES) {
      return { ok: false, error: `触发间隔不能小于 ${MIN_INTERVAL_MINUTES} 分钟` }
    }
    return { ok: true, value: { kind: 'interval', minutes } }
  }
  if (s.startsWith('daily:')) {
    const t = parseHhMm(s.slice('daily:'.length).trim())
    if (!t) return { ok: false, error: 'daily 格式应为 daily:HH:mm（两位数）' }
    return { ok: true, value: { kind: 'daily', ...t } }
  }
  if (s.startsWith('weekly:')) {
    // weekly:<d>-<d>:HH:mm
    const m = /^(\d)-(\d):(\d{2}):(\d{2})$/.exec(s.slice('weekly:'.length).trim())
    if (!m) return { ok: false, error: 'weekly 格式应为 weekly:<d>-<d>:HH:mm，d ∈ 0-6（0=周日）' }
    const from = Number(m[1])
    const to = Number(m[2])
    if (from > 6 || to > 6 || from > to) {
      return { ok: false, error: 'weekly 的 day 必须在 0-6 内且起点不大于终点' }
    }
    const hour = Number(m[3])
    const minute = Number(m[4])
    if (hour > 23 || minute > 59) return { ok: false, error: 'weekly 时间非法' }
    const days: number[] = []
    for (let d = from; d <= to; d++) days.push(d)
    return { ok: true, value: { kind: 'weekly', days, hour, minute } }
  }
  return { ok: false, error: '不支持的 schedule 格式。支持：interval:<N>m / daily:HH:mm / weekly:<d>-<d>:HH:mm' }
}

/** afterMs 之后（严格大于）的第一个到期时间戳 */
export function nextRunAt(spec: ScheduleSpec, afterMs: number): number {
  if (spec.kind === 'interval') {
    const step = spec.minutes * 60_000
    // 严格大于：落在边界上时跳到下一档
    return (Math.floor(afterMs / step) + 1) * step
  }
  const after = new Date(afterMs)
  // 从 after 所在天的 00:00 起逐天找
  const dayStart = new Date(after.getFullYear(), after.getMonth(), after.getDate()).getTime()
  for (let i = 0; i < 8; i++) {
    const day = new Date(dayStart + i * 86_400_000)
    if (spec.kind === 'weekly' && !spec.days.includes(day.getDay())) continue
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), spec.hour, spec.minute).getTime()
    if (at > afterMs) return at
  }
  // 不可达（8 天内必有命中）；防御性返回
  return afterMs + 86_400_000
}
