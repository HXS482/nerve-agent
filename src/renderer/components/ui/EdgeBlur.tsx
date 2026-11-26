import type { CSSProperties } from 'react'
import { cn } from '../../lib/cn'

/**
 * EdgeBlur —— 边缘渐进模糊。
 *
 * 用「多层 backdrop-blur 叠加 + 每层各自的渐变 mask」逼近一条柔和的模糊梯度：
 * 单独一层高斯模糊 + 线性渐变遮罩的过渡是直的，观感像一刀切；叠 N 层后，
 * 越靠边缘参与叠加的层越多、模糊越强，往里逐级减少，得到的是一条平滑的衰减曲线。
 *
 * 三条必须守住的约定：
 *   1. 模糊层是滚动容器的**兄弟**，不能放在滚动容器内部 —— 否则它跟着内容一起滚走。
 *   2. 模糊层本身 `pointer-events: none`，滚轮 / 触摸事件继续落到下面的滚动区。
 *   3. 外层框架需要 `overflow: hidden`（有圆角就还要 `isolate`），
 *      模糊层的 `absolute` 定位才有边界可裁，不会溢出到窗口外。
 */

/**
 * 叠几层。层数越多过渡越顺，代价是每层都是一个 backdrop-filter（各自一次合成）。
 *
 * 实测过 6 / 8 / 12 / 16 层的衰减曲线（用 2px 黑白条纹当底，逐行量对比度标准差反推模糊强度）：
 * 6 层在靠边 30px 内一直是满模糊、之后才开始掉，过渡集中在后半段，看着像「一段实的 + 一段渐隐」；
 * 8 层线性分布能把衰减摊平到整条带，曲线接近线性，肉眼看不出分段。
 * 再往上（12/16）已经没有可见收益，只是多烧合成。取 8。
 */
const LAYERS = 8

interface EdgeBlurProps {
  /** 贴哪条边。top = 模糊最强在最上方，向下递减 */
  position?: 'top' | 'bottom'
  /** 模糊带总高度（px） */
  height?: number
  /** 最靠边缘那层的模糊半径（px）。整条带从 ~0.4px 递增到它 */
  maxBlur?: number
  className?: string
}

export function EdgeBlur({ position = 'top', height = 64, maxBlur = 10, className }: EdgeBlurProps) {
  // 渐变方向：top 边从最上方开始实、往下变透明；bottom 边相反
  const toEdge = position === 'top' ? 'to bottom' : 'to top'

  return (
    <div
      aria-hidden="true"
      className={cn('edge-blur', className)}
      data-position={position}
      style={{ height } as CSSProperties}
    >
      {Array.from({ length: LAYERS }, (_, i) => {
        // i 从 0（最弱、覆盖整条带）到 LAYERS-1（最强、只覆盖最靠边的一小段）。
        // 模糊半径线性递增：第 i 层比上一层强一档。
        // 平方递增会让靠边几层强度差过大、中间段几乎不动，衰减集中在后半段（实测过，看着像两段）
        const progress = LAYERS > 1 ? i / (LAYERS - 1) : 1
        const blur = 0.5 + (maxBlur - 0.5) * progress
        // 覆盖深度必须和强度反着来：最强的层只贴住最边上一小段，最弱的层铺满整条带。
        // 这样靠边处所有层叠加（模糊最强），往里逐层退出、越来越清 —— 才是「景深」方向。
        // 写反了（强层铺满）会变成越往里越糊，整条带像蒙了层毛玻璃。
        const reach = ((LAYERS - i) / LAYERS) * 100
        const mask = `linear-gradient(${toEdge}, #000 0%, transparent ${reach}%)`
        return (
          <span
            key={i}
            style={{
              backdropFilter: `blur(${blur.toFixed(2)}px)`,
              WebkitBackdropFilter: `blur(${blur.toFixed(2)}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        )
      })}
    </div>
  )
}

export function TopBlur({ height = 64, maxBlur }: { height?: number; maxBlur?: number }) {
  return <EdgeBlur position="top" height={height} maxBlur={maxBlur} />
}

export function BottomBlur({ height = 64, maxBlur }: { height?: number; maxBlur?: number }) {
  return <EdgeBlur position="bottom" height={height} maxBlur={maxBlur} />
}
