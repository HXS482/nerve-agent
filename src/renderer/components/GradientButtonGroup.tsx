import { useState, useRef, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import { useChatStore } from "../stores/chatStore"

interface NavItem {
  id: string
  icon: React.ReactNode
  label: string
  onClick?: () => void
}

interface GradientButtonGroupProps {
  onOpenGallery: () => void
  onOpenCustomize: () => void
  onOpenMemory: () => void
  customizeOpen: boolean
}

// Palette icon
function PaletteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8s2.91 6.5 6.5 6.5c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-1 0-.83.67-1.5 1.5-1.5h1.76c2.01 0 3.63-1.63 3.63-3.63C14.62 4.07 11.59 1.5 8 1.5z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
      />
      <circle cx="5" cy="5.5" r="1" fill="#F87171" />
      <circle cx="8.5" cy="4" r="1" fill="#FBBF24" />
      <circle cx="11" cy="6.5" r="1" fill="#34D399" />
      <circle cx="4.5" cy="9" r="1" fill="#60A5FA" />
    </svg>
  )
}

const THEMES = [
  { id: 'dark' as const, label: 'Dark' },
  { id: 'light' as const, label: 'Light' },
  { id: 'aurora' as const, label: 'Aurora' },
]

export function GradientButtonGroup({
  onOpenGallery,
  onOpenCustomize,
  onOpenMemory,
  customizeOpen,
}: GradientButtonGroupProps) {
  const theme = useChatStore((s) => s.theme)
  const setTheme = useChatStore((s) => s.setTheme)
  const isDark = theme !== "light"

  const [activeId, setActiveId] = useState<string | null>(null)
  const [themeOpen, setThemeOpen] = useState(false)
  const themeRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close theme dropdown on outside click (check both button area and portal dropdown)
  useEffect(() => {
    if (!themeOpen) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (themeRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setThemeOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [themeOpen])

  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })

  const updateDropdownPos = useCallback(() => {
    const btn = themeRef.current
    if (!btn) return
    const sidebar = btn.closest('aside')
    const btnRect = btn.getBoundingClientRect()
    const sidebarRect = sidebar?.getBoundingClientRect()
    setDropdownPos({
      top: btnRect.top - 6,
      left: sidebarRect ? sidebarRect.left + sidebarRect.width / 2 : btnRect.left + btnRect.width / 2,
    })
  }, [])

  useEffect(() => {
    if (!themeOpen) return
    updateDropdownPos()
    const onResize = () => updateDropdownPos()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [themeOpen, updateDropdownPos])

  const navItems: NavItem[] = [
    {
      id: "theme",
      label: `Theme: ${THEMES.find((t) => t.id === theme)?.label ?? 'Dark'}`,
      onClick: () => setThemeOpen(!themeOpen),
      icon: <PaletteIcon />,
    },
    {
      id: "memory",
      label: "Memory",
      onClick: onOpenMemory,
      icon: (
        <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
          <path d="M358.4 621.226667c-6.826667 0-167.253333-3.413333-187.733333-102.4-54.613333-3.413333-92.16-13.653333-116.053334-37.546667-10.24-10.24-17.066667-23.893333-20.48-30.72-10.24-6.826667-23.893333-17.066667-30.72-40.96-3.413333-17.066667-3.413333-37.546667-3.413333-44.373333 0-17.066667 6.826667-174.08 215.04-256 208.213333-78.506667 436.906667-47.786667 525.653333 34.133333 95.573333 3.413333 170.666667 95.573333 177.493334 180.906667 6.826667 75.093333-37.546667 167.253333-174.08 191.146666-47.786667 58.026667-150.186667 68.266667-242.346667 75.093334-54.613333 6.826667-109.226667 10.24-136.533333 23.893333 0 3.413333-3.413333 6.826667-6.826667 6.826667zM204.8 498.346667c0 75.093333 126.293333 85.333333 150.186667 85.333333 34.133333-17.066667 85.333333-20.48 143.36-27.306667 85.333333-6.826667 184.32-17.066667 221.866666-68.266666 3.413333-3.413333 6.826667-6.826667 10.24-6.826667 102.4-17.066667 160.426667-78.506667 153.6-157.013333-6.826667-71.68-68.266667-150.186667-150.186666-150.186667-3.413333 0-10.24-3.413333-13.653334-3.413333-71.68-75.093333-293.546667-105.813333-491.52-30.72C40.96 211.626667 34.133333 348.16 34.133333 365.226667c0 6.826667 0 23.893333 3.413334 34.133333 3.413333 17.066667 10.24 17.066667 13.653333 17.066667 3.413333 0 10.24 3.413333 13.653333 3.413333 0 3.413333 3.413333 6.826667 3.413334 13.653333 0 0 3.413333 47.786667 102.4 51.2 3.413333-17.066667 10.24-34.133333 20.48-44.373333 27.306667-27.306667 71.68-23.893333 119.466666-20.48 27.306667 0 54.613333 3.413333 75.093334 0 10.24-3.413333 17.066667 3.413333 20.48 13.653333 0 10.24-3.413333 17.066667-13.653334 20.48-27.306667 3.413333-54.613333 3.413333-85.333333 3.413334-37.546667-3.413333-78.506667-3.413333-95.573333 13.653333-3.413333 0-6.826667 10.24-6.826667 27.306667z" />
          <path d="M597.333333 962.56h-102.4c-6.826667 0-13.653333-6.826667-17.066666-13.653333l-64.853334-259.413334C341.333333 682.666667 307.2 645.12 286.72 624.64c-3.413333-3.413333-6.826667-6.826667-6.826667-10.24-6.826667-6.826667-6.826667-17.066667 0-23.893333s17.066667-6.826667 23.893334 0l10.24 10.24c20.48 20.48 47.786667 54.613333 116.053333 54.613333 6.826667 0 13.653333 6.826667 17.066667 13.653333l64.853333 259.413334h68.266667l-34.133334-150.186667c-3.413333-10.24 3.413333-17.066667 13.653334-20.48 10.24-3.413333 17.066667 3.413333 20.48 13.653333l34.133333 170.666667c0 3.413333 0 10.24-3.413333 13.653333s-10.24 6.826667-13.653334 6.826667z" />
          <path d="M699.733333 826.026667c-105.813333 0-187.733333-44.373333-187.733333-102.4s81.92-102.4 187.733333-102.4 187.733333 44.373333 187.733334 102.4-81.92 102.4-187.733334 102.4z m0-170.666667c-92.16 0-153.6 37.546667-153.6 68.266667s61.44 68.266667 153.6 68.266666 153.6-37.546667 153.6-68.266666-61.44-68.266667-153.6-68.266667z" />
          <path d="M853.333333 689.493333c-10.24 0-17.066667-6.826667-17.066666-17.066666s6.826667-17.066667 17.066666-17.066667c68.266667 0 136.533333-23.893333 136.533334-51.2 0-20.48-47.786667-30.72-68.266667-34.133333-10.24 0-17.066667-10.24-17.066667-17.066667 0-10.24 6.826667-17.066667 17.066667-17.066667 51.2 0 58.026667-27.306667 61.44-44.373333 6.826667-68.266667-61.44-170.666667-78.506667-177.493333-10.24 0-17.066667-6.826667-17.066666-17.066667s6.826667-17.066667 17.066666-17.066667c44.373333 0 112.64 119.466667 112.64 197.973334 0 27.306667-6.826667 47.786667-23.893333 64.853333l-10.24 10.24c20.48 10.24 37.546667 27.306667 37.546667 51.2 3.413333 58.026667-95.573333 85.333333-167.253334 85.333333z" />
          <path d="M494.933333 314.026667c-3.413333 0-6.826667 0-10.24-3.413334-6.826667-3.413333-10.24-13.653333-6.826666-23.893333 3.413333-6.826667 88.746667-143.36 252.586666-143.36 10.24 0 17.066667 6.826667 17.066667 17.066667s-6.826667 17.066667-17.066667 17.066666c-146.773333 0-221.866667 126.293333-225.28 129.706667 0 3.413333-3.413333 6.826667-10.24 6.826667z" />
          <path d="M733.866667 518.826667c-20.48 0-37.546667-6.826667-51.2-23.893334-37.546667-40.96-34.133333-126.293333-34.133334-129.706666 0-10.24 10.24-17.066667 17.066667-17.066667 10.24 0 17.066667 10.24 17.066667 17.066667 0 20.48 0 78.506667 23.893333 105.813333 6.826667 6.826667 17.066667 13.653333 27.306667 13.653333 10.24 0 17.066667 6.826667 17.066666 17.066667 0 6.826667-6.826667 17.066667-17.066666 17.066667z" />
          <path d="M802.133333 382.293333c-10.24 0-17.066667-6.826667-17.066666-17.066666 0-51.2-85.333333-51.2-85.333334-51.2-10.24 0-17.066667-6.826667-17.066666-17.066667s6.826667-17.066667 17.066666-17.066667c58.026667 0 119.466667 27.306667 119.466667 85.333334 0 6.826667-6.826667 17.066667-17.066667 17.066666z" />
          <path d="M494.933333 484.693333c-10.24 0-17.066667-6.826667-17.066666-17.066666s6.826667-17.066667 17.066666-17.066667c17.066667 0 51.2-40.96 51.2-85.333333 0-10.24 6.826667-17.066667 17.066667-17.066667s17.066667 6.826667 17.066667 17.066667c0 54.613333-44.373333 119.466667-85.333334 119.466666z" />
          <path d="M187.733333 314.026667c-3.413333 0-6.826667 0-10.24-3.413334-34.133333-20.48-47.786667-51.2-47.786666-71.68-6.826667-34.133333 13.653333-78.506667 47.786666-109.226666 6.826667-6.826667 17.066667-6.826667 23.893334 0 6.826667 6.826667 3.413333 17.066667-3.413334 23.893333-23.893333 23.893333-37.546667 58.026667-34.133333 81.92 3.413333 17.066667 13.653333 34.133333 34.133333 44.373333 6.826667 6.826667 10.24 17.066667 3.413334 23.893334-3.413333 6.826667-6.826667 10.24-13.653334 10.24z" />
          <path d="M290.133333 314.026667c-10.24 0-17.066667-10.24-17.066666-17.066667s6.826667-17.066667 17.066666-17.066667c81.92 0 85.333333-119.466667 85.333334-119.466666 0-10.24 6.826667-17.066667 17.066666-17.066667s17.066667 6.826667 17.066667 17.066667c0 37.546667-20.48 153.6-119.466667 153.6z" />
        </svg>
      ),
    },
    {
      id: "gallery",
      label: "Gallery",
      onClick: onOpenGallery,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
        </svg>
      ),
    },
    {
      id: "customize",
      label: "Customize pet",
      onClick: onOpenCustomize,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
          <circle cx="8" cy="10" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="16" cy="10" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="10" cy="14" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="14" cy="14" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      ),
    },
  ]

  const handleClick = (item: NavItem) => {
    setActiveId(item.id)
    item.onClick?.()
  }

  return (
    <div className="relative flex items-center">
      <nav
        className={`inline-flex items-center gap-1.5 rounded-[10px] p-1 ${theme === 'aurora' ? 'dynamic-island' : ''}`}
        style={{
          background: theme === 'aurora'
            ? undefined
            : isDark
              ? "rgba(30, 30, 32, 0.6)"
              : "rgba(255, 255, 255, 0.6)",
          backdropFilter: theme === 'aurora' ? undefined : "blur(20px) saturate(180%)",
          WebkitBackdropFilter: theme === 'aurora' ? undefined : "blur(20px) saturate(180%)",
          border: theme === 'aurora'
            ? "1px solid var(--glass-border)"
            : isDark
              ? "1px solid rgba(255,255,255,0.08)"
              : "1px solid rgba(0,0,0,0.06)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
        }}
      >
        {navItems.map((item) => {
          const isActive = activeId === item.id
          const isTheme = item.id === 'theme'

          if (isTheme) {
            return (
              <div key={item.id} className="relative" ref={themeRef}>
                <button
                  type="button"
                  onClick={() => handleClick(item)}
                  className="relative flex h-[36px] w-[36px] items-center justify-center rounded-[8px] cursor-pointer transition-colors duration-200"
                  style={{ color: themeOpen ? "#3b82f6" : isDark ? "#6b6b6d" : "#a1a1aa" }}
                  title={item.label}
                >
                  {item.icon}
                </button>

                {themeOpen && createPortal(
                  <div
                    ref={dropdownRef}
                    className="animate-expand-in"
                    style={{
                      position: 'fixed', top: dropdownPos.top, left: dropdownPos.left,
                      transform: 'translate(-50%, -100%)',
                      minWidth: 140, borderRadius: 10, padding: 4,
                      background: isDark ? 'rgba(30, 30, 32, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                      backdropFilter: 'blur(20px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                      border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.08)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                      zIndex: 200,
                    }}
                  >
                    {THEMES.map((t) => {
                      const selected = theme === t.id
                      return (
                        <button
                          key={t.id}
                          onClick={() => { setTheme(t.id); setThemeOpen(false) }}
                          className="flex items-center w-full text-left transition-colors cursor-pointer"
                          style={{
                            gap: 8, padding: '7px 10px', borderRadius: 7, fontSize: 12,
                            fontWeight: selected ? 600 : 400,
                            background: selected ? (isDark ? 'rgba(173, 198, 255, 0.12)' : 'rgba(0, 90, 194, 0.1)') : 'transparent',
                            color: selected ? 'var(--accent-primary)' : 'var(--text-on-surface-variant)',
                            border: 'none',
                          }}
                          onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}
                          onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent' }}
                        >
                          <span>{t.label}</span>
                        </button>
                      )
                    })}
                  </div>,
                  document.body
                )}
              </div>
            )
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleClick(item)}
              className="relative flex h-[36px] w-[36px] items-center justify-center rounded-[8px] cursor-pointer transition-colors duration-200"
              style={{
                color: isActive
                  ? "#3b82f6"
                  : isDark ? "#6b6b6d" : "#a1a1aa",
              }}
              title={item.label}
            >
              {item.icon}
            </button>
          )
        })}
      </nav>

    </div>
  )
}
