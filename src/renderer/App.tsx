import { useClaude } from './hooks/useClaude'
import { useChatStore } from './stores/chatStore'
import { ChatPanel } from './components/ChatPanel'
import { getApprovalSummary } from './components/ChatPanel'
import { InputBar } from './components/InputBar'
import { Sidebar } from './components/Sidebar'
import { RightSidebar } from './components/RightSidebar'
import { SettingsPanel } from './components/SettingsPanel'
import { Gallery } from './components/Gallery'
import { PetView } from './components/PetView'
import { ModelIsland } from './components/ModelIsland'
import Grainient from './components/Grainient'
import { useState, useEffect, useCallback } from 'react'

function ApprovalBar() {
  const pendingApprovals = useChatStore((s) => s.pendingApprovals)
  const current = pendingApprovals[0]

  const handleResponse = useCallback((approved: boolean) => {
    if (!current) return
    useChatStore.getState().removeApproval(current.approvalId)
    window.claude.respondToolApproval({ approvalId: current.approvalId, approved })
  }, [current?.approvalId])

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleResponse(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleResponse(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current?.approvalId, handleResponse])

  if (!current) return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 52,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        minWidth: 357,
        maxWidth: '70%',
        background: 'color-mix(in srgb, var(--glass-bg) 30%, transparent)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid var(--glass-border)',
        borderRadius: 12,
        padding: '7px 14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
        animation: 'fade-in-simple 0.15s ease-out',
      }}
    >
      <div className="flex items-center gap-3">
        {/* Warning icon */}
        <div
          style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: 'rgba(255, 193, 7, 0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffc107" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>

        {/* Tool info */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-on-surface)', flexShrink: 0 }}>
            {current.toolName}
          </span>
          <span className="truncate font-mono" style={{ fontSize: '11px', color: 'var(--text-outline)' }}>
            {getApprovalSummary(current)}
          </span>
        </div>

        {/* Queue count */}
        {pendingApprovals.length > 1 && (
          <span style={{ fontSize: '11px', color: 'var(--text-outline)', flexShrink: 0 }}>
            +{pendingApprovals.length - 1}
          </span>
        )}

        {/* Deny */}
        <button
          onClick={() => handleResponse(false)}
          style={{
            fontSize: '12px', fontWeight: 500, padding: '5px 14px', borderRadius: 8,
            background: 'rgba(244, 67, 54, 0.1)', color: '#ef5350',
            border: '1px solid rgba(244, 67, 54, 0.2)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Deny
        </button>

        {/* Allow */}
        <button
          onClick={() => handleResponse(true)}
          autoFocus
          style={{
            fontSize: '12px', fontWeight: 500, padding: '5px 16px', borderRadius: 8,
            background: 'rgba(76, 175, 80, 0.15)', color: '#66bb6a',
            border: '1px solid rgba(76, 175, 80, 0.25)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Allow
        </button>
      </div>
    </div>
  )
}

const SIDEBAR_OFFSET = 8 // 4px (root margin) + 4px (gap between sidebar and main content border)

export default function App() {
  // Hash routing: #/pet renders the pet window
  if (window.location.hash === '#/pet') {
    return <PetView />
  }

  const claude = useClaude()
  const sidebarOpen = useChatStore((s) => s.sidebarOpen)
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen)
  const sidebarWidth = useChatStore((s) => s.sidebarWidth)
  const rightSidebarOpen = useChatStore((s) => s.rightSidebarOpen)
  const rightSidebarWidth = useChatStore((s) => s.rightSidebarWidth)
  const toggleRightSidebar = useChatStore((s) => s.toggleRightSidebar)
  const theme = useChatStore((s) => s.theme)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <div
      className="h-screen w-screen flex overflow-hidden"
      style={{
        background: 'transparent',
        borderRadius: 'var(--app-window-radius)',
        clipPath: 'inset(0 round var(--app-window-radius))',
      }}
    >
      {/* Solid background layer — clipped to exclude sidebar area */}
      <div
        className="fixed inset-0"
        style={{
          background: 'var(--bg-background)',
          borderRadius: 'var(--app-window-radius)',
          clipPath: sidebarOpen
            ? `inset(0 0 0 ${sidebarWidth + SIDEBAR_OFFSET}px)`
            : 'inset(0 0 0 0)',
          transition: 'clip-path 0.3s ease',
          zIndex: 0,
        }}
      />

      {/* Aurora Grainient — intentionally not clipped, glow extends under sidebar */}
      {theme === 'aurora' && (
        <div className="fixed inset-0 z-0">
          <Grainient
            color1="#FF9FFC"
            color2="#5227FF"
            color3="#B497CF"
            timeSpeed={0.85}
            colorBalance={0}
            warpStrength={1}
            warpFrequency={5}
            warpSpeed={2}
            warpAmplitude={50}
            blendAngle={0}
            blendSoftness={0.05}
            rotationAmount={500}
            noiseScale={2}
            grainAmount={0.1}
            grainScale={2}
            grainAnimated={false}
            contrast={1.5}
            gamma={1}
            saturation={1}
            centerX={0}
            centerY={0}
            zoom={0.9}
          />
        </div>
      )}

      {/* Floating Sidebar */}
      {sidebarOpen && (
        <Sidebar
          onNewChat={claude.clearMessages}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenGallery={() => setGalleryOpen(true)}
          onClose={() => setSidebarOpen(false)}
          onSelectSession={claude.loadSessionMessages}
        />
      )}

      {/* Main Content Area */}
      <main
        className="flex-1 flex flex-col overflow-hidden relative"
        style={{
          margin: '4px',
          marginLeft: sidebarOpen ? `${sidebarWidth + SIDEBAR_OFFSET}px` : '4px',
          marginRight: rightSidebarOpen ? `${rightSidebarWidth + 8}px` : '4px',
          background: 'transparent',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--app-shell-radius)',
          transition: 'margin-left 0.3s ease, margin-right 0.3s ease',
        }}
      >
        {/* Floating header — drag region + controls */}
        <div
          className="absolute top-0 left-0 right-0 z-30 flex items-center no-select"
          style={{ padding: '8px 11px', WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {/* Left: model island (with sidebar toggle when collapsed) */}
          <div
            className="flex items-center gap-1.5 shrink-0"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ModelIsland
              currentModel={claude.config.model || 'sonnet'}
              onSelectModel={(model, providerId) => claude.updateConfig({ model, ...(providerId ? { provider: providerId } : {}) })}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen(true)}
            />
          </div>

          {/* Center spacer */}
          <div className="flex-1" />

          {/* Right: toggle sidebar + settings + cmd */}
          <div
            className={`flex items-center gap-1.5 shrink-0 ${theme === 'aurora' ? 'dynamic-island' : 'bg-[var(--bg-surface-container)]'} border ${theme === 'aurora' ? 'border-[var(--glass-border)]' : 'border-[var(--border-default)]'}`}
            style={{
              padding: '4px 10px',
              borderRadius: 9,
              height: 28,
              WebkitAppRegion: 'no-drag',
              boxShadow: theme === 'aurora' ? '0 20px 50px rgba(0,0,0,0.5)' : undefined,
            } as React.CSSProperties}
          >
            <button
              onClick={toggleRightSidebar}
              className="p-1.5 rounded-full text-[var(--text-on-surface-variant)] hover:text-[var(--text-on-surface)] transition-colors"
              title="Toggle right sidebar"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M15 3v18" />
              </svg>
            </button>
            <div className="w-px h-4" style={{ background: 'var(--border-default)' }} />
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded-full text-[var(--text-on-surface-variant)] hover:text-[var(--text-on-surface)] transition-colors"
              title="Settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13 1.41-.513M5.106 17.785l1.15-.964m11.49-9.642 1.149-.964M7.501 19.795l.75-1.3m7.5-12.99.75-1.3m-6.063 16.658.26-1.477m2.605-14.772.26-1.477m0 17.726-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205 12 12m6.894 5.785-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495" />
              </svg>
            </button>
            <div className="w-px h-4" style={{ background: 'var(--border-default)' }} />
            <button
              className="p-1.5 rounded-full text-[var(--text-on-surface-variant)] hover:text-[var(--text-on-surface)] transition-colors"
              title="Command palette"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          <ChatPanel messages={claude.messages} isLoading={claude.isLoading} onSend={claude.send} />
          <ApprovalBar />
          <InputBar
            onSend={claude.send}
            onCancel={claude.cancel}
            isLoading={claude.isLoading}
          />
        </div>
      </main>

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsPanel
          config={claude.config}
          onUpdateConfig={claude.updateConfig}
          onPickDirectory={claude.pickDirectory}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Gallery modal */}
      {galleryOpen && <Gallery onClose={() => setGalleryOpen(false)} />}

      {/* Right Sidebar */}
      <RightSidebar />
    </div>
  )
}
