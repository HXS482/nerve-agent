import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { ContentBlock, ChatMessage } from '../../../shared/types'
import { pairTools, getToolSummary } from '../toolflow-utils'
import type { RowStatus } from '../ToolflowRow'
import { ToolIcon } from './ToolIcon'
import { useChatStore } from '../../stores/chatStore'
import { useStageStore } from '../../stores/stageStore'

// 全局工具点：Stage 形态下唯一的工具调用指示，与消息流解耦。
// 顶部是胶囊总图标（常驻），下面左侧边缘垂直排列每个工具调用的圆形图标；
// 执行中新调用追加时 dock 自动滚动展示；点击总图标折叠/展开其它工具的图标。
// 状态语义扩展：dock 只取最近 N 个可视，多出的滚动；折叠态只剩总图标与计数。

/** 已有结果的行距底部 40px 内才跟随滚动，避免用户上翻时被拽回 */
function nearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

export function ToolSpot({ messages }: { messages: ChatMessage[] }) {
  const currentSessionId = useStageStore((s) => s.stageSessionId)
  const pendingApprovals = useChatStore((s) => s.pendingApprovals)
  const [collapsed, setCollapsed] = useState(false)
  const dockRef = useRef<HTMLDivElement>(null)
  const sigRef = useRef('')
  const toolBlocksRef = useRef<ContentBlock[]>([])

  // 当前轮（最后一条用户消息之后）的所有工具块。
  // 签名缓存：tool 块只在 assistant IPC 到达时变化，文本/thinking 的原地更新
  // 会给 messages 换新数组但不改块数——按长度签名跳过，避免每个流式 tick 重算。
  const sig = `${currentSessionId}|${messages.length}|${messages[messages.length - 1]?.content.length ?? 0}`
  const toolBlocks = useMemo(() => {
    if (sigRef.current === sig) return toolBlocksRef.current
    const sessionMsgs = messages.filter((m) => m.sessionId === currentSessionId)
    let lastUserIdx = -1
    for (let i = sessionMsgs.length - 1; i >= 0; i--) {
      if (sessionMsgs[i].role === 'user') { lastUserIdx = i; break }
    }
    const blocks: ContentBlock[] = []
    for (const m of sessionMsgs.slice(lastUserIdx + 1)) {
      if (m.role !== 'assistant') continue
      for (const b of m.content) {
        if (b.type === 'tool_use' || b.type === 'tool_result') blocks.push(b)
      }
    }
    sigRef.current = sig
    toolBlocksRef.current = blocks
    return blocks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const tools = useMemo(() => pairTools(toolBlocks).tools, [toolBlocks])

  // 每个工具调用算出自己的状态（与 ToolflowRow 同一套规则）。
  // pending 匹配：优先按 toolCallId 精确匹配；已有结果的结果状态优先于 pending，
  // 避免同名的另一调用在等审批时把已完成行"传染"成 pending。
  const rows = useMemo(() => tools.map((pair) => {
    const toolName = pair.use.type === 'tool_use' ? pair.use.name || 'tool' : ''
    const input = pair.use.type === 'tool_use' ? pair.use.input : undefined
    const useId = pair.use.type === 'tool_use' ? pair.use.id : undefined
    const isPending =
      !pair.result &&
      pendingApprovals.some((a) =>
        a.toolCallId ? a.toolCallId === useId : a.toolName === toolName,
      )
    let status: RowStatus
    if (pair.result) status = pair.result.is_error ? 'error' : 'done'
    else if (isPending) status = 'pending'
    else status = 'running'
    const summary = toolName ? getToolSummary(toolName, input) : ''
    return { useId, toolName, status, summary }
  }), [tools, pendingApprovals])
  // 执行中新调用追加 → dock 滚动到底（仅当用户本就贴底）。
  // 用 rAF 缓动替代系统 smooth：距离自适应时长，连续追加打断旧段、从当前位置续滚，
  // 不会像 behavior:'smooth' 那样在中途突然跳针到新目标。
  const scrollRafRef = useRef(0)
  function scrollDockToLatest() {
    const dock = dockRef.current
    if (!dock || collapsed) return
    const delta = dock.scrollHeight - dock.scrollTop
    if (Math.abs(delta) < 1) return
    cancelAnimationFrame(scrollRafRef.current)
    const start = dock.scrollTop
    const duration = Math.min(300, Math.max(150, Math.abs(delta)))
    const t0 = performance.now()
    const step = (now: number) => {
      const p = Math.min((now - t0) / duration, 1)
      dock.scrollTop = start + delta * (1 - Math.pow(1 - p, 4))
      if (p < 1) scrollRafRef.current = requestAnimationFrame(step)
    }
    scrollRafRef.current = requestAnimationFrame(step)
  }
  useEffect(() => {
    const dock = dockRef.current
    if (dock && !collapsed && nearBottom(dock)) scrollDockToLatest()
  }, [tools.length, collapsed])
  // 卸载时停掉未完成滚动
  useEffect(() => () => cancelAnimationFrame(scrollRafRef.current), [])

  // 会话切换时恢复展开（避免 stale-collapsed 盯着新会话的收着状态）
  useEffect(() => setCollapsed(false), [currentSessionId])

  if (tools.length === 0) return null

  const aggregateStatus: RowStatus = rows.some((r) => r.status === 'error')
    ? 'error'
    : rows.some((r) => r.status === 'running')
      ? 'running'
      : rows.some((r) => r.status === 'pending')
        ? 'pending'
        : 'done'

  return (
    <div className="tool-spot">
      <button
        className="tool-spot-icon tool-spot-all"
        data-status={aggregateStatus}
        onClick={() => {
          setCollapsed((v) => !v)
          cancelAnimationFrame(scrollRafRef.current)
        }}
        title={collapsed ? `${tools.length} 个工具 · 点击展开` : `${tools.length} 个工具 · 点击收起`}
      >
        <svg width="15" height="13" viewBox="0 0 1152 1024" fill="currentColor">
          <path d="M563.584 32a131.904 131.904 0 0 1 35.2 259.072V374.4l206.272 122.56v235.008l68.288 37.952c21.952-23.488 52.48-38.912 86.464-41.472l9.856-0.32a131.904 131.904 0 1 1-127.424 97.728l-72.832-40.512-202.88 107.84-199.872-109.632-74.368 39.424c1.6 6.72 2.624 13.696 3.2 20.736l0.32 9.856a131.904 131.904 0 1 1-33.088-87.424l72.192-38.208V497.28l199.872-122.496V292.672A131.968 131.968 0 0 1 432 173.76l-0.32-9.856C431.68 91.072 490.688 32 563.52 32z m406.08 760.192a67.904 67.904 0 1 0 0 135.808 67.904 67.904 0 0 0 0-135.808z m-805.76-6.464a67.904 67.904 0 1 0 0 135.808 67.904 67.904 0 0 0 0-135.808zM567.04 430.08L398.912 533.12v195.136l168.064 92.224 174.08-92.48v-194.56L566.976 430.08zM563.584 96a67.904 67.904 0 1 0 0 135.808 67.904 67.904 0 0 0 0-135.808z" />
        </svg>
        <motion.span
          key={tools.length}
          className="tool-spot-count"
          initial={{ scale: 1.7, opacity: 0.3 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 20 }}
        >
          {tools.length}
        </motion.span>
      </button>
      <motion.div
        className="tool-spot-dock-wrap"
        initial={false}
        animate={{ height: collapsed ? 0 : 'auto', opacity: collapsed ? 0 : 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      >
        <div className="tool-spot-dock" ref={dockRef}>
          {rows.map((row, i) => (
            <motion.div
              key={row.useId ?? i}
              className="tool-spot-icon"
              data-status={row.status}
              title={row.summary ? `${row.toolName} · ${row.summary}` : row.toolName}
              initial={{ opacity: 0, y: -18, scale: 0.5 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 24, delay: Math.min(i, 4) * 0.05 }}
            >
              <ToolIcon name={row.toolName} />
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}

