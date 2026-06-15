# Fluid Dots — Agent 状态指示器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Siri Fluid Dots GLSL shader 集成为 ChatPanel 顶部的 agent 状态指示器，替换已废弃的 NerveOrb/NerveCloud。

**Architecture:** 新建 `FluidDots.tsx` 组件，用 OGL 封装 WebGL 渲染（同 Grainient.jsx 模式）。复用 chatStore 中已有的 `orbState` 状态机（idle/active/thinking/morphing），通过 lerp 控制 shader 的时间速度和亮度 uniform。仅在 dark 主题下渲染。

**Tech Stack:** React 19, OGL (WebGL2), GLSL 300 es, Zustand, Tailwind CSS

---

## 文件清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/renderer/components/FluidDots.tsx` | 新建 | WebGL 渲染组件，封装 Fluid Dots shader |
| `src/renderer/components/ChatPanel.tsx` | 修改 | 顶部居中挂载 FluidDots |
| `src/renderer/components/NerveOrb.tsx` | 删除 | 废弃，无引用 |
| `src/renderer/components/NerveCloud.tsx` | 删除 | 废弃，无引用 |

---

### Task 1: 创建 FluidDots 组件

**Files:**
- Create: `src/renderer/components/FluidDots.tsx`

- [ ] **Step 1: 创建 FluidDots.tsx**

完整组件代码，shader 内联。核心逻辑：
- OGL Renderer + Program + Mesh(Triangle)
- GLSL 300 es shader（从原始 GLSL 100 转换）
- `uTimeSpeed` / `uBrightness` uniform 控制状态
- lerp 平滑过渡（~300ms）
- IntersectionObserver + visibilitychange 离屏暂停
- ResizeObserver 响应容器尺寸

```tsx
import { useEffect, useRef } from 'react'
import { Renderer, Program, Mesh, Triangle } from 'ogl'

type DotsState = 'idle' | 'active' | 'thinking' | 'morphing'

interface FluidDotsProps {
  state?: DotsState
  size?: number
  className?: string
}

// --- GLSL 300 es (converted from siriFluidDotsCore) ---
const vert = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

const frag = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uBrightness;
out vec4 fragColor;

const float TAU = 6.28318530718;
const int N = 6;
const float SMOOTH_K = 0.08;
const float INTENSITY = 0.0025;
const float FALLOFF_P = 1.35;
const float FADE_START = 0.02;
const float FADE_END = 0.56;
const float ABERR = 0.005;
const vec3 SPECTRAL = vec3(0.0, 0.5, 1.0) * ABERR;
const float HUE_SPEED = 0.06;
const float COLOR_K = 0.5;
const float SAT = 0.01;
const float HUE_SPAN = 0.667;
const float MERGE_PERIOD = 6.0;
const float T_MOVE = 1.25;
const float STAGGER = 0.33;
const float HOLD = 0.0;
const float W = 4.6;
const float L = 3.2;
const float PIERCE = 0.12;
const float RECOIL = 0.035;
const float REC_LAG = 0.11;
const float GATHER_PERIOD = 12.0;
const float GATHER_START = 9.2;
const float GATHER_HOLD = 0.8;
const float GATHER_R = 0.008;
const float GATHER_DIM = 0.85;
const float GATHER_IN = 1.8;
const float GATHER_IN_L = 7.5;
const float BURST_W = 6.5;
const float BURST_L = 4.0;
const float CHARGE_T = 0.30;
const float CHARGE_SHRK = 0.18;
const float CHARGE_GLOW = 0.35;
const float FLASH_GAIN = 1.2;
const float FLASH_DECAY = 7.0;

float hash11(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }

float settleWL(float tau, float w, float l) {
  if (tau <= 0.0) return 0.0;
  return 1.0 - exp(-l * tau) * cos(w * tau);
}
float settle(float tau) { return settleWL(tau, W, L); }

float settleCrit(float tau, float l) {
  if (tau <= 0.0) return 0.0;
  return 1.0 - exp(-l * tau) * (1.0 + l * tau);
}

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

vec3 hue2rgb(float h) {
  h = fract(h);
  float r = clamp(abs(h * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  float g = clamp(2.0 - abs(h * 6.0 - 2.0), 0.0, 1.0);
  float b = clamp(2.0 - abs(h * 6.0 - 4.0), 0.0, 1.0);
  return vec3(r, g, b);
}

float dotR(float fi, float seed, float t) {
  return 0.036 + 0.010 * sin(t * 1.3 + seed * TAU) + 0.005 * sin(t * 2.4 + fi * 1.3);
}

float dotSD(vec2 p, vec2 pos, float r, float t, float fi, float shapeDamp) {
  vec2 d = p - pos;
  float sq = 0.075 * (0.5 + 0.5 * sin(t * 0.9 + fi * 2.0)) * shapeDamp;
  float ca = cos(t * 0.35 + fi), sa = sin(t * 0.35 + fi);
  d = mat2(ca, -sa, sa, ca) * d;
  d *= vec2(1.0 + sq, 1.0 - sq);
  return length(d) - r;
}

vec3 scene(vec2 p, float t) {
  float k = floor(t / MERGE_PERIOD);
  float u = fract(t / MERGE_PERIOD);
  float te = u * MERGE_PERIOD;
  float tg = mod(t, GATHER_PERIOD);
  float g = settleCrit((tg - GATHER_START) * GATHER_IN, GATHER_IN_L)
          - settleWL(tg - GATHER_START - GATHER_HOLD, BURST_W, BURST_L);
  float gC = clamp(g, 0.0, 1.0);
  float tb = tg - (GATHER_START + GATHER_HOLD);
  float charge = smoothstep(-CHARGE_T, 0.0, min(tb, 0.0)) * gC;
  float flash = tb > 0.0 ? exp(-tb * FLASH_DECAY) : 0.0;
  float gBright = mix(1.0, GATHER_DIM, gC) * (1.0 + CHARGE_GLOW * charge + FLASH_GAIN * flash);
  vec3 total3 = vec3(1e5);
  vec3 cAcc = vec3(0.0);
  float wAcc = 1e-6;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float seed = hash11(fi);
    float ang = fi / float(N) * TAU + t * 0.35;
    vec2 dir = vec2(cos(ang), sin(ang));
    float R = 0.17 + 0.010 * sin(t * 1.0) + 0.007 * sin(t * 1.3 + seed * TAU);
    float pairId = mod(fi, 3.0);
    float moverLow = mod(k + pairId, 2.0);
    float isMover = (fi < 2.5) ? step(moverLow, 0.5) : step(0.5, moverLow);
    float goStart = pairId * STAGGER;
    float retStart = 3.0 * STAGGER + HOLD + pairId * STAGGER;
    float m = (settle(te - goStart) - settle(te - retStart)) * isMover;
    float rec = (settle(te - goStart - REC_LAG) - settle(te - retStart - REC_LAG)) * (1.0 - isMover);
    float rSelf = dotR(fi, seed, t);
    rSelf = mix(rSelf, 0.036, gC);
    rSelf *= 1.0 - CHARGE_SHRK * charge;
    float fj = mod(fi + 3.0, 6.0);
    float rPart = dotR(fj, hash11(fj), t);
    float deep = -(R + RECOIL) - PIERCE * rPart;
    float radial = mix(R, deep, m) + RECOIL * rec;
    radial = mix(radial, GATHER_R, g);
    vec2 pos = radial * dir;
    float sdR = dotSD(p - SPECTRAL.r * dir, pos, rSelf, t, fi, 1.0 - gC);
    float sdG = dotSD(p - SPECTRAL.g * dir, pos, rSelf, t, fi, 1.0 - gC);
    float sdB = dotSD(p - SPECTRAL.b * dir, pos, rSelf, t, fi, 1.0 - gC);
    total3 = vec3(smin(total3.r, sdR, SMOOTH_K),
                  smin(total3.g, sdG, SMOOTH_K),
                  smin(total3.b, sdB, SMOOTH_K));
    float hue = fract(fi / float(N) + t * HUE_SPEED) * HUE_SPAN;
    vec3 dotCol = mix(vec3(1.0), hue2rgb(hue), SAT);
    float w = exp(-sdG * COLOR_K);
    cAcc += w * dotCol;
    wAcc += w;
  }
  vec3 sd3 = max(total3, vec3(0.0)) + 1e-4;
  vec3 core3 = clamp(INTENSITY / pow(sd3, vec3(FALLOFF_P)), 0.0, 1.0);
  vec3 edge3 = 1.0 - smoothstep(vec3(FADE_START), vec3(FADE_END), sd3);
  vec3 bright = core3 * edge3 * gBright;
  return bright * (cAcc / wAcc);
}

void main() {
  vec2 res = iResolution.xy;
  vec2 p = (2.0 * gl_FragCoord.xy - res) / min(res.x, res.y);
  float t = iTime * uTimeSpeed;
  p /= 1.0 + 0.03 * sin(t * 1.0);
  vec3 col = scene(p, t);
  col *= 1.0 + 0.05 * sin(t * 1.0 + 1.0);
  col *= uBrightness;
  col = pow(col, vec3(1.0 / 1.2));
  col = min(col, 1.0);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
`

// State → target uniforms
const STATE_MAP: Record<DotsState, { speed: number; brightness: number }> = {
  idle:     { speed: 0.3, brightness: 0.4 },
  active:   { speed: 1.0, brightness: 1.0 },
  thinking: { speed: 0.8, brightness: 0.9 },
  morphing: { speed: 1.0, brightness: 1.0 },
}

const LERP_RATE = 3.0 // higher = faster transition (~300ms to 95%)

export function FluidDots({ state = 'idle', size = 64, className = '' }: FluidDotsProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new Renderer({
      webgl: 2,
      alpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    })
    const gl = renderer.gl
    const canvas = gl.canvas as HTMLCanvasElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)

    const geometry = new Triangle(gl)
    const program = new Program(gl, {
      vertex: vert,
      fragment: frag,
      uniforms: {
        iResolution: { value: new Float32Array([1, 1]) },
        iTime: { value: 0 },
        uTimeSpeed: { value: STATE_MAP.idle.speed },
        uBrightness: { value: STATE_MAP.idle.brightness },
      },
    })
    const mesh = new Mesh(gl, { geometry, program })

    const setSize = () => {
      const rect = container.getBoundingClientRect()
      const w = Math.max(1, Math.floor(rect.width))
      const h = Math.max(1, Math.floor(rect.height))
      renderer.setSize(w, h)
      const res = program.uniforms.iResolution.value
      res[0] = gl.drawingBufferWidth
      res[1] = gl.drawingBufferHeight
    }
    const ro = new ResizeObserver(setSize)
    ro.observe(container)
    setSize()

    // Lerp state
    let targetSpeed = STATE_MAP.idle.speed
    let targetBright = STATE_MAP.idle.brightness
    let curSpeed = targetSpeed
    let curBright = targetBright

    // Expose setter for state sync
    const setTarget = (s: DotsState) => {
      targetSpeed = STATE_MAP[s].speed
      targetBright = STATE_MAP[s].brightness
    }
    // Store on container for external access
    ;(container as any).__fluidDotsSetTarget = setTarget

    let raf = 0
    let isVisible = true
    let isPageVisible = !document.hidden
    const t0 = performance.now()

    const loop = (t: number) => {
      const dt = 0.016 // ~60fps frame
      curSpeed += (targetSpeed - curSpeed) * Math.min(1, LERP_RATE * dt)
      curBright += (targetBright - curBright) * Math.min(1, LERP_RATE * dt)

      program.uniforms.iTime.value = (t - t0) * 0.001
      program.uniforms.uTimeSpeed.value = curSpeed
      program.uniforms.uBrightness.value = curBright
      renderer.render({ scene: mesh })
      raf = requestAnimationFrame(loop)
    }

    const tryStart = () => {
      if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop)
    }
    const tryStop = () => {
      if (raf !== 0) { cancelAnimationFrame(raf); raf = 0 }
    }

    const io = new IntersectionObserver(
      ([entry]) => { isVisible = entry.isIntersecting; isVisible ? tryStart() : tryStop() },
      { threshold: 0 }
    )
    io.observe(container)

    const onVisibility = () => {
      isPageVisible = !document.hidden
      isPageVisible ? tryStart() : tryStop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    tryStart()

    return () => {
      tryStop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      try { container.removeChild(canvas) } catch {}
    }
  }, [])

  // Sync state prop → shader target
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const setTarget = (container as any).__fluidDotsSetTarget
    if (setTarget) setTarget(state)
  }, [state])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden' }}
    />
  )
}
```

- [ ] **Step 2: 验证编译**

在项目根目录运行 dev server，确认无 TypeScript / import 错误：

```bash
cd G:\worktree\nerve-agent
npm run dev
```

Expected: 无编译错误，组件已创建但未挂载。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/FluidDots.tsx
git commit -m "feat: add FluidDots WebGL component with siriFluidDotsCore shader"
```

---

### Task 2: 集成到 ChatPanel

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`

- [ ] **Step 1: 在 ChatPanel 中引入 FluidDots**

在 ChatPanel.tsx 顶部添加 import：

```tsx
import { FluidDots } from './FluidDots'
```

在 `ChatPanel` 组件函数内，从 store 读取 `orbState` 和 `theme`：

```tsx
const orbState = useChatStore((s) => s.orbState)
const theme = useChatStore((s) => s.theme)
```

- [ ] **Step 2: 在消息列表顶部放置 FluidDots**

在 ChatPanel 的消息滚动区域的**最顶部**（`filteredMessages.map` 之前），添加：

```tsx
{theme === 'dark' && (
  <div className="flex justify-center py-3">
    <FluidDots state={orbState} size={64} />
  </div>
)}
```

具体位置：在 `<div className="flex-1 overflow-y-auto ...">` 内部，消息列表之前。

- [ ] **Step 3: 验证效果**

运行 dev server，切换到 dark 主题：
- 空闲时：Fluid Dots 缓慢流动、亮度柔和
- 发送消息后：Fluid Dots 加速、变亮（thinking 状态）
- 10s 后：切换到 morphing 状态（全速）
- 响应完成后：回到 idle（减速、变暗）

```bash
npm run dev
```

Expected: ChatPanel 顶部居中显示 64×64 的 Fluid Dots 动画，状态随 agent 活动切换。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx
git commit -m "feat: integrate FluidDots as agent state indicator in ChatPanel"
```

---

### Task 3: 清理废弃代码

**Files:**
- Delete: `src/renderer/components/NerveOrb.tsx`
- Delete: `src/renderer/components/NerveCloud.tsx`

- [ ] **Step 1: 确认无引用**

验证 NerveOrb / NerveCloud 没有被任何文件 import：

```bash
cd G:\worktree\nerve-agent
grep -r "NerveOrb\|NerveCloud" src/renderer --include="*.tsx" --include="*.ts" -l
```

Expected: 只有 NerveOrb.tsx 和 NerveCloud.tsx 自身出现。

- [ ] **Step 2: 删除文件**

```bash
rm src/renderer/components/NerveOrb.tsx
rm src/renderer/components/NerveCloud.tsx
```

- [ ] **Step 3: 验证构建**

```bash
npm run build
```

Expected: 构建成功，无错误。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove unused NerveOrb and NerveCloud components"
```
