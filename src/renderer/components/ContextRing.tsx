import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../stores/chatStore'

const SIZE = 36
const STROKE = 2.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const COMPACT_SIZE = 16

export function ContextRing({ compact = false }: { compact?: boolean }) {
  const usage = useChatStore((s) => s.sessionUsage)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const [open, setOpen] = useState(false)
  // 弹层锚点：展开前量一次用量环的位置，换算成 fixed 坐标（距视口右/下边）
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const toggle = () => {
    if (!open) {
      const r = ref.current?.getBoundingClientRect()
      if (r) {
        setAnchor({
          right: window.innerWidth - r.right,
          bottom: window.innerHeight - r.top + 10,
        })
      }
    }
    setOpen(!open)
  }

  // Close on outside click — must be before any early return
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!currentSessionId) return null

  const totalTokens = usage?.totalTokens ?? 0
  const maxTokens = usage?.maxContextTokens ?? 150000
  const remainingTokens = Math.max(0, maxTokens - totalTokens)
  const ratio = Math.min(totalTokens / maxTokens, 1)
  const offset = CIRCUMFERENCE * (1 - ratio)

  let ringColor = 'var(--accent-secondary, #34d399)'
  if (ratio > 0.75) ringColor = 'var(--error, #ff5f56)'
  else if (ratio > 0.5) ringColor = 'var(--accent-tertiary, #fbbf24)'

  const box = compact ? COMPACT_SIZE : SIZE
  const stroke = compact ? 4 : STROKE

  return (
    <div className="relative flex shrink-0 items-center gap-1.5" ref={ref}>
      {/* Ring button */}
      <div
        className={compact ? 'rounded-full cursor-pointer' : 'dynamic-island rounded-full cursor-pointer'}
        style={compact ? { width: COMPACT_SIZE, height: COMPACT_SIZE } : { width: SIZE, height: SIZE, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
        onClick={toggle}
        title="Context usage"
      >
        <svg
          width={box}
          height={box}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--bg-surface-container-high)" strokeWidth={stroke} />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none"
            stroke={ringColor} strokeWidth={stroke}
            strokeDasharray={CIRCUMFERENCE} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.3s ease' }}
          />
        </svg>
        {!compact && (
          <span
            className="absolute text-[10px] font-bold tabular-nums"
            style={{ color: ringColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          >
            {Math.round(ratio * 100)}
          </span>
        )}
      </div>
      {compact && (
        <span
          className="text-[9px] font-medium tabular-nums"
          style={{ color: ringColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >
          {Math.round(ratio * 100)}%
        </span>
      )}

      {/* 用量弹层：贴用量环左上浮出（不压暗背景），点卡片外任意处关闭 */}
      {open && anchor && (
        <div className="fixed inset-0 z-[200]" onClick={() => setOpen(false)}>
          <div
            className="animate-fade-in"
            style={{
              position: 'absolute',
              right: anchor.right,
              bottom: anchor.bottom,
              minWidth: 210,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 雾底：同形同色的一层，整体 filter: blur() —— 糊的是卡片自己的轮廓，
                不采样背后（无 backdrop-filter）。alpha 边缘被高斯羽化，所以没有硬边框 */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 14,
                background: 'color-mix(in srgb, var(--dynamic-island-bg) 75%, transparent)',
                filter: 'blur(18px)',
              }}
            />
            {/* 文字压在雾块之上，保持锐利 */}
            <div style={{ position: 'relative', padding: '14px 16px' }}>
              <div className="text-[13px] font-medium" style={{ color: 'var(--text-on-surface)' }}>
                Context window
              </div>
              {/* 空一行再给数字：标题亮、数字灰，和参考图一致 */}
              <div className="text-[13px]" style={{ marginTop: 14, lineHeight: 1.55, color: 'var(--text-outline)' }}>
                <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {totalTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
                </div>
                <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {remainingTokens.toLocaleString()} tokens remaining
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
