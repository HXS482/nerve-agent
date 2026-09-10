import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Check, Copy, FileCode2, LoaderCircle } from 'lucide-react'

// Stage 代码卡：回复中的 ``` 围栏代码块落地为产物卡。
// 结构与交互参照 beui CodeBlock：头栏（FileCode2 图标 + 文件名 + 语言大写 +
// Writing/Ready 状态 + 圆形 Copy 按钮）、行号槽 + 分隔竖线、pre-wrap 换行、
// 轻量正则语法着色。配色 token（--sc-*）见 globals.css，明暗主题各一套。

/* 轻量语法着色：keyword/import/条件、函数调用、字符串与数字 */
const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'async', 'function', 'const', 'let', 'var',
  'await', 'return', 'if', 'else', 'for', 'while', 'new', 'throw', 'try', 'catch',
  'null', 'true', 'false', 'undefined',
])
const TOKEN = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b(?:import|from|export|default|async|function|const|let|var|await|return|if|else|for|while|new|throw|try|catch|null|true|false|undefined)\b|[A-Za-z_$][\w$]*(?=\s*\())/g

function highlight(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0
    const t = m[0]
    if (idx > last) nodes.push(<span key={k++}>{text.slice(last, idx)}</span>)
    let color: string
    let weight: number | undefined
    if (/^["'`]/.test(t) || /^\d/.test(t)) color = 'var(--sc-orange)' // 字符串 / 数字
    else if (KEYWORDS.has(t)) color = 'var(--sc-accent)' // 关键字
    else { color = 'var(--sc-ink)'; weight = 500 } // 函数调用
    nodes.push(<span key={k++} style={{ color, fontWeight: weight }}>{t}</span>)
    last = idx + t.length
  }
  if (last < text.length) nodes.push(<span key={k++}>{text.slice(last)}</span>)
  return nodes
}

const SPRING_PRESS = { type: 'spring', stiffness: 500, damping: 30 } as const

export function StageCodeCard({ language, code, fileName, caption, status = 'complete' }: {
  language?: string
  code: string
  fileName?: string
  caption?: string
  status?: 'streaming' | 'complete'
}) {
  const reduce = useReducedMotion() ?? false
  const viewportRef = useRef<HTMLDivElement>(null)
  const copyTimer = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const streaming = status === 'streaming'
  const lines = useMemo(() => code.split('\n'), [code])
  const langLabel = (language ?? 'code').toLowerCase()

  // 复制完成后清理定时器，避免卸载后 setState
  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
  }, [])

  // 流式状态：新内容到达时平滑滚到底
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !streaming) return
    const frame = requestAnimationFrame(() => {
      if (viewport.scrollHeight <= viewport.clientHeight) return
      if (typeof viewport.scrollTo === 'function') {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
      } else {
        viewport.scrollTop = viewport.scrollHeight
      }
    })
    return () => cancelAnimationFrame(frame)
  })

  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(code) } catch { /* 剪贴板不可用 */ }
    setCopied(true)
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
  }, [code])

  return (
    <div className="stage-code" data-state={status} aria-busy={streaming}>
      {/* 头栏：FileCode2 图标 + 文件名/语言大写 + 状态 + 圆形 Copy 按钮 */}
      <div className="stage-code-header">
        <FileCode2 aria-hidden="true" size={14} strokeWidth={1.8} className="stage-code-fileicon" />
        <span className="stage-code-filename">{fileName}</span>
        <span className="stage-code-lang">{langLabel}</span>
        <span className={`stage-code-state${streaming ? ' is-streaming' : ''}`}>
          {streaming ? (
            <LoaderCircle size={12} className={reduce ? undefined : 'stage-code-spin'} />
          ) : (
            <Check size={12} />
          )}
          {streaming ? 'Writing' : 'Ready'}
        </span>
        <motion.button
          type="button"
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={copy}
          whileTap={reduce ? undefined : { scale: 0.9 }}
          transition={SPRING_PRESS}
          className="stage-code-copy"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </motion.button>
      </div>

      {/* 正文：行号槽（20px + 分隔竖线）+ pre-wrap 换行的代码行 */}
      <div className="stage-code-body" ref={viewportRef} role={streaming ? 'log' : undefined} aria-live={streaming ? 'polite' : undefined}>
        <span className="stage-code-gutter-line" aria-hidden />
        {lines.map((line, i) => (
          <div key={i} className="stage-code-line">
            <span className="stage-code-num">{i + 1}</span>
            <code className="stage-code-text">{highlight(line)}</code>
          </div>
        ))}
      </div>

      {/* 底部说明栏：模型对这段代码的解释常驻显示，不用点批注图标 */}
      {caption && <div className="stage-code-caption">{caption}</div>}
    </div>
  )
}
