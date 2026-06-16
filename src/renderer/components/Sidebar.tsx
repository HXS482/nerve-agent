import { useState, useEffect, useCallback, useRef } from 'react'
import { useChatStore, Session } from '../stores/chatStore'
import { SessionList } from './SessionList'
import { PetPixelArt, ColorScheme } from './PetPixelArt'
import { PetSkin } from '../../shared/types'
import { GradientButtonGroup } from './GradientButtonGroup'
import { MemoryBrowser } from './MemoryBrowser'
import { UsageStatsPanel } from './UsageStatsPanel'

interface SidebarProps {
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenGallery: () => void
  onClose: () => void
  onSelectSession: (sessionId: string) => void
}

export function Sidebar({ onNewChat, onOpenSettings, onOpenGallery, onClose, onSelectSession }: SidebarProps) {
  const config = useChatStore((s) => s.config)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const theme = useChatStore((s) => s.theme)
  const toggleTheme = useChatStore((s) => s.toggleTheme)
  const petColorScheme = useChatStore((s) => s.petColorScheme)
  const setPetColorScheme = useChatStore((s) => s.setPetColorScheme)
  const petSkinId = useChatStore((s) => s.petSkinId)
  const sidebarWidth = useChatStore((s) => s.sidebarWidth)
  const setSidebarWidth = useChatStore((s) => s.setSidebarWidth)
  const setPetSkinId = useChatStore((s) => s.setPetSkinId)
  const [skins, setSkins] = useState<PetSkin[]>([])
  const [petState, setPetState] = useState<string>('idle')
  const [petDocked, setPetDocked] = useState(false)
  const [isHoveringDock, setIsHoveringDock] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [petVisible, setPetVisible] = useState(true)
  const resizing = useRef(false)
  const customizeRef = useRef<HTMLDivElement>(null)

  // Load available skins (refresh when customize panel opens)
  useEffect(() => {
    window.claude.listPetSkins().then((s: PetSkin[]) => setSkins(s)).catch(() => {})
  }, [customizeOpen])

  // Listen for pet state and status changes
  useEffect(() => {
    // Sync initial state from main process
    window.claude.getPetState().then(({ visible, docked }: { visible: boolean; docked: boolean }) => {
      setPetVisible(visible)
      setPetDocked(docked)
    }).catch(() => {})

    const unsubState = window.claude.onPetStateChange((state: string) => {
      setPetState(state)
    })
    const unsubStatus = window.claude.onPetStatus(({ visible, docked }: { visible: boolean; docked: boolean }) => {
      setPetVisible(visible)
      setPetDocked(docked)
    })
    return () => {
      unsubState()
      unsubStatus()
    }
  }, [])

  const handleUndock = useCallback(() => {
    window.claude.undockPet()
  }, [])

  const handleTogglePet = useCallback(async () => {
    await window.claude.togglePet()
  }, [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const startX = e.clientX
    const startWidth = sidebarWidth
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return
      const delta = e.clientX - startX
      setSidebarWidth(startWidth + delta)
    }
    const onUp = () => {
      resizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth, setSidebarWidth])

  const handleSelectSession = (session: Session) => {
    onSelectSession(session.id)
  }

  // Close customize panel on click outside
  useEffect(() => {
    if (!customizeOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (customizeRef.current && !customizeRef.current.contains(e.target as Node)) {
        setCustomizeOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [customizeOpen])

  return (
    <aside
      className="fixed left-[1px] top-[1px] bottom-[1px] flex flex-col z-50 transition-[width] duration-300"
      style={{ width: sidebarWidth, background: 'transparent' }}
    >
      {/* Window Controls / Header */}
      <div className="px-4 pt-6 pb-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center justify-between mb-4" style={{ marginTop: '8px' }}>
          <div className="flex gap-2 group/tl" style={{ marginLeft: '10px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="w-3 h-3 rounded-full bg-[#FF5F56] cursor-pointer flex items-center justify-center" onClick={() => window.claude.windowClose()}>
              <svg className="w-2 h-2 opacity-0 group-hover/tl:opacity-100 transition-opacity duration-150" viewBox="0 0 12 12" fill="none" stroke="#4a0002" strokeWidth="2" strokeLinecap="round"><path d="M3 3l6 6M9 3l-6 6" /></svg>
            </div>
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E] cursor-pointer flex items-center justify-center" onClick={() => window.claude.windowMinimize()}>
              <svg className="w-2 h-2 opacity-0 group-hover/tl:opacity-100 transition-opacity duration-150" viewBox="0 0 12 12" fill="none" stroke="#5a3e00" strokeWidth="2" strokeLinecap="round"><path d="M2 6h8" /></svg>
            </div>
            <div className="w-3 h-3 rounded-full bg-[#27C93F] cursor-pointer flex items-center justify-center" onClick={() => window.claude.windowMaximize()}>
              <svg className="w-2 h-2 opacity-0 group-hover/tl:opacity-100 transition-opacity duration-150" viewBox="0 0 12 12" fill="none" stroke="#003a00" strokeWidth="1.5" strokeLinecap="round"><path d="M2 8l4-4 4 4M2 4l4 4 4-4" /></svg>
            </div>
          </div>
          <div className="flex items-center gap-1" style={{ paddingRight: '7px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[var(--text-on-surface-variant)] hover:bg-[var(--bg-surface-container-high)] hover:text-[var(--text-on-surface)] transition-colors cursor-pointer"
              title="Collapse sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
            <button
              onClick={onNewChat}
              className="p-1.5 rounded-md text-[var(--text-on-surface-variant)] hover:bg-[var(--bg-surface-container-high)] hover:text-[var(--text-on-surface)] transition-colors cursor-pointer"
              title="New chat"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div
          className={`flex items-center gap-2 rounded-lg cursor-pointer transition-all duration-300 group ${theme === 'aurora' ? 'dynamic-island' : ''}`}
          style={{
            margin: '24px 8px 0 8px',
            padding: '7px 10px',
            ...(theme === 'aurora'
              ? { border: '1px solid var(--glass-border)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }
              : { background: 'var(--bg-surface-container-high)', border: '1px solid rgba(173, 198, 255, 0.1)' }
            ),
          }}
          onMouseEnter={(e) => {
            if (theme !== 'aurora') {
              e.currentTarget.style.borderColor = 'rgba(173, 198, 255, 0.25)'
              e.currentTarget.style.background = 'var(--bg-surface-container-highest)'
            }
          }}
          onMouseLeave={(e) => {
            if (theme !== 'aurora') {
              e.currentTarget.style.borderColor = 'rgba(173, 198, 255, 0.1)'
              e.currentTarget.style.background = 'var(--bg-surface-container-high)'
            }
          }}
        >
          <svg className="w-4 h-4 text-[var(--accent-primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span className="text-[12px] text-[var(--text-on-surface-variant)] font-medium">History</span>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ padding: '12px 10px' }}>
        <UsageStatsPanel />

        {/* New session button */}
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 transition-colors cursor-pointer"
          style={{
            padding: '8px 10px',
            borderRadius: '9px',
            background: 'transparent',
            border: '1px dashed var(--border-default)',
            marginBottom: 8,
            marginLeft: 3,
            marginRight: 2,
            width: 'calc(100% - 5px)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-surface-container)'
            e.currentTarget.style.borderColor = 'var(--accent-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderColor = 'var(--border-default)'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="text-[12px] font-medium" style={{ color: 'var(--text-on-surface-variant)' }}>
            New session
          </span>
        </button>

        <SessionList
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
        />
      </div>

      {/* Bottom area: pedestal + buttons */}
      <div style={{ padding: '0 4px 14px 4px', marginTop: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Pet dock pedestal */}
        <div
          className="relative"
          style={{
            width: '100%',
            height: '56px',
            cursor: petDocked && petVisible ? 'pointer' : 'default',
          }}
          onMouseEnter={() => setIsHoveringDock(true)}
          onMouseLeave={() => setIsHoveringDock(false)}
          onClick={petDocked && petVisible ? handleUndock : undefined}
        >
          <div className="absolute inset-0 flex items-end justify-center" style={{ paddingBottom: '30px', pointerEvents: 'none', opacity: petDocked && petVisible ? 0 : 1 }}>
            <p className="text-[10px]" style={{ color: theme !== 'light' ? 'rgba(120, 130, 160, 0.25)' : 'rgba(80, 130, 180, 0.35)' }}>
              Drop pet here
            </p>
          </div>

          {petDocked && petVisible && (
            <div
              className="absolute"
              style={{
                left: '50%', bottom: '30px', transform: 'translateX(-50%)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}
            >
              <div style={{ transform: 'scale(0.55)', transformOrigin: 'center bottom', marginBottom: '-14px', position: 'relative', zIndex: 1 }}>
                <PetPixelArt state={petState as any} colorScheme={petColorScheme as ColorScheme} />
              </div>
              <div className="relative" style={{ zIndex: 2 }}>
                <div
                  className="absolute pointer-events-none"
                  style={{
                    width: '80px', height: '28px',
                    top: '-14px', left: '50%', transform: 'translateX(-50%)',
                    borderRadius: '50%',
                    background: theme !== 'light'
                      ? 'radial-gradient(ellipse, rgba(160,170,210,0.4) 0%, rgba(140,150,200,0.15) 40%, transparent 70%)'
                      : 'radial-gradient(ellipse, rgba(100,160,220,0.35) 0%, rgba(80,140,200,0.12) 40%, transparent 70%)',
                    animation: 'pedestal-glow 2s ease-in-out infinite',
                  }}
                />
                <div
                  className="rounded-full transition-all duration-300"
                  style={{
                    width: '64px', height: '10px',
                    background: theme !== 'light'
                      ? 'radial-gradient(ellipse, rgba(140,150,180,0.12) 0%, rgba(100,110,140,0.04) 60%, transparent 100%)'
                      : 'radial-gradient(ellipse, rgba(100,160,220,0.1) 0%, rgba(80,140,200,0.03) 60%, transparent 100%)',
                    boxShadow: isHoveringDock
                      ? theme !== 'light'
                        ? '0 0 12px rgba(140,150,200,0.15)'
                        : '0 0 12px rgba(100,160,220,0.15)'
                      : 'none',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Bottom bar: gradient button group */}
        <div style={{ paddingLeft: '2px' }}>
          <GradientButtonGroup
            onOpenGallery={onOpenGallery}
            onOpenCustomize={() => setCustomizeOpen(!customizeOpen)}
            onOpenMemory={() => setMemoryOpen(!memoryOpen)}
            customizeOpen={customizeOpen}
          />
        </div>
      </div>

      {/* Customize floating panel */}
      {customizeOpen && (
        <>
          <div
            className="fixed inset-0 z-40 animate-fade-in"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
            onClick={() => setCustomizeOpen(false)}
          />
          <div
            className="fixed z-50 animate-modal-in"
            style={{
              top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: 240,
              background: 'var(--dynamic-island-bg)',
              backdropFilter: 'var(--dynamic-island-blur)',
              WebkitBackdropFilter: 'var(--dynamic-island-blur)',
              border: '1px solid var(--dynamic-island-border)',
              borderRadius: 16,
              boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="no-select" style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="text-[13px] font-semibold" style={{ color: 'var(--text-on-surface)' }}>Pet</div>
            </div>
            <div style={{ padding: 10 }}>
              <div
                className="flex items-center justify-between cursor-pointer transition-colors"
                style={{ padding: '8px 10px', borderRadius: 10 }}
                onClick={handleTogglePet}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div className="flex items-center gap-2.5">
                  {petVisible ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-outline)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  )}
                  <span className="text-[12px]" style={{ color: 'var(--text-on-surface)' }}>Show Pet</span>
                </div>
                <div
                  className="rounded-full transition-all duration-200"
                  style={{
                    width: 30, height: 16, padding: 2,
                    background: petVisible ? 'var(--accent-primary)' : 'var(--bg-surface-container-highest)',
                  }}
                >
                  <div
                    className="rounded-full transition-all duration-200"
                    style={{
                      width: 12, height: 12,
                      background: petVisible ? 'var(--bg-surface)' : 'var(--text-outline)',
                      transform: petVisible ? 'translateX(14px)' : 'translateX(0)',
                    }}
                  />
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />

              <div className="flex items-center justify-between" style={{ padding: '8px 10px 4px' }}>
                <span className="text-[10px] font-medium uppercase" style={{ color: 'var(--text-outline-variant)', letterSpacing: '0.6px' }}>Skin</span>
                <button
                  onClick={async () => {
                    const skin = await window.claude.importPetSkin()
                    if (skin) { setSkins((prev) => [...prev, skin]); setPetSkinId(skin.id); window.claude.setPetSkin(skin.id) }
                  }}
                  className="text-[10px] transition-colors cursor-pointer"
                  style={{ color: 'var(--accent-primary)' }}
                  title="Import skin"
                >+ Import</button>
              </div>

              <div className="flex flex-col" style={{ gap: 2 }}>
                {skins.map((skin) => {
                  const isActive = petSkinId === skin.id
                  return (
                    <div
                      key={skin.id}
                      className="flex items-center gap-2 cursor-pointer transition-colors"
                      style={{ padding: '6px 8px', borderRadius: 8, background: isActive ? 'var(--bg-surface-container-high)' : 'transparent' }}
                      onClick={() => { setPetSkinId(skin.id); window.claude.setPetSkin(skin.id) }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                    >
                      <span
                        className={isActive ? 'animate-pulse-soft' : ''}
                        style={{
                          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                          background: isActive ? '#27C93F' : 'var(--text-outline-variant)',
                          display: 'block',
                        }}
                      />
                      <span className="text-[12px] flex-1 truncate" style={{ color: isActive ? 'var(--text-on-surface)' : 'var(--text-on-surface-variant)', fontWeight: isActive ? 500 : 400 }}>
                        {skin.displayName}
                      </span>
                      {!skin.isDefault && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            window.claude.deletePetSkin(skin.id).then((ok: boolean) => {
                              if (ok) { setSkins((prev) => prev.filter((s) => s.id !== skin.id)); if (petSkinId === skin.id) { setPetSkinId('default'); window.claude.setPetSkin('default') } }
                            })
                          }}
                          className="flex items-center justify-center rounded transition-all cursor-pointer"
                          style={{ width: 20, height: 20, borderRadius: 4, color: 'var(--text-outline)', background: 'transparent', border: 'none' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#ff5f56' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-outline)' }}
                          title="Delete"
                        >
                          <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M4 4l8 8M12 4l-8 8" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={{ padding: '8px 0 4px', borderTop: '1px solid var(--border-subtle)', marginTop: 6 }}>
                <div className="flex items-center justify-center">
                  <div style={{ transform: 'scale(0.55)', transformOrigin: 'center' }}>
                    <PetPixelArt state="idle" colorScheme={petColorScheme as ColorScheme} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Brain panel */}
      <MemoryBrowser open={memoryOpen} onClose={() => setMemoryOpen(false)} />

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute', top: 8, right: -2, bottom: 8,
          width: 4, cursor: 'col-resize', borderRadius: 2,
          background: 'transparent', transition: 'background 0.15s', zIndex: 60,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      />
    </aside>
  )
}
