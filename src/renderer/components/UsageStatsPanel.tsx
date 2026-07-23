import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
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

const CELL = 10
const GAP = 2

// --- Detail view constants ---
const DETAIL_DAYS = 7          // rows: last 7 days, newest at top
const SLOTS = 8                // columns: 8 × 3-hour slots
const SLOT_STARTS = [0, 3, 6, 9, 12, 15, 18, 21]  // start hour of each slot

/** Format a token count with K/M suffixes. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export function UsageStatsPanel() {
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [view, setView] = useState<'heatmap' | 'detail'>('heatmap')
  const theme = useChatStore((s) => s.theme)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [scrollRatio, setScrollRatio] = useState(0)
  const dragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartScroll = useRef(0)

  useEffect(() => {
    window.claude.getUsageStats().then((s: UsageStats) => setStats(s)).catch(() => {})
  }, [])

  const { grid, maxVal } = useMemo(() => {
    if (!stats) return { grid: [], maxVal: 0 }
    return buildYearGrid(stats.dailyActivity)
  }, [stats])

  const detail = useMemo(() => {
    if (!stats) return null

    // Build last DETAIL_DAYS local dates, newest first.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days: { key: string; label: string }[] = []
    for (let i = 0; i < DETAIL_DAYS; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      days.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}` })
    }

    // 2D matrix: rows = days, cols = slots. Values = token sums.
    const matrix: number[][] = days.map(({ key }) => {
      const hours = stats.dailyHourlyTokens[key] || new Array(24).fill(0)
      return SLOT_STARTS.map((start) =>
        hours[start] + hours[start + 1] + hours[start + 2]
      )
    })

    let globalMax = 0
    for (const row of matrix) for (const v of row) if (v > globalMax) globalMax = v

    // Peak slot = the slot column with the highest 7-day total.
    const slotTotals = new Array(SLOTS).fill(0)
    for (const row of matrix) {
      for (let s = 0; s < SLOTS; s++) slotTotals[s] += row[s]
    }
    let peakSlot = 0
    for (let s = 1; s < SLOTS; s++) if (slotTotals[s] > slotTotals[peakSlot]) peakSlot = s
    const peakValue = slotTotals[peakSlot]

    return { days, matrix, globalMax, peakSlot, peakValue, hasData: globalMax > 0 }
  }, [stats])

  const syncScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    if (maxScroll <= 0) { setScrollRatio(0); return }
    setScrollRatio(el.scrollLeft / maxScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    syncScroll()
    el.addEventListener('scroll', syncScroll, { passive: true })
    return () => el.removeEventListener('scroll', syncScroll)
  }, [syncScroll, collapsed])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    dragStartX.current = e.clientX
    dragStartScroll.current = scrollRef.current?.scrollLeft || 0

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !scrollRef.current || !trackRef.current) return
      const el = scrollRef.current
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll <= 0) return
      const dx = ev.clientX - dragStartX.current
      el.scrollLeft = dragStartScroll.current + (dx / trackRef.current.clientWidth) * maxScroll
      syncScroll()
    }

    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [syncScroll])

  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    const el = scrollRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    if (maxScroll <= 0) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    el.scrollLeft = ((e.clientX - rect.left) / rect.width) * maxScroll
    syncScroll()
  }, [syncScroll])

  if (!stats || grid.length === 0) return null

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
          <AnimatePresence mode="wait" initial={false}>
            {view === 'heatmap' ? (
              <motion.div
                key="heatmap"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
              >
                {/* Heatmap card — glassmorphism like functional island */}
                <div
                  className={`rounded-[10px] ${theme === 'aurora' ? 'dynamic-island' : ''}`}
                  onClick={() => setView('detail')}
                  style={{
                    background: theme === 'aurora'
                      ? undefined
                      : theme === 'light'
                        ? 'rgba(255, 255, 255, 0.6)'
                        : 'rgba(30, 30, 32, 0.6)',
                    backdropFilter: theme === 'aurora' ? undefined : 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: theme === 'aurora' ? undefined : 'blur(20px) saturate(180%)',
                    border: theme === 'aurora'
                      ? '1px solid var(--glass-border)'
                      : theme === 'light'
                        ? '1px solid rgba(0,0,0,0.06)'
                        : '1px solid rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    ref={scrollRef}
                    style={{ overflowX: 'hidden', overflowY: 'hidden', padding: '8px' }}
                  >
                    {/* Grid — fills container uniformly */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, flexShrink: 0 }}>
                      {grid.map((row, ri) => (
                        <div key={ri} style={{ display: 'flex', gap: GAP }}>
                          {row.map((val, ci) => {
                            const intensity = maxVal > 0 && val !== null ? val / maxVal : 0
                            const isNull = val === null
                            return (
                              <div
                                key={ci}
                                style={{
                                  width: CELL,
                                  height: CELL,
                                  borderRadius: 2,
                                  background: isNull
                                    ? 'transparent'
                                    : intensity > 0
                                      ? `rgba(99, 148, 255, ${0.12 + intensity * 0.88})`
                                      : theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
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

                {/* Scrollbar — dot on line, no shadow */}
                <div
                  ref={trackRef}
                  style={{
                    height: 2,
                    borderRadius: 1,
                    background: theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
                    marginTop: 8,
                    position: 'relative',
                    cursor: 'pointer',
                    marginLeft: 6,
                    marginRight: 6,
                  }}
                  onClick={handleTrackClick}
                >
                  {/* Invisible hit area for easier grabbing */}
                  <div
                    style={{
                      position: 'absolute',
                      top: -8,
                      left: 0,
                      right: 0,
                      height: 18,
                      cursor: 'grab',
                    }}
                    onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e) }}
                  />
                  {/* Visible dot */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'var(--text-on-surface-variant)',
                      transform: 'translate(-50%, -50%)',
                      left: `${Math.min(scrollRatio * 100, 100)}%`,
                      pointerEvents: 'none',
                      transition: dragging.current ? 'none' : 'left 0.1s ease-out',
                    }}
                  />
                </div>

                {/* Summary */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, padding: '0 6px' }}>
                  <SummaryRow label="Total tokens" value={formatTokens(stats.totalInputTokens + stats.totalOutputTokens)} theme={theme} />
                  <SummaryRow label="Sessions" value={String(stats.totalSessions)} theme={theme} />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="detail"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.1 }}
              >
                <DetailView
                  detail={detail}
                  theme={theme}
                  onBack={() => setView('heatmap')}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function SummaryRow({ label, value, theme }: { label: string; value: string; theme: string }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: '1px 0' }}>
      <span style={{ fontSize: 10, color: 'var(--text-on-surface-variant)', letterSpacing: '0.3px' }}>
        {label}
      </span>
      <span style={{
        fontSize: 10,
        fontWeight: 500,
        color: theme === 'light' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  )
}

function DetailView({
  detail,
  theme,
  onBack,
}: {
  detail: {
    days: { key: string; label: string }[]
    matrix: number[][]
    globalMax: number
    peakSlot: number
    peakValue: number
    hasData: boolean
  } | null
  theme: string
  onBack: () => void
}) {
  if (!detail) return null

  const slotLabel = (s: number) => `${String(s).padStart(2, '0')}:00`

  return (
    <div
      className={`rounded-[10px] ${theme === 'aurora' ? 'dynamic-island' : ''}`}
      style={{
        background: theme === 'aurora'
          ? undefined
          : theme === 'light'
            ? 'rgba(255, 255, 255, 0.6)'
            : 'rgba(30, 30, 32, 0.6)',
        backdropFilter: theme === 'aurora' ? undefined : 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: theme === 'aurora' ? undefined : 'blur(20px) saturate(180%)',
        border: theme === 'aurora'
          ? '1px solid var(--glass-border)'
          : theme === 'light'
            ? '1px solid rgba(0,0,0,0.06)'
            : '1px solid rgba(255,255,255,0.08)',
        padding: 8,
      }}
    >
      {/* Header: back + title */}
      <div className="flex items-center" style={{ marginBottom: 8 }}>
        <button
          onClick={onBack}
          className="flex items-center"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 4px',
            color: 'var(--text-on-surface-variant)',
          }}
          aria-label="Back to heatmap"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-on-surface-variant)',
          letterSpacing: '0.4px',
          marginLeft: 4,
        }}>
          Active Hours
        </span>
      </div>

      {!detail.hasData ? (
        <div style={{
          fontSize: 10,
          color: 'var(--text-outline-variant)',
          textAlign: 'center',
          padding: '16px 0',
        }}>
          No usage data
        </div>
      ) : (
        <>
          {/* X axis: slot labels */}
          <div style={{ display: 'flex', marginLeft: 28, gap: 2, marginBottom: 3 }}>
            {SLOT_STARTS.map((h) => (
              <div key={h} style={{
                flex: 1,
                fontSize: 7,
                color: 'var(--text-outline-variant)',
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows: one per day */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {detail.days.map((day, ri) => (
              <div key={day.key} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <div style={{
                  width: 26,
                  fontSize: 8,
                  color: 'var(--text-outline-variant)',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0,
                }}>
                  {day.label}
                </div>
                <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                  {detail.matrix[ri].map((val, ci) => {
                    const intensity = detail.globalMax > 0 ? val / detail.globalMax : 0
                    return (
                      <div
                        key={ci}
                        title={`${day.label} ${slotLabel(SLOT_STARTS[ci])}-${slotLabel(SLOT_STARTS[ci] + 3)}: ${formatTokens(val)} tokens`}
                        style={{
                          flex: 1,
                          height: 12,
                          borderRadius: 2,
                          background: intensity > 0
                            ? `rgba(99, 148, 255, ${0.12 + intensity * 0.88})`
                            : theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Peak summary */}
          <div className="flex items-center justify-between" style={{ marginTop: 8, paddingTop: 6, borderTop: theme === 'light' ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 9, color: 'var(--text-outline-variant)' }}>Peak</span>
            <span style={{
              fontSize: 9,
              fontWeight: 500,
              color: theme === 'light' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {slotLabel(SLOT_STARTS[detail.peakSlot])}–{slotLabel(SLOT_STARTS[detail.peakSlot] + 3)} · {formatTokens(detail.peakValue)}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
