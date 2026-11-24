import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

/**
 * PreviewRail —— beUI 的预览导航轨。
 *
 * message-scroller 通过 className 直接打在上游的 DOM 钩子上，所以这些
 * data-slot 名字必须对上（否则传进来的 [&_[data-slot=...]] 全部失效）：
 *   preview-rail-item / preview-rail-tick / preview-rail-card
 *   preview-rail-title / preview-rail-description
 *
 * ── 密度自适应 ──
 *
 * 固定 14px 槽高在短对话里没问题，消息一多就撑出容器：20 条 = 320px，
 * 60 条 = 960px，直接溢出视口、还压在正文上。
 *
 * 所以槽高不是常数，而是「能塞下就 14px，塞不下就按可用高度等分」，下限 4px。
 * 轨道本身是 relative 的子节点，量一次自己的高度就能算出每格该多高 ——
 * 结果就是条目越多刻度越密，整体始终贴合可视区，不溢出。
 *
 * 只压缩到 4px 仍然装不下的极端情况（>100 条），继续等分，画成一条细密刻度尺。
 */

/**
 * 舒适下限：低于它就走「密排」（去间隙 + 细刻线）。
 */
const MIN_SLOT = 3
/**
 * 绝对下限：即便这个也放不下，也不再让轨道溢出 —— 直接把每格压到
 * navH/n，刻度糊成一条细尺也胜过压在正文上。1.5px 是还能分辨相邻刻度的极限。
 */
const HARD_MIN_SLOT = 1.5
/** 默认槽高：14px 在 20 条以上就显得稀，9px 才是「尺子」的手感 */
const DEFAULT_SLOT = 9

export interface PreviewRailItem {
  id: string
  label: string
  description?: string
  ariaLabel?: string
}

interface Props {
  items: PreviewRailItem[]
  label: string
  activeId?: string
  onItemSelect: (item: PreviewRailItem) => void
  /** 预览浮层出现在刻度的哪一侧 */
  previewSide?: 'before' | 'after'
  highlightActive?: boolean
  /** 每根刻度的目标槽高（px）：装得下就用它，装不下自动压缩 */
  itemSize?: number
  className?: string
  railClassName?: string
  previewContainerClassName?: string
  previewClassName?: string
  children?: ReactNode
}

export function PreviewRail({
  items,
  label,
  activeId,
  onItemSelect,
  previewSide = 'before',
  highlightActive = true,
  itemSize = DEFAULT_SLOT,
  className,
  railClassName,
  previewContainerClassName,
  previewClassName,
  children,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const navRef = useRef<HTMLElement>(null)
  const [navHeight, setNavHeight] = useState(0)

  // 量轨道自身高度：槽高依赖它，所以必须跟着窗口尺寸一起变
  useEffect(() => {
    const el = navRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setNavHeight(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const show = useCallback((id: string) => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    setHoveredId(id)
  }, [])

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setHoveredId(null), 140)
  }, [])

  /*
   * 槽高算法：
   *   1. 先假定保留 2px 间隙，反推每格最多能多高；
   *   2. 如果那样会低于 MIN_SLOT，就丢掉间隙（密排里间隙比刻度还占地方）；
   *   3. 最后 clamp 到 MIN_SLOT，且**不取整** —— 取整会在边界上白丢 1px × n，
   *      正是「40 条就溢出 38px」的那 38px 的来源。
   */
  const gapTarget = 1.5
  let slot = itemSize
  let gap = 0

  if (items.length > 0 && navHeight > 0) {
    const withGap = (navHeight - (items.length - 1) * gapTarget) / items.length
    if (withGap >= MIN_SLOT) {
      // 装得下：维持目标槽高，够高才保留间隙
      slot = Math.min(itemSize, withGap)
      gap = slot >= itemSize ? gapTarget : 0
    } else {
      // 装不下：去间隙，按可用高度等分；仍不低于 HARD_MIN_SLOT
      slot = Math.max(HARD_MIN_SLOT, navHeight / items.length)
      gap = 0
    }
  }

  const dense = slot < itemSize

  return (
    <div className={cn('relative', className)}>
      {children}

      <nav
        ref={navRef}
        aria-label={label}
        className={cn('absolute flex flex-col items-end justify-center', railClassName)}
        /*
         * 这里**不能** overflow: hidden。
         *
         * 预览卡片是每个刻度项的子节点，用 right-full 往左展开 —— 它在 nav 的盒子
         * 外面。给 nav 上 hidden 会把卡片整个裁掉，表现就是「悬停什么都不显示」。
         *
         * 防止刻度越界压到正文那道保险，交给外层：message-scroller 给 PreviewRail
         * 的 className 本来就有 overflow-hidden，裁的是容器边界而不是 nav 边界。
         */
        style={{ gap }}
        onMouseLeave={scheduleHide}
      >
        {items.map((item) => {
          const isActive = highlightActive && item.id === activeId
          const isHovered = item.id === hoveredId
          // 刻度长度也随密度缩一档：密的时候短横线太粗会糊成一条
          const tickBase = dense ? 7 : 9
          const tickHover = dense ? 9 : 12
          const tickActive = dense ? 11 : 14
          return (
            <div key={item.id} className="relative">
              <button
                type="button"
                data-slot="preview-rail-item"
                aria-label={item.ariaLabel ?? item.label}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onItemSelect(item)}
                onMouseEnter={() => show(item.id)}
                onFocus={() => show(item.id)}
                onBlur={scheduleHide}
                className="flex cursor-pointer items-center justify-end bg-transparent p-0"
                style={{ height: slot, border: 'none' }}
              >
                <span
                  data-slot="preview-rail-tick"
                  className="block rounded-full transition-all duration-150"
                  style={{
                    width: isActive ? tickActive : isHovered ? tickHover : tickBase,
                    height: dense ? 1 : 1.25,
                    background: isActive
                      ? 'var(--text-on-surface)'
                      : isHovered
                        ? 'var(--text-on-surface-variant)'
                        : 'var(--border-strong)',
                  }}
                />
              </button>

              {isHovered && (
                <div
                  className={cn(
                    'pointer-events-none absolute top-1/2 -translate-y-1/2',
                    previewSide === 'before' ? 'right-full mr-3' : 'left-full ml-3',
                    previewContainerClassName,
                  )}
                  style={{ zIndex: 30 }}
                >
                  {/*
                   * 样式全在 .preview-rail-* 三个类里（见 globals.css）。
                   * 尺寸/颜色是对参考实现逐像素量的，别在 JSX 里覆盖。
                   */}
                  <div className={previewClassName}>
                    <div data-slot="preview-rail-card" className="preview-rail-card">
                      <div data-slot="preview-rail-title" className="preview-rail-title">
                        {item.label}
                      </div>
                      {item.description && (
                        <div
                          data-slot="preview-rail-description"
                          className="preview-rail-description"
                        >
                          {item.description}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </div>
  )
}
