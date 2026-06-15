# Fluid Dots — Agent 状态指示器

## 目标

将 iOS 27 Siri Fluid Dots (siriFluidDotsCore) GLSL shader 集成为 ChatPanel 顶部的 agent 状态指示器，替换已废弃的 NerveOrb/NerveCloud。

## 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 定位 | 替换 NerveOrb | NerveOrb/NerveCloud 已是死代码 |
| 位置 | ChatPanel 顶部居中 | 用户指定 |
| 状态映射 | 时间速度 + 亮度 | 最简实现，shader 自带动画足够美 |
| 尺寸 | 可配置，默认 64px | 灵活性 + 一致性 |
| 主题支持 | 仅 dark | 暂时限制，发光效果在深色背景最佳 |
| 渲染库 | OGL | 项目已有依赖，Grainient 同模式 |

## 组件设计

### Props

```ts
interface FluidDotsProps {
  state?: 'idle' | 'active'  // 默认 'idle'
  size?: number               // 默认 64，画布为 size×size 正方形
  className?: string
}
```

### 文件

- `src/renderer/components/FluidDots.tsx` — React 组件
- 无额外依赖，复用项目已有的 `ogl` 包

### Shader

原始 GLSL 100 语法适配为 GLSL 300 es：

- `attribute vec2 aPos` → `in vec2 position`（OGL Triangle 几何体默认 attribute 名）
- `void mainImage(out vec4, in vec2)` → 直接在 `main()` 中写逻辑
- `gl_FragColor` → `out vec4 fragColor`
- 新增 uniform：
  - `uTimeSpeed: float` — 乘到 `iTime`，控制动画速率
  - `uBrightness: float` — 乘到最终颜色，控制亮度

### 渲染循环

```
useEffect(初始化):
  1. new Renderer({ webgl: 2, alpha: true, dpr: min(dpr, 2) })
  2. new Program(vertex, fragment, uniforms)
  3. new Mesh(gl, { geometry: new Triangle(gl), program })
  4. canvas.style 尺寸 = 100% of container
  5. ResizeObserver → renderer.setSize → 更新 iResolution
  6. requestAnimationFrame loop → 更新 iTime → renderer.render
  7. IntersectionObserver 离屏暂停
  8. visibilitychange 切标签页暂停
  9. cleanup: cancelAnimationFrame, disconnect observers, remove canvas
```

### 状态映射

| 状态 | uTimeSpeed | uBrightness | 视觉 |
|------|-----------|-------------|------|
| idle | 0.3 | 0.4 | 缓慢流动，柔和暗淡 |
| active | 1.0 | 1.0 | 全速 gather/burst，明亮 |

状态切换通过 lerp 平滑过渡（约 300ms），不硬切。

### 集成位置

`src/renderer/components/ChatPanel.tsx` 顶部：

```tsx
{theme === 'dark' && (
  <div className="flex justify-center py-3">
    <FluidDots state={agentState} size={64} />
  </div>
)}
```

仅在 dark 主题下渲染。`agentState` 从 chatStore 的 agent 状态逻辑获取。

### 性能

- 64×64 画布，GPU 开销极低
- 离屏/切标签页自动暂停
- 纯 GPU shader，无 CPU 侧物理计算
- 每帧仅更新 2 个 uniform（iTime, uTimeSpeed/uBrightness 通过 lerp）

## 不做的事

- 不改 shader 动画逻辑，保持原始 gather/burst 循环
- 不加交互（点击、拖拽）
- 不支持 light/aurora 主题（后续迭代）
- 不暴露 shader 参数配置 UI
