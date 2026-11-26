import { create } from 'zustand'

/**
 * 「头像飞行」——空会话中间那只 Bot 飞向顶栏的那一段动画。
 *
 * 为什么需要独立的状态：这段动画跨越了两个组件树分支。空会话时 Bot 画在
 * ChatPanel 的占位里，发出第一条消息后 ChatPanel 直接换成分支、占位连同 Bot
 * 一起卸载，顶栏那只同时出现。想让它看起来是「一只飞上去」而不是「一只消失、
 * 另一只冒出来」，就得在两者之间放一个自己管理的替身。
 *
 * 替身的数据只有两个矩形：从哪飞、飞到哪。矩形必须在 send 被调用的**那一刻**
 * 同步量取 —— React 一旦重渲染，占位就不在了。
 */

export interface FlightRect {
  left: number
  top: number
  width: number
  height: number
}

interface AvatarFlightState {
  flight: { from: FlightRect; to: FlightRect; id: number } | null
  start: (from: FlightRect, to: FlightRect) => void
  finish: () => void
}

let seq = 0

export const useAvatarFlightStore = create<AvatarFlightState>()((set) => ({
  flight: null,
  start: (from, to) => set({ flight: { from, to, id: ++seq } }),
  finish: () => set({ flight: null }),
}))

/** 飞行中最长时长：万一 onAnimationComplete 没触发（组件被卸载等），兜底清掉 */
const FLIGHT_TIMEOUT = 1400

/**
 * 在 send 之前调用：量好两端的矩形并起飞。
 *
 * 只认 DOM 上的两个标记，不依赖 props 传递 —— 调用点分布在 chat 与 stage
 * 两套界面里，用查询比层层传 ref 简单，也不会有「ref 还是 null」的时序问题。
 *
 * 返回 false 表示这次不该飞（不在空会话、或元素还没布局），调用方不必处理。
 */
export function beginAvatarFlight(): boolean {
  if (typeof window === 'undefined') return false
  // 尊重系统设置：开了「减少动态效果」就直接切，不做位移动画
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false

  const fromEl = document.querySelector('[data-empty-avatar]')
  const toEl = document.querySelector('[data-avatar-slot]')
  if (!fromEl || !toEl) return false

  const a = fromEl.getBoundingClientRect()
  const b = toEl.getBoundingClientRect()
  // 有一端还没布局（宽高为 0）就没有可飞的东西，宁可不动
  if (a.width === 0 || b.width === 0) return false

  useAvatarFlightStore.getState().start(
    { left: a.left, top: a.top, width: a.width, height: a.height },
    { left: b.left, top: b.top, width: b.width, height: b.height },
  )

  // 兜底：动画结束时组件自己的 onAnimationComplete 会先清一次，这里只是保险
  window.setTimeout(() => useAvatarFlightStore.getState().finish(), FLIGHT_TIMEOUT)
  return true
}
