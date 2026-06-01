import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { UsageStats } from '../../shared/types'

const ROWS = 7 // Sun=0 .. Sat=6

interface MonthLabel { name: string; col: number }

function buildYearGrid(dailyActivity: Record<string, { messages: number }>): { grid: (number | null)[][]; months: MonthLabel[]; maxVal: number } {
  const today = new Date()
  const todayDow = today.getDay()
  const endDate = new Date(today)
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - todayDow - 52 * 7)

  const countMap: Record<string, number> = {}
  for (const [k, v] of Object.entries(dailyActivity)) {
    countMap[k] = v.messages
  }

  const totalMs = endDate.getTime() - startDate.getTime()
  const totalWeeks = Math.ceil(totalMs / (7 * 86_400_000)) + 1

  const grid: (number | null)[][] = Array.from({ length: ROWS }, () => new Array(totalWeeks).fill(null))
  const months: MonthLabel[] = []
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  let maxVal = 0
  let lastMonth = -1

  for (let week = 0; week < totalWeeks; week++) {
    for (let day = 0; day < ROWS; day++) {
      const cellDate = new Date(startDate)
      cellDate.setDate(cellDate.getDate() + week * 7 + day)
      if (cellDate > endDate) { grid[day][week] = null; continue }
      const key = cellDate.toISOString().slice(0, 10)
      const count = countMap[key] || 0
      grid[day][week] = count
      if (count > maxVal) maxVal = count
      if (day === 0) {
        const m = cellDate.getMonth()
        if (m !== lastMonth) { months.push({ name: MONTH_NAMES[m], col: week }); lastMonth = m }
      }
    }
  }

  return { grid, months, maxVal }
}

const CELL = 8
const GAP = 2

export function UsageStatsPanel() {
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollRatio, setScrollRatio] = useState(0)
  const [thumbWidth, setThumbWidth] = useState(100)
  const dragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartScroll = useRef(0)

  useEffect(() => {
    window.claude.getUsageStats().then((s: UsageStats) => setStats(s)).catch(() => {})
  }, [])

  const { grid, months, maxVal } = useMemo(() => {
    if (!stats) return { grid: [], months: [], maxVal: 0 }
    return buildYearGrid(stats.dailyActivity)
  }, [stats])

  // Sync scroll position → thumb position
  const syncScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    if (maxScroll <= 0) {
      setThumbWidth(100)
      setScrollRatio(0)
      return
    }
    setScrollRatio(el.scrollLeft / maxScroll)
    // Thumb width proportional to visible/total ratio
    const ratio = el.clientWidth / el.scrollWidth
    setThumbWidth(Math.max(20, ratio * 100))
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    syncScroll()
    el.addEventListener('scroll', syncScroll, { passive: true })
    return () => el.removeEventListener('scroll', syncScroll)
  }, [syncScroll, collapsed])

  // Drag handlers for custom thumb
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    dragStartX.current = e.clientX
    const el = scrollRef.current
    dragStartScroll.current = el ? el.scrollLeft : 0

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !scrollRef.current) return
      const el = scrollRef.current
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll <= 0) return
      const trackEl = (e.target as HTMLElement).parentElement
      if (!trackEl) return
      const trackWidth = trackEl.clientWidth
      const dx = ev.clientX - dragStartX.current
      const scrollDx = (dx / trackWidth) * maxScroll
      el.scrollLeft = dragStartScroll.current + scrollDx
    }

    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // Click on track to jump
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    const el = scrollRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    if (maxScroll <= 0) return
    const track = e.currentTarget as HTMLElement
    const rect = track.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const ratio = clickX / rect.width
    el.scrollLeft = ratio * maxScroll
  }, [])

  const totalTokens = stats ? stats.totalInputTokens + stats.totalOutputTokens : 0
  if (!stats || grid.length === 0) return null

  const totalWeeks = grid[0]?.length || 0
  const gridWidth = totalWeeks * (CELL + GAP)

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Header */}
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        style={{ padding: '6px 6px 4px' }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-outline-variant)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 20V10M12 20V4M6 20v-6" />
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
        <div style={{ padding: '0 6px 6px' }}>
          {/* Heatmap card */}
          <div
            className="rounded-lg"
            style={{
              background: 'var(--bg-surface-container)',
              border: '1px solid var(--border-subtle)',
              overflow: 'hidden',
            }}
          >
            {/* Hidden overflow scroll container */}
            <div
              ref={scrollRef}
              style={{ overflowX: 'hidden', overflowY: 'hidden', padding: '8px 6px 2px' }}
            >
              {/* Month labels */}
              <div style={{ position: 'relative', height: 14, marginLeft: 22, width: gridWidth }}>
                {months.map((m) => (
                  <span
                    key={m.name + m.col}
                    className="text-[8px] absolute"
                    style={{ color: 'var(--text-outline-variant)', left: m.col * (CELL + GAP), top: 0, letterSpacing: '0.3px' }}
                  >
                    {m.name}
                  </span>
                ))}
              </div>

              {/* Grid body */}
              <div style={{ display: 'flex', gap: GAP }}>
                {/* Day-of-week labels */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, paddingRight: 3 }}>
                  {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((label, i) => (
                    <div key={i} style={{ width: 22, height: CELL, display: 'flex', alignItems: 'center' }}>
                      <span className="text-[8px]" style={{ color: 'var(--text-outline-variant)', letterSpacing: '0.3px' }}>{label}</span>
                    </div>
                  ))}
                </div>

                {/* Cells */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, flexShrink: 0 }}>
                  {grid.map((row, ri) => (
                    <div key={ri} style={{ display: 'flex', gap: GAP }}>
                      {row.map((val, ci) => {
                        const intensity = maxVal > 0 && val !== null ? val / maxVal : 0
                        const isNull = val === null
                        return (
                          <div
                            key={ci}
                            className="rounded-sm"
                            style={{
                              width: CELL,
                              height: CELL,
                              background: isNull
                                ? 'transparent'
                                : intensity > 0
                                  ? `rgba(99, 148, 255, ${0.12 + intensity * 0.88})`
                                  : 'var(--bg-surface-container-highest)',
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
          </div>

          {/* Custom external scrollbar — dot on line */}
          <div
            style={{
              height: 2,
              borderRadius: 1,
              background: 'var(--bg-surface-container-highest)',
              marginTop: 8,
              position: 'relative',
              cursor: 'pointer',
              marginLeft: 6,
              marginRight: 6,
            }}
            onClick={handleTrackClick}
          >
            <div
              style={{
                position: 'absolute',
                top: '50%',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'var(--text-on-surface-variant)',
                transform: `translate(-50%, -50%) translateX(${scrollRatio * 100}%)`,
                left: `${Math.min(scrollRatio * 100, 100)}%`,
                cursor: 'grab',
                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                transition: dragging.current ? 'none' : 'box-shadow 0.15s',
              }}
              onMouseDown={handleDragStart}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,148,255,0.25), 0 1px 4px rgba(0,0,0,0.3)' }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
