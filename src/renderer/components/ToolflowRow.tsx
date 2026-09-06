import { useState, memo, useMemo } from 'react'
import type { ContentBlock } from '../../shared/types'
import { getToolSummary, getToolDetail } from './toolflow-utils'
import { useSubagentTracker } from '../stores/subagentTracker'

export type RowStatus = 'running' | 'pending' | 'done' | 'error'

function StatusIcon({ status }: { status: RowStatus }) {
  switch (status) {
    case 'running':
      return (
        <svg className="toolflow-ic is-spin" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'pending':
      return (
        <svg className="toolflow-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 4.8V8l2.2 2.2" strokeLinecap="round" />
        </svg>
      )
    case 'done':
      return (
        <svg className="toolflow-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6.5" strokeOpacity="0.35" />
          <path d="M5.2 8.2l1.9 1.9 3.7-3.9" />
        </svg>
      )
    case 'error':
      return (
        <svg className="toolflow-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.5" strokeOpacity="0.35" />
          <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
        </svg>
      )
  }
}

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

  // Select cards with a stable reference (Zustand Object.is on s.cards avoids
  // re-rendering every row on each tracker update); derive tasks in useMemo.
  const cards = useSubagentTracker((s) => s.cards)
  const subagentTasks = useMemo(() => {
    if (!toolCallId) return null
    for (const card of cards) {
      // spawn/chain tasks use toolCallId === parent id; parallel tasks use
      // `${parent}-t${i}` per child, so match by prefix.
      const tasks = card.tasks.filter(
        (t) => t.toolCallId === toolCallId || t.toolCallId.startsWith(`${toolCallId}-t`)
      )
      if (tasks.length > 0) return tasks
    }
    return null
  }, [cards, toolCallId])
  const hasSubagent = !!subagentTasks && subagentTasks.length > 0
  const clickable = !!detail || hasSubagent

  return (
    <div>
      <div
        className="toolflow-row"
        data-status={status}
        data-clickable={clickable ? 'true' : 'false'}
        onClick={() => clickable && setDetailOpen((v) => !v)}
      >
        <span className="toolflow-rail" />
        <StatusIcon status={status} />
        {name && <span className="toolflow-name">{name}</span>}
        {summary && <span className="toolflow-summary">{summary}</span>}
        {clickable && <span className="toolflow-chevron" data-open={detailOpen}>▸</span>}
      </div>
      <div className="toolflow-detail-wrap" data-open={detailOpen && (detail || hasSubagent) ? 'true' : 'false'}>
        <div className="toolflow-detail-clip">
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
        </div>
      </div>
    </div>
  )
})
