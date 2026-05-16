import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../stores/chatStore'

const SIZE = 36
const STROKE = 2.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ContextRing() {
  const usage = useChatStore((s) => s.sessionUsage)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
  const compactionCount = usage?.compactionCount ?? 0
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const ratio = Math.min(totalTokens / maxTokens, 1)
  const offset = CIRCUMFERENCE * (1 - ratio)

  let ringColor = 'var(--accent-secondary, #34d399)'
  if (ratio > 0.75) ringColor = 'var(--error, #ff5f56)'
  else if (ratio > 0.5) ringColor = 'var(--accent-tertiary, #fbbf24)'

  return (
    <div className="relative shrink-0" ref={ref}>
      {/* Ring button */}
      <div
        className="dynamic-island rounded-full cursor-pointer"
        style={{ width: SIZE, height: SIZE, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
        onClick={() => setOpen(!open)}
      >
        <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--bg-surface-container-high)" strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none"
            stroke={ringColor} strokeWidth={STROKE}
            strokeDasharray={CIRCUMFERENCE} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.3s ease' }}
          />
        </svg>
        <span
          className="absolute text-[10px] font-bold tabular-nums"
          style={{ color: ringColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >
          {Math.round(ratio * 100)}
        </span>
      </div>

      {/* Centered floating menu */}
      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.3)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="animate-fade-in p-[16px_20px]"
            style={{
              minWidth: 240,
              width: '100%',
              borderRadius: 16,
              background: 'var(--dynamic-island-bg)',
              backdropFilter: 'var(--dynamic-island-blur)',
              WebkitBackdropFilter: 'var(--dynamic-island-blur)',
              border: '1px solid var(--dynamic-island-border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <span className="text-[12px] font-semibold" style={{ color: 'var(--text-on-surface)' }}>
                Context Usage
              </span>
              <span
                className="text-[11px] font-medium tabular-nums"
                style={{ color: ringColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              >
                {Math.round(ratio * 100)}%
              </span>
            </div>

            {/* Progress bar */}
            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-surface-container-high)', marginBottom: 14, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${ratio * 100}%`, borderRadius: 3, background: ringColor, transition: 'width 0.3s ease' }} />
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
              <div>
                <div className="text-[10px]" style={{ color: 'var(--text-outline)', marginBottom: 2 }}>Input</div>
                <div className="text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-on-surface)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {inputTokens.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[10px]" style={{ color: 'var(--text-outline)', marginBottom: 2 }}>Output</div>
                <div className="text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-on-surface)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {outputTokens.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[10px]" style={{ color: 'var(--text-outline)', marginBottom: 2 }}>Used</div>
                <div className="text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-on-surface)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {totalTokens.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[10px]" style={{ color: 'var(--text-outline)', marginBottom: 2 }}>Limit</div>
                <div className="text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-on-surface)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {maxTokens.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Compaction */}
            {compactionCount > 0 && (
              <div
                className="flex items-center justify-between"
                style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}
              >
                <span className="text-[11px]" style={{ color: 'var(--text-outline)' }}>Compactions</span>
                <span className="text-[12px] font-semibold" style={{ color: 'var(--accent-primary)' }}>
                  {compactionCount}x
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
