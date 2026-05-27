import { useMemo, useEffect } from 'react'

export type OrbState = 'idle' | 'active' | 'thinking' | 'morphing'

interface Props {
  state?: OrbState
  theme?: string
  size?: number
  className?: string
}

const STATE_COLORS: Record<OrbState, string> = {
  idle: '#4A9EFF',
  active: '#6BA3FE',
  thinking: '#22D3EE',
  morphing: '#F97316',
}

const THEME_COLORS: Record<string, string> = {
  dark: '#4A9EFF',
  light: '#3B82F6',
  aurora: '#60A5FA',
}

interface Particle {
  id: number
  x: number
  y: number
  size: number
  blur: number
  duration: number
  delay: number
  driftX: number
  driftY: number
  breathMin: number
  breathMax: number
}

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const theta = Math.random() * Math.PI * 2
    const r = Math.pow(Math.random(), 1.5) * 45
    return {
      id: i,
      x: 50 + Math.cos(theta) * r,
      y: 50 + Math.sin(theta) * r,
      size: 2 + Math.random() * 4,
      blur: 1 + Math.random() * 2,
      duration: 3 + Math.random() * 5,
      delay: Math.random() * -5,
      driftX: 8 + Math.random() * 12,
      driftY: 8 + Math.random() * 12,
      breathMin: 0.6 + Math.random() * 0.2,
      breathMax: 0.9 + Math.random() * 0.3,
    }
  })
}

function buildKeyframes(particles: Particle[]): string {
  return particles
    .map(
      (p) => `
@keyframes cloud-drift-${p.id} {
  0%, 100% { transform: translate(0, 0) scale(${p.breathMin}); }
  25% { transform: translate(${p.driftX}px, ${-p.driftY * 0.5}px) scale(${p.breathMax}); }
  50% { transform: translate(${-p.driftX * 0.7}px, ${p.driftY}px) scale(${p.breathMin}); }
  75% { transform: translate(${p.driftX * 0.5}px, ${-p.driftY}px) scale(${p.breathMax}); }
}`
    )
    .join('\n')
}

export function NerveCloud({ state = 'idle', theme = 'dark', size = 64, className = '' }: Props) {
  const particles = useMemo(() => generateParticles(80), [])
  const idleColor = THEME_COLORS[theme] || THEME_COLORS.dark
  const currentColor = state === 'idle' ? idleColor : STATE_COLORS[state]

  useEffect(() => {
    const id = 'nerve-cloud-styles'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = buildKeyframes(particles)
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [particles])

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: size,
        height: size,
        filter: 'blur(3px)',
      }}
    >
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: currentColor,
            filter: `blur(${p.blur}px)`,
            animation: `cloud-drift-${p.id} ${p.duration}s ease-in-out ${p.delay}s infinite alternate`,
            transition: 'background 0.6s ease',
          }}
        />
      ))}
    </div>
  )
}
