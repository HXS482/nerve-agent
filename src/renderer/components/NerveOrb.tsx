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
uniform mat4 modelMatrix;
uniform float uTime;
uniform float uMorph;
out vec3 vNormal;
out vec3 vWorldPos;
out vec3 vViewPos;
out float vFresnel;
out float vFresnelWide;

// Simplex-style noise for smooth morph
float snoise(vec3 p) {
  return sin(p.x * 1.1 + p.y * 0.7) * cos(p.y * 1.3 - p.z * 0.9) * sin(p.z * 0.8 + p.x * 1.2);
}

void main() {
  vec3 pos = position;
  vec3 n = normal;

  // Multi-layer morph distortion — organic, not mechanical
  float n1 = snoise(pos * 2.0 + uTime * 0.8) * uMorph;
  float n2 = snoise(pos * 4.0 - uTime * 1.2) * uMorph * 0.3;
  pos += n * (n1 * 0.12 + n2 * 0.04);

  // Gentle breathing — very subtle
  float breath = sin(uTime * 0.8) * 0.015 + sin(uTime * 1.6) * 0.005;
  pos *= 1.0 + breath;

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  vViewPos = mvPosition.xyz;
  vNormal = normalize((modelViewMatrix * vec4(n, 0.0)).xyz);

  vec3 viewDir = normalize(-vViewPos);
  float NdotV = max(dot(viewDir, vNormal), 0.0);

  // Sharp Fresnel for crisp rim
  vFresnel = pow(1.0 - NdotV, 3.0);
  // Wide Fresnel for soft outer glow
  vFresnelWide = pow(1.0 - NdotV, 1.2);

  gl_Position = projectionMatrix * mvPosition;
}
`

const fragment = `#version 300 es
precision highp float;
uniform float uTime;
uniform float uState;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uOpacity;
in vec3 vNormal;
in vec3 vWorldPos;
in vec3 vViewPos;
in float vFresnel;
in float vFresnelWide;
out vec4 fragColor;

// High-quality hash noise
float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f); // smoothstep

  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3D(p);
    p *= 2.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  float t = uTime;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(-vViewPos);

  // === 1. SUBSURFACE SCATTERING SIMULATION ===
  // Light wrapping around the sphere edges (translucent material)
  vec3 lightDir1 = normalize(vec3(0.6, 0.8, 0.5));
  vec3 lightDir2 = normalize(vec3(-0.4, 0.3, 0.8));
  float sss1 = pow(max(dot(V, -lightDir1 + N * 0.4), 0.0), 2.0) * 0.5;
  float sss2 = pow(max(dot(V, -lightDir2 + N * 0.3), 0.0), 2.5) * 0.3;
  vec3 sssColor = mix(uColor1, uColor2, 0.5) * (sss1 + sss2);

  // === 2. MULTI-LAYER FRESNEL ===
  // Sharp bright rim
  vec3 rimSharp = uColor1 * 1.8 * vFresnel;
  // Soft wide halo
  vec3 rimSoft = mix(uColor1, uColor2, 0.3) * vFresnelWide * 0.4;

  // === 3. BASE BODY COLOR ===
  // Subtle color gradient based on surface angle
  float bodyBlend = dot(N, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
  vec3 bodyColor = mix(uColor1 * 0.15, uColor2 * 0.2, bodyBlend);

  // === 4. INTERNAL ENERGY FLOW ===
  // Noise-based patterns moving inside the orb
  vec3 noiseCoord = vWorldPos * 2.5 + vec3(t * 0.15, t * 0.1, -t * 0.12);
  float energy = fbm(noiseCoord);
  float energyPulse = sin(t * 1.2 + energy * 6.0) * 0.5 + 0.5;
  vec3 energyColor = mix(uColor1, uColor2, energy) * energyPulse * 0.25;

  // === 5. DUAL SPECULAR HIGHLIGHTS ===
  // Key light — sharp, bright
  vec3 R1 = reflect(-lightDir1, N);
  float spec1 = pow(max(dot(R1, V), 0.0), 64.0);
  // Fill light — soft, wide
  vec3 R2 = reflect(-lightDir2, N);
  float spec2 = pow(max(dot(R2, V), 0.0), 16.0);
  vec3 specular = vec3(1.0) * spec1 * 0.7 + uColor1 * spec2 * 0.2;

  // === 6. ENVIRONMENT REFLECTION (fake) ===
  // Subtle environment-like reflection for depth
  vec3 envReflect = reflect(-V, N);
  float envNoise = fbm(envReflect * 3.0 + t * 0.05);
  vec3 envColor = mix(uColor1, uColor2, envNoise) * 0.08;

  // === 7. COMPOSE ===
  vec3 col = bodyColor + sssColor + rimSharp + rimSoft + energyColor + specular + envColor;

  // === 8. STATE EFFECTS ===
  if (uState > 1.5 && uState < 2.5) {
    // Thinking: flowing energy bands
    float band = sin(vWorldPos.y * 8.0 - t * 2.0 + fbm(vWorldPos * 3.0) * 2.0);
    band = smoothstep(0.3, 1.0, band * 0.5 + 0.5);
    col += uColor1 * band * 0.3;
    // Extra inner pulse
    float pulse = sin(t * 2.5) * 0.5 + 0.5;
    col += uColor2 * pulse * vFresnel * 0.15;
  }
  if (uState > 2.5) {
    // Morphing: chaotic energy, faster internal movement
    float chaos = fbm(vWorldPos * 4.0 + t * 0.8);
    col += uColor1 * chaos * 0.3;
    // Prismatic edge shift
    float prism = sin(vWorldPos.y * 15.0 + t * 5.0) * 0.5 + 0.5;
    col = mix(col, uColor2 * 1.5, prism * vFresnel * 0.3);
  }

  // === 9. TONE MAPPING (soft HDR) ===
  // Prevent harsh clamping, keep glow natural
  col = col / (col + 0.5); // Reinhard-like
  col = pow(col, vec3(0.9)); // Slight gamma lift

  // Final opacity: base + rim boost
  float alpha = uOpacity + vFresnelWide * 0.15;
  alpha = clamp(alpha, 0.0, 1.0);

  fragColor = vec4(col, alpha);
}
`

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
  idle: 0.25,
  active: 0.5,
  thinking: 0.9,
  morphing: 2.0,
}

const STATE_MORPH: Record<OrbState, number> = {
  idle: 0,
  active: 0.05,
  thinking: 0.15,
  morphing: 1.0,
}

const STATE_OPACITY: Record<OrbState, number> = {
  idle: 0.92,
  active: 0.95,
  thinking: 0.98,
  morphing: 0.88,
}

const ctxMap = new WeakMap<HTMLElement, { renderer: any; program: any; mesh: any; camera: any; scene: any }>()

export function NerveOrb({ state = 'idle', theme = 'dark', size = 56, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const getThemeColors = useCallback(() => {
    const t = THEMES[theme] || THEMES.dark
    return { c1: hexToFloat(t.c1), c2: hexToFloat(t.c2) }
  }, [theme])

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

    // Slightly closer FOV for more presence
    const camera = new Camera(gl, { fov: 32 })
    camera.position.set(0, 0, 3.5)

    const scene = new Transform()

    // High subdivision for smooth sphere
    const geometry = new Sphere(gl, { widthSegments: 64, heightSegments: 64 })

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
        uOpacity: { value: 0.92 },
      },
    })

    const mesh = new Mesh(gl, { geometry, program })
    mesh.setParent(scene)

    ctxMap.set(container, { renderer, program, mesh, camera, scene })

    let raf = 0
    const t0 = performance.now()
    let curSpeed = STATE_SPEEDS[stateRef.current]
    let curMorph = STATE_MORPH[stateRef.current]
    let curOpacity = STATE_OPACITY[stateRef.current]

    const loop = (t: number) => {
      const elapsed = (t - t0) * 0.001

      // Smooth lerp for buttery state transitions
      const tgtSpeed = STATE_SPEEDS[stateRef.current]
      const tgtMorph = STATE_MORPH[stateRef.current]
      const tgtOpacity = STATE_OPACITY[stateRef.current]
      curSpeed += (tgtSpeed - curSpeed) * 0.04
      curMorph += (tgtMorph - curMorph) * 0.04
      curOpacity += (tgtOpacity - curOpacity) * 0.06

      program.uniforms.uTime.value = elapsed * curSpeed
      program.uniforms.uMorph.value = curMorph
      program.uniforms.uOpacity.value = curOpacity

      const stateMap: Record<OrbState, number> = { idle: 0, active: 1, thinking: 2, morphing: 3 }
      program.uniforms.uState.value = stateMap[stateRef.current]

      // Slow, elegant rotation
      mesh.rotation.y += 0.003 * curSpeed
      mesh.rotation.x += 0.001 * curSpeed

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
