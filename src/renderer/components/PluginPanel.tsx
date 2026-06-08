import { useState, useEffect } from 'react'

interface PluginInfo {
  id: string
  version: string
  description: string
  trust: string
  toolCount: number
}

export function PluginPanel({ onClose }: { onClose: () => void }) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadPlugins = async () => {
    setLoading(true)
    try {
      const list = await window.claude.getPlugins()
      setPlugins(list || [])
    } catch {
      setPlugins([])
    }
    setLoading(false)
  }

  useEffect(() => { loadPlugins() }, [])

  const handleReload = async (pluginId: string) => {
    await window.claude.reloadPlugin(pluginId)
    await loadPlugins()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 animate-fade-in"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      />
      {/* Modal */}
      <div
        className="fixed z-50 animate-modal-in"
        style={{
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 420, maxHeight: '70vh',
          background: 'var(--dynamic-island-bg)',
          backdropFilter: 'var(--dynamic-island-blur)',
          WebkitBackdropFilter: 'var(--dynamic-island-blur)',
          border: '1px solid var(--dynamic-island-border)',
          borderRadius: 16,
          boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between no-select" style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text-on-surface)' }}>Plugins</div>
            <div className="text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>
              {loading ? 'Loading...' : `${plugins.length} plugin(s) loaded`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded transition-colors cursor-pointer"
            style={{ width: 24, height: 24, color: 'var(--text-outline)', background: 'transparent', border: 'none' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-on-surface)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-outline)' }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '10px 14px 14px' }}>
          {loading ? (
            <div className="text-[12px]" style={{ color: 'var(--text-outline-variant)', padding: '20px 0', textAlign: 'center' }}>
              Loading plugins...
            </div>
          ) : plugins.length === 0 ? (
            <div className="text-[12px]" style={{ color: 'var(--text-outline-variant)', padding: '20px 0', textAlign: 'center' }}>
              No plugins installed. Place plugins in <code style={{ color: 'var(--text-on-surface-variant)', background: 'var(--bg-surface-container-high)', padding: '1px 5px', borderRadius: 4 }}>~/.nerve/plugins/</code>
            </div>
          ) : (
            <div className="flex flex-col" style={{ gap: 8 }}>
              {plugins.map(plugin => (
                <div
                  key={plugin.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface-container)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center" style={{ gap: 8 }}>
                      <span className="text-[12px] font-medium" style={{ color: 'var(--text-on-surface)' }}>
                        {plugin.id}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-outline-variant)' }}>
                        v{plugin.version}
                      </span>
                    </div>
                    <button
                      onClick={() => handleReload(plugin.id)}
                      className="text-[11px] cursor-pointer transition-colors"
                      style={{
                        padding: '3px 10px', borderRadius: 6,
                        background: 'var(--bg-surface-container-high)',
                        color: 'var(--text-on-surface-variant)',
                        border: '1px solid var(--border-subtle)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container-highest)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container-high)' }}
                    >
                      Reload
                    </button>
                  </div>
                  {plugin.description && (
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-on-surface-variant)' }}>
                      {plugin.description}
                    </p>
                  )}
                  <div className="flex items-center mt-2" style={{ gap: 12 }}>
                    <span className="text-[10px]" style={{ color: 'var(--text-outline-variant)' }}>
                      Trust: {plugin.trust}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-outline-variant)' }}>
                      Tools: {plugin.toolCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
