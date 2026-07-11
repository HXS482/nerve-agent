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
