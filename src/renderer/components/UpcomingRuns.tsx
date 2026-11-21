/**
 * 「即将运行」卡片。
 *
 * 不是按 routine 一行，而是按**下一次触发时刻**展开：
 * 同一个 routine 未来若干次触发各占一行，跨 routine 按时间排序，合并成一条时间线。
 * 这样看到的是「接下来会发生什么」，而不是「我配了哪些任务」——
 * 后者对调度类功能来说意义有限（用户真正想知道的是下一次什么时候响）。
 */

import { useMemo, useState } from 'react'
import { useRoutineStore, type Routine } from '../stores/routineStore'
import { useChatStore } from '../stores/chatStore'
import { BotAvatar } from './BotList'
import { describeSchedule, formatWhen, upcomingRuns } from '../lib/routine-schedule'

/** 每个粒度下：总共最多展示几行 / 单个任务最多取几次 */
const LIMITS = {
  day: { total: 6, perRoutine: 3 },
  week: { total: 10, perRoutine: 5 },
  month: { total: 14, perRoutine: 8 },
} as const

interface Row {
  routine: Routine
  at: number
}

interface Props {
  routines: Routine[]
  botId: string
}

export function UpcomingRuns({ routines, botId }: Props) {
  const bots = useRoutineStore((s) => s.bots)
  const theme = useChatStore((s) => s.theme)
  const setEnabled = useRoutineStore((s) => s.setEnabled)
  const remove = useRoutineStore((s) => s.remove)
  const [hovered, setHovered] = useState<string | null>(null)
  const [range, setRange] = useState<'day' | 'week' | 'month'>('day')

  const bot = useMemo(() => bots.find((b) => b.id === botId) ?? null, [bots, botId])

  const RANGE_MS = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 }

  const rows = useMemo(() => {
    const now = Date.now()
    const horizon = now + RANGE_MS[range]
    const limit = LIMITS[range]
    const out: Row[] = []
    for (const r of routines) {
      if (!r.enabled) continue
      // 按粒度截取窗口内的触发；单任务取几次有上限，避免高频任务淹没其他任务
      let taken = 0
      for (const at of upcomingRuns(r.schedule, now, limit.perRoutine)) {
        if (at > horizon) break
        out.push({ routine: r, at })
        if (++taken >= limit.perRoutine) break
      }
    }
    out.sort((a, b) => a.at - b.at)
    return out.slice(0, limit.total)
  }, [routines, range])

  const disabled = useMemo(() => routines.filter((r) => !r.enabled), [routines])

  return (
    <div
      style={{
        margin: '0 10px 10px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-background)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px 10px 6px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span className="text-[10px]" style={{ color: 'var(--text-on-surface-variant)', fontWeight: 500 }}>
          即将运行
        </span>

        {/* 分段控件：日 / 周 / 月 —— 决定时间窗口，不是分组方式 */}
        <div
          style={{
            display: 'flex',
            padding: 2,
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface-container)',
            gap: 2,
          }}
        >
          {([
            { id: 'day', label: '日' },
            { id: 'week', label: '周' },
            { id: 'month', label: '月' },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setRange(opt.id)}
              style={{
                minWidth: 26,
                padding: '2px 7px',
                borderRadius: 5,
                border: 'none',
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: range === opt.id ? 600 : 500,
                background: range === opt.id ? 'var(--text-on-surface)' : 'transparent',
                color: range === opt.id ? 'var(--bg-background)' : 'var(--text-outline)',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 && disabled.length === 0 && (
        <div className="text-[10px]" style={{ padding: '3px 12px 13px', color: 'var(--text-outline)' }}>
          {range === 'day' ? '今天没有要运行的任务' : range === 'week' ? '这一周没有要运行的任务' : '这 30 天没有要运行的任务'}
        </div>
      )}

      {rows.map(({ routine: r, at }, i) => (
        <div
          key={`${r.id}-${at}`}
          className="flex items-center gap-2.5"
          style={{ padding: '7px 12px', position: 'relative' }}
          onMouseEnter={() => setHovered(`${r.id}-${at}`)}
          onMouseLeave={() => setHovered(null)}
        >
          {/* 时间线圆点：第一行稍亮，其余保持同一节奏 */}
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              flexShrink: 0,
              marginTop: 6,
              background: 'var(--text-on-surface)',
              opacity: i === 0 ? 1 : 0.5,
            }}
          />

          <div className="flex-1 min-w-0">
            <div className="text-[11px] truncate" style={{ color: 'var(--text-on-surface)' }}>
              {r.instruction}
            </div>
            <div className="text-[10px] truncate" style={{ color: 'var(--text-on-surface-variant)', marginTop: 1 }}>
              {formatWhen(at)} · {describeSchedule(r.schedule)}
              {r.consecutiveFailures > 0 ? ` · 连续失败 ${r.consecutiveFailures}` : ''}
            </div>
          </div>

          {/* hover 时操作浮在头像位置，不挤动布局（与侧栏会话行同一套做法） */}
          <div style={{ position: 'relative', width: 22, height: 22, flexShrink: 0 }}>
            {bot && (
              <div
                style={{
                  opacity: hovered === `${r.id}-${at}` ? 0 : 1,
                  transition: 'opacity 0.12s',
                }}
              >
                <BotAvatar
                  bot={bot}
                  size={22}
                  paper={theme === 'light' ? '#eeeeee' : '#201f1f'}
                />
              </div>
            )}
            {hovered === `${r.id}-${at}` && (
              <div className="absolute inset-0 flex items-center gap-1 justify-end">
                <button
                  onClick={() => void setEnabled(r.id, false)}
                  title="停用"
                  className="text-[9px] rounded"
                  style={{ color: 'var(--text-on-surface-variant)', padding: '0 2px' }}
                >
                  停
                </button>
                <button
                  onClick={() => void remove(r.id)}
                  title="删除"
                  className="text-[9px] rounded"
                  style={{ color: 'var(--error)', padding: '0 2px' }}
                >
                  删
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* 停用中的任务不占时间线，但必须能看到 —— 否则用户以为它消失了 */}
      {disabled.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '7px 12px 9px' }}>
          {disabled.map((r) => (
            <div key={r.id} className="flex items-center gap-2" style={{ padding: '3px 0' }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-outline-variant)', flexShrink: 0, marginTop: 5 }} />
              <span className="text-[10px] flex-1 truncate" style={{ color: 'var(--text-outline-variant)' }}>
                {r.instruction}
              </span>
              <button
                onClick={() => void setEnabled(r.id, true)}
                className="text-[9px] shrink-0"
                style={{ color: 'var(--text-on-surface-variant)' }}
              >
                启用
              </button>
              <button
                onClick={() => void remove(r.id)}
                className="text-[9px] shrink-0"
                style={{ color: 'var(--error)' }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
