import { memo, useEffect, useRef } from 'react'
import { mountAvatar, type MountedAvatar } from 'open-bot-avatar/dom'
import type { AvatarDefinition } from 'open-bot-avatar'
import type { BotStatus } from '../../lib/botStatus'
import { shapeForSize } from '../../lib/bot-shapes'

/**
 * Bot 头像 —— open-bot-avatar（MIT）的 React 外壳。
 *
 * 上游只给了一个命令式 API：`mountAvatar(el, options)` 往 DOM 节点里塞 canvas，
 * 之后一律走 `avatar.update()`。这里就做三件事：
 *
 *   1. 挂载一次（effect 依赖只放"换了要重建的东西"）；
 *   2. 其余变化全部走 update —— 上游的 update 会自己 diff，重建反而会丢动画状态
 *      （正在转的身体会瞬间回到站姿）；
 *   3. 卸载时 destroy（它内部摘掉 rAF 订阅和指针监听，漏了就会一直跑）。
 *
 * 关于 still：列表里有几十个 Bot，让它们都跑 rAF 是纯浪费。`animate=false` 时传
 * still，上游会渲染一张静态 SVG（比 canvas 还轻），只有当前在干活的那只才动画。
 */

/** BotStatus → open-bot-avatar 的状态名。上游的语义比自己起名更准，直接映射。 */
const STATE_OF: Record<BotStatus, 'idle' | 'thinking' | 'working' | 'done' | 'blocked'> = {
  idle: 'idle',
  // 等模型：三个点脉动
  thinking: 'thinking',
  // 真在干活（有清单项/子任务在跑）：环带扫过身体
  busy: 'working',
  // 刚收尾：转几圈撒丝带
  done: 'done',
  // 挂了：身体换成感叹号
  error: 'blocked',
}

/** WCAG 相对亮度。不是 "r+g+b/3" —— 绿色在感知上比蓝色亮得多，简单平均会判错。 */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const h = m[1]!
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
}

const DARK_INK = '#151515'
const LIGHT_INK = '#f7f7f4'

/**
 * 眼睛颜色：在两个候选里挑对比度更高的那个。
 *
 * 不写死「亮底用黑眼」的阈值 —— 色板里有 #2DBE8A 这种中等亮度色，阈值一偏就
 * 变成灰眼糊在灰身上。直接比对比度，任何颜色都能得到可读的一对。
 */
function eyeColorFor(body: string): string {
  const lb = luminance(body)
  const ratio = (a: number) => (Math.max(a, lb) + 0.05) / (Math.min(a, lb) + 0.05)
  return ratio(luminance(DARK_INK)) >= ratio(luminance(LIGHT_INK)) ? DARK_INK : LIGHT_INK
}

export interface BotAvatarProps {
  /** 形状（来自 lib/botShapes，按 Bot id 散列或用户显式选的） */
  shape: AvatarDefinition
  size?: number
  /** 身体颜色；不传就用形状自带的出厂色 */
  color?: string
  /** 眼睛颜色；不传就按身体明暗自动取黑或白 */
  eyeColor?: string
  status?: BotStatus
  /**
   * 是否播放动画。列表里几十个头像同时跑 rAF 会白白吃满主线程，
   * 所以非激活的头像传 false：只渲染一张静态 SVG。
   */
  animate?: boolean
  /**
   * 眼睛和身体是否跟着鼠标转。
   *
   * 只在少数几个"英雄位"（顶栏、stage）开：开了之后每帧都要
   * getBoundingClientRect 拿位置，列表里几十个一起开会把布局抖动放大几十倍。
   */
  followPointer?: boolean
  className?: string
  /** 无障碍名；传空字符串表示纯装饰（上游会设 aria-hidden） */
  label?: string
  /**
   * 身体材质：'flat' 平涂，'fluffy' 毛绒。
   *
   * fluffy 走 WebGL2 画毛发，没有 WebGL2（或被回收）时上游自动退回 flat，
   * 所以这里不做能力检测 —— 只要知道会退，别把退化当成坏了。
   */
  material?: 'flat' | 'fluffy'
}

function BotAvatarImpl({
  shape,
  size = 34,
  color,
  eyeColor,
  status = 'idle',
  animate = false,
  followPointer = false,
  className = '',
  label,
  material = 'flat',
}: BotAvatarProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mounted = useRef<MountedAvatar | null>(null)

  const ink = color ?? '#f1efe9'
  const eye = eyeColor ?? eyeColorFor(ink)

  // 挂载一次。定义/颜色/尺寸的变化全交给下面那个 effect 走 update()。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    mounted.current = mountAvatar(host, {
      definition: shapeForSize(shape, size),
      color: ink,
      eyeColor: eye,
      state: STATE_OF[status],
      mood: status === 'done' ? 'happy' : 'neutral',
      followPointer,
      still: !animate,
      material,
      // 体积取上游默认的 6（自然深度）；0 会退化成纯平面剪影，失去圆润感
      label: label ?? shape.name,
    })
    return () => {
      mounted.current?.destroy()
      mounted.current = null
    }
    // 只有换节点/换动画开关才重建：形状与颜色让 update 处理，少闪一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, followPointer, material])

  // 其余全部走 update：上游会 diff，不会丢当前动画进度
  useEffect(() => {
    mounted.current?.update({
      definition: shapeForSize(shape, size),
      color: ink,
      eyeColor: eye,
      state: STATE_OF[status],
      mood: status === 'done' ? 'happy' : 'neutral',
      material,
      label: label ?? shape.name,
    })
  }, [shape, size, ink, eye, status, label, material])

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        width: size,
        height: size,
        // 上游会往这里写 color / --avatar-ink，也会自己补 position:relative
        display: 'block',
        flexShrink: 0,
        // 眼睛是画在身体上的，不需要底板；但给一点过渡，颜色切换时不生硬
        transition: 'opacity 120ms linear',
      }}
    />
  )
}

export const BotAvatar = memo(BotAvatarImpl)
