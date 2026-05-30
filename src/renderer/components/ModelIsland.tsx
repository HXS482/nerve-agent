import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../stores/chatStore'

interface Props {
  currentModel: string
  onSelectModel: (model: string, providerId?: string) => void
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
}

export function ModelIsland({ currentModel, onSelectModel, sidebarOpen, onToggleSidebar }: Props) {
  const providers = useChatStore((s) => s.providers)
  const availableModels = useChatStore((s) => s.availableModels)
  const providerModels = useChatStore((s) => s.providerModels)
  const config = useChatStore((s) => s.config)
  const theme = useChatStore((s) => s.theme)
  const storeDefaultProvider = useChatStore((s) => s.defaultProvider)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Use config.provider as authoritative, then settings defaultProvider, then prefix detection
  const detectProvider = (model: string): string => {
    if (model.startsWith('gpt') || model.startsWith('o1')) return 'openai'
    if (model.startsWith('gemini')) return 'google'
    return 'anthropic'
  }

  const activeProvider = config.provider || storeDefaultProvider || detectProvider(currentModel)

  // Build grouped models: only show the active provider's models
  const groupedModels: Record<string, { alias: string; name: string }[]> = {}

  // 1. Models from providerModels (fetched & saved per provider) — filter to active provider
  const activeModels = providerModels[activeProvider]
  if (activeModels && activeModels.length > 0) {
    groupedModels[activeProvider] = activeModels.map((m) => ({ alias: m, name: m }))
  }

  // 2. Fallback: if no providerModels at all, use availableModels under active provider
  if (Object.keys(groupedModels).length === 0 && availableModels.length > 0) {
    const target = activeProvider || 'anthropic'
    groupedModels[target] = availableModels.map((m) => ({ alias: m.alias, name: m.name }))
  }

  // 3. Hardcoded defaults as last resort
  if (Object.keys(groupedModels).length === 0) {
    groupedModels['anthropic'] = [
      { alias: 'sonnet', name: 'claude-sonnet-4-20250514' },
      { alias: 'opus', name: 'claude-opus-4-20250514' },
      { alias: 'haiku', name: 'claude-haiku-4-5-20251001' },
    ]
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1)

  return (
    <div className="relative shrink-0" ref={ref}>
      {/* Single pill: provider ▾ */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 transition-colors cursor-pointer ${theme === 'aurora' ? 'dynamic-island' : ''}`}
        style={{
          padding: '4px 10px',
          height: 28,
          borderRadius: 9,
          fontSize: 11,
          fontWeight: 500,
          background: theme === 'aurora' ? undefined : 'var(--bg-surface-container)',
          color: 'var(--text-on-surface-variant)',
          border: theme === 'aurora' ? '1px solid var(--glass-border)' : '1px solid var(--border-default)',
          boxShadow: theme === 'aurora' ? '0 20px 50px rgba(0,0,0,0.5)' : undefined,
        }}
      >
        {!sidebarOpen && onToggleSidebar && (
          <>
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="cursor-pointer hover:text-[var(--text-on-surface)] transition-colors shrink-0"
              style={{ marginLeft: -4 }}
              onClick={(e) => { e.stopPropagation(); onToggleSidebar() }}
              title="Open sidebar"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
            <div className="w-px h-3 shrink-0" style={{ background: 'var(--border-default)' }} />
          </>
        )}
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#27C93F', display: 'block', flexShrink: 0 }} />
        {label}
        <span style={{ color: 'var(--text-outline)', fontSize: 9 }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="animate-expand-in"
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            minWidth: 220, zIndex: 100, padding: 4,
            borderRadius: 12,
            background: 'var(--dynamic-island-bg)',
            backdropFilter: 'var(--dynamic-island-blur)',
            WebkitBackdropFilter: 'var(--dynamic-island-blur)',
            border: '1px solid var(--dynamic-island-border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          {/* Models grouped by provider */}
          {Object.entries(groupedModels).map(([providerId, models]) => (
            <div key={providerId}>
              <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-outline)', padding: '6px 8px 4px' }}>
                {providerId}
              </div>
              {models.map((m) => {
                const isActive = currentModel === m.alias
                return (
                  <button
                    key={m.alias}
                    onClick={() => { onSelectModel(m.alias, providerId); setOpen(false) }}
                    className="flex items-center w-full text-left transition-colors cursor-pointer"
                    style={{
                      gap: 8, padding: '6px 8px', borderRadius: 8, fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      background: isActive ? 'rgba(173, 198, 255, 0.12)' : 'transparent',
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-on-surface-variant)',
                      border: 'none',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                      background: isActive ? 'var(--accent-primary)' : 'transparent',
                      border: isActive ? 'none' : '1.5px solid var(--text-outline-variant)',
                      display: 'block',
                    }} />
                    <span className="flex-1 truncate">{m.alias}</span>
                    {m.alias !== m.name && (
                      <span className="text-[10px] truncate" style={{ color: 'var(--text-outline)', maxWidth: 120 }}>
                        {m.name}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
