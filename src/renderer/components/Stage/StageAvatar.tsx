import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'

interface Props {
  onOpenSettings: () => void
}

// Stage 顶栏账号头像：点击弹二级菜单（账号 / 主题切换 / 设置）
// 关闭走 document mousedown 而不是全屏遮罩：顶栏是 z-30 层，遮罩被压在里面，
// 点会话 FAB（z-55）、时间轴（z-35）这些更上面的层就关不掉菜单
export function StageAvatar({ onOpenSettings }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const theme = useChatStore((s) => s.theme)
  const setTheme = useChatStore((s) => s.setTheme)
  const isLight = theme === 'light'

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="stage-avatar-root" ref={ref}>
      {open && (
        <div className="stage-avatar-menu">
          {/* 账号体系还没接，点了只收起菜单 */}
          <button className="fab-menu-item" onClick={() => setOpen(false)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-1a7 7 0 0114 0v1" />
            </svg>
            账号
          </button>
          {/* 主题切换：dark ↔ light 二态循环 */}
          <button
            className="fab-menu-item"
            onClick={() => setTheme(isLight ? 'dark' : 'light')}
          >
            {isLight ? (
              // 太阳（当前 light，点击去 dark）
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              // 月亮（当前 dark/其他，点击去 light）
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
            主题：{isLight ? 'Light' : 'Dark'}
          </button>
          <button className="fab-menu-item" onClick={() => { setOpen(false); onOpenSettings() }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82.33l.06.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            设置
          </button>
        </div>
      )}
      <button
        className="stage-avatar-btn"
        onClick={() => setOpen((v) => !v)}
        title="账号"
      >
        <img src="/assets/avatar.jpg" alt="账号" className="stage-avatar-img" draggable={false} />
      </button>
    </div>
  )
}
