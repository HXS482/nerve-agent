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
        <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" style={{ flexShrink: 0, color: 'var(--text-on-surface-variant)' }}>
          <path d="M216,48H40A16,16,0,0,0,24,64V224a15.85,15.85,0,0,0,9.24,14.5A16.13,16.13,0,0,0,40,240a15.89,15.89,0,0,0,10.25-3.78l.09-.07L83,208H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48ZM40,224h0ZM216,192H80a8,8,0,0,0-5.23,1.95L40,224V64H216ZM88,112a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H96A8,8,0,0,1,88,112Zm0,32a8,8,0,0,1,8-8h64a8,8,0,1,1,0,16H96A8,8,0,0,1,88,144Z" />
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
                padding: '5px 6px 5px 0px',
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
            <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" style={{ flexShrink: 0, color: 'var(--text-on-surface-variant)' }}>
              <path d="M168,112a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,112Zm-8,24H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm72-8A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Zm-16,0A88,88,0,1,0,51.81,172.06a8,8,0,0,1,.66,6.54L40,216,77.4,203.53a7.85,7.85,0,0,1,2.53-.42,8,8,0,0,1,4,1.08A88,88,0,0,0,216,128Z" />
            </svg>
            <span
              className="text-[11px] flex-1 uppercase tracking-wider"
              style={{
                color: 'var(--text-on-surface-variant)',
                fontWeight: 500,
                letterSpacing: '0.02em',
              }}
            >
              Channels
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
                          padding: '5px 6px 5px 0px',
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
