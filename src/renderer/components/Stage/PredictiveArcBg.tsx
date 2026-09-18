import { useEffect, useRef } from 'react'

// Predictive Arc —— Stage 模式默认动态背景（Canvas 2D 点阵弧光）
// 移植自 @designcodeio/threeui 的 predictive 变体：点阵沿一条抛物线弧分布，
// 双正弦波调制亮度，中心亮核加成；dark 模式用 additive 叠加发光。
// 仅在用户未自定义 stageBg 时渲染；性能护栏与 BgVideo 相同（离屏/隐藏页暂停）。

export type PredictiveArcOptions = {
  mode: 'dark' | 'light'
  speed: number
  spacing: number
  dotSize: number
  archHeight: number
  thickness: number
  brightness: number
  hue: number
  saturation: number
}

export const PREDICTIVE_ARC_DEFAULTS: PredictiveArcOptions = {
  mode: 'dark',
  speed: 1,
  spacing: 5,
  dotSize: 6,
  archHeight: 0.7,
  thickness: 1,
  brightness: 1,
  hue: 0,
  saturation: 1,
}

function createPredictiveArcRenderer(canvas: HTMLCanvasElement, getOptions: () => PredictiveArcOptions) {
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return null
  let width = 1
  let height = 1
  let time = 0

  const resize = (nextWidth: number, nextHeight: number) => {
    width = Math.max(1, nextWidth)
    height = Math.max(1, nextHeight)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  }

  const render = () => {
    const options = getOptions()
    const isLight = options.mode === 'light'
    context.fillStyle = isLight ? '#eef1f6' : '#030303'
    context.fillRect(0, 0, width, height)
    time += 0.015 * options.speed

    const centerX = width / 2
    const archPeakY = height * 0.35
    const archWidth = width * 1.5
    const archHeight = height * options.archHeight
    context.globalCompositeOperation = isLight ? 'source-over' : 'lighter'

    for (let x = 0; x < width; x += options.spacing) {
      const normX = (x - centerX) / (archWidth / 2)
      const curveY = archPeakY + normX * normX * archHeight
      for (let y = 0; y < height; y += options.spacing) {
        const distanceToCurve = Math.abs(y - curveY)
        const thickness = (140 + (1 - Math.abs(normX)) * 80) * options.thickness
        if (distanceToCurve >= thickness) continue
        let intensity = 1 - distanceToCurve / thickness
        const waveX = Math.sin(x * 0.015 + time)
        const waveY = Math.cos(y * 0.02 + time)
        intensity = intensity * 0.7 + waveX * waveY * 0.3 * intensity
        intensity *= Math.max(0, 1 - Math.pow(Math.abs(normX), 2.5))
        if (intensity <= 0.02) continue

        let r: number
        let g: number
        let b: number
        if (isLight) {
          // Cool violet ink on pale paper — readable without additive washout.
          r = Math.min(255, 48 * intensity + 70 * Math.pow(intensity, 3))
          g = Math.min(255, 28 * intensity + 45 * Math.pow(intensity, 4))
          b = Math.min(255, 120 * intensity + 110 * Math.pow(intensity, 2))
          if (intensity > 0.7) {
            const coreBoost = (intensity - 0.7) * 3.3
            r = Math.min(255, r + 90 * coreBoost)
            g = Math.min(255, g + 70 * coreBoost)
            b = Math.min(255, b + 110 * coreBoost)
          }
        } else {
          r = Math.min(255, 60 * intensity + 100 * Math.pow(intensity, 3))
          g = Math.min(255, 20 * intensity + 60 * Math.pow(intensity, 4))
          b = Math.min(255, 120 * intensity + 135 * Math.pow(intensity, 2))
          if (intensity > 0.7) {
            const coreBoost = (intensity - 0.7) * 3.3
            r = Math.min(255, r + 150 * coreBoost)
            g = Math.min(255, g + 150 * coreBoost)
            b = Math.min(255, b + 150 * coreBoost)
          }
        }
        context.fillStyle = `rgb(${Math.floor(r * options.brightness)}, ${Math.floor(g * options.brightness)}, ${Math.floor(b * options.brightness)})`
        context.fillRect(x, y, options.dotSize * intensity, options.dotSize * intensity)
      }
    }
    context.globalCompositeOperation = 'source-over'
  }

  return { resize, render }
}

// 背景宿主：absolute inset 0 铺满 .stage-bg；不拦截交互（父层已 pointer-events:none）
export function PredictiveArcBg({ className = '', ...props }: Partial<PredictiveArcOptions> & { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const optionsRef = useRef({ ...PREDICTIVE_ARC_DEFAULTS, ...props })
  optionsRef.current = { ...PREDICTIVE_ARC_DEFAULTS, ...props }

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return undefined
    const renderer = createPredictiveArcRenderer(canvas, () => optionsRef.current)
    if (!renderer) return undefined
    let frame = 0
    let visible = true
    const resize = () => {
      const bounds = host.getBoundingClientRect()
      renderer.resize(bounds.width, bounds.height)
      renderer.render()
    }
    const tick = () => {
      renderer.render()
      frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0
    }
    const observer = new ResizeObserver(resize)
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true
      if (visible && !frame) frame = requestAnimationFrame(tick)
      if (!visible && frame) cancelAnimationFrame(frame), (frame = 0)
    })
    const visibility = () => {
      if (document.hidden && frame) cancelAnimationFrame(frame), (frame = 0)
      else if (!document.hidden && visible && !frame) frame = requestAnimationFrame(tick)
    }
    observer.observe(host)
    intersection.observe(host)
    document.addEventListener('visibilitychange', visibility)
    resize()
    frame = requestAnimationFrame(tick)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])

  const options = optionsRef.current
  return (
    <div ref={hostRef} className={`stage-bg-predictive${className ? ` ${className}` : ''}`} data-mode={options.mode}>
      <canvas
        ref={canvasRef}
        style={
          options.hue === 0 && options.saturation === 1
            ? undefined
            : { filter: `hue-rotate(${options.hue}deg) saturate(${options.saturation})` }
        }
      />
    </div>
  )
}
