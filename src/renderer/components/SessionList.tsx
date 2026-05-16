import { useState, useEffect } from 'react'
import { useChatStore, Session } from '../stores/chatStore'

interface Branch {
  name: string
  head: string
  active: boolean
}

interface Props {
  currentSessionId: string | null
  onSelectSession: (session: Session) => void
  searchQuery?: string
}

export function SessionList({ currentSessionId, onSelectSession, searchQuery = '' }: Props) {
  const sessions = useChatStore((s) => s.sessions)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const [sessionBranches, setSessionBranches] = useState<Record<string, Branch[]>>({})
  const [expandedSession, setExpandedSession] = useState<string | null>(null)

  const query = searchQuery.toLowerCase().trim()
  const sortedSessions = [...sessions]
    .filter((s) => !query || s.title.toLowerCase().includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  // Load branches when a session is expanded
  useEffect(() => {
    if (!expandedSession || sessionBranches[expandedSession]) return
    window.claude.listBranches(expandedSession).then((branches) => {
      if (branches && branches.length > 1) {
        setSessionBranches((prev) => ({ ...prev, [expandedSession]: branches }))
      }
    }).catch(() => {})
  }, [expandedSession])

  const toggleExpand = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedSession(expandedSession === sessionId ? null : sessionId)
  }

  if (sessions.length === 0) {
    return (
      <div className="px-1.5 py-6 text-center">
        <p className="text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>No conversations yet</p>
      </div>
    )
  }

  if (query && sortedSessions.length === 0) {
    return (
      <div className="px-1.5 py-6 text-center">
        <p className="text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>No matches</p>
      </div>
    )
  }

  return (
    <div>
      {sortedSessions.map((session) => {
        const isActive = session.id === currentSessionId
        const branches = sessionBranches[session.id]
        const isExpanded = expandedSession === session.id && branches && branches.length > 1

        return (
          <div key={session.id}>
            <div
              onClick={() => onSelectSession(session)}
              className="group flex items-center gap-2 w-full text-left transition-colors cursor-pointer"
              style={{
                padding: '5px 6px 5px 8px',
                borderRadius: '6px',
                background: isActive ? 'var(--bg-surface-container-high)' : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = 'var(--bg-surface-container)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent'
              }}
            >
              {/* Branch expand toggle */}
              {branches && branches.length > 1 ? (
                <button
                  onClick={(e) => toggleExpand(session.id, e)}
                  className="shrink-0 flex items-center justify-center transition-colors cursor-pointer"
                  style={{
                    width: 12, height: 12,
                    color: 'var(--text-outline-variant)',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                  }}
                >
                  <svg
                    width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </button>
              ) : (
                <span style={{ width: 12, flexShrink: 0 }} />
              )}

              <span
                className={isActive ? 'animate-pulse-soft' : ''}
                style={{
                  width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                  background: isActive ? '#27C93F' : 'var(--text-outline-variant)',
                  display: 'block',
                }}
              />
              <span
                className="text-[12px] flex-1 truncate"
                style={{
                  color: isActive ? 'var(--text-on-surface)' : 'var(--text-on-surface-variant)',
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                {session.title}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteSession(session.id)
                  window.claude.deleteSessionRemote(session.id).catch(() => {})
                }}
                className="shrink-0 flex items-center justify-center rounded transition-all"
                style={{
                  width: 16, height: 16,
                  color: 'var(--text-outline-variant)',
                  opacity: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--bg-surface-container-high)' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.background = 'transparent' }}
                title="Delete"
              >
                <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {/* Branch list */}
            {isExpanded && branches && (
              <div style={{ paddingLeft: 28 }}>
                {branches.map((b) => (
                  <div
                    key={b.name}
                    className="flex items-center gap-1.5"
                    style={{
                      padding: '3px 6px',
                      fontSize: 11,
                      color: b.active ? 'var(--accent-primary)' : 'var(--text-outline-variant)',
                      fontWeight: b.active ? 500 : 400,
                    }}
                  >
                    <span style={{
                      width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
                      background: b.active ? '#27C93F' : 'var(--text-outline-variant)',
                      display: 'block',
                    }} />
                    <span className="truncate">{b.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
