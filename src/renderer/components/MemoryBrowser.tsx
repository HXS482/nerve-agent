import { useEffect } from 'react'
import { useBrainStore } from '../stores/brainStore'
import { useChatStore } from '../stores/chatStore'
import type { MemoryAtom, SceneBlock, ConvEntry } from '../../shared/types'

const LAYER_CONFIG = {
  L0: { label: 'Conversations', icon: '💬', color: '#3b82f6', desc: 'Raw conversation history' },
  L1: { label: 'Memories', icon: '🧠', color: '#10b981', desc: 'Extracted memory atoms' },
  L2: { label: 'Scenes', icon: '🎬', color: '#f59e0b', desc: 'Contextual scene blocks' },
  L3: { label: 'Persona', icon: '👤', color: '#8b5cf6', desc: 'User persona profile' },
} as const

interface MemoryBrowserProps {
  open: boolean
  onClose: () => void
}

export function MemoryBrowser({ open, onClose }: MemoryBrowserProps) {
  const theme = useChatStore(s => s.theme)
  const isDark = theme !== 'light'
  const { data, activeLayer, selectedItem, selectedItemType, itemContent, loading, scan, setLayer, selectItem } = useBrainStore()

  useEffect(() => {
    if (open) scan()
  }, [open, scan])

  if (!open) return null

  const layerConfig = LAYER_CONFIG[activeLayer]
  const items = data[activeLayer]
  const isEmpty = activeLayer === 'L3'
    ? !data.L3.content
    : Array.isArray(items) && items.length === 0

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[55] animate-fade-in"
        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed z-[60] animate-brain-in flex flex-col"
        style={{
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(860px, calc(100vw - 80px))',
          height: 'min(560px, calc(100vh - 80px))',
          background: isDark ? 'rgba(18,18,20,0.95)' : 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(40px) saturate(180%)',
          border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
          borderRadius: 20,
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="no-select flex items-center justify-between" style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 1024 1024" fill="var(--accent-primary)">
              <path d="M358.4 621.226667c-6.826667 0-167.253333-3.413333-187.733333-102.4-54.613333-3.413333-92.16-13.653333-116.053334-37.546667-10.24-10.24-17.066667-23.893333-20.48-30.72-10.24-6.826667-23.893333-17.066667-30.72-40.96-3.413333-17.066667-3.413333-37.546667-3.413333-44.373333 0-17.066667 6.826667-174.08 215.04-256 208.213333-78.506667 436.906667-47.786667 525.653333 34.133333 95.573333 3.413333 170.666667 95.573333 177.493334 180.906667 6.826667 75.093333-37.546667 167.253333-174.08 191.146666-47.786667 58.026667-150.186667 68.266667-242.346667 75.093334-54.613333 6.826667-109.226667 10.24-136.533333 23.893333 0 3.413333-3.413333 6.826667-6.826667 6.826667z" />
            </svg>
            <span className="text-[14px] font-semibold" style={{ color: 'var(--text-on-surface)' }}>Memory</span>
            {loading && <span className="text-[11px]" style={{ color: 'var(--text-outline)' }}>loading...</span>}
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer transition-colors"
            style={{ padding: 6, borderRadius: 8, color: 'var(--text-outline)', background: 'transparent', border: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Layer tabs */}
          <div className="flex flex-col" style={{ width: 140, borderRight: '1px solid var(--border-subtle)', background: isDark ? 'rgba(20,20,22,0.4)' : 'rgba(250,250,250,0.4)' }}>
            {(Object.keys(LAYER_CONFIG) as Array<keyof typeof LAYER_CONFIG>).map(key => {
              const cfg = LAYER_CONFIG[key]
              const isActive = activeLayer === key
              const count = key === 'L3' ? (data.L3.content ? 1 : 0) : (Array.isArray(data[key]) ? data[key].length : 0)
              return (
                <button
                  key={key}
                  onClick={() => setLayer(key)}
                  className="flex items-center gap-2 px-4 py-3 text-left transition-colors cursor-pointer"
                  style={{
                    background: isActive ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
                    border: 'none',
                    borderLeft: isActive ? `2px solid ${cfg.color}` : '2px solid transparent',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <span className="text-[14px]">{cfg.icon}</span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[12px] font-medium truncate" style={{ color: isActive ? 'var(--text-on-surface)' : 'var(--text-outline)' }}>{cfg.label}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-outline)' }}>{count} items</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Center: Item list */}
          <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
            {loading && (
              <div className="flex items-center justify-center h-full">
                <span className="text-[12px]" style={{ color: 'var(--text-outline)' }}>loading...</span>
              </div>
            )}

            {!loading && isEmpty && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <span className="text-[32px] opacity-30">{layerConfig.icon}</span>
                <span className="text-[13px]" style={{ color: 'var(--text-outline)' }}>No {layerConfig.label.toLowerCase()} yet</span>
                <span className="text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>{layerConfig.desc}</span>
              </div>
            )}

            {!loading && !isEmpty && activeLayer === 'L3' && (
              <div className="p-4">
                <pre className="text-[12px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-on-surface)', fontFamily: 'Inter, sans-serif' }}>
                  {data.L3.content}
                </pre>
              </div>
            )}

            {!loading && !isEmpty && activeLayer === 'L1' && (
              <div className="p-3 flex flex-col gap-1.5">
                {(data.L1 as MemoryAtom[]).map(item => (
                  <button
                    key={item.id}
                    onClick={() => selectItem(item, 'L1')}
                    className="flex flex-col gap-1 px-3 py-2.5 rounded-lg text-left transition-colors cursor-pointer"
                    style={{
                      background: selectedItem?.id === item.id ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
                      border: 'none',
                    }}
                    onMouseEnter={e => { if (selectedItem?.id !== item.id) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}
                    onMouseLeave={e => { if (selectedItem?.id !== item.id) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: LAYER_CONFIG.L1.color + '20', color: LAYER_CONFIG.L1.color }}>{item.type}</span>
                      <span className="text-[11px] truncate" style={{ color: 'var(--text-on-surface)' }}>{item.content.slice(0, 80)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', color: 'var(--text-outline)' }}>{tag}</span>
                      ))}
                      {item.scene_name && <span className="text-[10px]" style={{ color: 'var(--text-outline)' }}>scene: {item.scene_name}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!loading && !isEmpty && activeLayer === 'L0' && (
              <div className="p-3 flex flex-col gap-1.5">
                {(data.L0 as ConvEntry[]).map(item => (
                  <button
                    key={item.id}
                    onClick={() => selectItem(item, 'L0')}
                    className="flex flex-col gap-1 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer"
                    style={{
                      background: selectedItem?.id === item.id ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
                      border: 'none',
                    }}
                    onMouseEnter={e => { if (selectedItem?.id !== item.id) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}
                    onMouseLeave={e => { if (selectedItem?.id !== item.id) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] px-1.5 py-0.5 rounded" style={{
                        background: item.role === 'user' ? '#3b82f620' : '#10b98120',
                        color: item.role === 'user' ? '#3b82f6' : '#10b981',
                      }}>{item.role}</span>
                      <span className="text-[11px] truncate" style={{ color: 'var(--text-on-surface)' }}>{item.content.slice(0, 100)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!loading && !isEmpty && activeLayer === 'L2' && (
              <div className="p-3 flex flex-col gap-1.5">
                {(data.L2 as SceneBlock[]).map(item => (
                  <button
                    key={item.filename}
                    onClick={() => selectItem(item, 'L2')}
                    className="flex flex-col gap-1 px-3 py-2.5 rounded-lg text-left transition-colors cursor-pointer"
                    style={{
                      background: selectedItem === item ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
                      border: 'none',
                    }}
                    onMouseEnter={e => { if (selectedItem !== item) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}
                    onMouseLeave={e => { if (selectedItem !== item) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium" style={{ color: 'var(--text-on-surface)' }}>{item.filename}</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-outline)' }}>{new Date(item.updated).toLocaleDateString()}</span>
                    </div>
                    <span className="text-[11px] truncate" style={{ color: 'var(--text-outline)' }}>{item.summary}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Detail panel */}
          {selectedItem && (
            <div
              className="flex flex-col animate-slide-in-right"
              style={{
                width: 300,
                borderLeft: '1px solid var(--border-subtle)',
                background: isDark ? 'rgba(20,20,22,0.6)' : 'rgba(250,250,250,0.6)',
              }}
            >
              <div className="flex items-center justify-between" style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-on-surface)' }}>
                  {selectedItemType === 'L1' && (selectedItem as MemoryAtom).type}
                  {selectedItemType === 'L0' && (selectedItem as ConvEntry).role}
                  {selectedItemType === 'L2' && (selectedItem as SceneBlock).filename}
                  {selectedItemType === 'L3' && 'Persona'}
                </span>
                <button
                  onClick={() => selectItem(null, activeLayer)}
                  className="cursor-pointer flex-shrink-0"
                  style={{ padding: 4, borderRadius: 6, color: 'var(--text-outline)', background: 'transparent', border: 'none' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto" style={{ padding: '12px 14px' }}>
                {itemContent ? (
                  <pre className="text-[11px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-on-surface)', fontFamily: 'Inter, sans-serif' }}>
                    {itemContent}
                  </pre>
                ) : (
                  <div className="text-[11px] text-center py-8" style={{ color: 'var(--text-outline)' }}>Loading...</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
