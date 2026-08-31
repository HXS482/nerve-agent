import { useMemo } from 'react'
import { useChatStore, Session } from '../../stores/chatStore'
import { useStageStore } from '../../stores/stageStore'

function formatSessionTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

interface Props {
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
}

// Stage 模式的会话抽屉：卡片式条目，只显示 stage 会话
export function StageSessions({ onSelectSession, onNewSession }: Props) {
  const sessions = useChatStore((s) => s.sessions)
  const currentSessionId = useStageStore((s) => s.stageSessionId)
  const deleteSession = useChatStore((s) => s.deleteSession)

  const stageSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.mode === 'stage')
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  )

  return (
    <div className="stage-sessions">
      <div className="stage-sessions-header">
        <span className="stage-sessions-title">Sessions</span>
        <button className="stage-sessions-new" onClick={onNewSession} title="新建会话">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <div className="stage-sessions-list">
        {stageSessions.length === 0 && (
          <div className="stage-sessions-empty">还没有空间会话</div>
        )}
        {stageSessions.map((s) => (
          <div
            key={s.id}
            className={`stage-session-item${s.id === currentSessionId ? ' is-active' : ''}`}
            onClick={() => onSelectSession(s.id)}
          >
            <div className="stage-session-main">
              <span className="stage-session-title">{s.title || 'Untitled'}</span>
              <span className="stage-session-time">{formatSessionTime(s.updatedAt)}</span>
            </div>
            <button
              className="stage-session-del"
              title="删除会话"
              onClick={(e) => {
                e.stopPropagation()
                deleteSession(s.id)
              }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
