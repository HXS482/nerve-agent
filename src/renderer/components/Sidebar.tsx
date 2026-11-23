import { useState } from 'react'
import { useChatStore, Session } from '../stores/chatStore'
import { BotList } from './BotList'
import { SidebarToggleIcon } from './SidebarToggleIcon'
import { GradientButtonGroup } from './GradientButtonGroup'
import { MemoryBrowser } from './MemoryBrowser'
import { UsageStatsPanel } from './UsageStatsPanel'

interface SidebarProps {
  onNewChat: () => void
  /** 当前会话的运行状态（与顶部小球同一份派生），喂给侧栏里选中的 Bot */
  botStatus?: 'idle' | 'thinking' | 'busy' | 'done' | 'error'
  onOpenSettings: () => void
  onOpenGallery: () => void
  onClose: () => void
  onSelectSession: (sessionId: string) => void
}

export function Sidebar({ onNewChat, onOpenSettings, onOpenGallery, onClose, onSelectSession, botStatus = 'idle' }: SidebarProps) {
  const config = useChatStore((s) => s.config)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const sidebarWidth = useChatStore((s) => s.sidebarWidth)
  const setSidebarWidth = useChatStore((s) => s.setSidebarWidth)
  const [memoryOpen, setMemoryOpen] = useState(false)
  /** 侧栏搜索框的查询串；空 = 不筛选。Esc 清空。 */
  const [query, setQuery] = useState('')
  const handleSelectSession = (session: Session) => {
    onSelectSession(session.id)
  }

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 flex flex-col z-[var(--z-panel)] transition-[width] duration-300"
      style={{ width: sidebarWidth, background: 'transparent' }}
    >
      {/* Window Controls / Header */}
      {/*
       * 头部只在纵向做容器，横向内边距交给两行自己：
       *   - 窗口按钮那一行用 16px（和改动前完全一致的落点）；
       *   - 搜索框用 8px，和下面的 Usage 卡片、Bot 行同一条左边缘。
       * 这样谁都不需要负 margin —— 负值会改变宽度算法，窄侧栏下会把盒子顶出右边界。
       */}
      <div className="pt-6 pb-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center justify-between mb-4 px-4" style={{ marginTop: '8px' }}>
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
          <div className="flex items-center gap-1" style={{ paddingRight: '8px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[var(--text-on-surface-variant)] hover:bg-[var(--bg-surface-container-high)] hover:text-[var(--text-on-surface)] transition-colors cursor-pointer"
              title="Collapse sidebar"
            >
              <SidebarToggleIcon />
            </button>
          </div>
        </div>

        {/*
         * 搜索框。
         *
         * 原来是个假的：带放大镜的 div，写着 History，没有 onClick 也没有 input，
         * 悬停还会变色 —— 看着能点，点了什么都不发生。画成可交互的就得真的能交互，
         * 现在它过滤下面的 Bot 列表（名字 / 分组 / 角色设定）。
         */}
        <div
          className="flex items-center gap-2 rounded-lg transition-all duration-200"
          style={{
            margin: '20px 8px 0',
            padding: '6px 9px',
            background: 'var(--bg-surface-container-high)',
            // 有输入时描边变主题色：这是「搜索生效中」最省笔墨的表达
            border: query
              ? '1px solid var(--accent-primary)'
              : '1px solid var(--border-subtle)',
            /*
             * 头部外层是 WebkitAppRegion: drag（拖窗用），而 drag 区会吃掉鼠标事件 ——
             * 里面的 input 永远拿不到焦点。必须显式挖成 no-drag，
             * 否则它看起来能输入、实际点不动。
             */
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-outline-variant)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="搜索 Bot"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-on-surface)',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="清除"
              style={{
                width: 14,
                height: 14,
                padding: 0,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-outline-variant)',
              }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ padding: '12px 8px' }}>
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
            marginLeft: 2,
            marginRight: 2,
            width: 'calc(100% - 4px)',
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

        <BotList
          onSelectSession={handleSelectSession}
          onNewChat={onNewChat}
          status={botStatus}
        />
      </div>

      {/* 侧栏底部：工具按钮组 */}
      <div style={{ padding: '0 4px 14px 4px', marginTop: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ paddingLeft: '2px' }}>
          <GradientButtonGroup
            onOpenGallery={onOpenGallery}
            onOpenMemory={() => setMemoryOpen(!memoryOpen)}
          />
        </div>
      </div>



      {/* Brain panel */}
      <MemoryBrowser open={memoryOpen} onClose={() => setMemoryOpen(false)} />

    </aside>
  )
}
