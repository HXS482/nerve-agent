import { useEffect, useState } from 'react'
import type { useClaude } from '../../hooks/useClaude'
import { useStageStore } from '../../stores/stageStore'
import { useChatStore } from '../../stores/chatStore'
import { Stage } from './Stage'
import { StageSessions } from './StageSessions'
import { SidebarToggleIcon } from '../SidebarToggleIcon'
import { StageAvatar } from './StageAvatar'
import { BgVideo, isVideoBg, isHtmlBg, BgHtml } from './StageBgMedia'
import { PredictiveArcBg } from './PredictiveArcBg'
import { ThinkSpot } from './ThinkSpot'
import { ToolSpot } from './ToolSpot'
import { UserLogTerminal } from './UserLogTerminal'
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
      {/* 背景：默认 Predictive Arc 弧光动画；自定义壁纸（图片/视频/HTML）优先 */}
      <div
        className="stage-bg"
        style={stageBg && !isHtmlBg(stageBg) ? (isVideoBg(stageBg) ? { background: '#0a0a0a' } : { background: `#0a0a0a url("${stageBg}") center / cover no-repeat` }) : { background: '#030303' }}
      >
        {!stageBg && <PredictiveArcBg />}
        {stageBg && isVideoBg(stageBg) && <BgVideo src={stageBg} />}
        {stageBg && isHtmlBg(stageBg) && <BgHtml src={stageBg} />}
      </div>
      {/* 顶栏 */}
      <div className="stage-topbar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="stage-topbar-left" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* 交通灯（chat 模式它们在侧边栏，Stage 需要自己的）。模型岛已移到底部输入胶囊内 */}
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
          {/* 会话入口：紧贴交通灯右侧（与参考分支 .stage-window-controls 的排布一致） */}
          <button
            className="stage-icon-btn"
            onClick={() => setSessionsOpen((v) => !v)}
            title="会话"
          >
            <SidebarToggleIcon />
          </button>
        </div>

        <div className="stage-topbar-right" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <StageAvatar onOpenSettings={onOpenSettings} />
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
              onSelectProject={(path) => {
                claude.selectProject(path)
                setSessionsOpen(false)
              }}
              onNewProject={() => {
                // 抽屉让位给居中面板：先收起抽屉再开项目选择器
                setSessionsOpen(false)
                useStageStore.getState().setProjectPickerOpen(true)
              }}
            />
          </div>
        </>
      )}

      {/* 主体：产物空间 + 固定状态点 */}
      <div className="stage-main">
        <Stage messages={claude.messages} onSend={claude.send} />
        <ThinkSpot messages={claude.messages} />
        <ToolSpot messages={claude.messages} />
        <UserLogTerminal messages={claude.messages} />
        <ApprovalBar />
      </div>

      {/* 选中文字的上下文 AI 操作条（stage：旁白/卡片文字划选） */}
      <SelectionActions onAction={claude.send} />
    </div>
  )
}
