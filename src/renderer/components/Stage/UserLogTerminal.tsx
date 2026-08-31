import { useEffect, useMemo, useRef } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { useStageStore } from '../../stores/stageStore'
import { buildStageView } from '../../adapters/stageAdapter'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

// 用户消息悬浮列表：右下角无外框，可滚动；点击某条回看该轮回复，再点回到最新轮
export function UserLogTerminal({ messages }: { messages: ChatMessage[] }) {
  const currentSessionId = useStageStore((s) => s.stageSessionId)
  const selectedRoundId = useStageStore((s) => s.selectedRoundId)
  const setSelectedRoundId = useStageStore((s) => s.setSelectedRoundId)
  const listRef = useRef<HTMLDivElement>(null)

  const vm = useMemo(() => {
    const sessionMsgs = currentSessionId ? messages.filter((m) => m.sessionId === currentSessionId) : []
    return buildStageView(sessionMsgs, selectedRoundId)
  }, [messages, currentSessionId, selectedRoundId])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [vm.rounds.length])

  if (vm.rounds.length === 0) return null

  return (
    <div className="user-log-list" ref={listRef}>
      {vm.rounds.map((r) => (
        <button
          key={r.id}
          type="button"
          className={r.id === vm.focusRoundId ? 'user-log-row is-active' : 'user-log-row'}
          title={r.userText}
          onClick={() => setSelectedRoundId(selectedRoundId === r.id ? null : r.id)}
        >
          <span className="user-log-time">[{fmtTime(r.ts)}]</span>
          <span className="user-log-prompt">›</span>
          <span className="user-log-text">{r.userText}</span>
        </button>
      ))}
    </div>
  )
}
