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
  // Map from tool_use.id → index in tools[], for O(1) result attachment.
  // 必须查所有未配对的 tool_use，而非仅最后一个，以正确处理并行/乱序的 tool_result。
  const useIndexById = new Map<string, number>()

  for (const block of blocks) {
    if (block.type === 'thinking' && block.thinking) {
      reasoningParts.push(block.thinking)
    } else if (block.type === 'tool_use') {
      if (block.id != null) useIndexById.set(block.id, tools.length)
      tools.push({ use: block })
    } else if (block.type === 'tool_result') {
      const idx = block.toolCallId != null ? useIndexById.get(block.toolCallId) : undefined
      if (idx != null && !tools[idx].result) {
        tools[idx].result = block
      } else {
        // 孤儿 result：无配对的 tool_use。result-only pair，use 留空（保持既有测试行为）
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

  // 有未配对的 tool_use，或（单元里存在工具且最后一块是 thinking，还在流） → active
  const pairs = pairTools(blocks).tools
  const hasPendingTool = pairs.some(
    (p) => p.use.type === 'tool_use' && !p.result
  )
  const lastBlock = blocks[blocks.length - 1]
  const endsWithThinking = lastBlock?.type === 'thinking'
  // 仅当单元中存在工具时，结尾的 thinking 才代表“仍在流式输出”；
  // 纯 thinking（无工具）视为已完成。
  const streamingWithTools = pairs.length > 0 && endsWithThinking

  if (hasPendingTool || streamingWithTools) return 'active'

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
    // 通用 Agent 工具用 description；orchestrator 的 subagent 工具用 task / tasks / steps
    const desc = input.description as string
    if (desc) return desc
    const task = input.task as string
    if (task) return task
    const arr = (input.tasks ?? input.steps) as unknown
    if (Array.isArray(arr)) {
      const first = arr[0]
      const head = typeof first === 'string' ? first : (first as { task?: string })?.task ?? ''
      const more = arr.length > 1 ? ` (+${arr.length - 1} more)` : ''
      return `${head}${more}`
    }
    return ''
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
