import { useEffect, useRef, useState } from 'react'

/* ─────────────────────────────────────────────────────────
 * SELECTION ACTIONS —— 选中文字的上下文 AI 操作条
 *
 * 在聊天消息区（[data-chat-scroll]）里划选文字，松开鼠标后
 * 在选区末行下方浮出胶囊操作条：预设动作 / 自定义指令，
 * 确认后把「选中内容 + 指令」作为新消息发给 agent。
 * ───────────────────────────────────────────────────────── */

interface SelAnchor {
  text: string
  x: number
  y: number
}

interface Props {
  /** 发送组合好的指令（选中内容 + 动作） */
  onAction: (prompt: string) => void
}

const iconProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

const ACTIONS = {
  primary: [
    { id: '解释', icon: <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.3a2.5 2.5 0 1 1 3.4 2.33c-.76.3-.9 1-.9 1.67" /><circle cx="12" cy="17" r="0.5" fill="currentColor" /></svg> },
    { id: '优化', icon: <svg {...iconProps}><path d="M12 3l2 6.2L20 11l-6 1.8L12 19l-2-6.2L4 11l6-1.8z" /></svg> },
  ],
  more: [
    { id: '缩写', icon: <svg {...iconProps}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.2 7.5L20 19M8.2 16.5L20 5" /></svg> },
    { id: '换语气', icon: <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5s1.2 1.8 3.5 1.8 3.5-1.8 3.5-1.8" /><path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.4" /></svg> },
    { id: '修语法', icon: <svg {...iconProps}><path d="M4 6h16M4 12h10M4 18h7" /></svg> },
  ],
}

const composePrompt = (instruction: string, selected: string) =>
  `${instruction}以下选中内容：\n\n${selected}`

export function SelectionActions({ onAction }: Props) {
  const [sel, setSel] = useState<SelAnchor | null>(null)
  const [prompt, setPrompt] = useState('')
  const [expanded, setExpanded] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  // 划选监听：mouseup 后在消息区内取选区，定位到末行下方
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      // 点在操作条内部：不清除（点按钮/输入框会导致选区塌缩，不能据此关闭）
      if (barRef.current?.contains(e.target as Node)) return
      requestAnimationFrame(() => {
        const s = window.getSelection()
        const text = s && !s.isCollapsed ? s.toString().trim() : ''
        if (!s || !text) { setSel(null); return }
        const range = s.getRangeAt(0)
        // 生效区域：chat 消息流（[data-chat-scroll]）或 stage 主体（.stage-main，含旁白/卡片文字）
        const node = range.commonAncestorContainer
        const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
        if (!el?.closest('[data-chat-scroll], .stage-main')) { setSel(null); return }
        const lines = Array.from(range.getClientRects())
        const lastLine = lines[lines.length - 1]
        if (!lastLine) { setSel(null); return }
        const bounds = range.getBoundingClientRect()
        const x = Math.min(
          Math.max(bounds.left + bounds.width / 2, 160),
          window.innerWidth - 160,
        )
        setSel({ text, x, y: lastLine.bottom + 8 })
        setPrompt('')
        setExpanded(false)
      })
    }
    const onScroll = () => setSel(null)
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (!sel) return null

  const run = (instruction: string) => {
    onAction(composePrompt(instruction, sel.text))
    window.getSelection()?.removeAllRanges()
    setSel(null)
  }

  const hasPrompt = prompt.trim().length > 0

  return (
    <div
      className="selection-bar-anchor"
      style={{ left: sel.x, top: sel.y }}
    >
      <div ref={barRef} className="selection-bar">
        {/* 自定义指令输入 */}
        <form
          className="selection-bar-form"
          style={{
            maxWidth: expanded ? 0 : hasPrompt ? 200 : 145,
            opacity: expanded ? 0 : 1,
          }}
          onSubmit={(e) => {
            e.preventDefault()
            run(prompt.trim() || '优化')
          }}
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            aria-label="描述修改"
            placeholder="描述修改…"
            className="selection-bar-input"
          />
        </form>

        {/* 动作组：输入指令时让位给发送键 */}
        <div
          className="selection-bar-actions"
          style={{
            maxWidth: hasPrompt ? 0 : expanded ? 460 : 190,
            opacity: hasPrompt ? 0 : 1,
          }}
        >
          <span className="selection-bar-divider" />
          {ACTIONS.primary.map((a) => (
            <button key={a.id} type="button" className="selection-bar-btn" onClick={() => run(a.id)}>
              {a.icon}
              {a.id}
            </button>
          ))}
          <div
            className="selection-bar-more"
            style={{ maxWidth: expanded ? 280 : 0, opacity: expanded ? 1 : 0 }}
          >
            {ACTIONS.more.map((a) => (
              <button key={a.id} type="button" className="selection-bar-btn" onClick={() => run(a.id)}>
                {a.icon}
                {a.id}
              </button>
            ))}
          </div>
          <span className="selection-bar-divider" />
          <button
            type="button"
            aria-label={expanded ? '收起更多动作' : '展开更多动作'}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="selection-bar-icon-btn"
          >
            <svg
              {...iconProps}
              style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.4s cubic-bezier(0.23,1,0.32,1)',
              }}
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        {/* 发送（输入指令时出现） */}
        <div
          className="selection-bar-send-wrap"
          style={{ maxWidth: hasPrompt ? 30 : 0, opacity: hasPrompt ? 1 : 0 }}
        >
          <button
            type="button"
            aria-label="发送修改指令"
            onClick={() => run(prompt.trim())}
            className="selection-bar-send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
