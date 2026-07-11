# ToolflowUnit 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将聊天信息流中的思考文本与工具调用统一为一个 Codex 风格的可折叠单元（ToolflowUnit），取代当前平铺渲染、思考被静默丢弃的现状。

**Architecture:** 渲染层归组（数据模型不动）。在 `MessageBubble.renderBlocks` 前加一道 `groupBlocks()` 遍历，把连续的 thinking+tool_use+tool_result 打包成 `toolflow` 组交给新组件 `<ToolflowUnit>`；text/image 等走原有 `inline` 路径。状态机用 autoMode latch 实现「干活时自动展开，完成后自动收起，用户手动一次即锁定」。

**Tech Stack:** React 19 + TypeScript + Zustand + Vitest（node 环境，无 DOM 测试库——纯函数走单测，组件走手动验证）

**设计文档:** `docs/superpowers/specs/2026-07-12-toolflow-unit-design.md`

---

## 文件结构

### 新增

| 文件 | 职责 |
|---|---|
| `src/renderer/components/toolflow-utils.ts` | 纯函数：`groupBlocks()`、`pairTools()`、`deriveUnitStatus()` + 从 MessageBubble 搬迁的 `getToolSummary`/`getToolDetail`/`TOOL_COLORS`/`TIMELINE`/`ToolIcon` + 类型定义 `BlockGroup`/`ToolPair`/`UnitStatus` |
| `src/renderer/components/__tests__/toolflow-utils.test.ts` | 上述纯函数的单元测试 |
| `src/renderer/components/ToolflowRow.tsx` | 命令行风格工具单行 + 可展开详情 |
| `src/renderer/components/ToolflowUnit.tsx` | 折叠单元主组件：状态机、autoMode latch、收起胶囊、展开分区（思考上/工具下）。内含 `ToolflowPill`（收起态，不独立成文件）和 `ReasoningSection`（思考区） |

### 改动

| 文件 | 改动 |
|---|---|
| `MessageBubble.tsx` | 删 `TIMELINE`/`TOOL_COLORS`/`DEFAULT_TOOL_COLOR`/`getToolStyle`/`ToolIcon`/`ToolTimeline`/`ToolRow`/`getToolSummary`/`getToolDetail`/`ThinkingBlock`（均搬走或被取代）；删 `renderBlocks` 内 thinking filter(562) 与工具归组逻辑(564-604)；改为调 `groupBlocks` 分发；`ContentBlockView` 删 thinking/tool 死分支(1120-1133)；新增从 toolflow-utils 的 re-import |
| `ChatPanel.tsx` | 删底部全局 Thinking 胶囊(86-96)；删 `<SubagentTracker>`(85) 及其 import |
| `globals.css` | 新增 `.toolflow-*` 样式块；保留 `.thinking-content` 相关（复用）；旧 `.tool-row-running`/`.tool-detail-enter` 删除 |

### 不动

`useClaude.ts`、`chatStore.ts`、`subagentTracker.ts`、`App.tsx`(ApprovalBar)、`shared/types.ts`

---

## Task 1: toolflow-utils.ts 纯函数 + 单测

**Files:**
- Create: `src/renderer/components/toolflow-utils.ts`
- Create: `src/renderer/components/__tests__/toolflow-utils.test.ts`

- [ ] **Step 1: 写 groupBlocks 的失败测试**

创建 `src/renderer/components/__tests__/toolflow-utils.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { groupBlocks } from '../toolflow-utils'
import type { ContentBlock } from '../../../shared/types'

const think = (t: string): ContentBlock => ({ type: 'thinking', thinking: t })
const tuse = (name: string, id: string): ContentBlock => ({ type: 'tool_use', name, id })
const tres = (id: string, err = false): ContentBlock => ({ type: 'tool_result', toolCallId: id, content: '', is_error: err })
const text = (t: string): ContentBlock => ({ type: 'text', text: t })
const img = (): ContentBlock => ({ type: 'image', src: 'x.png' })

describe('groupBlocks', () => {
  it('packs consecutive thinking+tool blocks into one toolflow group', () => {
    const blocks = [think('a'), tuse('Read', '1'), tres('1'), tuse('Bash', '2'), tres('2')]
    const groups = groupBlocks(blocks)
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('toolflow')
    expect(groups[0].kind === 'toolflow' && groups[0].blocks).toHaveLength(5)
  })

  it('splits group when text block appears (produces multiple toolflow groups)', () => {
    const blocks = [think('a'), tuse('Read', '1'), tres('1'), text('正文'), tuse('Bash', '2'), tres('2')]
    const groups = groupBlocks(blocks)
    expect(groups).toHaveLength(3)
    expect(groups[0].kind).toBe('toolflow')
    expect(groups[1].kind).toBe('inline')
    expect(groups[2].kind).toBe('toolflow')
  })

  it('treats image/file as inline group that splits toolflow', () => {
    const groups = groupBlocks([tuse('Read', '1'), img(), tres('1')])
    expect(groups).toHaveLength(3)
    expect(groups[0].kind).toBe('toolflow')
    expect(groups[1].kind).toBe('inline')
    expect(groups[2].kind).toBe('toolflow')
  })

  it('thinking-only blocks form a toolflow group', () => {
    const groups = groupBlocks([think('a'), think('b')])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('toolflow')
  })

  it('text-only content yields only inline groups', () => {
    const groups = groupBlocks([text('a'), text('b')])
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.kind === 'inline')).toBe(true)
  })

  it('empty array yields empty array', () => {
    expect(groupBlocks([])).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/renderer/components/__tests__/toolflow-utils.test.ts`
Expected: FAIL — `groupBlocks` 未定义（module not found）

- [ ] **Step 3: 写 pairTests 的失败测试**

追加到同一个测试文件：

```ts
import { pairTools } from '../toolflow-utils'

describe('pairTools', () => {
  it('pairs tool_use with matching tool_result by id', () => {
    const blocks = [tuse('Read', '1'), tres('1')]
    const { tools } = pairTools(blocks)
    expect(tools).toHaveLength(1)
    expect(tools[0].use.id).toBe('1')
    expect(tools[0].result?.toolCallId).toBe('1')
  })

  it('leaves running status when tool_use has no result', () => {
    const blocks = [tuse('Read', '1')]
    const { tools } = pairTools(blocks)
    expect(tools).toHaveLength(1)
    expect(tools[0].result).toBeUndefined()
  })

  it('accumulates all thinking text into reasoningText', () => {
    const blocks = [think('第一段'), tuse('Read', '1'), tres('1'), think('第二段')]
    const { reasoningText, tools } = pairTools(blocks)
    expect(reasoningText).toBe('第一段\n第二段')
    expect(tools).toHaveLength(1)
  })

  it('handles orphan tool_result (no matching use)', () => {
    const blocks = [tres('orphan')]
    const { tools } = pairTools(blocks)
    expect(tools).toHaveLength(1)
    // orphan result: use is the result block itself treated as result-only
    expect(tools[0].result?.toolCallId).toBe('orphan')
  })

  it('returns empty reasoningText and tools for empty input', () => {
    const { reasoningText, tools } = pairTools([])
    expect(reasoningText).toBe('')
    expect(tools).toEqual([])
  })
})
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npx vitest run src/renderer/components/__tests__/toolflow-utils.test.ts`
Expected: FAIL — `pairTools` 未定义

- [ ] **Step 5: 写 deriveUnitStatus 的失败测试**

追加到同一个测试文件：

```ts
import { deriveUnitStatus } from '../toolflow-utils'

describe('deriveUnitStatus', () => {
  it('returns active when a tool_use has no result yet', () => {
    const blocks = [tuse('Read', '1')]
    expect(deriveUnitStatus(blocks)).toBe('active')
  })

  it('returns active when last block is thinking (still streaming)', () => {
    const blocks = [tuse('Read', '1'), tres('1'), think('思考中…')]
    expect(deriveUnitStatus(blocks)).toBe('active')
  })

  it('returns done when all tools have non-error results', () => {
    const blocks = [tuse('Read', '1'), tres('1'), tuse('Bash', '2'), tres('2')]
    expect(deriveUnitStatus(blocks)).toBe('done')
  })

  it('returns error when any tool_result has is_error', () => {
    const blocks = [tuse('Read', '1'), tres('1'), tuse('Bash', '2'), tres('2', true)]
    expect(deriveUnitStatus(blocks)).toBe('error')
  })

  it('returns done for thinking-only blocks (no pending tools)', () => {
    const blocks = [think('a'), think('b')]
    expect(deriveUnitStatus(blocks)).toBe('done')
  })
})
```

- [ ] **Step 6: 运行测试确认失败**

Run: `npx vitest run src/renderer/components/__tests__/toolflow-utils.test.ts`
Expected: FAIL — `deriveUnitStatus` 未定义

- [ ] **Step 7: 实现 toolflow-utils.ts（含搬迁的工具函数）**

创建 `src/renderer/components/toolflow-utils.ts`：

```ts
import type React from 'react'
import type { ContentBlock } from '../../shared/types'

// ─── 类型 ───

export type UnitStatus = 'active' | 'done' | 'error'

export type BlockGroup =
  | { kind: 'toolflow'; blocks: ContentBlock[] }
  | { kind: 'inline'; block: ContentBlock }

export interface ToolPair {
  use: ContentBlock
  result?: ContentBlock
}

export interface ParsedToolflow {
  reasoningText: string
  tools: ToolPair[]
}

// ─── 归组：把连续的 thinking/tool_use/tool_result 打包 ───

const TOOLFLOW_TYPES = new Set(['thinking', 'tool_use', 'tool_result'])

export function groupBlocks(content: ContentBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = []
  let current: ContentBlock[] | null = null

  for (const block of content) {
    if (TOOLFLOW_TYPES.has(block.type)) {
      if (current === null) current = []
      current.push(block)
    } else {
      if (current !== null) {
        groups.push({ kind: 'toolflow', blocks: current })
        current = null
      }
      groups.push({ kind: 'inline', block })
    }
  }
  if (current !== null) {
    groups.push({ kind: 'toolflow', blocks: current })
  }
  return groups
}

// ─── 配对 + 思考文本抽取 ───

export function pairTools(blocks: ContentBlock[]): ParsedToolflow {
  const reasoningParts: string[] = []
  const tools: ToolPair[] = []

  for (const block of blocks) {
    if (block.type === 'thinking' && block.thinking) {
      reasoningParts.push(block.thinking)
    } else if (block.type === 'tool_use') {
      tools.push({ use: block })
    } else if (block.type === 'tool_result') {
      const last = tools[tools.length - 1]
      if (last && !last.result && last.use.type === 'tool_use' && last.use.id === block.toolCallId) {
        last.result = block
      } else {
        // 孤儿 result：当作 result-only 的 pair
        tools.push({ use: block, result: block })
      }
    }
  }

  return { reasoningText: reasoningParts.join('\n'), tools }
}

// ─── 单元状态派生 ───

export function deriveUnitStatus(blocks: ContentBlock[]): UnitStatus {
  // 任一 error → error
  const hasError = blocks.some((b) => b.type === 'tool_result' && b.is_error)
  if (hasError) return 'error'

  // 有未配对的 tool_use，或最后一块是 thinking（还在流） → active
  const pairs = pairTools(blocks).tools
  const hasRunning = pairs.some((p) => !p.result || (p.use.type === 'tool_result' && false))
  // 重新判定：tool_use 无 result 即 running
  const hasPendingTool = pairs.some(
    (p) => p.use.type === 'tool_use' && !p.result
  )
  const lastBlock = blocks[blocks.length - 1]
  const endsWithThinking = lastBlock?.type === 'thinking'

  if (hasPendingTool || endsWithThinking) return 'active'

  return 'done'
}

// ─── 从 MessageBubble 搬迁的工具函数与配色 ───

export const TIMELINE = {
  thinking: '#dfa88f',
  grep: '#9fc9a2',
  read: '#9fbbe0',
  edit: '#c0a8dd',
  done: '#c08532',
  error: '#cf2d56',
} as const

export const TOOL_COLORS: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  Read: { color: TIMELINE.read, bg: 'rgba(159,187,224,0.12)', icon: null },
  Write: { color: TIMELINE.done, bg: 'rgba(192,133,50,0.12)', icon: null },
  Edit: { color: TIMELINE.edit, bg: 'rgba(192,168,221,0.12)', icon: null },
  Bash: { color: TIMELINE.grep, bg: 'rgba(159,201,162,0.12)', icon: null },
  Glob: { color: TIMELINE.grep, bg: 'rgba(159,201,162,0.12)', icon: null },
  Grep: { color: TIMELINE.grep, bg: 'rgba(159,201,162,0.12)', icon: null },
  Agent: { color: TIMELINE.thinking, bg: 'rgba(223,168,143,0.12)', icon: null },
}

const DEFAULT_TOOL_COLOR = { color: 'var(--text-outline)', bg: 'var(--bg-surface-container)', icon: null }

export function getToolStyle(name: string) {
  return TOOL_COLORS[name] || DEFAULT_TOOL_COLOR
}

export function getToolSummary(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  if (name === 'Read' || name === 'Write' || name === 'Edit') {
    const path = (input.file_path as string) || ''
    return path.split(/[/\\]/).slice(-2).join('/') || path
  }
  if (name === 'Bash') {
    const cmd = input.command as string
    return cmd?.length > 50 ? cmd.slice(0, 50) + '...' : cmd || ''
  }
  if (name === 'Glob' || name === 'Grep') {
    return (input.pattern as string) || ''
  }
  if (name === 'Agent' || name === 'spawn_subagent' || name === 'parallel_subagents' || name === 'chain_subagents') {
    return (input.description as string) || ''
  }
  return ''
}

export function getToolDetail(name: string, input: Record<string, unknown> | undefined, result?: ContentBlock): string {
  if (!input) return ''
  if (name === 'Write') {
    return (input.content as string) || ''
  }
  if (name === 'Edit') {
    const parts: string[] = []
    if (input.old_string) parts.push(`- ${String(input.old_string).slice(0, 500)}`)
    if (input.new_string) parts.push(`+ ${String(input.new_string).slice(0, 500)}`)
    return parts.join('\n')
  }
  if (name === 'Read' && result && typeof result.content === 'string') {
    return result.content.slice(0, 3000)
  }
  if (name === 'Bash') {
    const cmd = `$ ${input.command || ''}`
    const out = result && typeof result.content === 'string' ? result.content : ''
    return out ? `${cmd}\n${out.slice(0, 3000)}` : cmd
  }
  if (name === 'Grep' && result && typeof result.content === 'string') {
    return result.content.slice(0, 3000)
  }
  if (name === 'Glob' && result && typeof result.content === 'string') {
    return result.content.slice(0, 3000)
  }
  return ''
}
```

- [ ] **Step 8: 运行测试确认全过**

Run: `npx vitest run src/renderer/components/__tests__/toolflow-utils.test.ts`
Expected: PASS — 全部 16 个测试通过

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/toolflow-utils.ts src/renderer/components/__tests__/toolflow-utils.test.ts
git commit -m "feat(toolflow): add groupBlocks/pairTools/deriveUnitStatus + migrated tool utils"
```

---

## Task 2: ToolflowRow.tsx 命令行风格工具行

**Files:**
- Create: `src/renderer/components/ToolflowRow.tsx`
- Modify: `src/renderer/styles/globals.css`（追加 `.toolflow-row` 等样式）

- [ ] **Step 1: 追加 CSS 样式**

在 `src/renderer/styles/globals.css` 末尾追加（保留旧 `.thinking-content` 等供 ReasoningSection 复用）：

```css
/* ===== Toolflow Unit ===== */
.toolflow-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 10px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-outline);
  line-height: 1.8;
  cursor: default;
  border-radius: var(--radius-sm);
  transition: background 0.12s;
}
.toolflow-row[data-clickable="true"] {
  cursor: pointer;
}
.toolflow-row[data-clickable="true"]:hover {
  background: var(--bg-surface-container);
}
.toolflow-row .toolflow-pfx {
  color: var(--text-outline-variant);
  opacity: 0.6;
  flex-shrink: 0;
}
.toolflow-row .toolflow-name {
  color: var(--text-on-surface-variant);
  font-weight: 600;
  flex-shrink: 0;
}
.toolflow-row .toolflow-summary {
  color: var(--text-outline);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toolflow-row .toolflow-status {
  flex-shrink: 0;
  margin-left: auto;
}
.toolflow-status-ok { color: #8db88d; }
.toolflow-status-run { color: var(--accent-thinking, #dfa88f); }
.toolflow-status-err { color: var(--accent-error, #cf2d56); }
.toolflow-status-pending { color: #e0c878; }

.toolflow-detail {
  margin: 2px 0 4px 24px;
  padding: 8px 10px;
  background: var(--bg-surface-container-lowest);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
  color: var(--text-on-surface-variant);
  white-space: pre-wrap;
  word-break: break-word;
  animation: toolflow-detail-in 0.15s ease-out;
}
@keyframes toolflow-detail-in {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}
.toolflow-detail::-webkit-scrollbar { width: 3px; }
.toolflow-detail::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 10px; }
```

- [ ] **Step 2: 实现 ToolflowRow.tsx**

创建 `src/renderer/components/ToolflowRow.tsx`：

```tsx
import { useState, memo } from 'react'
import type { ContentBlock } from '../../shared/types'
import { getToolSummary, getToolDetail } from './toolflow-utils'

export type RowStatus = 'running' | 'pending' | 'done' | 'error'

interface Props {
  pair: { use: ContentBlock; result?: ContentBlock }
  status: RowStatus
}

export const ToolflowRow = memo(function ToolflowRow({ pair, status }: Props) {
  const [detailOpen, setDetailOpen] = useState(false)

  // tool_use 块：取 name + input；孤儿 result 块：name 留空
  const isUse = pair.use.type === 'tool_use'
  const name = isUse ? pair.use.name || 'tool' : ''
  const input = isUse ? pair.use.input : undefined
  const summary = isUse ? getToolSummary(name, input) : ''
  const detail = isUse ? getToolDetail(name, input, pair.result) : ''
  const clickable = !!detail

  const statusText = {
    running: '● running',
    pending: '◆ pending',
    done: '✓ ok',
    error: '✕ failed',
  }[status]

  const statusClass = {
    running: 'toolflow-status-run',
    pending: 'toolflow-status-pending',
    done: 'toolflow-status-ok',
    error: 'toolflow-status-err',
  }[status]

  return (
    <div>
      <div
        className="toolflow-row"
        data-clickable={clickable ? 'true' : 'false'}
        onClick={() => clickable && setDetailOpen((v) => !v)}
      >
        <span className="toolflow-pfx">▸</span>
        {name && <span className="toolflow-name">{name}</span>}
        {summary && <span className="toolflow-summary">{summary}</span>}
        <span className={`toolflow-status ${statusClass}`}>{statusText}</span>
      </div>
      {detailOpen && detail && (
        <div className="toolflow-detail">{detail}</div>
      )}
    </div>
  )
})
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（ToolflowRow 暂未被引用，但应无类型错误）

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ToolflowRow.tsx src/renderer/styles/globals.css
git commit -m "feat(toolflow): add command-line style ToolflowRow component"
```

---

## Task 3: ToolflowUnit.tsx 主组件 + 状态机 + 胶囊

**Files:**
- Create: `src/renderer/components/ToolflowUnit.tsx`
- Modify: `src/renderer/styles/globals.css`（追加 `.toolflow-pill`、`.toolflow-expanded` 等）

- [ ] **Step 1: 追加胶囊与展开区 CSS**

在 `src/renderer/styles/globals.css` 的 `/* ===== Toolflow Unit ===== */` 区块内继续追加：

```css
/* 收起态胶囊 */
.toolflow-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 11px;
  background: rgba(223,168,143,0.10);
  border: 1px solid rgba(223,168,143,0.25);
  border-radius: 999px;
  font-size: 11.5px;
  color: #c9a899;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s;
  margin: 6px 0;
}
.toolflow-pill:hover {
  background: rgba(223,168,143,0.16);
  border-color: rgba(223,168,143,0.4);
}
.toolflow-pill[data-status="done"] {
  background: rgba(141,184,141,0.08);
  border-color: rgba(141,184,141,0.22);
  color: #9ab8a0;
}
.toolflow-pill[data-status="error"] {
  background: rgba(207,45,86,0.08);
  border-color: rgba(207,45,86,0.25);
  color: #d48898;
}
.toolflow-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: currentColor;
}
.toolflow-pill[data-status="active"] .toolflow-pill-dot {
  animation: thinking-pulse 1.4s ease-in-out infinite;
}
.toolflow-pill-chevron {
  opacity: 0.6;
  font-size: 10px;
  transition: transform 0.2s cubic-bezier(0.4,0,0.2,1);
}
.toolflow-pill-chevron[data-expanded="true"] {
  transform: rotate(90deg);
}

/* 展开态容器 */
.toolflow-expanded {
  margin: 4px 0 8px;
  padding: 10px 12px;
  background: rgba(223,168,143,0.04);
  border: 1px solid rgba(223,168,143,0.14);
  border-radius: var(--radius-md);
  animation: toolflow-detail-in 0.18s ease-out;
}

/* 展开态：思考区标签 */
.toolflow-section-label {
  font-size: 10px;
  color: var(--text-outline-variant);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 8px 0 4px;
}
.toolflow-section-label:first-child {
  margin-top: 0;
}

/* 展开态：思考文本（复用 thinking-content 视觉） */
.toolflow-reasoning {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface-container);
  border: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-on-surface-variant);
  max-height: 280px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 6px;
}
.toolflow-reasoning::-webkit-scrollbar { width: 3px; }
.toolflow-reasoning::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 10px; }

/* 展开态：工具列表区 */
.toolflow-tool-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}
```

- [ ] **Step 2: 实现 ToolflowUnit.tsx**

创建 `src/renderer/components/ToolflowUnit.tsx`：

```tsx
import { useState, useEffect, useMemo, memo } from 'react'
import type { ContentBlock } from '../../shared/types'
import {
  groupBlocks,
  pairTools,
  deriveUnitStatus,
  type UnitStatus,
} from './toolflow-utils'
import { ToolflowRow, type RowStatus } from './ToolflowRow'

interface Props {
  blocks: ContentBlock[]
}

export const ToolflowUnit = memo(function ToolflowUnit({ blocks }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [autoMode, setAutoMode] = useState(true)

  const unitStatus: UnitStatus = useMemo(() => deriveUnitStatus(blocks), [blocks])
  const { reasoningText, tools } = useMemo(() => pairTools(blocks), [blocks])

  // autoMode latch：状态变化时自动展开/收起，用户手动操作后锁定
  useEffect(() => {
    if (!autoMode) return
    if (unitStatus === 'active') {
      setExpanded(true)
    } else {
      // done 或 error → 自动收起
      setExpanded(false)
    }
  }, [unitStatus, autoMode])

  const toggle = () => {
    setExpanded((v) => !v)
    setAutoMode(false)
  }

  // 胶囊文案
  const hasReasoning = !!reasoningText.trim()
  const toolCount = tools.length
  const errorCount = tools.filter(
    (t) => t.result?.type === 'tool_result' && t.result.is_error
  ).length

  const pillLabel = (() => {
    const thinkPart = hasReasoning ? '思考' : ''
    if (unitStatus === 'active') {
      const runPart = toolCount > 0 ? ` · 运行了 ${toolCount} 个工具` : ''
      return `${thinkPart ? '思考中' : ''}${runPart}`.trim() || '运行中'
    }
    if (unitStatus === 'error') {
      return `${thinkPart ? '思考 · ' : ''}${toolCount} 个工具（${errorCount} 失败）`
    }
    // done
    return `${thinkPart ? '思考 · ' : ''}${toolCount} 个工具`
  })()

  return (
    <div>
      <button
        className="toolflow-pill"
        data-status={unitStatus}
        onClick={toggle}
      >
        <span className="toolflow-pill-dot" />
        <span>{pillLabel}</span>
        <span className="toolflow-pill-chevron" data-expanded={expanded}>▸</span>
      </button>

      {expanded && (
        <div className="toolflow-expanded">
          {hasReasoning && (
            <>
              <div className="toolflow-section-label">思考</div>
              <div className="toolflow-reasoning">{reasoningText}</div>
            </>
          )}
          {tools.length > 0 && (
            <>
              <div className="toolflow-section-label">工具</div>
              <div className="toolflow-tool-list">
                {tools.map((pair, i) => {
                  const status: RowStatus = pair.result
                    ? (pair.result.is_error ? 'error' : 'done')
                    : 'running'
                  return <ToolflowRow key={i} pair={pair} status={status} />
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
})
```

注意：`groupBlocks` import 暂时保留给后续 Task 4 用；此处未直接调用但保留导入以便 lint 不报未使用（若 lint 报错则移除此 import，Task 4 时 MessageBubble 会直接调 `groupBlocks`）。实际上此处应移除 `groupBlocks` import——修正：只导入实际用到的。

- [ ] **Step 3: 修正 import（移除未使用的 groupBlocks）**

将 `ToolflowUnit.tsx` 顶部的 import 改为：

```tsx
import {
  pairTools,
  deriveUnitStatus,
  type UnitStatus,
} from './toolflow-utils'
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ToolflowUnit.tsx src/renderer/styles/globals.css
git commit -m "feat(toolflow): add ToolflowUnit with autoMode latch state machine"
```

---

## Task 4: MessageBubble.renderBlocks 改造 + 删除旧组件

**Files:**
- Modify: `src/renderer/components/MessageBubble.tsx`

这是核心改造步骤。删除大量旧代码，接入 groupBlocks 分发。

- [ ] **Step 1: 删除旧的工具/思考相关定义（行 14-119、222-421、1035-1069、1120-1133）**

用 Edit 工具做以下删除（保留其余代码原样）：

**删除 1**: 行 14-119（`TIMELINE`、`TOOL_COLORS`、`DEFAULT_TOOL_COLOR`、`getToolStyle`、`ToolIcon`）——这些已搬到 toolflow-utils。

**删除 2**: 行 222-341（`ToolTimeline` 函数整体）——被 ToolflowUnit 取代。

**删除 3**: 行 344-374（`ToolRow` 函数整体）——被 ToolflowRow 取代。

**删除 4**: 行 376-421（`getToolSummary`、`getToolDetail`）——已搬迁。

**删除 5**: 行 1035-1069（`ThinkingBlock` 函数整体）——被 ToolflowUnit 内的 ReasoningSection 取代。

**删除 6**: 行 1120-1133（`ContentBlockView` 内 thinking/tool_use/tool_result 分支）——死代码。

- [ ] **Step 2: 在文件顶部添加 toolflow-utils 的 import**

在 `MessageBubble.tsx` 现有 import 之后（约行 6 后）加：

```tsx
import { groupBlocks } from './toolflow-utils'
import { ToolflowUnit } from './ToolflowUnit'
```

- [ ] **Step 3: 重写 renderBlocks（替换原 562-604 行的 thinking filter + 旧 renderBlocks）**

把原来的：

```tsx
  // Assistant message
  const otherBlocks = message.content.filter((b) => b.type !== 'thinking')

  const renderBlocks = () => {
    const result: React.ReactNode[] = []
    let i = 0
    let toolIdx = 0
    while (i < otherBlocks.length) {
      const block = otherBlocks[i]
      if (block.type === 'tool_use' || block.type === 'tool_result') {
        // Collect consecutive tool blocks
        const toolGroup: ContentBlock[] = []
        while (i < otherBlocks.length && (otherBlocks[i].type === 'tool_use' || otherBlocks[i].type === 'tool_result')) {
          toolGroup.push(otherBlocks[i])
          i++
        }
        // Pair tool_use with their tool_result
        const pairs: { use: ContentBlock; result?: ContentBlock }[] = []
        for (const b of toolGroup) {
          if (b.type === 'tool_use') {
            pairs.push({ use: b })
          } else if (b.type === 'tool_result') {
            const last = pairs[pairs.length - 1]
            if (last && !last.result) {
              last.result = b
            } else {
              // Orphan result, render as standalone
              pairs.push({ use: b, result: undefined })
            }
          }
        }
        result.push(
          <ToolTimeline
            key={`tc-${toolIdx++}`}
            pairs={pairs}
          />
        )
      } else {
        result.push(<ContentBlockView key={i} block={block} />)
        i++
      }
    }
    return result
  }
```

替换为：

```tsx
  // Assistant message: 归组分发
  const renderBlocks = () => {
    const groups = groupBlocks(message.content)
    return groups.map((group, idx) => {
      if (group.kind === 'toolflow') {
        return <ToolflowUnit key={`tf-${idx}`} blocks={group.blocks} />
      }
      return <ContentBlockView key={`in-${idx}`} block={group.block} />
    })
  }
```

- [ ] **Step 4: 修正 fileRefs 的数据源（原 606-609 行引用 otherBlocks，改为 message.content）**

把：

```tsx
  const fileRefs = otherBlocks
    .filter((b) => b.type === 'tool_use' && (b.name === 'Write' || b.name === 'Edit'))
    .map((b) => b.input?.file_path as string)
    .filter(Boolean)
```

改为：

```tsx
  const fileRefs = message.content
    .filter((b) => b.type === 'tool_use' && (b.name === 'Write' || b.name === 'Edit'))
    .map((b) => b.input?.file_path as string)
    .filter(Boolean)
```

- [ ] **Step 5: 清理 ContentBlockView（删除已删分支的残留）**

确认 `ContentBlockView` 函数现在只剩 `image` 和 `text` 两个分支（thinking/tool 分支已在 Step 1 删除）。函数结尾的 `return null` 保留。

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。常见问题：`TIMELINE` 被删除后，若 `FeedbackButtons`(行 705-742) 仍引用 `TIMELINE.done`/`TIMELINE.error`，需改为直接用颜色值。

- [ ] **Step 7: 修复 FeedbackButtons 对 TIMELINE 的引用**

`FeedbackButtons` 函数（原行 705-742）引用了 `TIMELINE.done` 和 `TIMELINE.error`。由于 TIMELINE 已搬走，需改为直接内联颜色或从 toolflow-utils 导入。在文件顶部 import 处补充：

```tsx
import { groupBlocks, TIMELINE } from './toolflow-utils'
```

（若 Step 2 的 import 已写成 `import { groupBlocks } from './toolflow-utils'`，改为 `import { groupBlocks, TIMELINE } from './toolflow-utils'`。）

- [ ] **Step 8: 再次类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 9: 运行测试确认未破坏**

Run: `npx vitest run`
Expected: toolflow-utils 测试全过，无回归

- [ ] **Step 10: 手动验证（启动 app，发起带工具调用的对话）**

Run: `npm run dev`（或项目的 dev 命令）
Expected:
- 助手回复时，思考文本 + 工具调用合并为一个胶囊（收起态：脉冲点 + 文案）
- 流式过程中胶囊自动展开，显示思考区 + 工具列表（命令行风格）
- 完成后自动收起
- 点击胶囊可手动展开/收起，手动后不再自动
- 纯文本回复不出现胶囊

- [ ] **Step 11: Commit**

```bash
git add src/renderer/components/MessageBubble.tsx
git commit -m "feat(toolflow): wire groupBlocks + ToolflowUnit into MessageBubble, remove ToolTimeline/ThinkingBlock"
```

---

## Task 5: SubagentTracker 迁移进 ToolflowRow

**Files:**
- Modify: `src/renderer/components/ToolflowUnit.tsx`（subagent 工具行的详情展开子任务列表）
- Modify: `src/renderer/components/ChatPanel.tsx`（删底部 `<SubagentTracker>`）
- Keep: `src/renderer/stores/subagentTracker.ts`（store 不动）

subagent 工具（`spawn_subagent`/`parallel_subagents`/`chain_subagents`）作为一个 ToolflowRow，其详情展开后显示子任务列表。

- [ ] **Step 1: 在 ToolflowUnit 中识别 subagent 工具并注入子任务详情**

在 `ToolflowUnit.tsx` 中，渲染工具列表时，对 subagent 工具特殊处理。把 Task 3 中的工具列表渲染部分：

```tsx
{tools.map((pair, i) => {
  const status: RowStatus = pair.result
    ? (pair.result.is_error ? 'error' : 'done')
    : 'running'
  return <ToolflowRow key={i} pair={pair} status={status} />
})}
```

改为：

```tsx
{tools.map((pair, i) => {
  const status: RowStatus = pair.result
    ? (pair.result.is_error ? 'error' : 'done')
    : 'running'
  const isSubagent =
    pair.use.type === 'tool_use' &&
    (pair.use.name === 'spawn_subagent' ||
      pair.use.name === 'parallel_subagents' ||
      pair.use.name === 'chain_subagents')
  return (
    <ToolflowRow
      key={i}
      pair={pair}
      status={status}
      toolCallId={isSubagent && pair.use.type === 'tool_use' ? pair.use.id : undefined}
    />
  )
})}
```

- [ ] **Step 2: 扩展 ToolflowRow 支持 subagent 子任务详情**

在 `ToolflowRow.tsx` 中，新增可选 `toolCallId` prop。当传入时，从 subagentTracker store 查该 toolCallId 的子任务，详情区渲染子任务列表。

更新 `Props` 与组件：

```tsx
import { useState, memo } from 'react'
import type { ContentBlock } from '../../shared/types'
import { getToolSummary, getToolDetail } from './toolflow-utils'
import { useSubagentTracker } from '../stores/subagentTracker'

export type RowStatus = 'running' | 'pending' | 'done' | 'error'

interface Props {
  pair: { use: ContentBlock; result?: ContentBlock }
  status: RowStatus
  toolCallId?: string  // subagent 工具的 tool_use.id，用于查子任务
}

export const ToolflowRow = memo(function ToolflowRow({ pair, status, toolCallId }: Props) {
  const [detailOpen, setDetailOpen] = useState(false)

  // subagent 子任务（仅当 toolCallId 传入时查询）
  const subagentTasks = useSubagentTracker((s) => {
    if (!toolCallId) return null
    for (const card of s.cards) {
      const tasks = card.tasks.filter((t) => t.toolCallId === toolCallId)
      if (tasks.length > 0) return tasks
    }
    return null
  })

  const isUse = pair.use.type === 'tool_use'
  const name = isUse ? pair.use.name || 'tool' : ''
  const input = isUse ? pair.use.input : undefined
  const summary = isUse ? getToolSummary(name, input) : ''
  const detail = isUse ? getToolDetail(name, input, pair.result) : ''
  const hasSubagent = !!subagentTasks && subagentTasks.length > 0
  const clickable = !!detail || hasSubagent

  const statusText = {
    running: '● running',
    pending: '◆ pending',
    done: '✓ ok',
    error: '✕ failed',
  }[status]

  const statusClass = {
    running: 'toolflow-status-run',
    pending: 'toolflow-status-pending',
    done: 'toolflow-status-ok',
    error: 'toolflow-status-err',
  }[status]

  return (
    <div>
      <div
        className="toolflow-row"
        data-clickable={clickable ? 'true' : 'false'}
        onClick={() => clickable && setDetailOpen((v) => !v)}
      >
        <span className="toolflow-pfx">▸</span>
        {name && <span className="toolflow-name">{name}</span>}
        {summary && <span className="toolflow-summary">{summary}</span>}
        <span className={`toolflow-status ${statusClass}`}>{statusText}</span>
      </div>
      {detailOpen && (detail || hasSubagent) && (
        <div className="toolflow-detail">
          {hasSubagent && subagentTasks!.map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
              <span style={{ color: t.status === 'completed' ? '#8db88d' : t.status === 'error' ? '#cf2d56' : '#dfa88f' }}>
                {t.status === 'completed' ? '✓' : t.status === 'error' ? '✕' : '●'}
              </span>
              <span style={{ flex: 1 }}>{t.task}</span>
            </div>
          ))}
          {detail && !hasSubagent && detail}
        </div>
      )}
    </div>
  )
})
```

- [ ] **Step 3: 删除 ChatPanel 底部的 SubagentTracker**

在 `ChatPanel.tsx` 中：

删除 import（行 4）：
```tsx
import { SubagentTracker } from './SubagentTracker'
```

删除渲染（行 85）：
```tsx
          <SubagentTracker />
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。注意 `SubagentTracker.tsx` 文件本身保留（只是不再被 ChatPanel 引用），其内部 import 不会报错。

- [ ] **Step 5: 手动验证（发起触发 subagent 的对话）**

Run: `npm run dev`
Expected:
- subagent 工具作为一个命令行行出现在工具区
- 点开该行详情，显示子任务列表（状态 + 任务文本）
- 列表底部不再有独立的 SubagentTracker 卡片

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ToolflowUnit.tsx src/renderer/components/ToolflowRow.tsx src/renderer/components/ChatPanel.tsx
git commit -m "feat(toolflow): migrate subagent tasks into ToolflowRow detail, remove global SubagentTracker"
```

---

## Task 6: 审批状态接入

**Files:**
- Modify: `src/renderer/components/ToolflowUnit.tsx`

工具等待用户审批时，对应 ToolflowRow 显示 `pending` 状态（从 chatStore 的 `pendingApprovals` 派生）。

- [ ] **Step 1: 在 ToolflowUnit 中从 chatStore 读 pendingApprovals**

在 `ToolflowUnit.tsx` 顶部加 import：

```tsx
import { useChatStore } from '../stores/chatStore'
```

在组件内加：

```tsx
const pendingApprovals = useChatStore((s) => s.pendingApprovals)
```

- [ ] **Step 2: 渲染工具列表时判定 pending 状态**

把工具列表渲染逻辑中的 status 判定改为优先查 pendingApprovals：

```tsx
{tools.map((pair, i) => {
  const toolCallId = pair.use.type === 'tool_use' ? pair.use.id : undefined
  const isPending = toolCallId
    ? pendingApprovals.some((a) => a.toolName === (pair.use.type === 'tool_use' ? pair.use.name : ''))
    : false
  const isSubagent =
    pair.use.type === 'tool_use' &&
    (pair.use.name === 'spawn_subagent' ||
      pair.use.name === 'parallel_subagents' ||
      pair.use.name === 'chain_subagents')
  let status: RowStatus
  if (isPending) status = 'pending'
  else if (pair.result) status = pair.result.is_error ? 'error' : 'done'
  else status = 'running'
  return (
    <ToolflowRow
      key={i}
      pair={pair}
      status={status}
      toolCallId={isSubagent ? toolCallId : undefined}
    />
  )
})}
```

注意：`pendingApprovals` 的匹配目前按 toolName 匹配（`ToolApprovalRequest` 只有 `approvalId`/`toolName`/`toolInput`，无 toolCallId）。这是已知近似——若同一类工具多个并发会不够精确，但当前数据模型不支持更精确匹配。在 ToolflowRow 上 pending 状态的显示优先于 running。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 手动验证（触发需要审批的工具调用）**

Run: `npm run dev`
Expected:
- 工具等待审批时，对应行显示 `◆ pending`（黄色）
- 同时底部 ApprovalBar 浮层照常弹出（双通道）
- 审批后行状态变为 running → done

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ToolflowUnit.tsx
git commit -m "feat(toolflow): show pending status in ToolflowRow for tools awaiting approval"
```

---

## Task 7: ChatPanel 清理 + CSS 收尾

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`
- Modify: `src/renderer/styles/globals.css`

- [ ] **Step 1: 删除 ChatPanel 底部全局 Thinking 胶囊**

在 `ChatPanel.tsx` 删除（原行 86-96）：

```tsx
          {isLoading && (
            <div className="flex justify-center my-4 animate-fade-in">
              <div
                className="flex items-center gap-2 px-3 py-1 rounded-full"
                style={{ background: 'rgba(223,168,143,0.12)' }}
              >
                <span className="w-1.5 h-1.5 rounded-full animate-pulse-soft" style={{ background: '#dfa88f' }} />
                <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08px', color: '#dfa88f', textTransform: 'uppercase' }}>Thinking</span>
              </div>
            </div>
          )}
```

注意：`isLoading` prop 现在不再用于胶囊显示，但保留 prop 定义（可能其他地方用到，如禁用输入框）。仅删除这一段渲染。

- [ ] **Step 2: 清理旧 CSS**

在 `globals.css` 删除（原行 998-1012 附近）：

```css
.tool-row-running { ... }
.tool-detail-enter { ... }
```

保留 `.thinking-*` 相关样式（`.thinking-toggle`/`.thinking-dot`/`.thinking-body` 等，原 818-913 行）——这些虽不再被 ThinkingBlock 引用，但 `.thinking-pulse` keyframe 被 `.toolflow-pill[data-status="active"]` 复用。确认 `thinking-pulse` keyframe 保留即可，其余 `.thinking-toggle` 等若确认无引用可删。

检查 `.animate-pulse-soft` 是否仍被其他组件引用（SubagentTracker、NerveOrb 等可能用）——保留。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 无错误，测试全过

- [ ] **Step 4: 手动整体走查**

Run: `npm run dev`
逐项验证：
- [ ] 纯文本对话：无胶囊，正文正常
- [ ] 带思考的回复：胶囊出现，展开有思考区
- [ ] 带工具的回复：胶囊出现，展开有工具列表（命令行风格）
- [ ] 带思考+工具：两者同在一个胶囊的展开态（思考上、工具下）
- [ ] 流式：干活时自动展开，完成后自动收起
- [ ] 手动点胶囊后不再自动
- [ ] subagent 工具：行内展开有子任务
- [ ] 审批：行内 pending 状态 + 底部浮层
- [ ] 错误：胶囊 error 态，工具行 ✕ failed
- [ ] 底部不再有全局 Thinking 胶囊和 SubagentTracker 卡

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx src/renderer/styles/globals.css
git commit -m "chore(toolflow): remove global thinking pill and clean up legacy CSS"
```

---

## Self-Review

**Spec coverage（对照设计文档各节）:**
- 决策 1（推理可见但默认折叠）→ Task 3 状态机 + Task 4 renderBlocks 接入 ✓
- 决策 2（全部归一个折叠单元）→ Task 1 groupBlocks ✓
- 决策 3（单行胶囊）→ Task 3 ToolflowPill ✓
- 决策 4（分区：思考上工具下）→ Task 3 ToolflowExpanded ✓
- 决策 5（干活展开完成收起 + autoMode latch）→ Task 3 useEffect ✓
- 决策 6a（subagent 并入）→ Task 5 ✓
- 决策 6b（审批双通道）→ Task 6 ✓
- 决策 7（命令行风格）→ Task 2 ToolflowRow ✓
- 文件拆分（MessageBubble 瘦身）→ Task 4 ✓

**Placeholder scan:** 无 TBD/TODO；每步都有完整代码。

**Type consistency:** `BlockGroup`/`ToolPair`/`UnitStatus`/`RowStatus`/`ParsedToolflow` 类型在 Task 1 定义，Task 2/3/5/6 引用一致。`pairTools` 返回 `{ reasoningText, tools }`，Task 3 解构一致。`deriveUnitStatus` 返回 `UnitStatus`，Task 3 用作 `unitStatus`。`pendingApprovals` 的近似匹配已在 Task 6 Step 2 注释说明。
