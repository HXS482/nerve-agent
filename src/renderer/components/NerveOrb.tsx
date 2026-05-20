import { useEffect, useRef, useCallback } from 'react'
import { Renderer, Program, Mesh, Sphere, Camera, Transform } from 'ogl'

export type OrbState = 'idle' | 'active' | 'thinking' | 'morphing'

interface Props {
  state?: OrbState
  theme?: string
  size?: number
  className?: string
}

const vertex = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uMorph;
out vec3 vNormal;
out vec3 vPosition;
out float vFresnel;

void main() {
  vec3 pos = position;

  // Morph distortion
  float noise = sin(pos.x * 3.0 + uTime * 2.0) * cos(pos.y * 2.5 + uTime * 1.8) * sin(pos.z * 2.8 + uTime * 1.5);
  pos += normal * noise * uMorph * 0.15;

  // Breathing pulse
  float pulse = sin(uTime * 1.5) * 0.03;
  pos *= 1.0 + pulse;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  vPosition = mvPosition.xyz;
  vNormal = normalize((modelViewMatrix * vec4(normal, 0.0)).xyz);

  vec3 viewDir = normalize(-vPosition.xyz);
  vFresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 2.5);

  gl_Position = projectionMatrix * mvPosition;
}
`

const fragment = `#version 300 es
precision highp float;
uniform float uTime;
uniform float uState; // 0=idle, 1=active, 2=thinking, 3=morphing
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uOpacity;
in vec3 vNormal;
in vec3 vPosition;
in float vFresnel;
out vec4 fragColor;

void main() {
  float t = uTime;

  // Base color blend between two theme colors
  float blend = sin(t * 0.5) * 0.5 + 0.5;
  vec3 baseColor = mix(uColor1, uColor2, blend);

  // Fresnel rim glow
  vec3 rimColor = uColor1 * 1.5;
  vec3 col = mix(baseColor * 0.4, rimColor, vFresnel);

  // Inner glow layers
  float innerGlow = pow(max(dot(vNormal, normalize(vec3(sin(t * 0.3), cos(t * 0.4), 0.5))), 0.0), 3.0);
  col += uColor2 * innerGlow * 0.3;

  // State-specific effects
  if (uState > 1.5 && uState < 2.5) {
    // Thinking: pulsing energy rings
    float ring = sin(vPosition.y * 12.0 - t * 3.0) * 0.5 + 0.5;
    col += uColor1 * ring * 0.2;
  }
  if (uState > 2.5) {
    // Morphing: faster, more distortion color shift
    float morph = sin(t * 4.0 + vPosition.x * 5.0) * 0.5 + 0.5;
    col = mix(col, uColor1 * 1.2, morph * 0.3);
  }

  // Subtle specular highlight
  vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
  float spec = pow(max(dot(reflect(-lightDir, vNormal), normalize(-vPosition)), 0.0), 16.0);
  col += vec3(1.0) * spec * 0.4;

  col = clamp(col, 0.0, 1.0);
  fragColor = vec4(col, uOpacity);
}
`

// Theme color palettes
const THEMES: Record<string, { c1: string; c2: string }> = {
  dark:   { c1: '#8EE3C8', c2: '#5227FF' },
  light:  { c1: '#6BA3FE', c2: '#A855F7' },
  aurora: { c1: '#FF9FFC', c2: '#5227FF' },
}

const hexToFloat = (hex: string): [number, number, number] => {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!r) return [1, 1, 1]
  return [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255]
}

const STATE_SPEEDS: Record<OrbState, number> = {
  idle: 0.3,
  active: 0.6,
  thinking: 1.0,
  morphing: 2.5,
}

const STATE_MORPH: Record<OrbState, number> = {
  idle: 0,
  active: 0.1,
  thinking: 0.2,
  morphing: 1.0,
}

const STATE_OPACITY: Record<OrbState, number> = {
  idle: 0.85,
  active: 0.9,
  thinking: 0.95,
  morphing: 0.8,
}

const ctxMap = new WeakMap<HTMLElement, { renderer: any; program: any; mesh: any; camera: any; scene: any }>()

export function NerveOrb({ state = 'idle', theme = 'dark', size = 40, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const getThemeColors = useCallback(() => {
    const t = THEMES[theme] || THEMES.dark
    return { c1: hexToFloat(t.c1), c2: hexToFloat(t.c2) }
  }, [theme])

  // Effect 1: Build WebGL context once
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new Renderer({
      webgl: 2,
      alpha: true,
      antialias: true,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    })

    const gl = renderer.gl
    const canvas = gl.canvas as HTMLCanvasElement
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    canvas.style.display = 'block'
    container.appendChild(canvas)

    const camera = new Camera(gl, { fov: 35 })
    camera.position.set(0, 0, 4)

    const scene = new Transform()

    const geometry = new Sphere(gl, { widthSegments: 48, heightSegments: 48 })

    const colors = getThemeColors()
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uState: { value: 0 },
        uColor1: { value: new Float32Array(colors.c1) },
        uColor2: { value: new Float32Array(colors.c2) },
        uMorph: { value: 0 },
        uOpacity: { value: 0.85 },
      },
    })

    const mesh = new Mesh(gl, { geometry, program })
    mesh.setParent(scene)

    ctxMap.set(container, { renderer, program, mesh, camera, scene })

    let raf = 0
    const t0 = performance.now()
    let targetSpeed = STATE_SPEEDS[stateRef.current]
    let currentSpeed = targetSpeed
    let targetMorph = STATE_MORPH[stateRef.current]
    let currentMorph = targetMorph
    let targetOpacity = STATE_OPACITY[stateRef.current]
    let currentOpacity = targetOpacity

    const loop = (t: number) => {
      const elapsed = (t - t0) * 0.001

      // Smooth interpolation for state transitions
      targetSpeed = STATE_SPEEDS[stateRef.current]
      targetMorph = STATE_MORPH[stateRef.current]
      targetOpacity = STATE_OPACITY[stateRef.current]
      currentSpeed += (targetSpeed - currentSpeed) * 0.05
      currentMorph += (targetMorph - currentMorph) * 0.05
      currentOpacity += (targetOpacity - currentOpacity) * 0.08

      program.uniforms.uTime.value = elapsed * currentSpeed
      program.uniforms.uMorph.value = currentMorph
      program.uniforms.uOpacity.value = currentOpacity

      // Map state to numeric
      const stateMap: Record<OrbState, number> = { idle: 0, active: 1, thinking: 2, morphing: 3 }
      program.uniforms.uState.value = stateMap[stateRef.current]

      // Gentle rotation
      mesh.rotation.y += 0.005 * currentSpeed
      mesh.rotation.x += 0.002 * currentSpeed

      renderer.render({ scene, camera })
      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ctxMap.delete(container)
      try { container.removeChild(canvas) } catch { /* ignore */ }
    }
  }, [size, getThemeColors])

  // Effect 2: Sync theme colors
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ctx = ctxMap.get(container)
    if (!ctx) return
    const colors = getThemeColors()
    ctx.program.uniforms.uColor1.value = new Float32Array(colors.c1)
    ctx.program.uniforms.uColor2.value = new Float32Array(colors.c2)
  }, [getThemeColors])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size, cursor: 'grab' }}
    />
  )
}
