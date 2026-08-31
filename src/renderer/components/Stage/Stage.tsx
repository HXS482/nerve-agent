import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ChatMessage } from '../../../shared/types'
import { useStageStore } from '../../stores/stageStore'
import { buildStageView } from '../../adapters/stageAdapter'
import { StageCard, type StageCardData } from './StageCard'
import { NarrationLayer } from './NarrationLayer'
import ASCIIText from '../ASCIIText'

// ─── 可拖拽卡片（外层出生飞入，内层拖拽偏移） ───

function DraggableCard({ card, isNew, annotations, onClose }: { card: StageCardData; isNew: boolean; annotations?: string[]; onClose: () => void }) {
  const offset = useStageStore((s) => s.cardOffsets[card.id]) ?? { x: 0, y: 0 }
  const setCardOffset = useStageStore((s) => s.setCardOffset)
  const imgWidth = useStageStore((s) => s.cardSizes[card.id])
  const setCardSize = useStageStore((s) => s.setCardSize)
  const slotRef = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState<{ dx: number; dy: number } | null>(null)

  // 新卡：先隐身渲染一帧测量自身位置，算 loader（顶栏中央）到卡片的位移
  useLayoutEffect(() => {
    if (!isNew || !slotRef.current) return
    const r = slotRef.current.getBoundingClientRect()
    setOrigin({
      dx: window.innerWidth / 2 - (r.left + r.width / 2),
      dy: 24 - (r.top + r.height / 2),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 图片卡：右下角缩放柄（原生监听 pointerdown —— React 合成事件拦不住 motion 的原生 drag 监听）
  const handleRef = useRef<HTMLDivElement>(null)
  const imgWidthRef = useRef(imgWidth)
  imgWidthRef.current = imgWidth
  useEffect(() => {
    const el = handleRef.current
    if (!el) return
    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startW = imgWidthRef.current ?? 300
      const onMove = (ev: PointerEvent) => {
        const next = Math.min(720, Math.max(120, Math.round(startW + (ev.clientX - startX))))
        setCardSize(card.id, next)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }
    el.addEventListener('pointerdown', onDown)
    return () => el.removeEventListener('pointerdown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])

  const sizeStyle = card.kind === 'image' && imgWidth
    ? ({ ['--img-w' as string]: `${imgWidth}px` } as React.CSSProperties)
    : undefined

  if (isNew && !origin) {
    return (
      <div ref={slotRef} className="stage-card-slot" style={{ visibility: 'hidden', ...sizeStyle }}>
        <StageCard card={card} annotations={annotations} />
      </div>
    )
  }

  return (
    <motion.div
      ref={slotRef}
      className="stage-card-slot"
      style={sizeStyle}
      initial={isNew && origin ? { x: origin.dx, y: origin.dy, scale: 0.2, opacity: 0 } : false}
      animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
    >
      <motion.div
        className={`stage-card-draggable${card.kind === 'image' ? ' is-image' : ''}`}
        drag
        dragMomentum={false}
        whileDrag={{ scale: 1.02, zIndex: 40 }}
        animate={{ x: offset.x, y: offset.y }}
        onDragEnd={(_e, info) =>
          setCardOffset(card.id, { x: offset.x + info.offset.x, y: offset.y + info.offset.y })
        }
      >
        <StageCard card={card} annotations={annotations} />
        {card.kind === 'image' && (
          <button
            type="button"
            className="stage-card-close"
            title="关闭图片"
            aria-label="关闭图片"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClose() }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        )}
        {card.kind === 'image' && (
          <div className="stage-resize-handle" ref={handleRef} title="拖拽缩放">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v6h-6" />
              <path d="M21 21l-9-9" />
              <path d="M3 9V3h6" />
              <path d="M3 3l9 9" />
            </svg>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ─── Stage 空间 ───

export function Stage({ messages }: { messages: ChatMessage[] }) {
  const currentSessionId = useStageStore((s) => s.stageSessionId)
  const selectedRoundId = useStageStore((s) => s.selectedRoundId)
  const hiddenCardIds = useStageStore((s) => s.hiddenCardIds)
  const hideCard = useStageStore((s) => s.hideCard)
  const filtered = useMemo(
    () => (currentSessionId ? messages.filter((m) => m.sessionId === currentSessionId) : []),
    [messages, currentSessionId],
  )
  const vm = useMemo(() => buildStageView(filtered, selectedRoundId), [filtered, selectedRoundId])
  const allCards = vm.cards.filter(({ card }) => !hiddenCardIds[card.id])
  const narrationText = vm.narrationText
  const focusRoundId = vm.focusRoundId

  // 出生动画只播给「新增」卡片：首帧已存在的全部标记 seen
  const seenRef = useRef<Set<string>>(new Set())
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  useEffect(() => {
    allCards.forEach((c) => seenRef.current.add(c.card.id))
  }, [allCards])

  // 进入 Stage 时复位根窗口滚动位置（历史 bug 遗留的非零 offset 会把顶栏裁掉）
  useEffect(() => {
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    const root = document.getElementById('root')
    if (root) root.scrollTop = 0
  }, [])

  // 只滚动 Stage 自己的画布，不能用 scrollIntoView 污染根窗口滚动位置。
  const canvasRef = useRef<HTMLDivElement>(null)
  const previousCardCountRef = useRef(allCards.length)
  useEffect(() => {
    if (allCards.length > previousCardCountRef.current) {
      const canvas = canvasRef.current
      canvas?.scrollTo({ top: canvas.scrollHeight, behavior: 'smooth' })
    }
    previousCardCountRef.current = allCards.length
  }, [allCards.length])

  if (allCards.length === 0 && !narrationText) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ paddingInline: 'var(--sp-md)' }}>
        <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ position: 'relative', width: '100%', height: '300px' }}>
          <ASCIIText text="Hey!" enableWaves asciiFontSize={4} />
        </div>
      </div>
    )
  }

  return (
    <div className="stage-root">
      {/* 雨幕背景（仅 Stage 模式） */}
      <div className="stage-rain" />
      <div ref={canvasRef} className="stage-canvas flex-1 overflow-y-auto w-full" data-chat-scroll>
        <div className="stage-masonry">
          {allCards.map(({ card, annotations }) => (
            <DraggableCard
              key={card.id}
              card={card}
              annotations={annotations}
              isNew={ready && !seenRef.current.has(card.id)}
              onClose={() => hideCard(card.id)}
            />
          ))}
        </div>
      </div>
      <AnimatePresence>
        {narrationText && focusRoundId && (
          <NarrationLayer key={focusRoundId} text={narrationText} />
        )}
      </AnimatePresence>
    </div>
  )
}
