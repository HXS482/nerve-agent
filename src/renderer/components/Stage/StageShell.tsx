import { useEffect } from 'react'
import type { useClaude } from '../../hooks/useClaude'
import { useStageStore, STAGE_SIDEBAR_DEFAULT_WIDTH } from '../../stores/stageStore'
import { useChatStore } from '../../stores/chatStore'
import { Stage } from './Stage'
import { StageSidebar } from './StageSidebar'
import { BgVideo, isVideoBg, isHtmlBg, BgHtml } from './StageBgMedia'
import { ThinkSpot } from './ThinkSpot'
import { ToolSpot } from './ToolSpot'
import { UserLogTerminal } from './UserLogTerminal'
import { ApprovalBar } from '../ApprovalBar'
import { SelectionActions } from '../SelectionActions'
import { SettingsPanel } from '../SettingsPanel'
import { SidebarToggleIcon } from '../SidebarToggleIcon'

interface Props {
  claude: ReturnType<typeof useClaude>
}

// StageShell —— Stage 模式的独立界面骨架
// 顶栏（交通灯 + 侧栏折叠 + 小球返回 + 产物空间 + 固定状态点
export function StageShell({ claude }: Props) {
  const setViewMode = useStageStore((s) => s.setViewMode)
  const settingsOpen = useStageStore((s) => s.settingsOpen)
  const setSettingsOpen = useStageStore((s) => s.setSettingsOpen)
  const sidebarOpen = useStageStore((s) => s.sidebarOpen)
  const setSidebarOpen = useStageStore((s) => s.setSidebarOpen)
  const sidebarWidth = useStageStore((s) => s.sidebarWidth)
  const setSidebarWidth = useStageStore((s) => s.setSidebarWidth)
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

  // 侧栏宽度写到 CSS 变量：侧栏/分割线是 .stage-shell 的兄弟节点，拿不到内联变量
  useEffect(() => {
    document.documentElement.style.setProperty('--stage-sidebar-width', `${sidebarWidth}px`)
  }, [sidebarWidth])

  // 拖分界线调侧栏宽度：指针 x 即侧栏右缘（分界线是侧栏的右边框，就落在宽度处），
  // 宽度上下限在 store 里夹紧
  const startResizeSidebar = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => setSidebarWidth(ev.clientX)
    const onUp = () => {
      handle.releasePointerCapture(e.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // 设置是独立全屏视图（自带导航栏）：侧栏、分割线、右移量必须一起让位，
  // 只藏组件不撤右移量的话左侧会空出一整条 sidebar 宽度，视觉上变成三栏
  const sidebarVisible = sidebarOpen && !settingsOpen

  return (
    <>
    {/* Stage 独立侧栏：窗口级透明层（后续 session 空间入口），同 chat 侧栏同一机制 */}
    {sidebarVisible && (
      <StageSidebar
        onSelectSession={(id) => claude.loadStageSession(id)}
        onNewSession={() => claude.clearStageSession()}
        onPickDirectory={() => claude.pickDirectory()}
      />
    )}
    {/* 调宽手柄：分界线（侧栏右边框）上的竖向命中区，跨线居中，避开顶部红绿灯那一行 */}
    {sidebarVisible && (
      <div
        className="stage-sidebar-resizer"
        style={{ left: sidebarWidth - 4 }}
        onPointerDown={startResizeSidebar}
        onDoubleClick={() => setSidebarWidth(STAGE_SIDEBAR_DEFAULT_WIDTH)}
        title="拖动调整侧栏宽度，双击复位"
      />
    )}
    <div
      className={`stage-shell${sidebarVisible ? ' has-stage-sidebar' : ''}`}
      style={{ marginLeft: sidebarVisible ? sidebarWidth : undefined }}
    >
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
      {/* 窗口级固定层：红绿灯 + 侧栏折叠按钮，不随应用表面右移 */}
      <div className="stage-window-controls">
        <div className="flex gap-2 group/tl" style={{ marginLeft: '10px' }}>
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
        <button
          className="stage-icon-btn"
          style={{ padding: '2px 4px' }}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? '收起侧栏' : '打开侧栏'}
        >
          <SidebarToggleIcon expanded={sidebarOpen} />
        </button>
      </div>

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
      </div>

      {/* 主体：产物空间 + 固定状态点 */}
      <div className="stage-main">
        <Stage messages={claude.messages} onSend={claude.send} />
        <ThinkSpot messages={claude.messages} />
        <ToolSpot messages={claude.messages} />
        <UserLogTerminal messages={claude.messages} />
        <ApprovalBar />
      </div>

      {/* 选中文字的上下文 AI 操作条（stage：旁边卡片文字划选） */}
      <SelectionActions onAction={claude.send} />
      </>
      )}
    </div>
    </>
  )
}
