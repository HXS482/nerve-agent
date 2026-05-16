import { useEffect, useState, useMemo, memo, useRef } from 'react'
import { useSubagentTracker, SubagentCard } from '../stores/subagentTracker'

/* ── helpers ── */

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return s % 60 === 0 ? `${m}m` : `${m}m${s % 60}s`
}

const TYPE_META: Record<string, { label: string; accent: string; dim: string; border: string }> = {
  spawn:    { label: 'Subagent',  accent: '#60a5fa', dim: 'rgba(96,165,250,0.06)',  border: 'rgba(96,165,250,0.25)' },
  parallel: { label: 'Parallel',  accent: '#a78bfa', dim: 'rgba(167,139,250,0.06)', border: 'rgba(167,139,250,0.2)' },
  chain:    { label: 'Chain',     accent: '#4ade80', dim: 'rgba(74,222,128,0.06)',  border: 'rgba(74,222,128,0.25)' },
}

/* ── progress ring ── */

function ProgressRing({ progress, size = 28, stroke = 2.5, accent }: {
  progress: number; size?: number; stroke?: number; accent: string
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.min(progress, 1))

  return (
    <svg width={size} height={size} className="subagent-ring" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={accent} strokeOpacity={0.12} strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={accent} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.5s cubic-bezier(0.4,0,0.2,1)' }}
      />
    </svg>
  )
}

/* ── animated checkmark ── */

function CheckIcon({ accent }: { accent?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="subagent-check-pop">
      <path d="M3.5 8.5l3 3 6-6.5" stroke={accent || '#34d399'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="subagent-check-pop">
      <circle cx="8" cy="8" r="5" stroke="#f87171" strokeWidth="1.4" />
      <path d="M6.2 6.2l3.6 3.6M9.8 6.2l-3.6 3.6" stroke="#f87171" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function SpinnerDot({ accent }: { accent: string }) {
  return (
    <span className="subagent-spinner-dot" style={{ background: accent }} />
  )
}

/* ── task item ── */

function TaskItem({ task, now, accent, index }: {
  task: { id: string; task: string; status: string; startedAt: number; completedAt?: number }
  now: number; accent: string; index: number
}) {
  const running = task.status === 'running'
  const done = task.status === 'completed'
  const err = task.status === 'error'

  return (
    <div
      className="subagent-task-item"
      style={{
        '--stagger': `${index * 40}ms`,
        opacity: done ? 0.55 : 1,
      } as React.CSSProperties}
    >
      {/* Status */}
      <span className="subagent-task-status">
        {running && <SpinnerDot accent={accent} />}
        {done && <CheckIcon />}
        {err && <ErrorIcon />}
      </span>

      {/* Text */}
      <span className="subagent-task-text" style={{ color: running ? 'var(--text-on-surface)' : 'var(--text-outline)' }}>
        {task.task}
      </span>

      {/* Duration pill */}
      <span className="subagent-task-time" style={{ color: running ? accent : 'var(--text-outline-variant)' }}>
        {running && elapsed(now - task.startedAt)}
        {done && task.completedAt && elapsed(task.completedAt - task.startedAt)}
        {err && 'err'}
      </span>
    </div>
  )
}

/* ── main component ── */

export const SubagentTracker = memo(function SubagentTracker() {
  const cards = useSubagentTracker((s) => s.cards)
  const clear = useSubagentTracker((s) => s.clear)
  const [expanded, setExpanded] = useState(true)
  const [now, setNow] = useState(Date.now())
  const prevCountRef = useRef(0)

  // tick while running
  useEffect(() => {
    const hasRunning = cards.some((c) => c.tasks.some((t) => t.status === 'running'))
    if (!hasRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [cards])

  // auto-collapse then clear
  useEffect(() => {
    if (cards.length === 0) return
    const allDone = cards.every((c) => c.tasks.every((t) => t.status !== 'running'))
    if (!allDone) return
    const t1 = setTimeout(() => setExpanded(false), 1500)
    const t2 = setTimeout(clear, 5000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [cards, clear])

  // expand on new tasks
  useEffect(() => {
    const total = cards.reduce((n, c) => n + c.tasks.length, 0)
    if (total > prevCountRef.current) setExpanded(true)
    prevCountRef.current = total
  }, [cards])

  const stats = useMemo(() => {
    let total = 0, done = 0, err = 0
    for (const c of cards) for (const t of c.tasks) {
      total++
      if (t.status === 'completed') done++
      if (t.status === 'error') err++
    }
    return { total, done, err, finished: done + err }
  }, [cards])

  const allTasks = useMemo(() =>
    cards.flatMap((c) => c.tasks.map((t) => ({ ...t, cardType: c.type }))),
    [cards]
  )

  if (cards.length === 0) return null

  const running = stats.finished < stats.total
  const progress = stats.total > 0 ? stats.finished / stats.total : 0
  const primary = cards[0]?.type || 'spawn'
  const { label, accent, dim, border } = TYPE_META[primary] || TYPE_META.spawn

  return (
    <div className="subagent-tracker" data-running={running}>
      <div
        className="subagent-card"
        style={{
          '--accent': accent,
          '--dim': dim,
          '--card-border': border,
        } as React.CSSProperties}
      >
        {/* ── header ── */}
        <button className="subagent-header" onClick={() => setExpanded(!expanded)}>
          {/* left: progress ring */}
          <div className="subagent-header-left">
            {running ? (
              <ProgressRing progress={progress} accent={accent} />
            ) : (
              <div className="subagent-done-badge" style={{ background: stats.err > 0 ? 'rgba(248,113,113,0.12)' : 'rgba(52,211,153,0.12)' }}>
                {stats.err > 0 ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M6 6l4 4M10 6l-4 4" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M4 8.5l3 3 5-5.5" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            )}
          </div>

          {/* center: label + meta */}
          <div className="subagent-header-center">
            <span className="subagent-header-label" style={{ color: accent }}>{label}</span>
            <span className="subagent-header-meta">
              <span className="tabular-nums">{stats.finished}/{stats.total}</span>
              {running && (
                <span className="subagent-header-timer tabular-nums">
                  {elapsed(now - (cards[0]?.startedAt || now))}
                </span>
              )}
            </span>
          </div>

          {/* right: chevron */}
          <svg
            width="10" height="10" viewBox="0 0 16 16" fill="none"
            stroke="var(--text-outline-variant)" strokeWidth="2" strokeLinecap="round"
            className="subagent-chevron"
            data-expanded={expanded}
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>

        {/* ── task list ── */}
        <div className="subagent-body" data-expanded={expanded}>
          <div className="subagent-body-inner">
            {allTasks.map((task, i) => (
              <TaskItem key={task.id} task={task} now={now} accent={accent} index={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})
