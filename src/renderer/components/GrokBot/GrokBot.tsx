import { memo, useEffect, useRef } from 'react'
import { BotEngine, type BotFrame } from './engine'
import { NOTIF_BLUE } from './decor'
import { mixHex } from './skins'
import { DEMI_VIEWBOX, RAYON } from './repere'
import type { StateId } from './states'

/**
 * GrokBot 头像 —— 移植自 jeremy-prt/bloub (MIT) 对 x.ai Grok Bot 头像的复刻。
 *
 * 核心不变量（改动前先读 bloub 的 docs/architecture.md）：
 * - `engine.sample(t)` 是纯时间函数，无框架无时钟；所有常量是对官方视频
 *   的逐帧测量值，不要四舍五入或"顺手优化"。
 * - 眼睛是 <mask> 里的洞，不是叠上去的白色形状：滑到轮廓边缘时自动被裁切。
 * - 需要一张不透明的 `paper` 底板垫在身体下面：环的后半段和爆裂粒子画在
 *   身体后面以便被遮挡，没有底板它们会从眼睛的洞里透出来。
 */

export type BotStatus = 'idle' | 'thinking' | 'busy' | 'done' | 'error'

interface Props {
  size?: number
  /** 头像本体颜色（墨色）；paper 是页面底色，用于眼睛挖空处与粒子雾化 */
  color?: string
  paper?: string
  className?: string
  status?: BotStatus
}

/** 状态到动画状态序列的映射（循环播放）。 */
const STATUS_STATES: Record<BotStatus, StateId[]> = {
  idle: ['idle'],
  // 思考中：官方的三个点脉动
  thinking: ['thinking'],
  // 长任务执行：轨道环
  busy: ['orbit'],
  // 完成后眨个眼回到 idle
  done: ['wink', 'idle'],
  error: ['alert', 'idle'],
}

/** 状态保持时长（秒），对齐 bloub 的实测节奏。 */
const HOLD: Partial<Record<StateId, number>> = {
  idle: 2.4,
  thinking: 2.6,
  orbit: 3.4,
  wink: 1.6,
  alert: 2.4,
}

function GrokBotImpl({ size = 40, color = '#0a0a0c', paper = '#f9f9f9', className = '', status = 'idle' }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)

  // 共享时钟：主 effect 每帧写、status effect 读
  const clockRef = useRef(0)

  // 引擎与播放指针放 ref 里，避免每次渲染重建
  const refs = useRef<{ engine: BotEngine; seq: StateId[]; idx: number; stateStart: number } | null>(null)
  if (!refs.current) {
    refs.current = {
      engine: new BotEngine(RAYON, 'idle', null, null),
      seq: STATUS_STATES.idle,
      idx: 0,
      stateStart: 0,
    }
  }

  const prevStatus = useRef<BotStatus>(status)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const r = refs.current!
    let raf = 0
    let last = 0
    let clock = 0

    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick)
      // 场景时钟钳制 delta：窗口隐藏后重新显示不跳帧（rAF 挂起期间不积累）
      const dt = last ? Math.min((ms - last) / 1000, 0.064) : 0
      last = ms
      clock += dt
      clockRef.current = clock

      // 状态推进：当前状态到点就切序列里的下一个（循环）
      const hold = HOLD[r.seq[r.idx]!] ?? 2
      if (clock - r.stateStart >= hold) {
        r.stateStart = clock
        r.idx = (r.idx + 1) % r.seq.length
        r.engine.setState(r.seq[r.idx]!, clock)
      }

      applyFrame(r.engine.sample(clock))
    }

    // 把 BotFrame 写进 SVG DOM——结构对齐 bloub 的 BloubBot.vue 模板
    const q = <T extends Element>(sel: string) => svg.querySelector<T>(`[data-gb="${sel}"]`)
    const applyFrame = (f: BotFrame) => {
      // mask 里那条 body 是整只球的轮廓：它没有 d，mask 就是空的，
      // 被 mask 的 rect 什么都画不出来 —— 整只球直接消失。
      const bodyEl = q<SVGPathElement>('body')
      if (bodyEl) bodyEl.setAttribute('d', f.bodyPath)

      const bodyG = q<SVGGElement>('body-group')
      if (bodyG) bodyG.setAttribute('opacity', String(f.bodyAlpha))

      // 底板要跟 body 同一个 d：眼睛是洞，没有这层，画在身后的环会从洞里透出来
      const underEl = q<SVGPathElement>('under')
      if (underEl) {
        underEl.setAttribute('d', f.bodyPath)
        underEl.setAttribute('fill', paper)
      }

      // 眼睛每帧重建（对齐 bloub 的 v-for）：数量恒定但几何一直在变，
      // 用数量做守卫会让眼睛冻在第一帧，再也不眨、不转。
      const eyesG = q<SVGGElement>('eyes')
      if (eyesG) {
        eyesG.replaceChildren()
        for (const eye of f.eyes) {
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          p.setAttribute('d', eye.d)
          p.setAttribute('transform', eye.matrix)
          p.setAttribute('opacity', String(eye.alpha))
          p.setAttribute('fill', '#000')
          eyesG.appendChild(p)
        }
      }

      // dots（前后两层）
      fillDots(q<SVGGElement>('dots-behind'), f.dotsBehind ? f.dots : [], color, paper)
      fillDots(q<SVGGElement>('dots-front'), f.dotsBehind ? [] : f.dots, color, paper)

      // arcs（环/彗尾，前 + 后）
      fillArcs(q<SVGGElement>('arcs-back'), f.arcs, 'back')
      fillArcs(q<SVGGElement>('arcs-front'), f.arcs, 'front')

      // 通知蓝点 + 身体上的凹口
      const notif = q<SVGCircleElement>('notif')
      const notch = q<SVGCircleElement>('notch')
      if (notif && notch) {
        if (f.notif && f.notch) {
          notif.setAttribute('cx', String(f.notif.x))
          notif.setAttribute('cy', String(f.notif.y))
          notif.setAttribute('r', String(f.notif.r))
          notif.setAttribute('display', '')
          notch.setAttribute('cx', String(f.notch.x))
          notch.setAttribute('cy', String(f.notch.y))
          notch.setAttribute('r', String(f.notch.r))
          notch.setAttribute('display', '')
        } else {
          notif.setAttribute('display', 'none')
          notch.setAttribute('display', 'none')
        }
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // status 变化：切换状态序列（引擎保留历史做 morph 过渡）
  useEffect(() => {
    if (prevStatus.current === status) return
    prevStatus.current = status
    const r = refs.current!
    r.seq = STATUS_STATES[status]
    r.idx = 0
    r.stateStart = clockRef.current
    r.engine.setState(r.seq[0]!, clockRef.current)
  }, [status])

  const R = RAYON
  const VB = DEMI_VIEWBOX
  const maskId = useMemoMask()

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      role="img"
      aria-label="Grok Bot"
      className={className}
    >
      <defs>
        {/*
          眼睛是身体上的真洞（同 x.ai 官方），不是叠白色形状：
          滑向边缘时被轮廓自动裁切，无需裁剪代码
        */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path data-gb="body" fill="#fff" />
          <g data-gb="eyes" />
          <circle data-gb="notch" fill="#000" display="none" />
        </mask>

        <linearGradient data-gb="grad" gradientUnits="userSpaceOnUse">
          {/* arcs 的渐变由运行时生成（fillArcs 里重建） */}
        </linearGradient>
      </defs>

      {/* 环的后半段：画在身体前 → 被身体遮挡 */}
      <g data-gb="arcs-back" fill="none" strokeLinecap="round" />

      {/* 爆裂粒子（在身体后面被吞掉的那批） */}
      <g data-gb="dots-behind" />

      <g data-gb="body-group">
        {/* 不透明底板：防止画在身后的环从眼睛洞里透出来 */}
        <path data-gb="under" fill={paper} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={color} />
        </g>
      </g>

      {/* 通知蓝点（压在身体上） */}
      <circle data-gb="notif" fill={NOTIF_BLUE} display="none" />

      {/* 前景粒子（! 的点等） */}
      <g data-gb="dots-front" />

      {/* 环的前半段 */}
      <g data-gb="arcs-front" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/** mask id 唯一化（多实例共存） */
function useMemoMask(): string {
  const ref = useRef<string | null>(null)
  if (!ref.current) ref.current = `gb-mask-${Math.random().toString(36).slice(2, 8)}`
  return ref.current
}


function fillDots(g: SVGGElement | null, dots: BotFrame['dots'], ink: string, paper: string): void {
  if (!g) return
  if (dots.length === 0 && g.childElementCount === 0) return
  g.replaceChildren()
  for (const d of dots) {
    let el: SVGElement
    if (d.d) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      el.setAttribute('d', d.d)
      el.setAttribute('transform', `translate(${d.x} ${d.y}) rotate(${d.rot ?? 0}) scale(${RAYON})`)
    } else {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      el.setAttribute('cx', String(d.x))
      el.setAttribute('cy', String(d.y))
      el.setAttribute('r', String(d.r))
    }
    // depth：越远的粒子越化进底色（bloub 的 dotAttrs 同款）
    const fill = d.color ?? (d.depth === undefined ? ink : mixHex(paper, ink, d.depth))
    el.setAttribute('fill', fill)
    el.setAttribute('opacity', String(d.opacity))
    g.appendChild(el)
  }
}

function fillArcs(
  g: SVGGElement | null,
  arcs: BotFrame['arcs'],
  half: 'front' | 'back'
): void {
  if (!g) return
  g.replaceChildren()
  for (const a of arcs) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    p.setAttribute('d', half === 'front' ? a.front : a.back)
    p.setAttribute('stroke-width', String(a.width))
    p.setAttribute('opacity', String(a.opacity))
    // 渐变省略（性能/简洁）：纯色取渐变中间色
    const stops = a.grad.stops
    p.setAttribute('stroke', stops[Math.floor(stops.length / 2)] ?? '#888')
    g.appendChild(p)
  }
}

export const GrokBot = memo(GrokBotImpl)
