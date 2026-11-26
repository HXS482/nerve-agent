import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useChatStore } from '../stores/chatStore'

interface Props {
  currentModel: string
  onSelectModel: (model: string, providerId?: string) => void
  // 下拉贴哪一侧：输入胶囊里靠右边缘，要右对齐；顶栏里靠左缘，保持左对齐
  dropdownAlign?: 'left' | 'right'
  // 下拉朝哪边弹：输入框在窗口底部，向上弹才不出屏
  dropDirection?: 'down' | 'up'
}

export function ModelIsland({ currentModel, onSelectModel, dropdownAlign = 'left', dropDirection = 'down' }: Props) {
  const providers = useChatStore((s) => s.providers)
  const availableModels = useChatStore((s) => s.availableModels)
  const providerModels = useChatStore((s) => s.providerModels)
  const config = useChatStore((s) => s.config)
  const storeDefaultProvider = useChatStore((s) => s.defaultProvider)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // 弹层走 portal 挂到 body：胶囊自己就是 backdrop-filter 层，子层的 blur 采不到壁纸，
  // 只会糊成一块灰。挪到根上（和思考强度滑轨同款做法）blur 才吃得到背后的壁纸。
  // 所以位置得自己算——打开瞬间量按钮的视口坐标，换算成 fixed 值。
  const [anchor, setAnchor] = useState<{ top?: number; bottom?: number; left?: number; right?: number } | null>(null)
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAnchor({
      ...(dropDirection === 'up'
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
      ...(dropdownAlign === 'right'
        ? { right: window.innerWidth - r.right }
        : { left: r.left }),
    })
  }, [dropDirection, dropdownAlign])
  // 窗口尺寸变化 / 滚动时重新对齐，避免弹层和胶囊脱位
  useEffect(() => {
    if (!open) return
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, measure])

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
      const inTrigger = ref.current?.contains(e.target as Node)
      const inMenu = menuRef.current?.contains(e.target as Node)
      if (!inTrigger && !inMenu) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1)

  return (
    <div className="relative shrink-0" ref={ref}>
      {/* Single pill: provider ▾ */}
      <button
        onClick={() => { if (open) { setOpen(false) } else { measure(); setOpen(true) } }}
        className="flex items-center gap-1.5 transition-colors cursor-pointer glass-dock"
        style={{
          padding: '3px 8px',
          height: 24,
          borderRadius: 9,
          fontSize: 10,
          fontWeight: 500,
          color: 'var(--text-on-surface-variant)',
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#27C93F', display: 'block', flexShrink: 0 }} />
        {label}
        <span style={{ color: 'var(--text-outline)', fontSize: 9 }}>{dropDirection === 'up' ? '▴' : '▾'}</span>
      </button>

      {/* Dropdown：portal 到 body，复用思考强度滑轨那套毛玻璃（--stage-glass + blur(12px)）。
          挂在胶囊内部时 blur 采不到壁纸只会糊成灰，挪到根层级才有真磨砂 */}
      {open && anchor && createPortal(
        <div
          ref={menuRef}
          className="animate-expand-in"
          style={{
            position: 'fixed',
            ...anchor,
            minWidth: 220, zIndex: 200, padding: 4,
            borderRadius: 12,
            background: 'var(--stage-glass)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--stage-border)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
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
                      background: isActive ? 'color-mix(in srgb, var(--accent-primary) 14%, transparent)' : 'transparent',
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-on-surface-variant)',
                      border: 'none',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--stage-hover)' }}
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
        </div>,
        document.body,
      )}
    </div>
  )
}
