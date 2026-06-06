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

const PLATFORM_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  telegram: {
    label: 'Telegram',
    color: '#229ED9',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
      </svg>
    ),
  },
  discord: {
    label: 'Discord',
    color: '#5865F2',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
      </svg>
    ),
  },
  wechat: {
    label: 'WeChat',
    color: '#09C063',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.045c.134 0 .24-.11.24-.245 0-.06-.024-.12-.04-.178l-.325-1.233a.492.492 0 01.177-.554C23.144 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-7.062-6.122zm-2.18 2.768c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982zm4.553 0c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982z"/>
      </svg>
    ),
  },
  feishu: {
    label: 'Feishu',
    color: '#3370FF',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.012 1.996c-.568 0-1.135.176-1.628.527L3.535 6.752A.5.5 0 003.25 7.2v7.084a.5.5 0 00.285.448l6.849 4.229c.493.351 1.06.527 1.628.527.568 0 1.135-.176 1.628-.527l6.849-4.229a.5.5 0 00.285-.448V7.2a.5.5 0 00-.285-.448l-6.849-4.229A3.02 3.02 0 0012.012 1.996z"/>
      </svg>
    ),
  },
  dingtalk: {
    label: 'DingTalk',
    color: '#0089FF',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
      </svg>
    ),
  },
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

  // Separate local (recent) sessions from channel sessions
  const recentSessions = sortedSessions.filter((s) => !s.platform)
  const channelSessions = sortedSessions.filter((s) => !!s.platform)

  // Group channel sessions by platform
  const channelGroups = new Map<string, typeof channelSessions>()
  for (const s of channelSessions) {
    const key = s.platform!
    if (!channelGroups.has(key)) channelGroups.set(key, [])
    channelGroups.get(key)!.push(s)
  }

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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

  const isRecentCollapsed = collapsedGroups.has('recent')
  const isChannelsCollapsed = collapsedGroups.has('channels')

  return (
    <div>
      {/* Recent — collapsible */}
      <button
        onClick={() => toggleGroup('recent')}
        className="flex items-center gap-1.5 w-full text-left transition-colors cursor-pointer"
        style={{
          padding: '6px 6px 4px 6px',
          background: 'transparent',
          border: 'none',
          borderRadius: '4px',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <svg
          width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          style={{
            transform: isRecentCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 0.15s',
            color: 'var(--text-outline-variant)',
            flexShrink: 0,
          }}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--text-on-surface-variant)' }}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span
          className="text-[11px] flex-1 truncate"
          style={{
            color: 'var(--text-on-surface-variant)',
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          Recent
        </span>
        <span
          className="text-[10px]"
          style={{
            color: 'var(--text-outline-variant)',
            background: 'var(--bg-surface-container)',
            padding: '1px 5px',
            borderRadius: '8px',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {recentSessions.length}
        </span>
      </button>

      {!isRecentCollapsed && recentSessions.map((session) => {
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

      {/* Channels — collapsible */}
      {channelGroups.size > 0 && (
        <div>
          <button
            onClick={() => toggleGroup('channels')}
            className="flex items-center gap-1.5 w-full text-left transition-colors cursor-pointer"
            style={{
              padding: '6px 6px 4px 6px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg
              width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              style={{
                transform: isChannelsCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                transition: 'transform 0.15s',
                color: 'var(--text-outline)',
                flexShrink: 0,
              }}
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
            <span
              className="text-[10px] flex-1 uppercase tracking-wider"
              style={{
                color: 'var(--text-outline)',
                fontWeight: 600,
                letterSpacing: '0.05em',
              }}
            >
              Channels
            </span>
            <span
              className="text-[10px]"
              style={{
                color: 'var(--text-outline)',
                background: 'var(--bg-surface-container)',
                padding: '1px 5px',
                borderRadius: '8px',
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {channelSessions.length}
            </span>
          </button>

          {!isChannelsCollapsed && [...channelGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([groupKey, groupSessions]) => {
            const meta = PLATFORM_META[groupKey]
            const isCollapsed = collapsedGroups.has(groupKey)

            return (
              <div key={groupKey} style={{ marginBottom: 2 }}>
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="flex items-center gap-1.5 w-full text-left transition-colors cursor-pointer"
                  style={{
                    padding: '6px 6px 4px 6px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <svg
                    width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    style={{
                      transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                      transition: 'transform 0.15s',
                      color: 'var(--text-outline-variant)',
                      flexShrink: 0,
                    }}
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>

                  {meta ? (
                    <span style={{ color: meta.color, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      {meta.icon}
                    </span>
                  ) : (
                    <span style={{
                      width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--text-outline-variant)',
                      display: 'block',
                    }} />
                  )}

                  <span
                    className="text-[11px] flex-1 truncate"
                    style={{
                      color: meta ? meta.color : 'var(--text-on-surface-variant)',
                      fontWeight: 500,
                      letterSpacing: '0.02em',
                    }}
                  >
                    {meta ? meta.label : (groupKey.charAt(0).toUpperCase() + groupKey.slice(1))}
                  </span>

                  <span
                    className="text-[10px]"
                    style={{
                      color: meta ? meta.color : 'var(--text-outline-variant)',
                      background: meta ? `${meta.color}18` : 'var(--bg-surface-container)',
                      padding: '1px 5px',
                      borderRadius: '8px',
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    {groupSessions.length}
                  </span>
                </button>

                {!isCollapsed && groupSessions.map((session) => {
                  const isActive = session.id === currentSessionId
                  const branches = sessionBranches[session.id]
                  const isExpanded = expandedSession === session.id && branches && branches.length > 1

                  return (
                    <div key={session.id}>
                      <div
                        onClick={() => onSelectSession(session)}
                        className="group flex items-center gap-2 w-full text-left transition-colors cursor-pointer"
                        style={{
                          padding: '5px 6px 5px 22px',
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

                      {isExpanded && branches && (
                        <div style={{ paddingLeft: 42 }}>
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
          })}
        </div>
      )}
    </div>
  )
}
