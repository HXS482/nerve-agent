import { useState, useRef, useEffect } from 'react'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { useChatStore } from '../stores/chatStore'
import { useStageStore } from '../stores/stageStore'
import { useGitStore } from '../stores/gitStore'
import { ModelIsland } from './ModelIsland'
import { ContextRing } from './ContextRing'
import type { ClaudeConfig, FileAttachment } from '../../shared/types'

interface Props {
  onSend: (prompt: string, files?: FileAttachment[]) => void
  onCancel: () => void
  isLoading: boolean
  // Stage 模式注入：模型岛嵌在胶囊右侧；不传则不渲染（chat 模式模型岛在顶栏）
  currentModel?: string
  onSelectModel?: (model: string, providerId?: string) => void
  // Stage 模式注入：状态行左半的「Local checkout / 当前分支」
  workingDirectory?: string
}

// 思考强度档位：存的是 API enum，显示说人话
const EFFORT_LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-high', max: 'Max',
}
const EFFORTS: Array<ClaudeConfig['effort']> = ['low', 'medium', 'high', 'xhigh', 'max']

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const color = mimeType.startsWith('image/') ? '#22c55e'
    : mimeType === 'application/pdf' ? '#ef4444'
    : mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('yaml') ? '#eab308'
    : '#3b82f6'
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

export function InputBar({ onSend, onCancel, isLoading, currentModel, onSelectModel, workingDirectory }: Props) {
  const [input, setInput] = useState('')
  const [hasVoice, setHasVoice] = useState(false)
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const plusRootRef = useRef<HTMLDivElement>(null)
  // + 弹条几何：打开瞬间实测 + 按钮相对根的偏移（弹条挂在根层级，见下方 JSX 注释）。
  // 写死数字会飘位——按钮距根左缘受胶囊内边距影响，chat 模式根还有侧边栏 marginLeft
  const [plusMenuPos, setPlusMenuPos] = useState({ left: 10, bottom: 106 })
  const rootRef = useRef<HTMLDivElement>(null)
  const togglePlusMenu = () => {
    const root = rootRef.current
    const btn = plusRootRef.current
    if (root && btn) {
      const rr = root.getBoundingClientRect()
      const br = btn.getBoundingClientRect()
      setPlusMenuPos({ left: br.left - rr.left, bottom: rr.bottom - br.top + 8 })
    }
    setPlusMenuOpen((v) => !v)
  }
  const [effortMenuOpen, setEffortMenuOpen] = useState(false)
  const effortRootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const setOrbState = useChatStore((s) => s.setOrbState)
  const sidebarOpen = useChatStore((s) => s.sidebarOpen)
  const sidebarWidth = useChatStore((s) => s.sidebarWidth)
  const rightSidebarOpen = useChatStore((s) => s.rightSidebarOpen)
  const rightSidebarWidth = useChatStore((s) => s.rightSidebarWidth)
  const conversationWidth = useChatStore((s) => s.conversationWidth)
  const effort = useChatStore((s) => s.config.effort)
  const setConfigEffort = useChatStore((s) => s.setConfig)
  const viewMode = useStageStore((s) => s.viewMode)
  // Stage 模式下侧边栏不存在，输入栏不预留其宽度
  const effectiveSidebarOpen = viewMode === 'stage' ? false : sidebarOpen
  const effectiveRightOpen = viewMode === 'stage' ? false : rightSidebarOpen

  // 状态行的当前分支：只在 gitStore 的 cwd 与 stage 工作目录一致时可信
  //（chat 模式的 git 面板会往同一个 store 写自己的 cwd）
  const gitCwd = useGitStore((s) => s.cwd)
  const gitStatus = useGitStore((s) => s.status)
  const gitBranches = useGitStore((s) => s.branches)
  const setGitCwd = useGitStore((s) => s.setCwd)
  const fetchGitStatus = useGitStore((s) => s.fetchStatus)
  const fetchGitBranches = useGitStore((s) => s.fetchBranches)
  const currentBranch = gitCwd === workingDirectory
    ? gitStatus?.current || gitBranches.find((branch) => branch.current)?.name || ''
    : ''

  // gitStore 的 cwd 是单例：进 stage 时把它指向 stage 的工作目录，否则 fetch* 会打到旧目录
  useEffect(() => {
    if (viewMode === 'stage' && workingDirectory && gitCwd !== workingDirectory) {
      setGitCwd(workingDirectory)
    }
  }, [viewMode, workingDirectory, gitCwd, setGitCwd])

  useEffect(() => {
    if (viewMode === 'stage' && workingDirectory && gitCwd === workingDirectory) {
      void Promise.all([fetchGitStatus(), fetchGitBranches()])
    }
  }, [viewMode, workingDirectory, gitCwd, fetchGitStatus, fetchGitBranches])

  const voice = useVoiceInput((text) => {
    setHasVoice(true)
    setInput((prev) => (prev ? prev + ' ' + text : text))
  })

  // Sync orb state with loading
  useEffect(() => {
    if (isLoading) {
      setOrbState('thinking')
      const timer = setTimeout(() => {
        setOrbState('morphing')
      }, 10000)
      return () => clearTimeout(timer)
    } else {
      setOrbState('idle')
    }
  }, [isLoading, setOrbState])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 菜单开着时点外面就收起：document mousedown 而非全屏遮罩。
  // 原遮罩 z-54 与胶囊的 backdrop-filter 层级冲突，把弹出的菜单压到点不到
  useEffect(() => {
    if (!plusMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (plusRootRef.current && !plusRootRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [plusMenuOpen])

  // 思考强度菜单同款外点关闭
  useEffect(() => {
    if (!effortMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (effortRootRef.current && !effortRootRef.current.contains(e.target as Node)) {
        setEffortMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [effortMenuOpen])

  // 滑动变阻器：按点击/拖动的横向位置换算档位（5 档均分轨道）。
  // 拖动中只在松手时提交 setConfig——每次 setConfig 都触发 zustand persist 写盘，
  // 拖动一路写 localStorage 是拖动卡顿的根因
  const effortTrackRef = useRef<HTMLDivElement>(null)
  const pendingEffortRef = useRef<ClaudeConfig['effort'] | null>(null)
  // 粒子：滑动时从条的右端冒出的绿色小光点，纯 DOM + CSS 动画（不用 canvas，
  // 粒子数量个位数，DOM 足够且免掉一层渲染栈）
  const spawnEffortParticles = (fillEl: HTMLElement) => {
    const track = fillEl.parentElement
    if (!track) return
    // 限流：上一颗粒子还没走完就不再补种（300ms 生命周期）
    if ((track as any)._particleBusy) return
    ;(track as any)._particleBusy = true
    setTimeout(() => { (track as any)._particleBusy = false }, 90)
    for (let i = 0; i < 2; i++) {
      const p = document.createElement('span')
      p.className = 'effort-particle'
      const w = fillEl.getBoundingClientRect().width
      p.style.left = `${w - 2 + Math.random() * 4}px`
      p.style.top = `${8 + Math.random() * 14}px`
      p.style.animationDelay = `${i * 60}ms`
      p.style.setProperty('--dx', `${2 + Math.random() * 5}px`)
      p.style.setProperty('--dy', `${-(2 + Math.random() * 5)}px`)
      p.addEventListener('animationend', () => p.remove())
      track.appendChild(p)
    }
  }
  const effortIdxFromClientX = (clientX: number): number => {
    const el = effortTrackRef.current
    if (!el) return EFFORTS.indexOf(effort)
    const r = el.getBoundingClientRect()
    const ratio = Math.min(Math.max((clientX - r.left) / r.width, 0), 0.999)
    return Math.floor(ratio * EFFORTS.length)
  }
  const effortApplyFromClientX = (clientX: number) => {
    const idx = effortIdxFromClientX(clientX)
    pendingEffortRef.current = EFFORTS[idx]
    // 可用行程 = 轨道内宽（扣两侧 4px 等距边距），fill 宽度按档位比例折算
    const el = effortTrackRef.current
    if (el) {
      const fill = el.querySelector<HTMLElement>('.effort-slider-fill')
      if (fill) {
        const trackW = el.getBoundingClientRect().width - 8
        fill.style.width = `${Math.max(8, ((idx + 1) / EFFORTS.length) * trackW)}px`
        spawnEffortParticles(fill)
      }
      const label = el.querySelector<HTMLElement>('.effort-slider-label')
      if (label) label.textContent = EFFORT_LABELS[pendingEffortRef.current] ?? pendingEffortRef.current
    }
  }
  const effortCommitPending = () => {
    const next = pendingEffortRef.current
    pendingEffortRef.current = null
    if (next && next !== effort) setConfigEffort({ effort: next })
  }

  const handlePickFiles = async () => {
    setPlusMenuOpen(false)
    const files = await window.claude.pickAndReadFiles()
    if (files && files.length > 0) {
      setAttachments((prev) => [...prev, ...files])
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return
    if (voice.isRecording) voice.stop()
    const prompt = hasVoice ? `[语音指令] ${input.trim()}` : input.trim()
    setOrbState('active')
    onSend(prompt, attachments.length > 0 ? attachments : undefined)
    setInput('')
    setHasVoice(false)
    setAttachments([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const getPlaceholder = () => {
    if (voice.isRecording) return `Recording ${formatDuration(voice.duration)}...`
    if (voice.isTranscribing) return 'Transcribing...'
    return 'Ask anything...'
  }

  return (
    <div
      ref={rootRef}
      className="absolute left-0 right-0 z-50 flex flex-col items-center gap-2"
      style={{
        paddingLeft: '11px',
        paddingRight: '11px',
        bottom: '14px',
        marginLeft: effectiveSidebarOpen ? `${sidebarWidth + 8}px` : '4px',
        marginRight: effectiveRightOpen ? `${rightSidebarWidth + 8}px` : '4px',
        transition: 'margin-left 0.3s ease, margin-right 0.3s ease',
      }}
    >
      {/* Attachment thumbnails */}
      {attachments.length > 0 && (
        <div className="flex gap-1.5 justify-center">
          {attachments.map((file, i) => (
            <div key={i} className="relative rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)', maxWidth: 120 }}>
              <button onClick={() => removeAttachment(i)}
                className="absolute top-1 right-1 z-10 w-4 h-4 rounded-full flex items-center justify-center transition-all hover:scale-110"
                style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}>
                <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
              {file.isImage ? (
                <img src={`data:${file.mimeType};base64,${file.data}`} className="w-full h-16 object-cover" />
              ) : (
                <div className="w-full h-16 flex items-center justify-center" style={{ background: 'var(--bg-surface-container)', color: 'var(--text-outline-variant)' }}>
                  <FileIcon mimeType={file.mimeType} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 菜单关闭遮罩已改为 document mousedown 外点关闭（StageAvatar 同款做法） */}

      {/* + 按钮弹出条（Add photo & files）：挂在 InputBar 根层级，与思考强度弹条同款处理——
          嵌在 glass-dock 里 blur 采不到壁纸（backdrop-filter 屏障），挪出来才是真磨砂。
          几何在打开瞬间从 + 按钮实测（见 togglePlusMenu）：弹条左缘对齐按钮左缘，
          弹条底到按钮顶 8px。不写死数字——写死的 106/10 在真实布局下偏左偏低 */}
      {plusMenuOpen && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
          <div
            className="inputbar-plus-menu"
            style={{ position: 'absolute', bottom: plusMenuPos.bottom, left: plusMenuPos.left, minWidth: 180 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button className="fab-menu-item" style={{ pointerEvents: 'auto' }} onClick={handlePickFiles}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="9" cy="9" r="2" />
                <path d="M21 15l-3.5-3.5L8 16" />
              </svg>
              Add photo &amp; files
            </button>
          </div>
        </div>
      )}

      {/* 思考强度弹出条：挂在 InputBar 根层级（与输入胶囊同层级、同为 z-50 根内直接子元素），
          不嵌在 glass-dock 里——backdrop-filter 胶囊会成为 fixed/absolute 后代的采样屏障，
          嵌在里面 blur 采不到壁纸，观感发虚。现在 blur 直接吃壁纸，与输入胶囊同一质感 */}
      {viewMode === 'stage' && effortMenuOpen && (
        <div ref={effortRootRef} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div
            className="effort-slider-track"
            role="slider"
            aria-label="思考强度"
            aria-valuemin={0}
            aria-valuemax={EFFORTS.length - 1}
            aria-valuenow={EFFORTS.indexOf(effort)}
            ref={effortTrackRef}
            style={{ pointerEvents: 'auto', position: 'absolute', bottom: 76, left: '50%', transform: 'translateX(-50%)' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              effortApplyFromClientX(e.clientX)
            }}
            onPointerMove={(e) => {
              if (e.buttons & 1) effortApplyFromClientX(e.clientX)
            }}
            onPointerUp={effortCommitPending}
            onLostPointerCapture={effortCommitPending}
          >
            <div className="effort-slider-fill" style={{ width: `${Math.max(8, ((EFFORTS.indexOf(effort) + 1) / EFFORTS.length) * 142)}px` }} />
            <span className="effort-slider-label">{EFFORT_LABELS[effort] ?? effort}</span>
          </div>
        </div>
      )}

      {/* Input row：外层列容器把胶囊和状态行绑成同宽一组（max-w-4xl 挂这里，
          状态行才跟着胶囊一起限宽，而不是自己顶到窗口边缘） */}
      <div className="flex justify-center items-center gap-3 w-full">
        {/* max-w-4xl 是默认上限；conversationWidth > 0 时由设置面板接管，与正文列同宽 */}
        <div
          className="flex flex-col gap-1 flex-1 min-w-0 max-w-4xl"
          style={{ maxWidth: conversationWidth > 0 ? conversationWidth : undefined }}
        >
          {/* Main Input Container */}
          <div
            className="glass-dock rounded-full p-1.5 flex items-center gap-2 transition-all duration-300 group w-full h-9"
            style={{
              boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
              border: voice.isRecording ? '1px solid var(--error)' : undefined,
            }}
          >
            {/* + 按钮（容器内左侧）：点开向上弹 Add photo & files bar（弹条挂在根层级，见上） */}
            <div className="inputbar-plus-root" ref={plusRootRef} style={{ marginLeft: 4 }}>
              <button
                className="stage-icon-btn"
                onClick={togglePlusMenu}
                title="添加文件"
                style={{ borderRadius: 999 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.2s', transform: plusMenuOpen ? 'rotate(45deg)' : 'none' }}>
                  <path d="M5 12h14" />
                  <path d="M12 5v14" />
                </svg>
              </button>
            </div>

            {/* Input Field */}
            <div className="flex-1 flex items-center" style={{ paddingLeft: '8px', paddingRight: '16px' }}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={getPlaceholder()}
                className="bg-transparent border-none focus:ring-0 text-[var(--text-on-surface)] placeholder-[var(--text-outline)] w-full text-[14px] outline-none focus:outline-none"
                style={{ caretColor: 'var(--accent-primary)' }}
                disabled={isLoading || voice.isTranscribing}
              />
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-1.5" style={{ paddingRight: '10px', paddingLeft: '4px' }}>
              {/* 思考强度入口按钮：弹出条挂在 InputBar 根层级（见上方 effortMenuOpen 块） */}
              {viewMode === 'stage' && (
                <div className="inputbar-plus-root" ref={effortRootRef}>
                  <button
                    className="stage-icon-btn"
                    onClick={() => setEffortMenuOpen((v) => !v)}
                    title={`思考强度: ${EFFORT_LABELS[effort] ?? effort}`}
                    style={{ borderRadius: 999, fontSize: 10, fontWeight: 600, width: 'auto', padding: '0 8px', gap: 3 }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3a6 6 0 016 6c0 2.2-1.2 3.6-2.2 4.8-.6.7-1 1.3-1.2 2.2h-5.2c-.2-.9-.6-1.5-1.2-2.2C7.2 12.6 6 11.2 6 9a6 6 0 016-6z" />
                      <path d="M9.5 19h5" />
                      <path d="M10.5 21.5h3" />
                    </svg>
                    {EFFORT_LABELS[effort] ?? effort}
                  </button>
                </div>
              )}
              {currentModel && onSelectModel && (
                <ModelIsland
                  currentModel={currentModel}
                  onSelectModel={onSelectModel}
                  dropdownAlign="right"
                  dropDirection="up"
                />
              )}
              {isLoading ? (
                <button
                  onClick={onCancel}
                  className="p-2 rounded-full text-[var(--text-on-surface-variant)] hover:text-[var(--error)] hover:bg-white/5 transition-all"
                  title="Stop generating"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={voice.toggle}
                  disabled={voice.isTranscribing}
                  className={`p-2 rounded-full transition-all ${
                    voice.isRecording
                      ? 'text-[var(--error)] voice-recording'
                      : voice.isTranscribing
                        ? 'text-[var(--accent-primary)] animate-pulse-soft'
                        : 'text-[var(--text-on-surface-variant)] hover:text-[var(--accent-primary)] hover:bg-white/5'
                  }`}
                  title={voice.isRecording ? 'Stop recording' : 'Voice input'}
                >
                  {voice.isTranscribing ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 12a9 9 0 11-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                      <path d="M19 10v2a7 7 0 01-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>

        {/* 状态行（仅 stage）：左半 Local checkout + 当前分支，右半 context 用量环。
            宽度扣掉 12px 两侧内边距，和胶囊的视觉边缘对齐 */}
        {viewMode === 'stage' && (
          <div
            className="flex items-center justify-between"
            style={{ minHeight: 20, width: 'calc(100% - 24px)', margin: '0 12px' }}
          >
            <div
              className="flex min-w-0 items-center gap-2 overflow-hidden text-[10px]"
              style={{ color: 'var(--text-on-surface-variant)' }}
            >
              <span className="inline-flex shrink-0 items-center gap-1.5" title={workingDirectory || 'Local checkout'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7.5A2.5 2.5 0 015.5 5H9l2 2h7.5A2.5 2.5 0 0121 9.5v7A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5v-9z" />
                </svg>
                <span>Local checkout</span>
              </span>
              <span className="h-3 w-px shrink-0" style={{ background: 'var(--border-default)' }} />
              <span
                className="inline-flex min-w-0 items-center gap-1.5"
                title={`Current branch: ${currentBranch || 'unknown'}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <circle cx="6" cy="5" r="2" />
                  <circle cx="18" cy="6" r="2" />
                  <circle cx="6" cy="19" r="2" />
                  <path d="M6 7v10" />
                  <path d="M8 6h4a4 4 0 014 4v2a4 4 0 01-4 4H8" />
                </svg>
                <span className="truncate">{currentBranch || 'unknown'}</span>
              </span>
            </div>
            <ContextRing compact />
          </div>
        )}
        </div>
      </div>

      {/* Error toast */}
      {voice.error && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg text-xs text-[var(--error)] bg-[var(--error-container)] animate-fade-in whitespace-nowrap">
          {voice.error}
        </div>
      )}
    </div>
  )
}
