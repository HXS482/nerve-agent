import { useState, useEffect, useMemo, memo } from 'react'
import type { ContentBlock } from '../../shared/types'
import {
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
                  const isSubagent =
                    pair.use.type === 'tool_use' &&
                    (pair.use.name === 'spawn_subagent' ||
                      pair.use.name === 'parallel_subagents' ||
                      pair.use.name === 'chain_subagents')
                  const toolCallId = isSubagent && pair.use.type === 'tool_use' ? pair.use.id : undefined
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
            </>
          )}
        </div>
      )}
    </div>
  )
})
