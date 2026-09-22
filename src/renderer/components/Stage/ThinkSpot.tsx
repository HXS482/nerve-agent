import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { ChatMessage } from '../../../shared/types'
import { useChatStore } from '../../stores/chatStore'
import { useStageStore } from '../../stores/stageStore'
import { LaptopLoader } from './LaptopLoader'

// 全局思考点：Stage 形态下唯一的思考指示，与消息流解耦。
// 流式阶段：限高视口内文本经 y 弹簧偏移贴底跟随（最新一行始终可见，顶部渐隐遮罩）；
// 结束后：内容回弹到顶部，完整日志停留一个时间窗可滚动回看（timed disclosure），
// 窗口结束后自动收起；手动点按则锁定，不受自动展开/收起影响。

/** 视口基础限高：与旧 .think-spot-panel 的 170px 一致，另受 26vh 约束（不压下方工具 dock） */
const STREAM_MAX_HEIGHT = 170
/** 思考结束后完整日志的停留时长（ms），随后自动收起 */
const DONE_HOLD_MS = 2600
const SPRING_STREAM = { type: 'spring', stiffness: 300, damping: 36 } as const

function useStreamMaxHeight() {
  const [max, setMax] = useState(STREAM_MAX_HEIGHT)
  useEffect(() => {
    const update = () => setMax(Math.min(STREAM_MAX_HEIGHT, Math.round(window.innerHeight * 0.26)))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return max
}

/** 流式思考文本：限高视口 + 弹簧贴底跟随 + 完成后回弹顶部可滚动回看 */
function ThinkStream({ lines, working, maxHeight }: { lines: string[]; working: boolean; maxHeight: number }) {
  const reduce = useReducedMotion() ?? false
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  // ResizeObserver 而非按行数测量：同一行内流式增长（换行前的文本追加）也能带动竖线生长
  useLayoutEffect(() => {
    const node = contentRef.current
    if (!node) return
    const measure = () => setContentHeight(node.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const capped = contentHeight > maxHeight
  const viewportHeight = Math.min(contentHeight, maxHeight)
  // 流式阶段：内容向上平移让最新一行贴底；完成后偏移归零（motion 弹簧回弹到顶部）
  const streamOffset = working ? Math.min(0, viewportHeight - contentHeight) : 0
  // 流式只遮顶部（内容在上移）；完成后上下都渐隐，提示可滚动
  const maskImage = capped
    ? working
      ? 'linear-gradient(to bottom, transparent, black 14px)'
      : 'linear-gradient(to bottom, transparent, black 12px, black calc(100% - 12px), transparent)'
    : undefined

  return (
    <div
      className={`think-stream${capped && !working ? ' is-scrollable' : ''}`}
      style={{ height: viewportHeight || undefined, maskImage, WebkitMaskImage: maskImage }}
    >
      <motion.div
        ref={contentRef}
        className="think-trace-inner"
        initial={false}
        animate={{ y: streamOffset }}
        transition={reduce ? { duration: 0 } : SPRING_STREAM}
      >
        <span aria-hidden className="think-trace-line" style={{ height: contentHeight ? contentHeight - 2 : 0 }} />
        <div className="think-trace-content">
          {lines.map((line, i) => {
            const isActiveRow = working && i === lines.length - 1
            return (
              <motion.div
                key={i}
                className="think-trace-row"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  opacity: { duration: 0.18, ease: 'easeOut' },
                  y: SPRING_STREAM,
                }}
              >
                {isActiveRow ? (
                  <span className="think-trace-spinner" />
                ) : (
                  <svg className="think-trace-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
                <span className="think-trace-row-text">{line}</span>
              </motion.div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}

export function ThinkSpot({ messages }: { messages: ChatMessage[] }) {
  const currentSessionId = useStageStore((s) => s.stageSessionId)
  const isLoading = useChatStore((s) => s.isLoading)
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
  const [doneHold, setDoneHold] = useState(false)
  const prevLoadingRef = useRef(isLoading)
  // 用户在思考期间手动点按过 → 结束后不进回看窗，尊重其收起/展开选择
  const userLockedRef = useRef(false)
  const maxHeight = useStreamMaxHeight()

  // 最新一段思考文本（当前会话最后一个含 thinking 的 assistant 消息）
  const thinking = useMemo(() => {
    const sessionMsgs = messages.filter((m) => m.sessionId === currentSessionId)
    for (let i = sessionMsgs.length - 1; i >= 0; i--) {
      const m = sessionMsgs[i]
      if (m.role !== 'assistant') continue
      const parts = m.content
        .filter((b) => b.type === 'thinking' && b.thinking)
        .map((b) => b.thinking!)
      if (parts.length > 0) return parts.join('\n')
    }
    return ''
  }, [messages, currentSessionId])

  const lines = useMemo(
    () => thinking.split('\n').map((l) => l.trim()).filter(Boolean),
    [thinking],
  )

  // 每轮思考结束/开始都重置手动锁定，恢复自动展开/收起
  useEffect(() => setManualExpanded(null), [isLoading])

  // 结束后的停留窗口：完整日志保留在面板里可滚动回看，窗口结束后自动收起；
  // 手动点按过的轮次尊重用户选择，不进回看窗；下一轮开始时立即撤窗并清锁
  useEffect(() => {
    const wasLoading = prevLoadingRef.current
    prevLoadingRef.current = isLoading
    if (wasLoading && !isLoading) {
      if (userLockedRef.current) {
        userLockedRef.current = false
        return
      }
      setDoneHold(true)
      const t = setTimeout(() => setDoneHold(false), DONE_HOLD_MS)
      return () => clearTimeout(t)
    }
    if (isLoading) {
      setDoneHold(false)
      userLockedRef.current = false
    }
  }, [isLoading])

  const autoExpanded = isLoading && !!thinking
  const expanded = manualExpanded ?? (autoExpanded || (doneHold && !!thinking))

  // 没有思考内容且不在生成中 → 不渲染
  if (!thinking && !isLoading) return null

  return (
    <div className="think-spot">
      <button
        className="think-toggle"
        data-status={isLoading ? 'active' : 'done'}
        onClick={() => {
          if (isLoading) userLockedRef.current = true
          setManualExpanded(!expanded)
        }}
        title="思考"
      >
        <LaptopLoader />
      </button>
      {isLoading && <div className="think-bubble">思考中…</div>}
      <div className="think-trace-body think-spot-panel" data-open={expanded && !!thinking}>
        <div className="think-trace-clip">
          <ThinkStream lines={lines} working={isLoading} maxHeight={maxHeight} />
        </div>
      </div>
    </div>
  )
}
