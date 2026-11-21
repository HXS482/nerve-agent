import { useState, useEffect, useMemo, memo } from 'react'
import type { ContentBlock } from '../../shared/types'
import {
  pairTools,
  deriveUnitStatus,
  getToolSummary,
  getToolDetail,
  type UnitStatus,
  type ToolPair,
} from './toolflow-utils'
import { ToolflowRow, type RowStatus } from './ToolflowRow'
import { ThinkTraceContent } from './ThinkTrace'
import { useChatStore } from '../stores/chatStore'

interface Props {
  blocks: ContentBlock[]
  /** 所在消息是否正在流式输出（纯 thinking 单元据此判断思考仍在进行） */
  isStreaming?: boolean
  /**
   * 思考内容的展开状态由卡片头部（名字右边那枚火花）控制。
   *
   * 传了就别再自己画 header —— 「思考完成」那行字要去掉，只保留图标，
   * 而图标得在名字那一行，跨组件了，所以状态必须上提。
   */
  think?: { open: boolean; onToggle: () => void }
}

// 通用折叠单元：autoMode latch —— 状态变化时自动展开/收起，用户手动操作后锁定
function useAutoExpanded(active: boolean) {
  const [expanded, setExpanded] = useState(false)
  const [autoMode, setAutoMode] = useState(true)

  useEffect(() => {
    if (!autoMode) return
    setExpanded(active)
  }, [active, autoMode])

  const toggle = () => {
    setExpanded((v) => !v)
    setAutoMode(false)
  }
  return { expanded, toggle }
}

function ThinkUnit({ text, status }: { text: string; status: UnitStatus }) {
  const { expanded, toggle } = useAutoExpanded(status === 'active')
  return (
    <div className="think-trace">
      <button
        type="button"
        className="think-trace-header"
        data-open={expanded}
        onClick={toggle}
        aria-expanded={expanded}
        title="思考"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={status === 'active' ? 'var(--text-on-surface-variant)' : 'var(--text-outline-variant)'}>
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <svg className="think-trace-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <ThinkBody text={text} working={status === 'active'} open={expanded} />
    </div>
  )
}

/**
 * 只有思考正文，没有 header。
 *
 * 火花图标搬到卡片头部之后，正文这一侧不需要任何自己的标题 —— 一个消息里
 * 出现两处「思考」是之前的问题：上面一行「思考完成」，下面又一段灰字。
 */
function ThinkBody({ text, working, open }: { text: string; working: boolean; open: boolean }) {
  return (
    <div className="think-trace-body" data-open={open}>
      <div className="think-trace-clip">
        <ThinkTraceContent text={text} working={working} />
      </div>
    </div>
  )
}

/**
 * 一串工具调用。
 *
 * 收起态只有一行极简摘要（「3 个工具 · 2 失败」），没有胶囊、没有背景、没有边框：
 * 展开后本来就看得见每一行，再套一个玻璃胶囊只是在同一个信息上加第二层容器。
 * 那个胶囊曾经是这套 UI 里最显「手搓」的一处。
 */
function ToolsUnit({ tools, status }: { tools: ToolPair[]; status: UnitStatus }) {
  const pendingApprovals = useChatStore((s) => s.pendingApprovals)
  const { expanded, toggle } = useAutoExpanded(status === 'active')

  const errorCount = tools.filter(
    (t) => t.result?.type === 'tool_result' && t.result.is_error
  ).length

  const label = (() => {
    if (status === 'active') return `运行中 · ${tools.length} 个工具`
    if (status === 'error') return `${tools.length} 个工具 · ${errorCount} 个失败`
    return `${tools.length} 个工具`
  })()

  return (
    <div className="toolflow-unit">
      <button
        type="button"
        className="toolflow-summary-line"
        data-status={status}
        data-expanded={expanded}
        onClick={toggle}
        aria-expanded={expanded}
      >
        <span className="toolflow-summary-text">{label}</span>
        <span className="toolflow-summary-chevron" data-expanded={expanded}>▸</span>
      </button>
      <div className="toolflow-expand-grid" data-open={expanded}>
        <div className="toolflow-expand-clip">
          <div className="toolflow-tool-list">
            {tools.map((pair, i) => {
              const toolName = pair.use.type === 'tool_use' ? pair.use.name : ''
              const input = pair.use.type === 'tool_use' ? pair.use.input : undefined
              const useId = pair.use.type === 'tool_use' ? pair.use.id : undefined
              // 按 toolCallId 精确匹配审批；无 id 时退回名字匹配（且已有结果优先于 pending）
              const isPending =
                !pair.result &&
                !!toolName &&
                pendingApprovals.some((a) =>
                  a.toolCallId ? a.toolCallId === useId : a.toolName === toolName,
                )
              const isSubagent =
                pair.use.type === 'tool_use' &&
                (pair.use.name === 'spawn_subagent' ||
                  pair.use.name === 'parallel_subagents' ||
                  pair.use.name === 'chain_subagents')
              const toolCallId = isSubagent && pair.use.type === 'tool_use' ? pair.use.id : undefined
              let status: RowStatus
              if (pair.result) status = pair.result.is_error ? 'error' : 'done'
              else if (isPending) status = 'pending'
              else status = 'running'
              const summary = toolName ? getToolSummary(toolName, input) : ''
              const detail = toolName ? getToolDetail(toolName, input, pair.result) : ''
              return (
                <ToolflowRow
                  key={pair.use.id ?? (pair.use as any).toolCallId ?? i}
                  toolName={toolName || ''}
                  summary={summary}
                  detail={detail}
                  status={status}
                  toolCallId={toolCallId}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export const ToolflowUnit = memo(function ToolflowUnit({ blocks, isStreaming, think }: Props) {
  const unitStatus: UnitStatus = useMemo(() => deriveUnitStatus(blocks), [blocks])
  const { reasoningText, tools } = useMemo(() => pairTools(blocks), [blocks])

  const hasReasoning = !!reasoningText.trim()
  // 思考进行中：最后一块是 thinking，且（单元内有工具未完结 | 消息仍在流式输出）。
  // 注意 deriveUnitStatus 把纯 thinking 单元判为 done，所以流式信号要由外部传入。
  const lastIsThinking = blocks[blocks.length - 1]?.type === 'thinking'
  const thinkStatus: UnitStatus =
    unitStatus !== 'error' && lastIsThinking && (unitStatus === 'active' || isStreaming)
      ? 'active'
      : 'done'

  return (
    <div>
      {/*
       * 思考正文永远跟着工具流走，但它的开关可能在外面（卡片头部那枚火花）。
       * 两种模式的差别只有一行 header 而已，正文是同一个组件。
       */}
      {hasReasoning &&
        (think ? (
          <ThinkBody text={reasoningText} working={thinkStatus === 'active'} open={think.open} />
        ) : (
          <ThinkUnit text={reasoningText} status={thinkStatus} />
        ))}
      {tools.length > 0 && <ToolsUnit tools={tools} status={unitStatus} />}
    </div>
  )
})
