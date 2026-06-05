# GatewayView 重设计方案

**日期**: 2026-06-05
**风格**: Vercel Dashboard — 极简卡片、内联 sparkline、高信息密度、克制排版
**范围**: RightSidebar 内 GatewayView 组件完整重写

---

## 目标

当前 GatewayView 使用硬编码 hex 色值，脱离 app 的 CSS 变量体系，视觉质感低。重设计目标：

1. 接入 `--bg-surface-container`、`--text-on-surface` 等 CSS 变量，支持 dark/light/aurora 三主题
2. 引入 sparkline 数据可视化（连接数、会话数、内存趋势）
3. 提升整体视觉质感至 Vercel/Grafana 仪表盘水平
4. 保持现有 IPC 数据流和后端接口不变

---

## 组件拆分

将 421 行单文件拆为 5 个子组件：

```
GatewayView.tsx          ← 容器，管 IPC 数据和状态
├── StatusHeader.tsx     ← 状态点 + 运行时长 + 状态 badge
├── MetricCards.tsx      ← 3 格 sparkline 指标卡
├── ControlButtons.tsx   ← Start / Stop 双按钮
├── AdapterList.tsx      ← 适配器列表
└── LogTerminal.tsx      ← 实时日志终端
```

数据流：IPC → `useState` → 各子组件，不引入新的状态管理（不加 Zustand store）。

---

## StatusHeader

- 左侧：8px 状态圆点（绿/黄/红），`box-shadow` 柔光
- 中间："Gateway" 标题（`--fs-sm`，font-weight 600）
- 右侧：运行时长（`--text-on-surface-variant`）+ 状态 badge（pill 形，`--accent-primary-container` 背景，`--accent-on-primary` 文字）
- 整行高度 32px，底部 1px `--border-subtle` 分割

---

## MetricCards

3 列等宽 grid（`grid-template-columns: 1fr 1fr 1fr`），gap 6px。

每张卡片结构（`--bg-surface-container-low` 背景，`--border-subtle` 1px 边框，`--radius-md` 圆角）：

| 层 | 内容 | 样式 |
|---|------|------|
| 标签 | "CONNECTIONS" / "SESSIONS" / "MEMORY" | 9px，大写，`--text-outline-variant` |
| 数值 | 当前值 + 单位 | 18px，font-weight 600，`--text-on-surface` |
| 变化指示 | `↑ +3` 或 `↓ -2` | 9px，正向 `--accent-primary`，负向 `--error`，无变化不显示 |
| Sparkline | 最近 20 个数据点 | SVG 16px 高，polyline，stroke `--accent-primary`，stroke-width 1.5 |

**Sparkline 实现**：
- SVG viewBox `0 0 60 16`
- `useRef<number[]>` 环形缓冲区，每次 health 更新推入新值
- 数据归一化到 0-16 y 轴，`stroke-linecap="round"`
- 无数据时显示平直线（`--text-outline-variant`，opacity 0.3）

**数值变化动效**（Motion）：数字 scale 1.0→1.05→1.0，150ms ease-out。

---

## ControlButtons

两按钮等宽（`1fr 1fr`），gap 6px，高度 32px，`--radius-md` 圆角。左侧各一个 12px lucide 图标（`Play` / `Square`），图标与文字间距 4px。

**Start 按钮**：

| 状态 | 背景 | 文字 | 其他 |
|------|------|------|------|
| 默认 | `--accent-primary` | `--accent-on-primary` | font-weight 600, 11px |
| Hover | 同上 | 同上 | `box-shadow: 0 0 12px rgba(accent-primary, 0.2)` |
| Disabled | `--bg-surface-container` | `--text-outline` | cursor not-allowed |
| Loading | 同默认 | spinner 替换文字 | 14px spinner 动画 |

**Stop 按钮**：

| 状态 | 背景 | 文字 | 边框 |
|------|------|------|------|
| 默认 | `--bg-surface-container` | `--text-on-surface-variant` | `--border-subtle` |
| Hover | 同上 | `--error` | `--error` |
| Disabled | 同上 | `--text-outline` | `--border-subtle` |
| Loading | 同默认 | spinner 替换文字 | `--border-subtle` |

**状态联动**：
- 未运行 → Start 可点，Stop disabled
- 运行中 → Start disabled，Stop 可点
- 切换中 → 两按钮都 disabled + loading

---

## AdapterList

**容器**：`--bg-surface-container-low` 背景卡片，padding 8px，`--radius-md` 圆角。

**每行适配器**（高度 36px）：

| 位置 | 内容 | 样式 |
|------|------|------|
| 左侧 | 平台色圆点 6px | 从 `PLATFORM_BADGE` 映射（Telegram 蓝、Discord 紫等） |
| 中间 | 平台名 | 12px，`--text-on-surface`，font-weight 500 |
| 右侧状态 | pill badge | 已连接：`rgba(accent-primary, 0.1)` 背景 + `--accent-primary` 文字，显示 "Connected" 或延迟 "42ms"；未连接：`--text-outline-variant`，"OFF" |
| 最右侧 | toggle 开关 | 8px 高 iOS 风格滑块，ON `--accent-primary`，OFF `--bg-surface-variant` |

- Hover 整行背景变 `--bg-surface-container`，cursor pointer
- Toggle 切换 spring 动画 200ms
- 无适配器时居中显示 "No adapters configured"（`--text-outline`，11px）
- 行间无分割线，靠背景色差异区分

---

## LogTerminal

**容器**：`--bg-background` 纯黑背景，`--border-subtle` 1px 边框，`--radius-md` 圆角，padding 8px。

**顶部过滤栏**（高度 24px）：
- 左侧：4 个 pill tab（All / Info / Warn / Error），选中态 `--accent-primary` 文字 + 底部 2px 指示条，未选中 `--text-outline`
- 右侧：auto-scroll toggle + 清空按钮（`Trash2` 图标 12px）

**日志行**：
- 等宽字体 `--font-mono`，10px，行高 18px
- 格式：`[HH:MM:SS] LEVEL message`
- 时间戳 `--text-outline-variant`，Level 着色（INFO `--accent-primary`、WARN `#FBBC05`、ERROR `--error`），Message `--text-on-surface-variant`
- Error 行：左侧 2px `--error` 色条 + 背景 `rgba(error, 0.04)`

**滚动区**：`flex-1 overflow-y-auto`，auto-scroll 开启时新行自动到底。

**新行入场动效**：`translateY(4px)` + `opacity(0→1)`，100ms。

**底部状态栏**（高度 20px）：
- 左侧：日志计数 "247 entries"
- 右侧：队列状态（积压时 "12 queued" + 黄色圆点）
- 字号 9px，`--text-outline-variant`

---

## 微交互总览（Motion）

| 元素 | 动效 | 参数 |
|------|------|------|
| 数值变化 | scale 跳动 | 1.0→1.05→1.0, 150ms ease-out |
| Adapter toggle | 滑块 spring | 200ms |
| Status badge 切换 | opacity fade | 200ms |
| 日志新行 | translateY + opacity | 100ms |
| 按钮点击 | scale press | 0.97, 100ms |

---

## 不做的事

- 不加网络拓扑图、饼图、柱状图——侧边栏空间有限
- 不加 tooltip——hover 信息已在 badge 显示
- 不做日志搜索——保持简单
- 不引入 Zustand store——IPC 状态足够
- 不改后端 IPC 接口

---

## 依赖

- 现有：React 19、Tailwind v4、Motion、lucide-react
- 无需新增依赖

---

## 文件变更

| 文件 | 操作 |
|------|------|
| `src/renderer/components/GatewayView.tsx` | 重写为容器组件 |
| `src/renderer/components/gateway/StatusHeader.tsx` | 新建 |
| `src/renderer/components/gateway/MetricCards.tsx` | 新建 |
| `src/renderer/components/gateway/ControlButtons.tsx` | 新建 |
| `src/renderer/components/gateway/AdapterList.tsx` | 新建 |
| `src/renderer/components/gateway/LogTerminal.tsx` | 新建 |

---

## 测试

- 手动验证：dark / light / aurora 三主题下视觉正确
- 功能验证：Start/Stop 状态切换、适配器 toggle、日志过滤和自动滚动
- 边界：无适配器、无日志、无 health 数据时的空态显示
