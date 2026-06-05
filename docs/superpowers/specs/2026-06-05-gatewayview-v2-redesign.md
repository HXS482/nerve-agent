# GatewayView V2 重设计方案

**日期**: 2026-06-05
**风格**: 环形 Gauge + 渐变光晕仪表盘，一比一还原 mockup
**范围**: RightSidebar 内 GatewayView 组件全面重写（在 V1 分支基础上迭代）

---

## 目标

V1 实现"太素太平"，缺少仪表盘的厚度和氛围。V2 要求：
1. 一比一还原 mockup A 的视觉效果
2. 主指标用圆环 gauge 展示，取代简单的数字卡片
3. 顶部渐变光晕营造深度感
4. 紧凑布局适配侧边栏有限空间

---

## 整体布局 + 背景氛围

- 容器：`#0D0D0D` 纯黑底，`position: relative`
- 顶部光晕：`radial-gradient(ellipse, rgba(77,142,255,0.08) 0%, transparent 70%)`，尺寸 200×120px，`position: absolute; top: -40px; left: 50%; transform: translateX(-50%); pointer-events: none`
- 整体 padding 14px，各区块自行控制间距

---

## Hero Gauge + 状态区

左侧圆环 Gauge（56×56px SVG）+ 右侧信息区，flex 排列，gap 12px，margin-bottom 16px。

**圆环 Gauge**：
- 底环：`rgba(255,255,255,0.04)`，stroke-width 4
- 值环：`linearGradient` 从 `#adc6ff` 到 `#4d8eff`，stroke-width 4
- `stroke-dasharray="120 51"`，`stroke-linecap="round"`，`rotate(-90 28 28)`
- 中心数值：14px，font-weight 700，白色
- 下方标签："连接"，7px，`#8B949E`

**右侧信息区**（flex:1）：
- 第一行："Gateway" 14px font-weight 700 + 绿色 pill badge "LIVE"
  - Badge：`rgba(52,168,83,0.12)` 底，`#34A853` 文字，8px，border-radius 10px，font-weight 600
- 第二行："UP 2h 14m · 48 sessions"，10px，`#8B949E`
- 第三行：sparkline SVG（100×12px）
  - `#4d8eff` 描边 stroke-width 1.5，stroke-linecap round
  - 渐变填充区域：`linearGradient` 顶部 `rgba(77,142,255,0.2)` → 底部 `rgba(77,142,255,0)`

---

## 指标条

三列等宽横排，gap 1px，border-radius 6px，overflow hidden（共享边框感）。margin-bottom 14px。

每格：`rgba(255,255,255,0.03)` 背景，padding 8px 10px，text-align center。
- 标签：8px，大写，`#8B949E`，letter-spacing 0.5px
- 数值：16px，font-weight 700，白色
- 内存单位 "MB" 用 9px `#8B949E`
- 错误数为 0 时显示 `#34A853`

三个指标：会话 / 内存 / 错误。

---

## 控制按钮

两按钮 flex 排列，gap 6px，margin-bottom 14px。

**Start 按钮**（flex:1）：
- 背景 `linear-gradient(135deg, #34A853 0%, #2d9348 100%)`
- `box-shadow: 0 2px 12px rgba(52,168,83,0.2), inset 0 1px 0 rgba(255,255,255,0.15)`
- 文字黑色，11px，font-weight 700，letter-spacing 0.5px，"▶ START"
- border-radius 8px，padding 7px

**Stop 按钮**（固定宽 44px）：
- 背景 `rgba(255,255,255,0.04)`，border `1px solid rgba(255,255,255,0.06)`
- 文字 `#8B949E`，11px，"■"
- border-radius 8px，padding 7px

---

## 适配器列表

外层容器：`rgba(255,255,255,0.02)` 背景，`1px solid rgba(255,255,255,0.04)` 边框，border-radius 8px，overflow hidden。margin-bottom 12px。

标题在容器外："适配器"，8px，`#8B949E`，大写，letter-spacing 0.8px，margin-bottom 6px。

每行（padding 8px 10px）：
- 行间分割：`1px solid rgba(255,255,255,0.03)`
- 6px 圆点：平台品牌色 + box-shadow 柔光（已连接时）
- 平台名 11px font-weight 500，未连接时 `#8B949E`
- 已连接：`#34A853` monospace "42ms"；未连接：`#484F58` "OFF"
- Toggle：28×14px 圆角胶囊，ON `#4d8eff` + 白色圆点右，OFF `rgba(255,255,255,0.06)` + 灰色圆点左

---

## 日志终端

容器：`#08090B` 背景，`1px solid rgba(255,255,255,0.04)` 边框，border-radius 8px，padding 6px 8px。

日志行：等宽字体 9px，line-height 1.6。
- 时间戳 `#484F58` 格式 `HH:MM:SS`
- Level：SYS `#4d8eff`，OK `#34A853`，WARN `#FBBC05`，ERR `#EA4335`
- Message `#C9D1D9`

固定 48px 高，overflow hidden（只显示最新几行，不做滚动）。

去掉 level 过滤 tab、底部状态栏、清空按钮。完整日志后续可加展开按钮。

---

## 与 V1 的关系

在 `feat/gatewayview-redesign` 分支上继续迭代。V1 的组件拆分结构保留（gateway/ 子目录），但 UI 代码全部重写匹配 mockup。容器 GatewayView.tsx 的 IPC 逻辑不变。

---

## 文件变更

| 文件 | 操作 |
|------|------|
| `src/renderer/components/gateway/StatusHeader.tsx` | 重写为 HeroGauge + 状态信息 |
| `src/renderer/components/gateway/MetricCards.tsx` | 重写为紧凑指标条 |
| `src/renderer/components/gateway/ControlButtons.tsx` | 重写为渐变胶囊按钮 |
| `src/renderer/components/gateway/AdapterList.tsx` | 重写为带边框容器 + toggle |
| `src/renderer/components/gateway/LogTerminal.tsx` | 重写为极简固定高度日志 |
| `src/renderer/components/GatewayView.tsx` | 更新子组件 import 和 props |

---

## 依赖

现有：React 19、Tailwind v4、Motion、lucide-react。无需新增依赖。

---

## 测试

手动验证：dev server 打开 Gateway tab，确认与 mockup A 视觉一致。验证 Start/Stop、适配器 toggle、日志显示功能正常。
