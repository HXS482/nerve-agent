import { useState, useEffect, useMemo, useRef, useId } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useChatStore } from '../stores/chatStore'
import { UsageStats } from '../../shared/types'

const ROWS = 7 // Sun=0 .. Sat=6

/** Local date key — matches the LOCAL-time bucketing used by the backend. */
function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildYearGrid(dailyActivity: Record<string, { messages: number; tokens: number }>): { grid: (number | null)[][]; maxVal: number } {
  const now = new Date()
  const todayDow = now.getDay()

  // End = today (local)
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Start = 52 weeks before the Sunday of today's week
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - todayDow - 52 * 7)

  // Build count map
  const countMap: Record<string, number> = {}
  for (const [k, v] of Object.entries(dailyActivity)) {
    countMap[k] = v.tokens
  }

  // Compute total weeks
  const totalMs = endDate.getTime() - startDate.getTime()
  const totalWeeks = Math.ceil(totalMs / (7 * 86_400_000)) + 1

  const grid: (number | null)[][] = Array.from({ length: ROWS }, () => new Array(totalWeeks).fill(null))

  let maxVal = 0

  for (let week = 0; week < totalWeeks; week++) {
    for (let day = 0; day < ROWS; day++) {
      const cellDate = new Date(startDate)
      cellDate.setDate(cellDate.getDate() + week * 7 + day)
      if (cellDate > endDate) { grid[day][week] = null; continue }

      const key = toDateKey(cellDate)
      const count = countMap[key] || 0
      grid[day][week] = count
      if (count > maxVal) maxVal = count
    }
  }

  return { grid, maxVal }
}

const CELL = 11
const GAP = 3
const STACK_LIMIT = 3

// Reference GitHubActivity coloring: one accent + per-level opacity over a neutral base cell
const ACCENT = '#39d353'
const LEVEL_OPACITY: Record<number, number> = { 0: 0, 1: 0.3, 2: 0.52, 3: 0.76, 4: 1 }

/** Format a token count with K/M suffixes. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export function UsageStatsPanel() {
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [open, setOpen] = useState(false) // bottom floating panel (expand/collapse)
  const theme = useChatStore((s) => s.theme)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    window.claude.getUsageStats().then((s: UsageStats) => setStats(s)).catch(() => {})
  }, [])

  const { grid, maxVal } = useMemo(() => {
    if (!stats) return { grid: [], maxVal: 0 }
    return buildYearGrid(stats.dailyActivity)
  }, [stats])

  if (!stats || grid.length === 0) return null

  const totalTokens = formatTokens(stats.totalInputTokens + stats.totalOutputTokens)
  const totalMessages = formatTokens(stats.totalMessages)

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Header */}
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        style={{ padding: '6px 6px 4px 6px' }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-on-surface-variant)' }}>
            <path d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z" />
          </svg>
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-on-surface-variant)', letterSpacing: '0.4px' }}>
            Usage
          </span>
        </div>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-outline-variant)" strokeWidth="2" strokeLinecap="round"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {!collapsed && (
        <div style={{ padding: '0 5px 6px' }}>
          <HeatmapCard
            theme={theme}
            grid={grid}
            maxVal={maxVal}
            open={open}
            setOpen={setOpen}
            reduceMotion={reduceMotion}
            totalTokens={totalTokens}
            totalMessages={totalMessages}
            totalSessions={String(stats.totalSessions)}
          />
        </div>
      )}
    </div>
  )
}

// --- Heatmap card: vertical week columns + bottom floating panel (GitHubActivity-style) ---
// Collapsed: floating bar = title + stacked circular metric icons + chevron.
// Expanded: panel covers the card; icons morph (layoutId) into one row per metric.
type MetricKind = 'tokens' | 'sessions' | 'messages'

function MetricIcon({ kind, size = 12 }: { kind: MetricKind; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (kind === 'tokens') {
    // coin: circle + mini bar chart
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 15v-3M12 15V9M15.5 15v-4.5" />
      </svg>
    )
  }
  if (kind === 'sessions') {
    // chat bubble
    return (
      <svg {...common}>
        <path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12Z" />
      </svg>
    )
  }
  // messages: envelope
  return (
    <svg {...common}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  )
}

const EASE_OUT = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring' as const, bounce: 0.2, duration: 0.62 }
const HEADER_SPRING = { ...SPRING, bounce: 0.45 }
const ROW_SPRING = { ...SPRING, bounce: 0.26, delay: 0.08 }
const ROW_OFFSET = 10

function HeatmapCard({
  theme,
  grid,
  maxVal,
  open,
  setOpen,
  reduceMotion,
  totalTokens,
  totalMessages,
  totalSessions,
}: {
  theme: string
  grid: (number | null)[][]
  maxVal: number
  open: boolean
  setOpen: (v: boolean) => void
  reduceMotion: boolean | null
  totalTokens: string
  totalMessages: string
  totalSessions: string
}) {
  const isLight = theme === 'light'

  const spring = reduceMotion ? { duration: 0 } : SPRING
  const headerSpring = reduceMotion ? { duration: 0 } : HEADER_SPRING
  const rowSpring = reduceMotion ? { duration: 0 } : ROW_SPRING

  // grid rows = days (0..6), transpose into week columns
  const weeks = useMemo(() => {
    if (!grid.length) return []
    const totalWeeks = grid[0].length
    return Array.from({ length: totalWeeks }, (_, w) =>
      Array.from({ length: ROWS }, (_, d) => grid[d]?.[w] ?? null)
    )
  }, [grid])

  // Grid fills the container exactly: cell size derives from measured width and column count,
  // so cells stretch to use every pixel and the leftover (< one cell) splits evenly left/right.
  const fitRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<{ cell: number; count: number; pad: number }>()
  useEffect(() => {
    const el = fitRef.current
    if (!el) return
    const measure = () => {
      const inner = el.clientWidth - 16 // minus the 8px padding on each side
      const count = Math.max(1, Math.floor((inner + GAP) / (CELL + GAP)))
      const cell = (inner - (count - 1) * GAP) / count
      const pad = (inner - count * cell - (count - 1) * GAP) / 2
      setFit({ cell, count, pad })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)
  const show = (val: number | null, cell: HTMLElement) => {
    if (val === null) return
    const rect = cell.getBoundingClientRect()
    setTooltip({ text: `${formatTokens(val)} tokens`, x: rect.left + rect.width / 2, y: rect.top })
  }

  // The last `fit.count` week columns
  const shown = fit ? weeks.slice(-fit.count) : []

  // metrics: icon + label + value
  const metrics: { kind: MetricKind; label: string; value: string }[] = [
    { kind: 'tokens', label: 'Token usage', value: totalTokens },
    { kind: 'sessions', label: 'Sessions', value: totalSessions },
    { kind: 'messages', label: 'Messages', value: totalMessages },
  ]
  const uid = useId()

  const CARD_GLASS: React.CSSProperties = theme === 'aurora'
    ? { border: '1px solid var(--glass-border)' }
    : {
        background: isLight ? 'rgba(255, 255, 255, 0.6)' : 'rgba(30, 30, 32, 0.6)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: isLight ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.08)',
      }

  const PANEL_BG: React.CSSProperties = theme === 'aurora'
    ? { background: 'rgba(20, 15, 40, 0.5)' }
    : { background: isLight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(30, 30, 32, 0.92)' }
  const PANEL_BORDER: React.CSSProperties = theme === 'aurora'
    ? { border: '1px solid var(--glass-border)' }
    : { border: isLight ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.08)' }

  const kick = reduceMotion ? {} : { x: ROW_OFFSET, y: ROW_OFFSET }
  const rowMotion = {
    initial: { opacity: 0, ...kick },
    animate: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, ...kick },
  }

  const iconChip = (ml?: number): React.CSSProperties => ({
    width: 18,
    height: 18,
    marginLeft: ml,
    background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
    color: 'var(--text-on-surface-variant)',
  })

  return (
    <div
      className={`rounded-[10px] relative overflow-hidden ${theme === 'aurora' ? 'dynamic-island' : ''}`}
      style={CARD_GLASS}
    >
      {/* Grid area */}
      <div ref={fitRef} style={{ padding: 8, paddingBottom: open ? 8 : 30 }}>
        <div style={{ overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              gap: GAP,
              justifyContent: 'center',
              paddingLeft: fit?.pad,
              paddingRight: fit?.pad,
            }}
          >
            {shown.map((week, wi) => (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                {week.map((val, di) => {
                  // intensity 0..1 → level 0..4 → accent color at stepped opacity,
                  // layered on the same neutral base cell the reference uses
                  const level = maxVal > 0 && val ? Math.min(4, Math.ceil((val / maxVal) * 4)) : 0
                  return (
                    <div
                      key={di}
                      onMouseEnter={(e) => show(val, e.currentTarget)}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        width: fit?.cell ?? CELL,
                        height: fit?.cell ?? CELL,
                        borderRadius: 2,
                        // null = future days (right edge) — still draw the base cell so columns look full
                        background:
                          level > 0
                            ? `rgba(57, 211, 83, ${LEVEL_OPACITY[level]})`
                            : isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
                        flexShrink: 0,
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom floating panel */}
      <motion.div
        data-state={open ? 'open' : 'closed'}
        style={{
          position: 'absolute',
          left: 5,
          right: 5,
          top: open ? 5 : undefined,
          bottom: open ? 5 : 5,
          borderRadius: 8,
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          overflow: 'hidden',
          zIndex: 5,
          ...PANEL_BG,
          ...PANEL_BORDER,
        }}
        transition={spring}
      >
        {/* Header row: title (open) + stacked icons (closed) + chevron */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '5px 7px' }}
        >
          <span style={{ fontSize: 10, letterSpacing: '0.3px', color: 'var(--text-on-surface-variant)' }}>
            {open ? 'Usage' : ''}
          </span>

          <div className="flex items-center" style={{ gap: 5 }}>
            {!open && (
              <div className="flex items-center">
                {metrics.slice(0, STACK_LIMIT).map((m, index) => (
                  <motion.span
                    key={m.kind}
                    layoutId={`${uid}-${index}`}
                    transition={spring}
                    className="grid place-items-center rounded-full shrink-0"
                    style={iconChip(index === 0 ? 0 : -5)}
                    title={`${m.label}: ${m.value}`}
                  >
                    <MetricIcon kind={m.kind} size={10} />
                  </motion.span>
                ))}
              </div>
            )}

            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="grid place-items-center rounded-full cursor-pointer shrink-0"
              style={{
                width: 18,
                height: 18,
                background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.08)',
                border: 'none',
              }}
              title={open ? 'Collapse' : 'Expand'}
            >
              <motion.svg
                width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ color: 'var(--text-on-surface-variant)' }}
                initial={false}
                animate={{ rotate: open ? 180 : 0 }}
                transition={spring}
              >
                <path d="M6 9l6 6 6-6" />
              </motion.svg>
            </button>
          </div>
        </div>

        {/* Expanded: one row per metric; icons morph from the collapsed stack via layoutId */}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div key="panel-body" style={{ padding: '0 3px 4px' }}>
              {metrics.map((m, index) => (
                <motion.div
                  key={m.kind}
                  {...rowMotion}
                  transition={rowSpring}
                  className="flex items-center"
                  style={{ gap: 7, padding: '3px 5px', borderRadius: 6 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <motion.span
                    layoutId={`${uid}-${index}`}
                    transition={spring}
                    className="grid place-items-center rounded-full shrink-0"
                    style={iconChip()}
                  >
                    <MetricIcon kind={m.kind} size={10} />
                  </motion.span>
                  <span className="flex-1 truncate" style={{ fontSize: 10, color: 'var(--text-on-surface-variant)', letterSpacing: '0.3px' }}>
                    {m.label}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 500, color: isLight ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)', fontVariantNumeric: 'tabular-nums' }}>
                    {m.value}
                  </span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Tooltip (hover on heatmap cell) */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, calc(-100% - 8px))',
            background: isLight ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.8)',
            color: '#fff',
            fontSize: 10,
            padding: '3px 7px',
            borderRadius: 6,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 100,
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  )
}
