import { useEffect, useState } from 'react'
import type { useClaude } from '../../hooks/useClaude'
import { useStageStore } from '../../stores/stageStore'
import { useChatStore } from '../../stores/chatStore'
import { Stage } from './Stage'
import { StageSessions } from './StageSessions'
import { BgVideo, isVideoBg, isHtmlBg, BgHtml } from './StageBgMedia'
import { ThinkSpot } from './ThinkSpot'
import { ToolSpot } from './ToolSpot'
import { UserLogTerminal } from './UserLogTerminal'
import { ModelIsland } from '../ModelIsland'
import { ApprovalBar } from '../ApprovalBar'
import { SelectionActions } from '../SelectionActions'
import { SettingsPanel } from '../SettingsPanel'

interface Props {
  claude: ReturnType<typeof useClaude>
}

// StageShell —— Stage 模式的独立界面骨架
// 顶栏（交通灯 + 会话抽屉 + 小球返回 + 模型 + 设置）+ 产物空间 + 固定状态点
export function StageShell({ claude }: Props) {
  const setViewMode = useStageStore((s) => s.setViewMode)
  const settingsOpen = useStageStore((s) => s.settingsOpen)
  const setSettingsOpen = useStageStore((s) => s.setSettingsOpen)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const stageBg = useChatStore((s) => s.stageBg)
  const stageBgEnabled = useChatStore((s) => s.stageBgEnabled)
  // 启用开关开着且有素材才渲染自定义背景；否则透明透出系统 Mica
  const activeBg = stageBgEnabled ? stageBg : null

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
      {/* 设置模式：进入独立设置视图（Stage 内容整体卸载，背景直接透出系统 acrylic） */}
      {settingsOpen && (
        <SettingsPanel
          docked
          config={claude.config}
          onUpdateConfig={claude.updateConfig}
          onPickDirectory={claude.pickDirectory}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {!settingsOpen && (
      <>
      {/* 背景：默认透明透出 Mica 模糊桌面；启用开关开着时渲染自定义壁纸（图片/视频/HTML） */}
      <div
        className="stage-bg"
        style={activeBg && !isHtmlBg(activeBg) ? (isVideoBg(activeBg) ? { background: '#0a0a0a' } : { background: `#0a0a0a url("${activeBg}") center / cover no-repeat` }) : activeBg && isHtmlBg(activeBg) ? { background: '#0a0a0a' } : undefined}
      >
        {activeBg && isVideoBg(activeBg) && <BgVideo src={activeBg} />}
        {activeBg && isHtmlBg(activeBg) && <BgHtml src={activeBg} />}
      </div>
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
          {/* 会话按钮：点击打开会话抽屉 */}
          <button
            className="stage-icon-btn"
            onClick={() => setSessionsOpen((v) => !v)}
            title="会话"
          >
            {/* Archive（填色版，fill 继承 currentColor） */}
            <svg width="15" height="15" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M906.838603 912.325571 143.716192 912.325571c-27.590382 0-50.036603-22.447245-50.036603-50.036603l0-520.31027c0-27.590382 22.446221-50.036603 50.036603-50.036603l763.122411 0c27.590382 0 50.036603 22.447245 50.036603 50.036603l0 520.31027C956.875207 889.87935 934.427962 912.325571 906.838603 912.325571zM143.716192 322.640258c-10.481725 0-19.337417 8.855692-19.337417 19.337417l0 520.31027c0 10.481725 8.855692 19.337417 19.337417 19.337417l763.122411 0c10.481725 0 19.337417-8.855692 19.337417-19.337417l0-520.31027c0-10.482749-8.855692-19.337417-19.337417-19.337417L143.716192 322.640258zM594.651418 481.966986 455.902354 481.966986c-9.900487 0-21.249977-0.345877-30.632671-4.472871-12.514012-5.504364-19.404955-16.674775-19.404955-31.453363 0-27.590382 22.446221-50.036603 50.036603-50.036603l138.749064 0c27.590382 0 50.036603 22.446221 50.036603 50.036603 0 14.777565-6.890944 25.947975-19.404955 31.453363C615.901395 481.621109 604.552929 481.966986 594.651418 481.966986zM436.94356 449.034946c1.073448 0.862647 4.984524 2.232854 18.959817 2.232854l138.749064 0c13.975293 0 17.886369-1.369184 18.959817-2.232854 0.094144-0.234337 0.3776-1.100054 0.3776-2.994194 0-10.482749-8.855692-19.337417-19.337417-19.337417L455.902354 426.703335c-10.482749 0-19.337417 8.855692-19.337417 19.337417C436.564937 447.934892 436.848393 448.799586 436.94356 449.034946zM941.525614 287.953248 109.029182 287.953248c-27.590382 0-50.036603-22.447245-50.036603-50.036603l0-76.204589c0-27.590382 22.446221-50.036603 50.036603-50.036603l832.496431 0c27.590382 0 50.036603 22.447245 50.036603 50.036603l0 76.204589C991.562217 265.506003 969.115995 287.953248 941.525614 287.953248zM109.029182 142.373615c-10.482749 0-19.337417 8.855692-19.337417 19.337417l0 76.204589c0 10.482749 8.855692 19.337417 19.337417 19.337417l832.496431 0c10.481725 0 19.337417-8.855692 19.337417-19.337417l0-76.204589c0-10.482749-8.855692-19.337417-19.337417-19.337417L109.029182 142.373615z" />
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
        <Stage messages={claude.messages} onSend={claude.send} />
        <ThinkSpot messages={claude.messages} />
        <ToolSpot messages={claude.messages} />
        <UserLogTerminal messages={claude.messages} />
        <ApprovalBar />
      </div>

      {/* 选中文字的上下文 AI 操作条（stage：旁白/卡片文字划选） */}
      <SelectionActions onAction={claude.send} />
      </>
      )}
    </div>
  )
}
