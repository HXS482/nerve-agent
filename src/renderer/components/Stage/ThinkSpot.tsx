import { useEffect, useMemo, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { useChatStore } from '../../stores/chatStore'
import { useStageStore } from '../../stores/stageStore'
import { LaptopLoader } from './LaptopLoader'
import { ThinkTraceContent } from '../ThinkTrace'

// 全局思考点：Stage 形态下唯一的思考指示，与消息流解耦。
// 展示当前会话最新一段 thinking；思考开始自动展开、结束自动收缩（手动操作锁定），均带 grid 高度动画。
export function ThinkSpot({ messages }: { messages: ChatMessage[] }) {
  const currentSessionId = useStageStore((s) => s.stageSessionId)
  const isLoading = useChatStore((s) => s.isLoading)
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)

  // 最新一段思考文本（当前会话最后一个含 thinking 的 assistant 消息）
  const thinking = useMemo(() => {
    const sessionMsgs = messages.filter((m) => m.sessionId === currentSessionId)
    for (let i = sessionMsgs.length - 1; i >= 0; i--) {
      const m = sessionMsgs[i]
      if (m.role !== 'assistant') continue
      const parts = m.content
        .filter((b) => b.type === 'thinking' && b.thinking)
        .map((b) => b.thinking!)
      if (parts.length > 0) return parts.join('\n')
    }
    return ''
  }, [messages, currentSessionId])

  // 每轮思考结束/开始都重置手动锁定，恢复自动展开/收缩
  useEffect(() => setManualExpanded(null), [isLoading])

  const autoExpanded = isLoading && !!thinking
  const expanded = manualExpanded ?? autoExpanded

  // 没有思考内容且不在生成中 → 不渲染
  if (!thinking && !isLoading) return null

  return (
    <div className="think-spot">
      <button
        className="think-toggle"
        data-status={isLoading ? 'active' : 'done'}
        onClick={() => setManualExpanded(!expanded)}
        title="思考"
      >
        <LaptopLoader />
      </button>
      {isLoading && <div className="think-bubble">思考中…</div>}
      <div className="think-trace-body think-spot-panel" data-open={expanded && !!thinking}>
        <div className="think-trace-clip">
          <ThinkTraceContent text={thinking} working={isLoading} />
        </div>
      </div>
    </div>
  )
}
