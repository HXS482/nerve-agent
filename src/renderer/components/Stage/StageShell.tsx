import { useEffect, useState } from 'react'
import type { useClaude } from '../../hooks/useClaude'
import { useStageStore } from '../../stores/stageStore'
import { useChatStore } from '../../stores/chatStore'
import { Stage } from './Stage'
import { StageSessions } from './StageSessions'
import { ThinkSpot } from './ThinkSpot'
import { ToolSpot } from './ToolSpot'
import { UserLogTerminal } from './UserLogTerminal'
import { ModelIsland } from '../ModelIsland'
import { ApprovalBar } from '../ApprovalBar'
import { SelectionActions } from '../SelectionActions'

interface Props {
  claude: ReturnType<typeof useClaude>
  onOpenSettings: () => void
}

// StageShell —— Stage 模式的独立界面骨架
// 顶栏（交通灯 + 会话抽屉 + 小球返回 + 模型 + 设置）+ 产物空间 + 固定状态点
export function StageShell({ claude, onOpenSettings }: Props) {
  const setViewMode = useStageStore((s) => s.setViewMode)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const stageBg = useChatStore((s) => s.stageBg)

  // 自愈：当前 stage 会话若无 mode 标记（历史丢失），进入 stage 时补上
  useEffect(() => {
    const sid = useStageStore.getState().stageSessionId
    if (!sid) return
    const store = useChatStore.getState()
    if (store.sessionModes[sid] !== 'stage') {
      store.markSessionMode(sid, 'stage')
      store.updateSession(sid, { mode: 'stage' })
    }
  }, [])

  return (
    <div className="stage-shell">
      {/* 静态壁纸背景：进入 Stage 模式即固定铺满内框，不随任何状态变化；支持设置面板自定义 */}
      <div className="stage-bg" style={stageBg ? { backgroundImage: `url("${stageBg}")` } : undefined} />
      {/* 顶栏 */}
      <div className="stage-topbar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="stage-topbar-left" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* 交通灯（chat 模式它们在侧边栏，Stage 需要自己的） */}
          <div className="flex gap-2 group/tl" style={{ marginRight: '4px' }}>
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
          <ModelIsland
            currentModel={claude.config.model || 'sonnet'}
            onSelectModel={(model, providerId) => claude.updateConfig({ model, ...(providerId ? { provider: providerId } : {}) })}
            sidebarOpen={true}
            onToggleSidebar={() => {}}
          />
        </div>

        <div className="stage-topbar-right" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button className="stage-icon-btn stage-settings-btn" onClick={onOpenSettings} title="Settings">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82.33l.06.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

        {/* 居中小球：点击返回 chat 模式（挂在 stage-shell 上，不进拖拽区） */}
        <button
          className="task-spinner-wrap task-orb-btn"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => setViewMode('chat')}
          title="返回聊天模式"
        >
          <div className="task-loader">
            <svg width={100} height={100} viewBox="0 0 100 100">
              <defs>
                <mask id="tl-clipping">
                  <polygon points="0,0 100,0 100,100 0,100" fill="black" />
                  <polygon points="25,25 75,25 50,75" fill="white" />
                  <polygon points="50,25 75,75 25,75" fill="white" />
                  <polygon points="35,35 65,35 50,65" fill="white" />
                  <polygon points="35,35 65,35 50,65" fill="white" />
                  <polygon points="35,35 65,35 50,65" fill="white" />
                  <polygon points="35,35 65,35 50,65" fill="white" />
                </mask>
              </defs>
            </svg>
            <div className="task-loader-box" />
          </div>
        </button>

      {/* 会话抽屉 */}
      {sessionsOpen && (
        <>
          <div className="stage-drawer-mask" onClick={() => setSessionsOpen(false)} />
          <div className="stage-drawer">
            <StageSessions
              onSelectSession={(id) => {
                claude.loadStageSession(id)
                setSessionsOpen(false)
              }}
              onNewSession={() => {
                claude.clearStageSession()
                setSessionsOpen(false)
              }}
            />
          </div>
        </>
      )}

      {/* 主体：产物空间 + 固定状态点 */}
      <div className="stage-main">
        <Stage messages={claude.messages} />
        <ThinkSpot messages={claude.messages} />
        <ToolSpot messages={claude.messages} />
        <UserLogTerminal messages={claude.messages} />
        <ApprovalBar />
      </div>

      {/* 选中文字的上下文 AI 操作条（stage：旁白/卡片文字划选） */}
      <SelectionActions onAction={claude.send} />

      {/* 会话入口：左下角悬浮按钮（挂在 stage-shell 而非 stage-main：
          stage-main 的 z-index 层叠上下文会把 z-55 压在全宽 InputBar(z-50) 之下） */}
      <button
        className="stage-icon-btn stage-sessions-fab"
        onClick={() => setSessionsOpen((v) => !v)}
        title="会话"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
    </div>
  )
}
