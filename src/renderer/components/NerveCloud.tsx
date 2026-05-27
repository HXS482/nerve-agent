import { useEffect, useRef } from 'react'
import { Mat4 } from 'ogl'

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

const PARTICLE_COUNT = 300

const hexToFloat = (hex: string): [number, number, number] => {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!r) return [1, 1, 1]
  return [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255]
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

function createProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram()!
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.useProgram(program)
  return program
}

function fibonacciSphere(count: number, radius: number): Float32Array {
  const data = new Float32Array(count * 3)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2
    const r = Math.sqrt(1 - y * y) * radius
    const theta = goldenAngle * i
    data[i * 3] = Math.cos(theta) * r
    data[i * 3 + 1] = y * radius
    data[i * 3 + 2] = Math.sin(theta) * r
  }
  return data
}

const VERTEX = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform float uTime;
uniform float uPointSize;
out float vAlpha;

void main() {
  vec3 pos = aPosition;

  float breathe = sin(uTime * 0.5 + aPosition.y * 2.0) * 0.008;
  pos += normalize(aPosition) * breathe;

  vec4 mvPos = uModelView * vec4(pos, 1.0);
  gl_Position = uProjection * mvPos;

  float eqFactor = 1.0 - 0.15 * abs(aPosition.y);
  gl_PointSize = uPointSize * eqFactor / (1.0 - mvPos.z * 0.3);

  vAlpha = 1.0 - 0.3 * abs(aPosition.y);
}
`

const FRAGMENT = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - 0.5;
  float d = length(coord);
  if (d > 0.5) discard;

  float alpha = 1.0 - pow(d * 2.0, 2.5);
  alpha *= vAlpha * uOpacity;

  float centerBoost = 1.0 + 0.4 * (1.0 - d * 2.0);
  vec3 col = uColor * centerBoost;

  float glow = (1.0 - d * 2.0) * 0.15;
  col += uColor * glow;

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

const ctxMap = new WeakMap<HTMLElement, {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  colorLoc: WebGLUniformLocation
  opacityLoc: WebGLUniformLocation
  timeLoc: WebGLUniformLocation
  mvLoc: WebGLUniformLocation
  projLoc: WebGLUniformLocation
  pointSizeLoc: WebGLUniformLocation
}>()

export function NerveCloud({ state = 'idle', theme = 'dark', size = 64, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

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
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
    })
    if (!gl) return

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)

    // ---- shaders ----
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT)
    const program = createProgram(gl, vs, fs)

    const posLoc = gl.getAttribLocation(program, 'aPosition')
    const colorLoc = gl.getUniformLocation(program, 'uColor')!
    const opacityLoc = gl.getUniformLocation(program, 'uOpacity')!
    const timeLoc = gl.getUniformLocation(program, 'uTime')!
    const mvLoc = gl.getUniformLocation(program, 'uModelView')!
    const projLoc = gl.getUniformLocation(program, 'uProjection')!
    const pointSizeLoc = gl.getUniformLocation(program, 'uPointSize')!

    // ---- geometry ----
    const positions = fibonacciSphere(PARTICLE_COUNT, 0.5)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0)

    // ---- matrices ----
    const fov = Math.PI / 5.6
    const proj = makePerspective(fov, 1, 0.1, 10)
    const mv = new Mat4()

    ctxMap.set(container, {
      gl, program,
      colorLoc, opacityLoc, timeLoc,
      mvLoc, projLoc, pointSizeLoc,
    })

    // ---- color state ----
    const idle = hexToFloat(THEME_COLORS[theme] || THEME_COLORS.dark)
    const idleArr = new Float32Array(idle)
    const curColor = new Float32Array(idleArr)
    const tgtColor = new Float32Array(idleArr)

    let curOpacity = 0.92
    let curSpeed = 0.25
    let angle = 0
    let raf = 0
    const t0 = performance.now()

    const loop = (t: number) => {
      const elapsed = (t - t0) * 0.001

      const current = stateRef.current
      const raw = STATE_COLORS[current]
      const tgt = hexToFloat(current === 'idle' ? (THEME_COLORS[theme] || THEME_COLORS.dark) : raw)
      for (let i = 0; i < 3; i++) tgtColor[i] = tgt[i]

      const SPEED_MAP: Record<OrbState, number> = { idle: 0.25, active: 0.5, thinking: 0.9, morphing: 2.0 }
      const OPACITY_MAP: Record<OrbState, number> = { idle: 0.92, active: 0.95, thinking: 0.98, morphing: 0.88 }

      const tgtSpeed = SPEED_MAP[current]
      const tgtOpacity = OPACITY_MAP[current]
      curSpeed += (tgtSpeed - curSpeed) * 0.04
      curOpacity += (tgtOpacity - curOpacity) * 0.06

      for (let i = 0; i < 3; i++) {
        curColor[i] += (tgtColor[i] - curColor[i]) * 0.04
      }

      angle += 0.008 * curSpeed

      mv.identity()
      mv.translate([0, 0, -4])
      mv.rotate(angle, [0, 1, 0])
      mv.rotate(angle * 0.3, [1, 0, 0])

      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.useProgram(program)

      gl.uniformMatrix4fv(mvLoc, false, mv as Float32Array)
      gl.uniformMatrix4fv(projLoc, false, proj)
      gl.uniform1f(timeLoc, elapsed * curSpeed)
      gl.uniform3fv(colorLoc, curColor)
      gl.uniform1f(opacityLoc, curOpacity)
      gl.uniform1f(pointSizeLoc, 6 + 3 * curSpeed)

      gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT)

      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ctxMap.delete(container)
      try { container.removeChild(canvas) } catch { /* ignore */ }
    }
  }, [size, theme])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size }}
    />
  )
}
