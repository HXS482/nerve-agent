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
import { BotAvatar } from './BotList'
import { describeSchedule, formatWhen, upcomingRuns } from '../lib/routine-schedule'

/** 卡片里最多展示多少条未来触发（含停用任务不参与） */
const MAX_ROWS = 8
/** 每个 routine 最多取几次未来触发 */
const PER_ROUTINE = 5

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
  const setEnabled = useRoutineStore((s) => s.setEnabled)
  const remove = useRoutineStore((s) => s.remove)
  const [hovered, setHovered] = useState<string | null>(null)

  const bot = useMemo(() => bots.find((b) => b.id === botId) ?? null, [bots, botId])

  const rows = useMemo(() => {
    const now = Date.now()
    const out: Row[] = []
    for (const r of routines) {
      if (!r.enabled) continue
      for (const at of upcomingRuns(r.schedule, now, PER_ROUTINE)) out.push({ routine: r, at })
    }
    out.sort((a, b) => a.at - b.at)
    return out.slice(0, MAX_ROWS)
  }, [routines])

  const disabled = useMemo(() => routines.filter((r) => !r.enabled), [routines])

  return (
    <div
      style={{
        margin: '0 10px 10px',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'var(--bg-surface-container)',
        overflow: 'hidden',
      }}
    >
      <div
        className="text-[11px]"
        style={{
          padding: '10px 12px 6px',
          color: 'var(--text-on-surface-variant)',
          fontWeight: 500,
        }}
      >
        即将运行
      </div>

      {rows.length === 0 && disabled.length === 0 && (
        <div className="text-[11px]" style={{ padding: '2px 12px 12px', color: 'var(--text-outline-variant)' }}>
          还没有定时任务
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
              width: 5,
              height: 5,
              borderRadius: '50%',
              flexShrink: 0,
              background: i === 0 ? '#7C5CD6' : 'rgba(124, 92, 214, 0.55)',
            }}
          />

          <div className="flex-1 min-w-0">
            <div className="text-[12px] truncate" style={{ color: 'var(--text-on-surface)' }}>
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
                <BotAvatar bot={bot} size={22} />
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
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '6px 12px 8px' }}>
          {disabled.map((r) => (
            <div key={r.id} className="flex items-center gap-2" style={{ padding: '3px 0' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-outline-variant)', flexShrink: 0 }} />
              <span className="text-[11px] flex-1 truncate" style={{ color: 'var(--text-outline-variant)' }}>
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
