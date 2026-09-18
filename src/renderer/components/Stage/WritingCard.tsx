import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// 写作卡（Stage 画布）：检测到写作任务时，正文内容进入居中固定卡片渲染。
// 玻璃卡身（浅白底 + 高斯模糊 + 细白边 + 圆角矩形），内容超长内部滚动，逐段渐现。
// 头部笔按钮 → 卡片底部滑出输入框，提交后把修改要求发给 agent 对话式重生成
//（触发判定见 stageAdapter.ts 的 detectWriting）。

const EASE = [0.22, 1, 0.36, 1] as const

export function WritingCard({
  text,
  streaming,
  regenerating,
  onSend,
}: {
  text: string
  streaming?: boolean
  /** 重生成中：卡片保持挂载、正文清空，头部显示等待态（新文字到达后自然恢复） */
  regenerating?: boolean
  onSend?: (prompt: string) => void
}) {
  const scrollRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* 剪贴板不可用忽略 */ }
  }

  const toggleEdit = () => {
    if (streaming) return
    setEditing((v) => !v)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const instruction = draft.trim()
    if (!instruction || streaming) return
    onSend?.(`请根据以下要求重新生成上面的文章：\n\n${instruction}`)
    setEditing(false)
    setDraft('')
  }

  // 正文按段落/代码围栏切块，逐段渐现（与 NarrationLayer 同节奏语法）
  const segments = useMemo(() => {
    const blocks: string[] = []
    let cur: string[] = []
    let inFence = false
    for (const line of text.split('\n')) {
      const fence = /^```/.test(line.trim())
      if (fence) {
        if (!inFence) {
          if (cur.length) { blocks.push(cur.join('\n')); cur = [] }
          inFence = true
        } else {
          inFence = false
        }
        cur.push(line)
        continue
      }
      if (inFence) { cur.push(line); continue }
      if (!line.trim()) {
        if (cur.length) { blocks.push(cur.join('\n')); cur = [] }
        continue
      }
      cur.push(line)
    }
    if (cur.length) blocks.push(cur.join('\n'))
    return blocks.filter((b) => b.trim())
  }, [text])

  const lineCount = text.split('\n').filter((l) => l.trim()).length
  // 流式场景：逐段渐现只给「已完成段落」用小延迟；最新一段（流式增长中）不做延迟直接跟随
  const step = lineCount > 30 ? 0.03 : lineCount > 12 ? 0.05 : 0.09
  let seg = 0
  const delayFor = (block: string, isLast: boolean) => {
    const d = seg * step
    seg += block.split('\n').length
    // 最后一段（含流式增长中的未闭合段）实时跟随，不排队等动画
    if (isLast) return Math.min(d, 0.15)
    // 非最后段延迟同样封顶：长文流式时累计延迟会把后段压到几秒之后才显
    return Math.min(d, 0.6)
  }

  // 内容增长时贴底跟随（仅当用户未上翻）
  useEffect(() => {
    const el = bodyRef.current
    if (el && (streaming || regenerating) && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [text, streaming, regenerating])

  const charCount = text.length

  return (
    <div className="writing-card-layer">
      <motion.div
        className="writing-card"
        initial={{ opacity: 0, y: 24, scale: 0.96, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, scale: 0.97, filter: 'blur(8px)', transition: { duration: 0.25 } }}
        transition={{ type: 'spring', stiffness: 220, damping: 26 }}
      >
      <div className="writing-card-head">
        <span className="writing-card-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Writing
        </span>
        <span className="writing-card-meta tabular-nums">
          {regenerating || streaming
            ? (streaming ? 'writing…' : 'regenerating…')
            : `${charCount.toLocaleString()} 字`}
        </span>
        <span className="writing-card-actions">
          <button
            type="button"
            className="writing-card-btn"
            data-active={editing ? 'true' : undefined}
            title={streaming ? '生成中不可修改' : '修改重写'}
            disabled={streaming}
            onClick={toggleEdit}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
          <button
            type="button"
            className="writing-card-btn"
            title={copied ? '已复制' : '复制全文'}
            onClick={handleCopy}
          >
            {copied ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
            )}
          </button>
        </span>
      </div>
      <div className="writing-card-body" ref={bodyRef}>
        {segments.map((block, i) => {
          const isFence = block.trimStart().startsWith('```')
          const isLast = i === segments.length - 1
          return (
            <motion.div
              key={i}
              className={isFence ? 'narration-code' : 'narration-line'}
              initial={isLast && (streaming || regenerating) ? { opacity: 0.6 } : { opacity: 0, y: 10, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: delayFor(block, isLast), duration: 0.45, ease: EASE }}
            >
              {isFence ? (
                <div className="prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]}>
                    {block}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="prose narration-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {block}
                  </ReactMarkdown>
                </div>
              )}
            </motion.div>
          )
        })}
        {regenerating && segments.length === 0 && (
          <div className="writing-card-empty">
            <i className="writing-card-live" aria-hidden />
            <span>正在重新生成…</span>
          </div>
        )}
      </div>
      {/* 修改重写输入框：笔按钮切换显隐，提交 = 把修改要求发给 agent 对话式重生成 */}
      <form
        className="writing-card-input-wrap"
        data-open={editing && !streaming ? 'true' : 'false'}
        onSubmit={handleSubmit}
      >
        <div className="writing-card-input">
          <input
            autoFocus={editing}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="输入修改要求，如：把第二段压缩到 100 字…"
          />
          <button
            type="submit"
            className="writing-card-send"
            disabled={!draft.trim() || streaming}
            title="重新生成"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </form>
      </motion.div>
    </div>
  )
}
