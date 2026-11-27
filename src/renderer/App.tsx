import { useClaude } from './hooks/useClaude'
import { useChatStore } from './stores/chatStore'
import { ChatPanel } from './components/ChatPanel'
import { InputBar } from './components/InputBar'
import { Sidebar } from './components/Sidebar'
import { StageShell } from './components/Stage/StageShell'
import { isVideoBg, isHtmlBg } from './components/Stage/StageBgMedia'
import { useStageStore } from './stores/stageStore'
import { RightSidebar } from './components/RightSidebar'
import { SettingsPanel } from './components/SettingsPanel'
import { ProjectPalette } from './components/ProjectPalette'
import { Gallery } from './components/Gallery'
import { SidebarToggleIcon } from './components/SidebarToggleIcon'
import { ApprovalBar } from './components/ApprovalBar'
import { AvatarFlight } from './components/AvatarFlight'
import { beginAvatarFlight, useAvatarFlightStore } from './stores/avatarFlightStore'
import { SelectionActions } from './components/SelectionActions'
import { BotAvatar as AvatarFace } from './components/BotAvatar/BotAvatar'
import { SHAPES_BY_ID, shapeForBot } from './lib/bot-shapes'
import { useBotStatus } from './hooks/useBotStatus'
import { useRoutineStore } from './stores/routineStore'
import { botInk } from './lib/bot-avatar'
import { AskUserCard } from './components/AskUserCard'
import type { FileAttachment } from '../shared/types'
import { ResizeBorder } from './components/ResizeBorder'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

export default function App() {
  const claude = useClaude()
  // 头像飞行中：顶栏那只先隐身，让替身落地后接管（见 components/AvatarFlight.tsx）
  const flying = useAvatarFlightStore((s) => s.flight !== null)
  // 发消息前先起飞。包一层而不是改 useClaude：飞行是纯展示的事，
  // 数据层不该知道渲染层有没有动画在播。量矩形必须发生在 send 之前 ——
  // send 会立刻改 session 状态，空会话占位随之卸载，之后就没有起点可量了。
  const sendWithFlight = useCallback(
    (prompt: string, files?: FileAttachment[]) => {
      beginAvatarFlight()
      void claude.send(prompt, files)
    },
    [claude.send],
  )
  const sidebarOpen = useChatStore((s) => s.sidebarOpen)
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen)
  const viewMode = useStageStore((s) => s.viewMode)
  const setViewMode = useStageStore((s) => s.setViewMode)
  const sidebarWidth = useChatStore((s) => s.sidebarWidth)
  const rightSidebarOpen = useChatStore((s) => s.rightSidebarOpen)
  const rightSidebarWidth = useChatStore((s) => s.rightSidebarWidth)
  const toggleRightSidebar = useChatStore((s) => s.toggleRightSidebar)
  const theme = useChatStore((s) => s.theme)
  const stageBg = useChatStore((s) => s.stageBg)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  // 小球跟着本轮任务状态走（与 Stage 同一套派生：转环/脉动/眨眼/红点）
  const botStatus = useBotStatus(currentSessionId)
  // 空会话里正文中间已经有一只在等你了，顶栏就不该再放一只 —— 否则新建会话
  // 的画面上是「两个 Bot 头像」。判定和 ChatPanel 的空态同源：这个会话没有消息。
  const isEmptySession = useMemo(() => {
    if (!currentSessionId) return true
    return !claude.messages.some((m) => m.sessionId === currentSessionId)
  }, [claude.messages, currentSessionId])
  // 顶栏那只什么时候隐身：飞行中（替身在路上）或空会话（中间那只才是主角）
  const hideTopAvatar = flying || isEmptySession


  // 顶部球的颜色跟随「当前 Bot」：侧栏选中的优先，否则用当前会话绑定的那个
  const bots = useRoutineStore((s) => s.bots)
  const activeBotId = useChatStore((s) => s.activeBotId)
  const loadBots = useRoutineStore((s) => s.loadBots)
  useEffect(() => { void loadBots() }, [loadBots])
  const currentBot = useMemo(() => {
    if (bots.length === 0) return null
    const byActive = activeBotId ? bots.find((b) => b.id === activeBotId) : null
    if (byActive) return byActive
    const session = useChatStore.getState().sessions.find((s) => s.id === currentSessionId)
    const bySession = session?.botId ? bots.find((b) => b.id === session.botId) : null
    return bySession ?? bots.find((b) => b.isDefault) ?? bots[0] ?? null
  }, [bots, activeBotId, currentSessionId])
  const topInk = botInk(currentBot)
  // 顶栏是"英雄位"：形状跟着当前 Bot，眼睛还跟鼠标转
  const topShape = useMemo(() => {
    if (!currentBot) return shapeForBot('nerve')
    return (currentBot.avatarShape && SHAPES_BY_ID[currentBot.avatarShape]) || shapeForBot(currentBot.id)
  }, [currentBot])

  // 顶部球的状态：当前 Bot 与当前会话所属 Bot 不一致时，不跟着跑状态（那只球不是它）
  const sessionBotId = useChatStore((s) =>
    s.sessions.find((x) => x.id === s.currentSessionId)?.botId
  )
  const topStatus = !currentBot || !sessionBotId || currentBot.id === sessionBotId ? botStatus : 'idle'
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const resizing = useRef(false)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const startX = e.clientX
    const startWidth = sidebarWidth
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return
      useChatStore.getState().setSidebarWidth(startWidth + (e.clientX - startX))
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
  }, [sidebarWidth])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <div
      className="h-screen w-screen flex overflow-hidden"
      style={{
        background: viewMode === 'stage' ? 'transparent' : 'var(--bg-background)',
        borderRadius: 'var(--app-window-radius)',
        clipPath: 'inset(0 round var(--app-window-radius))',
        border: viewMode === 'stage'
          ? '1.5px solid var(--stage-window-border)'
          : '1.5px solid var(--border-default)',
      }}
    >
      {/* Stage 模式：整屏独立界面。外框底图只在设了自定义壁纸时渲染
          （视频/HTML 用纯色底，图片贴原图）；无壁纸时露出 .stage-bg 的纯纸面 */}
      {viewMode === 'stage' && (
        <>
          <div
            className="stage-frame-bg"
            style={stageBg && !isHtmlBg(stageBg) ? (isVideoBg(stageBg) ? { background: 'var(--stage-frame)' } : { backgroundImage: `url("${stageBg}")` }) : stageBg && isHtmlBg(stageBg) ? { background: 'var(--stage-frame)' } : { display: 'none' }}
          />
          <StageShell claude={claude} onOpenSettings={() => setSettingsOpen(true)} />
          <div className="stage-frame-frost" />
          <div className="stage-frame-ring" />
        </>
      )}

      {/* Chat 模式：侧边栏 + 聊天区（不受影响） */}
      {viewMode === 'chat' && (
        <>
      {/* Floating Sidebar */}
      {sidebarOpen && (
        <Sidebar
          onNewChat={claude.clearMessages}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenGallery={() => setGalleryOpen(true)}
          onClose={() => setSidebarOpen(false)}
          onSelectSession={claude.loadSessionMessages}
          botStatus={botStatus}
        />
      )}

      {/* Main Content Area */}
      <main
        className="flex-1 flex flex-col overflow-hidden relative"
        style={{
          margin: '2px',
          marginLeft: sidebarOpen ? `${sidebarWidth + 2}px` : '2px',
          marginRight: rightSidebarOpen ? `${rightSidebarWidth + 4}px` : '2px',
          background: 'var(--bg-chat-surface)',
          border: 'var(--chat-frame-border-w) solid var(--chat-frame-border)',
          borderRadius: 'var(--app-shell-radius)',
          transition: 'margin-left 0.3s ease, margin-right 0.3s ease',
        }}
      >
        {/* Sidebar resize handle — left edge of main */}
        <div
          onMouseDown={handleResizeStart}
          className="group/resize"
          style={{
            position: 'absolute', top: 0, left: -3, bottom: 0,
            width: 8, cursor: 'col-resize', zIndex: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            className="opacity-0 group-hover/resize:opacity-100 transition-opacity"
            style={{
              width: 3, height: 28, borderRadius: 2,
              background: 'rgba(255,255,255,0.5)',
            }}
          />
        </div>
        {/* Floating header — drag region + controls */}
        <div
          className="absolute top-0 left-0 right-0 z-[var(--z-topbar)] flex items-center no-select"
          style={{ padding: '6px 7px', WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {/* Left: 侧栏收起时留一个开侧栏按钮（模型岛已移到底部输入胶囊内，两模式统一）。
              圆形胶囊：和圆角矩形相比没有「横向多出来的空白」，26×26 装一枚图标刚好。
              尺寸与右侧胶囊对齐（同一高度、同一图标大小），两个控件的图形留白才一致；
              顶栏左右各留 7px 内边距，26 的圆塞进去不顶边也不显空 */}
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="glass-dock flex shrink-0 items-center justify-center cursor-pointer text-[var(--text-on-surface-variant)] hover:text-[var(--text-on-surface)] transition-colors"
              style={{ width: 26, height: 26, padding: 0, borderRadius: 999, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title="Open sidebar"
            >
              <SidebarToggleIcon size={16} />
            </button>
          )}

          {/* Center spacer */}
          <div className="flex-1" />

          {/* Right: toggle sidebar + settings + cmd */}
          {/* 内边距 3px：按钮 16×16、胶囊高 26，上下留白 (26-16)/2 = 5 = 3 + 1px 描边，
              水平同理，四周等距。圆角 10 = 26/2 - 3，和 32→13、28→11 是同一套比例 */}
          <div
            className="flex items-center shrink-0 glass-dock"
            style={{
              padding: '0 3px',
              gap: 4,
              borderRadius: 10,
              height: 26,
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            <button
              onClick={toggleRightSidebar}
              className="flex items-center justify-center rounded-full text-[var(--text-on-surface-variant)] hover:text-[var(--text-on-surface)] transition-colors"
              style={{ width: 16, height: 16, padding: 0 }}
              title="Toggle right sidebar"
            >
              <SidebarToggleIcon size={16} />
            </button>
            <div className="w-px shrink-0" style={{ height: 11, background: 'var(--border-default)' }} />
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center justify-center rounded-full text-[var(--text-on-surface-variant)] hover:text-[var(--text-on-surface)] transition-colors"
              style={{ width: 16, height: 16, padding: 0 }}
              title="Settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13 1.41-.513M5.106 17.785l1.15-.964m11.49-9.642 1.149-.964M7.501 19.795l.75-1.3m7.5-12.99.75-1.3m-6.063 16.658.26-1.477m2.605-14.772.26-1.477m0 17.726-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205 12 12m6.894 5.785-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495" />
              </svg>
            </button>
          </div>
        </div>

        {/* Bot 头像：点击进入 Stage 模式（与 Stage 里返回 chat 的那只是同一只） */}
        <button
          className="bot-switch-btn"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => setViewMode('stage')}
          title="进入产物空间"
        >
          {/* data-avatar-slot 是飞行动画的终点标记。飞行途中先隐身：替身落地的那一刻
              它再淡入，看起来才是「同一只落位」，而不是两只短暂重叠 */}
          <div
            data-avatar-slot
            style={{
              display: 'flex',
              opacity: hideTopAvatar ? 0 : 1,
              transition: 'opacity 140ms linear',
            }}
          >
            <AvatarFace
              shape={topShape}
              size={44}
              status={topStatus}
              color={topInk ?? (theme === 'light' ? '#0a0a0c' : '#f1efe9')}
              /* 材质跟着当前 Bot：顶栏这只和侧栏里那行必须是同一张脸（含毛发） */
              material={currentBot?.avatarMaterial === 'fluffy' ? 'fluffy' : 'flat'}
              animate
              followPointer
              label={currentBot ? currentBot.name : 'Bot'}
            />
          </div>
        </button>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-h-0 relative" style={{ marginTop: 0 }}>
          {/* iOS 风格顶部渐隐：progressive blur 覆盖层（内缩与圆角随
              --chat-frame-border-w 派生，改描边粗细时不用手改） */}
          <div className="chat-top-fade" />
          <ChatPanel messages={claude.messages} isLoading={claude.isLoading} onSend={claude.send} />
          <ApprovalBar />
        </div>
      </main>
        </>
      )}

      {/* 空会话头像飞向顶栏的替身（portal 到 body，跨层级） */}
      <AvatarFlight />

      {/* 选中文字的上下文 AI 操作条（仅 chat 模式） */}
      {viewMode === 'chat' && <SelectionActions onAction={sendWithFlight} />}

      {/* InputBar outside main so backdrop-filter blurs through the page background.
          stage / chat 共用同一套输入区 UI：模型岛、思考强度、状态行两种模式都渲染 */}
      <InputBar
        onSend={sendWithFlight}
        onCancel={claude.cancel}
        isLoading={claude.isLoading}
        currentModel={claude.config.model || 'sonnet'}
        onSelectModel={(model, providerId) => claude.updateConfig({ model, ...(providerId ? { provider: providerId } : {}) })}
        workingDirectory={claude.config.cwd}
      />

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsPanel
          config={claude.config}
          onUpdateConfig={claude.updateConfig}
          onOpenProjectPicker={() => useStageStore.getState().setProjectPickerOpen(true)}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* 项目选择器（应用内目录浏览，stage / chat 通用，居中面板） */}
      <ProjectPalette onSelect={claude.selectProject} />

      {/* Gallery modal */}
      {galleryOpen && <Gallery onClose={() => setGalleryOpen(false)} />}

      {/* Right Sidebar（仅 chat 模式） */}
      {viewMode === 'chat' && <RightSidebar />}

      {/* AskUser 问答卡片（agent 结构化提问，stage/chat 通用，必须始终可回应） */}
      <AskUserCard />

      {/* Resize handles — invisible border layer for frameless window drag-resize */}
      <ResizeBorder />
    </div>
  )
}
