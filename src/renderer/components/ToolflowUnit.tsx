import { useState, useEffect, useMemo, memo } from 'react'
import type { ContentBlock } from '../../shared/types'
import {
  pairTools,
  deriveUnitStatus,
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

function Pill({ kind, status, label, expanded, onClick }: {
  kind: 'think' | 'tools'
  status: UnitStatus
  label: string
  expanded: boolean
  onClick: () => void
}) {
  return (
    <button
      className="toolflow-pill"
      data-kind={kind}
      data-status={status}
      onClick={onClick}
    >
      <span className="toolflow-pill-dot" />
      <span>{label}</span>
      <span className="toolflow-pill-chevron" data-expanded={expanded}>▸</span>
    </button>
  )
}

function ThinkUnit({ text, status }: { text: string; status: UnitStatus }) {
  const { expanded, toggle } = useAutoExpanded(status === 'active')
  const working = status === 'active'
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill={working ? 'var(--text-on-surface-variant)' : 'var(--text-outline-variant)'}>
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        {working ? (
          <span className="think-trace-status is-working" role="status">思考中</span>
        ) : (
          <span className="think-trace-status" role="status">思考完成</span>
        )}
        <svg className="think-trace-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className="think-trace-body" data-open={expanded}>
        <div className="think-trace-clip">
          <ThinkTraceContent text={text} working={working} />
        </div>
      </div>
    </div>
  )
}

function ToolsUnit({ tools, status }: { tools: ToolPair[]; status: UnitStatus }) {
  const pendingApprovals = useChatStore((s) => s.pendingApprovals)
  const { expanded, toggle } = useAutoExpanded(status === 'active')

  const errorCount = tools.filter(
    (t) => t.result?.type === 'tool_result' && t.result.is_error
  ).length

  const label = (() => {
    if (status === 'active') return `运行了 ${tools.length} 个工具`
    if (status === 'error') return `${tools.length} 个工具（${errorCount} 失败）`
    return `${tools.length} 个工具`
  })()

  return (
    <div>
      <Pill kind="tools" status={status} label={label} expanded={expanded} onClick={toggle} />
      {expanded && (
        <div className="toolflow-expanded" data-kind="tools">
          <div className="toolflow-tool-list">
            {tools.map((pair, i) => {
              const toolName = pair.use.type === 'tool_use' ? pair.use.name : ''
              // NOTE: ToolApprovalRequest carries no toolCallId, so we match by
              // toolName. If two tools of the same name run concurrently, both
              // would render as pending — acceptable given the current data model.
              const isPending = pendingApprovals.some((a) => a.toolName === toolName)
              const isSubagent =
                pair.use.type === 'tool_use' &&
                (pair.use.name === 'spawn_subagent' ||
                  pair.use.name === 'parallel_subagents' ||
                  pair.use.name === 'chain_subagents')
              const toolCallId = isSubagent && pair.use.type === 'tool_use' ? pair.use.id : undefined
              let status: RowStatus
              if (isPending) status = 'pending'
              else if (pair.result) status = pair.result.is_error ? 'error' : 'done'
              else status = 'running'
              return (
                <ToolflowRow
                  key={i}
                  pair={pair}
                  status={status}
                  toolCallId={toolCallId}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export const ToolflowUnit = memo(function ToolflowUnit({ blocks, isStreaming }: Props) {
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
      {hasReasoning && <ThinkUnit text={reasoningText} status={thinkStatus} />}
      {tools.length > 0 && <ToolsUnit tools={tools} status={unitStatus} />}
    </div>
  )
})
