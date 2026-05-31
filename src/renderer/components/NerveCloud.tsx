import { useEffect, useRef } from 'react'
import { Mat4 } from 'ogl'

export type OrbState = 'idle' | 'active' | 'thinking' | 'morphing'

interface Props {
  state?: OrbState
  theme?: string
  size?: number
  className?: string
}

const PARTICLE_COUNT = 200
const RADIUS = 0.55

const THEMES: Record<string, { c1: [number, number, number]; c2: [number, number, number] }> = {
  dark:   { c1: [0.56, 0.89, 0.78], c2: [0.32, 0.15, 1.0] },
  light:  { c1: [0.42, 0.73, 1.0],  c2: [0.66, 0.33, 0.97] },
  aurora: { c1: [1.0, 0.62, 0.99],  c2: [0.32, 0.15, 1.0] },
}

const STATE_PHYSICS: Record<OrbState, { turbulence: number; freq: number; gravity: number; damping: number }> = {
  idle:     { turbulence: 0.018, freq: 0.8, gravity: 0.0003, damping: 0.06 },
  active:   { turbulence: 0.012, freq: 1.0, gravity: 0.002, damping: 0.08 },
  thinking: { turbulence: 0.04,  freq: 2.0, gravity: 0.0008, damping: 0.07 },
  morphing: { turbulence: 0.03,  freq: 1.5, gravity: -0.003, damping: 0.04 },
}

// --- CPU-side turbulence (multi-sine approximation) ---
function turbulence(x: number, y: number, z: number, freq: number, t: number): [number, number, number] {
  const fx = x * freq + t
  const fy = y * freq + t * 0.7
  const fz = z * freq + t * 1.3
  const nx = Math.sin(fx * 1.1) * Math.cos(fy * 1.3) * Math.sin(fz * 0.7 + t * 0.5)
            + Math.sin(fx * 2.3 + t) * Math.cos(fz * 1.7) * 0.3
  const ny = Math.cos(fy * 1.1) * Math.sin(fz * 0.9) * Math.cos(fx * 1.0 + t * 0.3)
            + Math.cos(fy * 2.1 - t) * Math.sin(fx * 1.4) * 0.3
  const nz = Math.sin(fz * 0.8) * Math.cos(fx * 1.2) * Math.sin(fy * 1.5 + t * 0.6)
            + Math.sin(fz * 2.0 - t * 0.8) * Math.cos(fy * 1.1) * 0.3
  return [nx, ny, nz]
}

// --- Helpers ---
function randomOnSphere(r: number): [number, number, number] {
  const u = Math.random() * 2 - 1
  const theta = Math.random() * Math.PI * 2
  const s = Math.sqrt(1 - u * u)
  return [Math.cos(theta) * s * r, u * r, Math.sin(theta) * s * r]
}

function len3(v: number[], i: number): number {
  return Math.sqrt(v[i] * v[i] + v[i + 1] * v[i + 1] + v[i + 2] * v[i + 2])
}

function normalize3(v: number[], i: number, out: number[], oi: number) {
  const l = len3(v, i) || 1
  out[oi] = v[i] / l
  out[oi + 1] = v[i + 1] / l
  out[oi + 2] = v[i + 2] / l
}

// --- Shaders ---
const VERTEX = `#version 300 es
precision highp float;
in vec3 aPosition;
in float aSize;
in float aAlpha;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform float uPointSize;
uniform float uPulse;
uniform float uHover;
uniform float uSizeBoost;
out float vAlpha;
out float vDist;

void main() {
  vec4 mvPos = uModelView * vec4(aPosition, 1.0);
  gl_Position = uProjection * mvPos;

  float depth = 1.0 / (1.0 - mvPos.z * 0.25);
  float boost = uSizeBoost * (1.0 + uPulse * 0.3 + uHover * 0.08);
  gl_PointSize = uPointSize * aSize * depth * boost;

  vAlpha = aAlpha;
  vDist = clamp(length(aPosition) / 0.6, 0.0, 1.0);
}
`

const FRAGMENT = `#version 300 es
precision highp float;
in float vAlpha;
in float vDist;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uOpacity;
uniform float uPulse;
out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;

  // dual-layer glow: hard core + soft halo
  float core = exp(-10.0 * d * d);
  float glow = exp(-2.0 * d * d) * 0.4;
  float alpha = (core + glow) * vAlpha * uOpacity;

  // color: core color → outer color based on distance
  vec3 col = mix(uColor1, uColor2, vDist);
  // center white boost (dense core feel)
  col += vec3(1.0) * core * 0.4;
  // pulse brightness
  col *= 1.0 + uPulse * 0.6;

  fragColor = vec4(col, alpha);
}
`

function makePerspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2)
  const nf = 1 / (near - far)
  const m = new Float32Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) * nf
  m[14] = 2 * far * near * nf
  m[11] = -1
  return m
}

export function NerveCloud({ state = 'idle', theme = 'dark', size = 64, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const hoverRef = useRef(0)
  const pulseRef = useRef(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const canvas = document.createElement('canvas')
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    canvas.style.display = 'block'
    container.appendChild(canvas)

    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: false, antialias: false, depth: false,
    })
    if (!gl) return

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    gl.clearColor(0, 0, 0, 0)

    const compileShader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }

    const vs = compileShader(gl.VERTEX_SHADER, VERTEX)
    const fs = compileShader(gl.FRAGMENT_SHADER, FRAGMENT)
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.useProgram(program)

    const posLoc = gl.getAttribLocation(program, 'aPosition')
    const sizeLoc = gl.getAttribLocation(program, 'aSize')
    const alphaLoc = gl.getAttribLocation(program, 'aAlpha')
    const color1Loc = gl.getUniformLocation(program, 'uColor1')!
    const color2Loc = gl.getUniformLocation(program, 'uColor2')!
    const opacityLoc = gl.getUniformLocation(program, 'uOpacity')!
    const timeLoc = gl.getUniformLocation(program, 'uTime')!
    const mvLoc = gl.getUniformLocation(program, 'uModelView')!
    const projLoc = gl.getUniformLocation(program, 'uProjection')!
    const pointSizeLoc = gl.getUniformLocation(program, 'uPointSize')!
    const pulseLoc = gl.getUniformLocation(program, 'uPulse')!
    const sizeBoostLoc = gl.getUniformLocation(program, 'uSizeBoost')!
    const hoverLoc = gl.getUniformLocation(program, 'uHover')!

    // --- Particle data ---
    const posData = new Float32Array(PARTICLE_COUNT * 3)
    const velData = new Float32Array(PARTICLE_COUNT * 3)
    const homeData = new Float32Array(PARTICLE_COUNT * 3)
    const sizeData = new Float32Array(PARTICLE_COUNT)
    const alphaData = new Float32Array(PARTICLE_COUNT)

    // 60% core (tight cluster), 40% outer (loose)
    const coreCount = Math.floor(PARTICLE_COUNT * 0.6)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = i < coreCount
        ? 0.03 + Math.random() * 0.18  // core: 0.03 ~ 0.21
        : 0.15 + Math.random() * 0.55  // outer: 0.15 ~ 0.7
      const [x, y, z] = randomOnSphere(r)
      const idx = i * 3
      homeData[idx] = x
      homeData[idx + 1] = y
      homeData[idx + 2] = z
      // start near home with small random offset
      posData[idx] = x + (Math.random() - 0.5) * 0.05
      posData[idx + 1] = y + (Math.random() - 0.5) * 0.05
      posData[idx + 2] = z + (Math.random() - 0.5) * 0.05
      velData[idx] = (Math.random() - 0.5) * 0.01
      velData[idx + 1] = (Math.random() - 0.5) * 0.01
      velData[idx + 2] = (Math.random() - 0.5) * 0.01

      // core particles bigger, outer smaller
      sizeData[i] = i < coreCount
        ? 1.4 + Math.random() * 0.8   // 1.4 ~ 2.2
        : 0.4 + Math.random() * 0.6   // 0.4 ~ 1.0

      alphaData[i] = i < coreCount
        ? 0.4 + Math.random() * 0.3   // 0.4 ~ 0.7
        : 0.15 + Math.random() * 0.25  // 0.15 ~ 0.4
    }

    // Position buffer (updated every frame)
    const posBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0)

    // Size buffer (static)
    const sizeBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf)
    gl.bufferData(gl.ARRAY_BUFFER, sizeData, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(sizeLoc)
    gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, 0, 0)

    // Alpha buffer (static)
    const alphaBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf)
    gl.bufferData(gl.ARRAY_BUFFER, alphaData, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(alphaLoc)
    gl.vertexAttribPointer(alphaLoc, 1, gl.FLOAT, false, 0, 0)

    const fov = Math.PI / 5.6
    const proj = makePerspective(fov, 1, 0.1, 10)
    const mv = new Mat4()

    const themeC = THEMES[theme] || THEMES.dark
    const curColor1 = new Float32Array(themeC.c1)
    const curColor2 = new Float32Array(themeC.c2)
    const tgtColor1 = new Float32Array(themeC.c1)
    const tgtColor2 = new Float32Array(themeC.c2)

    let curOpacity = 0.92
    let curPulse = 0
    let curSizeBoost = 1.0
    let curHover = 0
    let angle = 0
    let raf = 0
    let prevState: OrbState = stateRef.current
    const t0 = performance.now()
    const tmpNorm = new Float32Array(3)

    const loop = (t: number) => {
      const elapsed = (t - t0) * 0.001
      const dt = 0.016 // ~60fps
      const current = stateRef.current

      // state transition → burst
      if (current !== prevState) {
        if (current === 'morphing' || current === 'thinking') {
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            const idx = i * 3
            normalize3(posData, idx, tmpNorm, 0)
            velData[idx]     += tmpNorm[0] * 0.35
            velData[idx + 1] += tmpNorm[1] * 0.35
            velData[idx + 2] += tmpNorm[2] * 0.35
          }
        }
        prevState = current
      }

      // --- Physics ---
      const phys = STATE_PHYSICS[current]
      const tgtPhys = STATE_PHYSICS[current]
      // smooth-lerp physics params would be overkill; just use target directly
      const turb = phys.turbulence
      const freq = phys.freq
      const grav = phys.gravity
      const damp = 1 - phys.damping

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const idx = i * 3

        // turbulence
        const [tx, ty, tz] = turbulence(posData[idx], posData[idx + 1], posData[idx + 2], freq, elapsed)
        velData[idx]     += tx * turb
        velData[idx + 1] += ty * turb
        velData[idx + 2] += tz * turb

        // gravity toward home
        const dx = homeData[idx] - posData[idx]
        const dy = homeData[idx + 1] - posData[idx + 1]
        const dz = homeData[idx + 2] - posData[idx + 2]
        velData[idx]     += dx * grav
        velData[idx + 1] += dy * grav
        velData[idx + 2] += dz * grav

        // damping
        velData[idx]     *= damp
        velData[idx + 1] *= damp
        velData[idx + 2] *= damp

        // integrate
        posData[idx]     += velData[idx] * dt
        posData[idx + 1] += velData[idx + 1] * dt
        posData[idx + 2] += velData[idx + 2] * dt
      }

      // upload positions
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, posData)

      // --- Interact ---
      if (pulseRef.current > 0.01) {
        pulseRef.current *= 0.92
      } else {
        pulseRef.current = 0
      }
      curPulse += (pulseRef.current - curPulse) * 0.15

      const tgtBoost = curPulse > 0.01 ? 1.0 + curPulse * 0.3 : (hoverRef.current > 0.5 ? 1.1 : 1.0)
      curSizeBoost += (tgtBoost - curSizeBoost) * 0.05
      curHover += (hoverRef.current - curHover) * 0.06

      // --- Color lerp ---
      const tc = THEMES[theme] || THEMES.dark
      for (let i = 0; i < 3; i++) {
        tgtColor1[i] = tc.c1[i]
        tgtColor2[i] = tc.c2[i]
        curColor1[i] += (tgtColor1[i] - curColor1[i]) * 0.04
        curColor2[i] += (tgtColor2[i] - curColor2[i]) * 0.04
      }

      // opacity
      const OPACITY: Record<OrbState, number> = { idle: 0.92, active: 0.95, thinking: 0.98, morphing: 0.88 }
      curOpacity += (OPACITY[current] - curOpacity) * 0.06

      // rotation: base + hover boost
      const baseSpeed = current === 'idle' ? 0.25 : current === 'active' ? 0.4 : current === 'thinking' ? 0.6 : 0.8
      angle += (0.02 + curHover * 0.015) * baseSpeed

      mv.identity()
      mv.translate([0, 0, -3.8])
      mv.rotate(angle, [0, 1, 0])
      mv.rotate(angle * 0.25, [1, 0, 0])

      // --- Render ---
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)

      gl.uniformMatrix4fv(mvLoc, false, mv as Float32Array)
      gl.uniformMatrix4fv(projLoc, false, proj)
      gl.uniform3fv(color1Loc, curColor1)
      gl.uniform3fv(color2Loc, curColor2)
      gl.uniform1f(opacityLoc, curOpacity)
      gl.uniform1f(pointSizeLoc, 8 + 3.0 * baseSpeed)
      gl.uniform1f(pulseLoc, curPulse)
      gl.uniform1f(sizeBoostLoc, curSizeBoost)
      gl.uniform1f(hoverLoc, curHover)

      gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT)

      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      try { container.removeChild(canvas) } catch { /* ignore */ }
    }
  }, [size, theme])

  const handleMouseEnter = () => { hoverRef.current = 1 }
  const handleMouseLeave = () => { hoverRef.current = 0 }
  const handleClick = () => { pulseRef.current = 1.0 }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size, cursor: 'pointer' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    />
  )
}
