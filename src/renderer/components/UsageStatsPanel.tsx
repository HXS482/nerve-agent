import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useChatStore } from '../stores/chatStore'
import { UsageStats } from '../../shared/types'

const ROWS = 7 // Sun=0 .. Sat=6

/** UTC-safe date key — avoids toISOString timezone offset */
function toDateKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildYearGrid(dailyActivity: Record<string, { messages: number }>): { grid: (number | null)[][]; maxVal: number } {
  const now = new Date()
  const todayDow = now.getUTCDay()

  // End = today (UTC)
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // Start = 52 weeks before the Sunday of today's week
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - todayDow - 52 * 7)

  // Build count map
  const countMap: Record<string, number> = {}
  for (const [k, v] of Object.entries(dailyActivity)) {
    countMap[k] = v.messages
  }

  // Compute total weeks
  const totalMs = endDate.getTime() - startDate.getTime()
  const totalWeeks = Math.ceil(totalMs / (7 * 86_400_000)) + 1

  const grid: (number | null)[][] = Array.from({ length: ROWS }, () => new Array(totalWeeks).fill(null))

  let maxVal = 0

  for (let week = 0; week < totalWeeks; week++) {
    for (let day = 0; day < ROWS; day++) {
      const cellDate = new Date(startDate)
      cellDate.setUTCDate(cellDate.getUTCDate() + week * 7 + day)
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

export function UsageStatsPanel() {
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [collapsed, setCollapsed] = useState(false)
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
        <div style={{ padding: '0 6px 6px' }}>
          {/* Heatmap card — glassmorphism like functional island */}
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
              overflow: 'hidden',
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
        </div>
      )}
    </div>
  )
}
