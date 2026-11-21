import { useState, memo, useMemo } from 'react'
import { useSubagentTracker } from '../stores/subagentTracker'

export type RowStatus = 'running' | 'pending' | 'done' | 'error'

interface Props {
  /** 工具名（原始值而非 pair 对象——memo 依赖稳定，流式 tick 不重渲染） */
  toolName: string
  /** 单行摘要（文件路径/命令/pattern） */
  summary: string
  /** 展开详情文本（diff/输出），空串 = 不可展开（subagent 除外） */
  detail: string
  status: RowStatus
  toolCallId?: string  // subagent 工具的 tool_use.id，用于查子任务
}

/**
 * 工具调用的一行。
 *
 * 状态只由一个 5px 圆点表达 —— 这里曾经同时有「左侧状态竖线 + 状态图标 + 胶囊
 * 里的圆点」三层信号，三层说的是同一件事，叠起来只让整行显得廉价。竖线也改成
 * 容器级的连续一条（见 globals.css 的 .toolflow-tool-list::before），不再是每行
 * 各自一小截，展开后才像一条真正的时间轴。
 *
 * 字体分工：工具名是界面元素用 sans，参数（路径/命令/pattern）是可复制的内容用
 * mono。以前整行 mono，导致每行字符宽度不一致、右端参差。
 */
export const ToolflowRow = memo(function ToolflowRow({ toolName, summary, detail, status, toolCallId }: Props) {
  const [detailOpen, setDetailOpen] = useState(false)

  // 只在有子任务可查时才订阅 tracker（其余行不因 subagent 进度事件重渲染）。
  // selector 必须返回稳定引用（空数组字面量每次都是新对象 → getSnapshot 死循环闪退），
  // 所以这里订阅整个 cards，用 toolCallId 判断是否真的取任务。
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
        <span className="toolflow-dot" aria-hidden />
        {toolName && <span className="toolflow-name">{toolName}</span>}
        {toolName && summary && <span className="toolflow-sep">·</span>}
        {summary && <span className="toolflow-summary">{summary}</span>}
        {clickable && <span className="toolflow-chevron" data-open={detailOpen}>▸</span>}
      </div>
      <div className="toolflow-detail-wrap" data-open={detailOpen && clickable ? 'true' : 'false'}>
        <div className="toolflow-detail-clip">
          <div className="toolflow-detail">
            {hasSubagent && subagentTasks!.map((t) => (
              <div key={t.id} className="toolflow-subtask" data-status={t.status}>
                <span className="toolflow-subtask-dot" data-status={t.status} aria-hidden />
                <span className="toolflow-subtask-text">{t.task}</span>
              </div>
            ))}
            {detail && !hasSubagent && detail}
          </div>
        </div>
      </div>
    </div>
  )
})
