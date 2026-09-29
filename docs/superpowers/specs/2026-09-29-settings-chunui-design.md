# 设置面板 ChunUI 化设计

日期：2026-09-29
状态：已批准
范围：`src/renderer/components/SettingsPanel.tsx`（排版层重构）+ `src/renderer/styles/globals.css`（少量新增动画/分组卡样式）

## 目标

把设置面板从「发丝线分段 + 灰盒套灰盒」重排为 ChunUI（Zinner/Chat0IM 设计系统）的 iOS 设置范式：分组大卡、卡外段标题、行内发丝线、控件右对齐、唯一强调色、三梯度字号、ccReveal 入场动效。

**配色沿用现有 CSS 变量**（`--accent-primary`、`--bg-surface-*` 等），三主题（dark/light/aurora）自动跟随；只搬 ChunUI 的结构范式，不搬它的黑白粉调色板。

## 用户决策

- 导航：保留左侧 tab 栏，右侧内容区 ChunUI 化
- 配色：ChunUI 结构 + 现有主题变量
- 范围：全部 9 个 tab 一次到位
- 动效：加入场动效（ccReveal 范式）

## 基础件重做（SettingsPanel.tsx 共享组件）

| 组件 | 现状 | 改为 |
|---|---|---|
| `Section` | 发丝线分段 + 标题在内容上方 | 标题在卡外（11px/600/letter-spacing 0.8/`--text-outline`）+ hint 跟随，内容包进 GroupCard |
| `GroupCard`（新增） | 无 | 圆角 14px 卡（`--bg-surface-container` 底 + `--border-subtle` 边），子行间自动发丝线（`> * + *`，左侧缩进对齐文字） |
| `Row` | 124px 网格 | 横向 flex：label 左（13px/500），hint 挂 label 下，控件右对齐，minHeight 44 |
| `Toggle` | 30×17 | 40×22，accent 开态 |
| `TextInput` | 现状 | 聚焦改 accent 焦点环（CCNeoInput 范式），其余不动 |
| 入场动效 | 无 | `cc-reveal`：上浮 10px 淡入，0.32s cubic-bezier(0.22,0.8,0.36,1) 零过冲，分组卡按序错峰 0.06s；tab 内容容器 `key={tab}` 触发切 tab 重播 |

三梯度字号：13（行标签/控件）/ 11（hint/元信息）/ mono（值）。去掉 12px 中间层。

## 9 个 tab 落法

- General / Voice / Soul / Persona：纯换壳，所有 Section/Row 自动获得新排版；StageBgPicker、宽度滑杆跟随新行节奏
- Provider / MCP / Channels：条目从「灰盒卡」改为分组卡内可展开行——行头（名称+元信息+操作）+ 展开后表单平铺行下方，行间发丝线，展开态表单用新 Row 排版
- Skills / Plugins：列表行化（Toggle + 名称 + 描述），发丝线分隔
- 侧栏：行高/间距对齐 44px 行节奏，active 保持 accent-soft

## 不动的

- 所有数据流、`window.claude.*` IPC、状态逻辑
- 模态壳（尺寸/背景模糊/关闭按钮）
- `globals.css` 里 settings-slider 等现有样式（仅追加，不修改）
- 逻辑零改动，纯排版层重构

## 验收

- tsc 对 SettingsPanel.tsx 无新增类型错误
- 三主题下分组卡/发丝线/控件对比度正常
- 9 个 tab 均为新排版，无新旧混排
- 切 tab 有 ccReveal 错峰入场
