import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { ChatMessage } from '../../../shared/types'
import { useStageStore } from '../../stores/stageStore'
import { buildStageView } from '../../adapters/stageAdapter'
import type { StageCardKind } from './StageCard'

// 用户消息时间轴（右下角）：Hook Sidebar 式「钩轨」导航。
// 左缘一根常驻导轨：焦点轮以主题色实线 + 圆角钩子标记；悬停行以虚线段预览跳转目标。
// 点击整行切换回看该轮，再点回到最新轮。产物类型以小图标贴在文本前。

const CORNER = 6
const DASH = 'repeating-linear-gradient(to top, transparent 0 2px, currentColor 2px 4px)'

const KIND_ICON_PATHS: Partial<Record<StageCardKind, ReactNode>> = {
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  code: (
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 010 18" />
      <path d="M12 3a15 15 0 000 18" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  tasks: (
    <>
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </>
  ),
}

/** 导轨段：from→y 的细线 + 末端圆角钩子（虚线 = 悬停预览，实线 = 当前焦点） */
function Rail({
  from = 0,
  y,
  visible,
  color,
  dashed,
}: {
  from?: number
  y: number | null
  visible: boolean
  color?: string
  dashed: boolean
}) {
  const reduced = useReducedMotion()
  const travel = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.7 }

  return (
    <motion.span
      aria-hidden
      initial={false}
      style={{ color }}
      animate={{ opacity: visible && y !== null ? 1 : 0 }}
      transition={reduced ? { duration: 0 } : { duration: 0.2 }}
      className="rail-root"
    >
      <motion.span
        initial={false}
        animate={{ top: from, height: Math.max(0, (y ?? 0) - CORNER - from) }}
        transition={travel}
        style={dashed ? { backgroundImage: DASH } : { backgroundColor: 'currentColor' }}
        className="rail-line"
      />
      <motion.svg
        initial={false}
        animate={{ top: (y ?? 0) - CORNER }}
        transition={travel}
        width="12"
        height="7"
        viewBox="0 0 12 7"
        fill="none"
        className="rail-hook"
      >
        <path
          d="M0.5 0a6 6 0 0 0 6 6H12"
          stroke="currentColor"
          strokeDasharray={dashed ? '2 2' : undefined}
        />
      </motion.svg>
    </motion.span>
  )
}

export function UserLogTerminal({ messages }: { messages: ChatMessage[] }) {
  const currentSessionId = useStageStore((s) => s.stageSessionId)
  const selectedRoundId = useStageStore((s) => s.selectedRoundId)
  const setSelectedRoundId = useStageStore((s) => s.setSelectedRoundId)

  const vm = useMemo(() => {
    const sessionMsgs = currentSessionId ? messages.filter((m) => m.sessionId === currentSessionId) : []
    return buildStageView(sessionMsgs, selectedRoundId)
  }, [messages, currentSessionId, selectedRoundId])

  // 新轮追加时滚到底，保证最新轮（钩子标记）在折叠视口内可见
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [vm.rounds.length])

  // Hook Sidebar 的行中心测量（ResizeObserver，供导轨定位）
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  const [centers, setCenters] = useState<number[]>([])
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () =>
      setCenters(itemRefs.current.map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : 0)))
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [vm.rounds.length])

  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [pointerInside, setPointerInside] = useState(false)

  if (vm.rounds.length === 0) return null

  // 焦点轮可能是不进列表的孤儿轮（auto-*），此时无任何行高亮，与改动前一致
  const activeIdx = vm.rounds.findIndex((r) => r.id === vm.focusRoundId)

  const activeY = activeIdx < 0 ? null : (centers[activeIdx] ?? null)
  const hoverY = hoverIndex === null ? null : (centers[hoverIndex] ?? null)
  // 焦点钩子上方的悬停段只画钩角（焦点实线已覆盖该跨度）
  const hoverFrom =
    activeY !== null && hoverY !== null && hoverY <= activeY
      ? Math.max(0, hoverY - CORNER)
      : activeY ?? 0

  return (
    <div
      className="user-log-timeline"
      ref={listRef}
      onMouseLeave={() => setPointerInside(false)}
    >
      <Rail
        from={hoverFrom}
        y={hoverY}
        visible={pointerInside && hoverIndex !== null && hoverIndex !== activeIdx}
        dashed
      />
      <Rail y={activeY} visible={activeY !== null} color="#34d399" dashed />

      {vm.rounds.map((r, i) => {
        const state = i === activeIdx ? 'is-active' : activeIdx > 0 && i < activeIdx ? 'is-passed' : ''
        const cls = ['user-log-entry', state, r.hasArtifacts ? 'has-artifacts' : ''].filter(Boolean).join(' ')
        return (
          <button
            key={r.id}
            type="button"
            ref={(el) => { itemRefs.current[i] = el }}
            className={cls}
            title={r.userText}
            aria-label={r.userText || '对话轮'}
            aria-current={i === activeIdx ? 'true' : undefined}
            onMouseEnter={() => { setHoverIndex(i); setPointerInside(true) }}
            onClick={() => setSelectedRoundId(selectedRoundId === r.id ? null : r.id)}
          >
            {r.artifactKinds.length > 0 && (
              <span className="user-log-kinds" aria-hidden>
                {r.artifactKinds.slice(0, 3).map((k) =>
                  KIND_ICON_PATHS[k] ? (
                    <svg key={k} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {KIND_ICON_PATHS[k]}
                    </svg>
                  ) : null,
                )}
              </span>
            )}
            <span className="user-log-text">{r.userText}</span>
          </button>
        )
      })}
    </div>
  )
}
