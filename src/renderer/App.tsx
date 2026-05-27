import { useClaude } from './hooks/useClaude'
import { useChatStore } from './stores/chatStore'
import { ChatPanel } from './components/ChatPanel'
import { InputBar } from './components/InputBar'
import { Sidebar } from './components/Sidebar'
import { RightSidebar } from './components/RightSidebar'
import { SettingsPanel } from './components/SettingsPanel'
import { Gallery } from './components/Gallery'
import { PetView } from './components/PetView'
import { ModelIsland } from './components/ModelIsland'
import Grainient from './components/Grainient'
import { NerveCloud } from './components/NerveCloud'
import { useState, useEffect } from 'react'

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
  const orbState = useChatStore((s) => s.orbState)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <div
      className="h-screen w-screen flex overflow-hidden"
      style={{
        background: 'var(--bg-background)',
        borderRadius: 'var(--app-window-radius)',
        clipPath: 'inset(0 round var(--app-window-radius))',
      }}
    >
      {/* Aurora theme background */}
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
          marginLeft: sidebarOpen ? `${sidebarWidth + 8}px` : '4px',
          marginRight: rightSidebarOpen ? `${rightSidebarWidth + 8}px` : '4px',
          background: 'var(--bg-mica)',
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

          {/* Center: Nerve Orb */}
          <div className="flex-1 flex justify-center items-center">
            <NerveCloud state={orbState} theme={theme} size={64} />
          </div>

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
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
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
