import { useState, useEffect, useMemo, memo } from 'react'
import type { ContentBlock } from '../../shared/types'
import {
  pairTools,
  deriveUnitStatus,
  type UnitStatus,
  type ToolPair,
} from './toolflow-utils'
import { ToolflowRow, type RowStatus } from './ToolflowRow'
import { useChatStore } from '../stores/chatStore'

interface Props {
  blocks: ContentBlock[]
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
  return (
    <div>
      <button className="think-toggle" data-status={status} onClick={toggle} title="思考">
        <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor">
          <path d="M42.666667 469.333333c0-144.099556 123.448889-213.333333 217.201777-213.333333 139.946667 0 210.716444 95.345778 285.127112 186.311111C625.777778 541.013333 671.345778 597.333333 764.131556 597.333333c61.383111 0 131.868444-44.544 131.868444-128S825.457778 341.333333 764.131556 341.333333c-58.254222 0-104.96 43.747556-125.383112 63.715556a42.666667 42.666667 0 1 1-59.562666-61.041778c18.432-18.033778 88.064-88.007111 184.888889-88.007111 93.809778 0 217.258667 69.233778 217.258666 213.333333S857.884444 682.666667 764.131556 682.666667c-139.946667 0-210.716444-95.345778-285.127112-186.311111C398.222222 397.653333 352.654222 341.333333 259.868444 341.333333 198.542222 341.333333 128 385.877333 128 469.333333s70.542222 128 131.868444 128c59.164444 0 87.153778-26.339556 125.326223-63.715555a42.666667 42.666667 0 1 1 59.619555 61.041778C405.447111 633.173333 355.84 682.666667 259.982222 682.666667 166.115556 682.666667 42.666667 613.432889 42.666667 469.333333z" />
        </svg>
      </button>
      {expanded && (
        <div className="toolflow-expanded" data-kind="think">
          <div className="toolflow-reasoning">{text}</div>
        </div>
      )}
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

export const ToolflowUnit = memo(function ToolflowUnit({ blocks }: Props) {
  const unitStatus: UnitStatus = useMemo(() => deriveUnitStatus(blocks), [blocks])
  const { reasoningText, tools } = useMemo(() => pairTools(blocks), [blocks])

  const hasReasoning = !!reasoningText.trim()
  // 思考是否仍在流式输出：整体 active 且最后一块是 thinking
  const lastIsThinking = blocks[blocks.length - 1]?.type === 'thinking'
  const thinkStatus: UnitStatus = unitStatus === 'active' && lastIsThinking ? 'active' : 'done'

  return (
    <div>
      {hasReasoning && <ThinkUnit text={reasoningText} status={thinkStatus} />}
      {tools.length > 0 && <ToolsUnit tools={tools} status={unitStatus} />}
    </div>
  )
})
