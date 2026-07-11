# ToolflowUnit — 聊天信息流 UI 重构设计

**日期**: 2026-07-12
**状态**: 已批准（待实现）
**主题**: 重构 ChatPanel 信息流，将思考与工具调用统一为优雅的折叠单元

---

## 背景与问题

当前 ChatPanel 信息流存在三个核心问题：

1. **推理文本被静默丢弃**。`useClaude.ts` 正确地将 reasoning delta 累积进 `thinking` 类型的 `ContentBlock`，`MessageBubble.tsx` 中 `ThinkingBlock` 组件与对应 CSS 也已写好，但 `renderBlocks`（`MessageBubble.tsx:562`）在渲染前用 `filter(b => b.type !== 'thinking')` 把思考块全部过滤掉了。结果是：组件与样式是死代码，用户只能看到 `ChatPanel.tsx:86-96` 那个与具体内容解耦的全局「Thinking」脉冲胶囊——信息量为零且观感粗糙。

2. **工具暴露方式不优雅**。普通工具走 `ToolTimeline`（消息内折叠时间线），subagent 工具走 `SubagentTracker`（列表底部独立卡片），工具审批走 `ApprovalBar`（底部浮层）——三套割裂的 UI。且 thinking 与 tool 是平铺渲染，没有「归组」概念。

3. **MessageBubble.tsx 过度膨胀**。单文件 1136 行，混装了消息渲染、工具时间线、工具行、思考块、工具摘要/详情工具函数、配色表、图标。

### 行业参照

- **assistant-ui** 的 [Chain of Thought](https://www.assistant-ui.com/docs/guides/chain-of-thought)：核心思想是把相邻的 reasoning + tool-call parts 用 `MessagePrimitive.GroupedParts` + `groupPartByType` 自动归组成单一可折叠单元。这是 Codex / Cursor / ZCode 桌面端那种「干净」观感的本质。
- **OpenAI Codex CLI**（`codex-rs/tui/src/chatwidget.rs`）：在流式时维护一个可原地变更的 `active_cell`（「often representing a coalesced exec/tool group」），完成后冻结为 `HistoryCell`；连续工具调用被合并（coalesce）。
- 共识（Claude Code Issue #46554 等）：中间工具调用刷屏是普遍痛点，**默认折叠**是刚需。

---

## 设计决策

| # | 决策点 | 选择 |
|---|---|---|
| 1 | 推理文本 | 可见但默认折叠 |
| 2 | 归组策略 | 思考 + 工具全部进一个折叠单元 |
| 3 | 收起态外观 | 单行胶囊（Codex 风格） |
| 4 | 展开态布局 | 分区（思考上、工具下） |
| 5 | 流式行为 | 干活时自动展开，完成后自动收起（用户可手动覆盖） |
| 6a | Subagent 工具 | 并入折叠单元（作为带子任务详情的 ToolflowRow） |
| 6b | 审批状态 | 折叠单元内显示 + 浮层双通道 |
| 7 | 工具行样式 | 命令行风格（等宽、▸ 前缀、状态文字），简洁高级 |
| - | 工程取向 | 方案 A：渲染层归组（数据模型不动） |

**基调**：简洁、高级、终端质感、少装饰。

### 方案选择理由（方案 A：渲染层归组）

`ContentBlock` 联合类型已经区分 `text`/`thinking`/`tool_use`/`tool_result`，底层模型够用。问题纯粹在渲染层缺失「归组」抽象。方案 A 把改动锁在渲染层，不碰 `useClaude.ts` 的流式逻辑、不碰持久化的数据契约，复用现有的 `getToolSummary`/`getToolDetail`/`TOOL_COLORS` 等零件，风险可控、可逆。

被否决的方案：
- **方案 B（数据层归组）**：改 `ContentBlock` 加 `toolflow` 包装块。要改流式累积逻辑，影响 session 持久化，风险高，为 UI 改数据契约不划算。
- **方案 C（引入 assistant-ui 库）**：`@assistant-ui/react` 是完整聊天框架（自带 runtime/store/provider），与现有 Zustand + IPC 架构严重冲突，等于重写。我们要的是它的分组算法参照，不是整套依赖。

---

## 架构

### 组件结构

```
MessageBubble
 └─ renderBlocks(content)
     ├─ groupBlocks(content) → BlockGroup[]      ← 新增：归组遍历
     │     BlockGroup =
     │       { kind: 'toolflow', blocks: ContentBlock[] }   // thinking+tool_use+tool_result 打包
     │       | { kind: 'inline', block: ContentBlock }      // text/image/file 等单块
     │
     └─ 按 kind 分发：
        ├─ 'toolflow' → <ToolflowUnit blocks={...} />        ← 新组件
        └─ 'inline'   → <ContentBlockView block={...} />     （现有，瘦身）

<ToolflowUnit>  ← 新组件（取代 ToolTimeline 的位置）
 ├─ 状态机：active | done | error（派生自子块）
 ├─ 收起态：<ToolflowPill>（单行胶囊：脉冲点 + 文案 + chevron）
 └─ 展开态：<ToolflowExpanded>
     ├─ <ReasoningSection>  ← 复用现有 ThinkingBlock，抽 reasoning 文本
     │     所有 thinking 块的文本合并，顶部一个可滚动区
     └─ <ToolSection>
         └─ <ToolflowRow> × N  ← 命令行风格单行
              每行：▸ ToolName  摘要  状态
              可点开详情（复用 getToolDetail）
```

### 状态机

三个维度的状态：

**维度 1：单元生命周期状态（`unitStatus`，派生自子块，不可人为设）**

```
active  → 有 thinking 块在流式，或有 tool_use 还没收到 tool_result
done    → 所有工具都有 result 且无 error
error   → 任一 tool_result.is_error === true
```

派生算法（`ToolflowUnit` 内 `useMemo`）：
- 任一 `tool_result.is_error` → `error`
- 任一 `tool_use` 无配对 `tool_result`，或最后一个 block 是 `thinking` 且还在流 → `active`
- 否则 → `done`

**维度 2：展开/收起（`expanded`，本地 useState + 自动逻辑）**

核心规则：**自动状态跟随 unitStatus，但用户一旦手动操作就锁定**。

```
初始：autoMode = true, expanded = false

unitStatus 变化时（useEffect，仅当 autoMode === true）：
  active  → expanded = true
  done    → expanded = false
  error   → expanded = false

用户点胶囊（toggle）：
  expanded = !expanded
  autoMode = false    ← 关键 latch：手动一次后不再自动
```

这个 `autoMode` latch 是关键。没有它会出现：用户手动收起后，下一个工具到来又把它撑开。

**维度 3：工具行状态（`ToolflowRow` 各自）**

```
running   → tool_use 存在，无配对 tool_result
pending   → 在 pendingApprovals store 里（待批准）
done      → tool_result 且 !is_error
error     → tool_result.is_error
```

### 收起态胶囊文案（派生自 unitStatus + 内容）

```
active:  ● 思考中 · 运行了 N 个工具     （脉冲点；N = 工具总数；有未完成工具时体现「运行中」）
done:    ✓ 思考 · N 个工具              （静态对勾，脉冲停止）
error:   ✕ 思考 · N 个工具（1 失败）
```

「思考中」是否出现取决于有无 thinking 文本；纯工具无思考时只显示「运行了 N 个工具」。普通对话（无思考无工具）不产生 toolflow 组，胶囊根本不出现。

### 归组算法 `groupBlocks()`

遍历 `ContentBlock[]`，把连续的 thinking + tool_use + tool_result 收进一个 `toolflow` 组；其余每块各自成 `inline` 组。

```
groups = []
current = null   // 正在攒的 toolflow 组

for block in content:
  if block.type ∈ {thinking, tool_use, tool_result}:
    if current === null: current = []
    current.push(block)
  else:  // text, image, file, approval
    if current !== null:
      groups.push({kind:'toolflow', blocks: current}); current = null
    groups.push({kind:'inline', block})

if current !== null:
  groups.push({kind:'toolflow', blocks: current})

return groups
```

**为什么 tool_result 归进组**：顺序是 `tool_use → tool_result → ...`，若只归 use，result 会散落。

**为什么 text/image/file 切断组**：一条 assistant 消息可能是 `[思考][工具][正文1][思考][工具][正文2]`。正文是「结果」，和工具是两个语义层，必须独立渲染（Markdown/代码块）。遇到 text/image/file 就切断当前组，产生多个 toolflow 组——每个组各自一个胶囊，符合「模型分几段干活就有几个胶囊」的直觉。

**配对在 ToolflowUnit 内部做**（`groupBlocks` 只打包不配对）。复用现有 `renderBlocks:578-591` 逻辑：tool_use 创建 `{use, result?}`，tool_result 按 `toolCallId` 挂到前一个未配对的 use，thinking 累积到 reasoning 文本。产出 `{ reasoningText: string, tools: ToolPair[] }`。

**边界**：
| 情况 | 处理 |
|---|---|
| 只有 thinking 无工具 | 仍成 toolflow 组（胶囊显示「思考」，展开只有思考区） |
| 孤儿 tool_result（无配对 use） | 仍进组，ToolflowRow 显示 result 摘要，状态 done |
| 空组（防御） | 跳过，不渲染胶囊 |

### Subagent 与审批的统一

**SubagentTracker 迁移**：subagent 工具（`spawn_subagent`/`parallel_subagents`/`chain_subagents`）作为一个 `ToolflowRow` 出现在工具区，其「详情」展开后是子任务列表（复用现有 `TaskItem` 渲染逻辑）。`ChatPanel.tsx` 底部的全局 `<SubagentTracker>` 移除。`subagentTracker` store 保留，只搬渲染位置。

**ApprovalBar 不动**：审批浮层照旧。`ToolflowRow` 增加 `pending` 状态（从 `pendingApprovals` store 派生），实现双通道提示。

---

## 文件改动清单

### 新增

| 文件 | 职责 |
|---|---|
| `src/renderer/components/ToolflowUnit.tsx` | 折叠单元主组件：状态机、展开/收起编排、组合 ReasoningSection + ToolSection |
| `src/renderer/components/ToolflowPill.tsx` | 收起态单行胶囊（也可内联进 ToolflowUnit，实现时定） |
| `src/renderer/components/ToolflowRow.tsx` | 命令行风格工具单行 + 可展开详情 |
| `src/renderer/components/toolflow-utils.ts` | `groupBlocks()`、`pairTools()`、`deriveUnitStatus()` 纯函数 + 搬迁的 `getToolSummary`/`getToolDetail`/`TOOL_COLORS`/`ToolIcon` + 类型定义 |

### 改动

| 文件 | 改动 |
|---|---|
| `MessageBubble.tsx` | 删 `ToolTimeline`(222-341)、`ToolRow`(344-374)；工具函数搬到 toolflow-utils；`renderBlocks` 改为调 `groupBlocks` 分发；删 thinking filter(562)；清理 `ContentBlockView` 死分支(1120-1133)；`ThinkingBlock` 适配为 `ReasoningSection`（去掉自带 toggle） |
| `ChatPanel.tsx` | 删底部全局 Thinking 胶囊(86-96)；删底部 `<SubagentTracker>`(85) |
| `globals.css` | 新增 `.toolflow-*` 命令行风格样式；旧 `.tool-*`/`.thinking-*` 视情况保留或清理 |

### 不动

- `useClaude.ts`（流式累积逻辑正确）
- `chatStore.ts`（数据层）
- `subagentTracker.ts`（store 保留，只搬渲染）
- `ApprovalBar`（App.tsx，浮层不动）
- `shared/types.ts`（`ContentBlock` 类型不动）

---

## 实现顺序（每步可独立验证）

1. **toolflow-utils.ts** — `groupBlocks()` + `pairTools()` + `deriveUnitStatus()` + 搬迁的工具函数。纯函数，可单测。
2. **ToolflowRow.tsx** — 命令行风格单行 + 详情展开。先用静态数据验证样式。
3. **ToolflowUnit.tsx + ToolflowPill** — 状态机 + autoMode latch + 组合。先不接 subagent/审批，跑通主路径。
4. **MessageBubble.renderBlocks 改造** — 接入 groupBlocks 分发；删旧 ToolTimeline/ToolRow/thinking filter。此刻主流程已通。
5. **SubagentTracker 迁移** — subagent 进 ToolflowRow 详情；删 ChatPanel 底部全局卡。
6. **审批状态接入** — ToolflowRow 加 pending 状态（从 pendingApprovals 派生）。
7. **ChatPanel 清理 + CSS 收尾** — 删全局 Thinking 胶囊；旧 CSS 清理；整体走查。

---

## 风险点

- **autoMode latch 的 useEffect 依赖**：`unitStatus` 派生要稳定，避免流式时频繁触发收起。用 `useMemo` 派生 + `useEffect` 监听派生值。
- **多 toolflow 组的 React key**：一条消息可能有多个组，key 用组的首块在原 content 中的 index。
- **流式时 tool_result 晚到**：工具行 running→done 是正常状态迁移，`deriveUnitStatus` 重算；只要还有别的 active 工具，整体仍 active 不误收。最后一个工具 done 时才整体收起。

---

## 参照来源

- [assistant-ui Chain of Thought](https://www.assistant-ui.com/docs/guides/chain-of-thought) · [Headless Primitives](https://www.assistant-ui.com/docs/primitives)
- [openai/codex chatwidget.rs](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget.rs)
- [Claude Code Issue #46554 — 工具调用刷屏](https://github.com/anthropics/claude-code/issues/46554)
