import { useState, useRef, useEffect } from 'react'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { useChatStore } from '../stores/chatStore'
import { useStageStore } from '../stores/stageStore'
import type { FileAttachment } from '../../shared/types'

interface Props {
  onSend: (prompt: string, files?: FileAttachment[]) => void
  onCancel: () => void
  isLoading: boolean
  // Stage 模式注入：头像点击菜单里的「设置」入口；不传则不显示头像
  onOpenSettings?: () => void
}

// 账号头像按钮：输入框左侧，点击弹出 账号/设置 二级菜单
export function AvatarButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="stage-avatar-root">
      {menuOpen && (
        <>
          <div className="stage-fab-menu-mask" onClick={() => setMenuOpen(false)} />
          <div className="stage-avatar-menu">
            <button
              className="stage-fab-menu-item"
              onClick={() => { setMenuOpen(false) }}
            >
              {/* 账号图标 */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21v-1a7 7 0 0114 0v1" />
              </svg>
              账号
            </button>
            <button
              className="stage-fab-menu-item"
              onClick={() => { setMenuOpen(false); onOpenSettings() }}
            >
              {/* 设置齿轮 */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82.33l.06.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
              设置
            </button>
          </div>
        </>
      )}
      <button
        className="stage-avatar-btn"
        onClick={() => setMenuOpen((v) => !v)}
        title="账号"
      >
        <img src="assets/avatar.png" alt="账号" className="w-full h-full object-cover" draggable={false} />
      </button>
    </div>
  )
}

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

export function InputBar({ onSend, onCancel, isLoading, onOpenSettings }: Props) {
  const [input, setInput] = useState('')
  const [hasVoice, setHasVoice] = useState(false)
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const setOrbState = useChatStore((s) => s.setOrbState)
  const sidebarOpen = useChatStore((s) => s.sidebarOpen)
  const sidebarWidth = useChatStore((s) => s.sidebarWidth)
  const rightSidebarOpen = useChatStore((s) => s.rightSidebarOpen)
  const rightSidebarWidth = useChatStore((s) => s.rightSidebarWidth)
  const viewMode = useStageStore((s) => s.viewMode)
  const conversationWidth = useChatStore((s) => s.conversationWidth)
  // Stage 模式下侧边栏不存在，输入栏不预留其宽度
  const effectiveSidebarOpen = viewMode === 'stage' ? false : sidebarOpen
  const effectiveRightOpen = viewMode === 'stage' ? false : rightSidebarOpen

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

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handlePickFiles = async () => {
    setPlusMenuOpen(false)
    const files = await window.claude.pickAndReadFiles()
    if (files && files.length > 0) {
      setAttachments((prev) => [...prev, ...files])
      inputRef.current?.focus()
    }
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

      {/* Input row */}
      <div className="flex justify-center items-center gap-3 w-full">
        {onOpenSettings && <AvatarButton onOpenSettings={onOpenSettings} />}

        {/* Main Input Container */}
        <div
          className="glass-dock rounded-full p-1.5 flex items-center gap-2 transition-all duration-300 group flex-1 h-9"
          style={{
            maxWidth: conversationWidth > 0 ? conversationWidth : undefined,
            boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
            border: voice.isRecording ? '1px solid var(--error)' : undefined,
          }}
        >
          {/* + 按钮（容器内左侧）：点开向上弹 Add photo & files bar */}
          <div className="inputbar-plus-root" style={{ marginLeft: 4 }}>
            {plusMenuOpen && (
              <>
                <div className="stage-fab-menu-mask" onClick={() => setPlusMenuOpen(false)} />
                <div className="inputbar-plus-menu">
                  <button
                    className="stage-fab-menu-item"
                    onClick={handlePickFiles}
                  >
                    {/* 图片 + 文件图标（Zeron Add photo & files 同款） */}
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="M21 15l-3.5-3.5L8 16" />
                    </svg>
                    Add photo &amp; files
                  </button>
                </div>
              </>
            )}
            <button
              className="stage-icon-btn"
              onClick={() => setPlusMenuOpen((v) => !v)}
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
