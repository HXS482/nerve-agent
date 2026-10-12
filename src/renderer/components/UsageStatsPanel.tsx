import { useEffect, useMemo, useRef, useState } from 'react'
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-08" → "Oct 8"：悬浮提示里只有一个裸数字，看不出是哪天 */
function formatDayKey(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  if (!m || !d) return key
  return `${MONTHS[m - 1]} ${d}`
}

interface YearGrid {
  /** [day 0..6][week] → 当日 token；null = 未来日期 */
  grid: (number | null)[][]
  /** 与 grid 同形，另带日期键（悬浮提示要能指明是哪天） */
  dates: (string | null)[][]
  maxVal: number
}

function buildYearGrid(dailyActivity: Record<string, { messages: number; tokens: number }>): YearGrid {
  const now = new Date()
  const todayDow = now.getDay()
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // 起点 = 本周日往前 52 周：每列必须对齐到自然周，否则行列会错位
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - todayDow - 52 * 7)

  const countMap: Record<string, number> = {}
  for (const [k, v] of Object.entries(dailyActivity)) countMap[k] = v.tokens

  const totalMs = endDate.getTime() - startDate.getTime()
  const totalWeeks = Math.ceil(totalMs / (7 * 86_400_000)) + 1

  const grid: (number | null)[][] = Array.from({ length: ROWS }, () => new Array(totalWeeks).fill(null))
  const dates: (string | null)[][] = Array.from({ length: ROWS }, () => new Array(totalWeeks).fill(null))
  let maxVal = 0

  for (let week = 0; week < totalWeeks; week++) {
    for (let day = 0; day < ROWS; day++) {
      const cellDate = new Date(startDate)
      cellDate.setDate(cellDate.getDate() + week * 7 + day)
      if (cellDate > endDate) continue
      const key = toDateKey(cellDate)
      const count = countMap[key] || 0
      grid[day][week] = count
      dates[day][week] = key
      if (count > maxVal) maxVal = count
    }
  }

  return { grid, dates, maxVal }
}

/** Format a token count with K/M suffixes. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

const CELL = 8
const GAP = 2.5

/**
 * 热力图配色：级别用「主题强调色的透明度」分层，不引外部绿色——
 * 深浅主题自动跟随，也不会跟侧栏里其它强调色打架。
 */
const LEVEL_PCT = [0, 26, 46, 70, 100]

function cellBackground(level: number, isLight: boolean): string {
  if (level <= 0) return isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.07)'
  return `color-mix(in srgb, var(--accent-primary) ${LEVEL_PCT[level]}%, transparent)`
}

interface HeatmapProps {
  grid: (number | null)[][]
  dates: (string | null)[][]
  maxVal: number
  isLight: boolean
}

function Heatmap({ grid, dates, maxVal, isLight }: HeatmapProps) {
  // 后端按天分桶 → 转成按周排列的列（一列 = 一周），贡献图那套读法
  const weeks = useMemo(() => {
    if (!grid.length) return []
    const totalWeeks = grid[0].length
    return Array.from({ length: totalWeeks }, (_, w) =>
      Array.from({ length: ROWS }, (_, d) => ({
        val: grid[d]?.[w] ?? null,
        date: dates[d]?.[w] ?? null,
      }))
    )
  }, [grid, dates])

  // 列数不写死：由实测宽度反推格子尺寸，余下不足一格的部分均分到左右两端，
  // 这样两侧留白对称，也不会出现被裁掉一半的列
  const fitRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<{ cell: number; count: number; pad: number }>()
  useEffect(() => {
    const el = fitRef.current
    if (!el) return
    const measure = () => {
      // 左右内边距按实测算，不写死：外层圆角框的 padding 会变，硬编码迟早对不上
      const cs = getComputedStyle(el)
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const inner = el.clientWidth - padX
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

  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const shown = fit ? weeks.slice(-fit.count) : []

  return (
    <>
      <div ref={fitRef} style={{ padding: '2px 0 6px' }}>
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
              {week.map((cell, di) => {
                const level = maxVal > 0 && cell.val ? Math.min(4, Math.ceil((cell.val / maxVal) * 4)) : 0
                return (
                  <div
                    key={di}
                    onMouseEnter={(e) => {
                      if (cell.val === null || !cell.date) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      setTip({
                        text: `${formatDayKey(cell.date)} · ${formatTokens(cell.val)} tokens`,
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                      })
                    }}
                    onMouseLeave={() => setTip(null)}
                    style={{
                      width: fit?.cell ?? CELL,
                      height: fit?.cell ?? CELL,
                      borderRadius: 2,
                      background: cellBackground(level, isLight),
                      flexShrink: 0,
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 悬浮提示：fixed 定位，免得被卡片的 overflow 裁掉 */}
      {tip && (
        <div
          style={{
            position: 'fixed',
            left: tip.x,
            top: tip.y,
            transform: 'translate(-50%, calc(-100% - 8px))',
            background: isLight ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            fontSize: 10,
            padding: '3px 7px',
            borderRadius: 6,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 100,
          }}
        >
          {tip.text}
        </div>
      )}
    </>
  )
}

export function UsageStatsPanel() {
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const isLight = useChatStore((s) => s.theme) === 'light'

  useEffect(() => {
    window.claude.getUsageStats().then((s: UsageStats) => setStats(s)).catch(() => {})
  }, [])

  const year = useMemo(() => (stats ? buildYearGrid(stats.dailyActivity) : null), [stats])

  if (!stats || !year || year.grid.length === 0) return null

  // 三项读数等分一行：值在上、标签在下。
  // 原先是「玻璃卡片 + 卡内再嵌一层玻璃浮层 + 图标堆叠 + 展开时图标位移动画」——
  // 两层玻璃叠在本来就窄的侧栏里，又厚又吵，而信息量只有这三个数。
  const metrics = [
    { label: 'tokens', value: formatTokens(stats.totalInputTokens + stats.totalOutputTokens) },
    { label: 'sessions', value: formatTokens(stats.totalSessions) },
    { label: 'messages', value: formatTokens(stats.totalMessages) },
  ]

  return (
    <div style={{ marginBottom: 4 }}>
      {/* 头部：与 Recent / Channels 同一套节奏（可折叠） */}
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
        /* 圆角矩形框：单层描边 + 极淡底色。
           之前的版本是「毛玻璃卡片 + 卡内再叠一层不透明玻璃浮条」，两层玻璃才显得厚重；
           这里只保留一层轮廓，框内底色轻到几乎看不出，作用是把热力图和读数收成一个整体 */
        <div
          style={{
            margin: '0 -4px 6px',
            padding: '6px 8px 8px',
            borderRadius: 10,
            background: isLight ? 'rgba(0, 0, 0, 0.022)' : 'rgba(255, 255, 255, 0.028)',
            border: `1px solid ${isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.07)'}`,
          }}
        >
          <Heatmap grid={year.grid} dates={year.dates} maxVal={year.maxVal} isLight={isLight} />
          <div className="grid grid-cols-3">
            {metrics.map((m) => (
              <div key={m.label} className="flex flex-col items-center">
                <span
                  className="text-[11px] font-medium"
                  style={{ color: 'var(--text-on-surface)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {m.value}
                </span>
                {/* 不加字距：「MESSAGES」在侧栏拉到最窄（160px）时正好卡满一栏，
                    再加 tracking 就会被截断成省略号 */}
                <span
                  className="text-[9px] uppercase truncate"
                  style={{
                    color: 'var(--text-on-surface-variant)',
                    opacity: 0.75,
                    maxWidth: '100%',
                  }}
                >
                  {m.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
