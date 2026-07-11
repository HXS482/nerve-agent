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

  // tool_use 块：取 name + input；孤儿 result 块：name 留空
  const isUse = pair.use.type === 'tool_use'
  const name = isUse ? pair.use.name || 'tool' : ''
  const input = isUse ? pair.use.input : undefined
  const summary = isUse ? getToolSummary(name, input) : ''
  const detail = isUse ? getToolDetail(name, input, pair.result) : ''

  const subagentTasks = useSubagentTracker((s) => {
    if (!toolCallId) return null
    for (const card of s.cards) {
      const tasks = card.tasks.filter((t) => t.toolCallId === toolCallId)
      if (tasks.length > 0) return tasks
    }
    return null
  })
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
