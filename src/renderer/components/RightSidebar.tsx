import { useChatStore } from '../stores/chatStore'
import { motion, AnimatePresence } from 'motion/react'
import { useCallback, useRef, useEffect, useState } from 'react'

// Lazy render hook — only render children when element is in viewport
function useLazyRender(ref: React.RefObject<HTMLDivElement | null>) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true)
        obs.disconnect()
      }
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref])
  return visible
}

declare global {
  interface Window {
    claude: Record<string, unknown>
  }
}

type RightSidebarView = 'flow' | 'folder' | 'git' | 'diff'

const VIEWS: { id: RightSidebarView; label: string; icon: JSX.Element }[] = [
  {
    id: 'flow',
    label: 'Flow',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v6" /><path d="M12 16v6" />
        <path d="M4.93 4.93l4.24 4.24" /><path d="M14.83 14.83l4.24 4.24" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: 'folder',
    label: 'Files',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
  },
  {
    id: 'git',
    label: 'Git',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M13 6h3a2 2 0 012 2v7" />
        <path d="M6 9v9" />
      </svg>
    ),
  },
  {
    id: 'diff',
    label: 'Changes',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" />
        <path d="M3 8h4" />
        <path d="M3 12h4" />
        <path d="M3 16h4" />
        <path d="M17 8h4" />
        <path d="M17 12h4" />
        <path d="M17 16h4" />
      </svg>
    ),
  },
]

const IFRAME_VIRTUAL_HEIGHT = 800

function LazyIframe({ srcDoc, style }: { srcDoc: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useLazyRender(ref)
  const containerHeight = style?.height === '100%' ? 140 : (typeof style?.height === 'number' ? style.height : 140)
  const scale = containerHeight / IFRAME_VIRTUAL_HEIGHT

  return (
    <div ref={ref} style={{ ...style, position: 'relative', overflow: 'hidden' }}>
      {visible ? (
        <iframe
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          scrolling="no"
          className="w-full border-0 pointer-events-none"
          style={{
            height: IFRAME_VIRTUAL_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            width: `${100 / scale}%`,
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>
          Loading...
        </div>
      )}
    </div>
  )
}

const MAX_FLOW_ITEMS = 30
const MAX_HTML_LENGTH = 50000

function FlowCard({ item }: { item: FlowItem }) {
  const [hovered, setHovered] = useState(false)
  const removeFlowItem = useChatStore((s) => s.removeFlowItem)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-lg relative"
      style={{ background: 'var(--bg-surface-container)', border: '1.5px solid var(--border-default)', padding: 3, height: item.type === 'image' ? undefined : 140 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {item.type === 'image' ? (
        <div className="overflow-hidden" style={{ border: '1px solid var(--border-subtle)', borderRadius: 7 }}>
          <img src={item.content} alt="" className="w-full" style={{ display: 'block', objectFit: 'cover' }} />
        </div>
      ) : (
        <div className="overflow-hidden h-full" style={{ border: '1px solid var(--border-subtle)', borderRadius: 7 }}>
          <LazyIframe srcDoc={item.content.length > MAX_HTML_LENGTH ? item.content.slice(0, MAX_HTML_LENGTH) + '\n<!-- truncated -->' : item.content} style={{ height: '100%' }} />
        </div>
      )}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute flex gap-1.5"
            style={{ top: 7, right: 7 }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); window.claude?.openInBrowser?.(item.type, item.content) }}
              className="w-2.5 h-2.5 rounded-full cursor-pointer"
              style={{ background: '#22c55e', border: 'none' }}
            />
            <button
              onClick={(e) => { e.stopPropagation(); removeFlowItem(item.id) }}
              className="w-2.5 h-2.5 rounded-full cursor-pointer"
              style={{ background: '#ef4444', border: 'none' }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function FlowView() {
  const flowItems = useChatStore((s) => s.flowItems)
  const clearFlow = useChatStore((s) => s.clearFlow)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [flowItems.length])

  return (
    <div className="flex flex-col h-full">
      {flowItems.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 shrink-0">
          <div className="text-[11px] text-[var(--text-outline-variant)]">
            {flowItems.length} item{flowItems.length !== 1 ? 's' : ''}
          </div>
          <button
            onClick={clearFlow}
            className="text-[11px] text-[var(--text-outline-variant)] hover:text-[var(--text-on-surface)] transition-colors"
          >
            Clear
          </button>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide">
        {flowItems.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-[12px] text-[var(--text-outline-variant)] opacity-60">
              Flow content will appear here
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5" style={{ padding: '12px 10px' }}>
            <AnimatePresence initial={false}>
              {flowItems.slice(-MAX_FLOW_ITEMS).map((item) => (
                <FlowCard key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

function FolderView() {
  const config = useChatStore((s) => s.config)
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-outline-variant)] font-medium">Explorer</div>
      <div className="rounded-lg p-3 text-[12px] text-[var(--text-outline-variant)]" style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}>
        <div className="truncate">{config.cwd || '~/'} </div>
        <div className="mt-2 text-[11px] opacity-60">File tree coming soon...</div>
      </div>
    </div>
  )
}

function GitView() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-outline-variant)] font-medium">Git</div>
      <div className="rounded-lg p-3 text-[12px] text-[var(--text-outline-variant)]" style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}>
        <div className="text-[11px] opacity-60">Git integration coming soon...</div>
      </div>
    </div>
  )
}

function DiffView() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-outline-variant)] font-medium">Changes</div>
      <div className="rounded-lg p-3 text-[12px] text-[var(--text-outline-variant)]" style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}>
        <div className="text-[11px] opacity-60">Diff viewer coming soon...</div>
      </div>
    </div>
  )
}

const VIEW_COMPONENTS: Record<RightSidebarView, React.FC> = {
  flow: FlowView,
  folder: FolderView,
  git: GitView,
  diff: DiffView,
}

export function RightSidebar() {
  const open = useChatStore((s) => s.rightSidebarOpen)
  const width = useChatStore((s) => s.rightSidebarWidth)
  const view = useChatStore((s) => s.rightSidebarView)
  const theme = useChatStore((s) => s.theme)
  const setView = useChatStore((s) => s.setRightSidebarView)
  const setOpen = useChatStore((s) => s.setRightSidebarOpen)
  const setWidth = useChatStore((s) => s.setRightSidebarWidth)

  const resizing = useRef(false)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const startX = e.clientX
    const startWidth = width

    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return
      const delta = startX - e.clientX
      setWidth(startWidth + delta)
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
  }, [width, setWidth])

  const ViewContent = VIEW_COMPONENTS[view] || VIEW_COMPONENTS.flow

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: width + 8, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: width + 8, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed top-1 bottom-1 right-1 z-40 flex flex-col overflow-hidden"
          style={{
            width,
            background: 'var(--bg-mica)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--app-shell-radius)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
          }}
        >
          {/* Resize handle — left edge */}
          <div
            onMouseDown={handleResizeStart}
            className="absolute left-0 top-0 bottom-0 z-50"
            style={{
              width: 5,
              cursor: 'col-resize',
              background: 'transparent',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = 'var(--accent-primary)'
            }}
            onMouseLeave={(e) => {
              if (!resizing.current) (e.target as HTMLElement).style.background = 'transparent'
            }}
          />
          {/* Top Dock — glassmorphism style matching GradientButtonGroup */}
          <div
            className="flex items-center justify-center gap-1.5 shrink-0 relative z-50"
            style={{
              padding: '8px 10px',
            }}
          >
            <nav
              className={`inline-flex items-center gap-1 p-1 ${theme === 'aurora' ? 'dynamic-island' : ''}`}
              style={{
                borderRadius: 10,
                background: theme === 'aurora' ? undefined : 'rgba(30, 30, 32, 0.6)',
                backdropFilter: theme === 'aurora' ? undefined : 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: theme === 'aurora' ? undefined : 'blur(20px) saturate(180%)',
                border: theme === 'aurora' ? '1px solid var(--glass-border)' : '1px solid rgba(255,255,255,0.08)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              }}
            >
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className="relative flex h-[32px] w-[32px] items-center justify-center rounded-[8px] transition-colors duration-200"
                  style={{
                    color: view === v.id ? '#3b82f6' : '#6b6b6d',
                  }}
                  title={v.label}
                >
                  {v.icon}
                </button>
              ))}
              </nav>

            {/* Close button */}
            <div
              className={`p-1.5 ${theme === 'aurora' ? 'dynamic-island' : ''}`}
              style={{
                borderRadius: 8,
                background: theme === 'aurora' ? undefined : 'rgba(30, 30, 32, 0.6)',
                backdropFilter: theme === 'aurora' ? undefined : 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: theme === 'aurora' ? undefined : 'blur(20px) saturate(180%)',
                border: theme === 'aurora' ? '1px solid var(--glass-border)' : '1px solid rgba(255,255,255,0.08)',
                boxShadow: theme === 'aurora' ? '0 20px 50px rgba(0,0,0,0.5)' : undefined,
              }}
            >
              <button
                onClick={() => setOpen(false)}
                className="text-[#6b6b6d] hover:text-[var(--text-on-surface)] transition-colors"
              >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            <ViewContent />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
