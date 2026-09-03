import { useCallback, useState, type ReactNode } from 'react'

// Stage 代码卡：回复中的 ``` 围栏代码块落地为产物卡。
// 结构与样式参照 CodeBlock 参照组件：头栏（文件图标 + 语言 + Copy）、
// 行号槽 + 分隔竖线、行内 pre-wrap 换行（不横向滚动）、轻量正则语法着色。
// 配色 token（--sc-*）见 globals.css，明暗主题各一套。

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

function FileIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  )
}

export function StageCodeCard({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }, [code])

  const lines = code.split('\n')

  return (
    <div className="stage-code">
      {/* 头栏：文件图标 + 语言 · Copy */}
      <div className="stage-code-header">
        <span className="stage-code-file">
          <FileIcon />
          <span className="stage-code-filename">{language || 'code'}</span>
        </span>
        <button
          type="button"
          className="stage-code-copy"
          data-copied={copied}
          aria-label="Copy code"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={copy}
        >
          {copied ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* 正文：行号槽（20px + 分隔竖线）+ pre-wrap 换行的代码行 */}
      <div className="stage-code-body">
        <span className="stage-code-gutter-line" aria-hidden />
        {lines.map((line, i) => (
          <div key={i} className="stage-code-line">
            <span className="stage-code-num">{i + 1}</span>
            <code className="stage-code-text">{highlight(line)}</code>
          </div>
        ))}
      </div>
    </div>
  )
}

// 代码卡批注：右侧跟随的裸 SVG 弹幕图标（无圆圈底），点击弹出无边框卡片显示完整批注。
// 挂在 .stage-card（position: relative，code 卡 overflow: visible）内，
// 随卡片拖拽与缩放移动；pointerdown 阻断，避免触发卡片拖拽。
export function StageCodeAnnotation({ annotations }: { annotations: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="code-annotation">
      <button
        type="button"
        className="code-annotation-toggle"
        data-open={open}
        title="批注"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
      >
        {/* 弹幕：气泡 + 两行文字 */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4h18v11H10l-5 4.5V15H3z" />
          <line x1="7" y1="8.5" x2="17" y2="8.5" />
          <line x1="7" y1="11.5" x2="13" y2="11.5" />
        </svg>
      </button>
      {open && (
        <div className="code-annotation-pop" onPointerDown={(e) => e.stopPropagation()}>
          {annotations.map((a, i) => (
            <p key={i}>{a}</p>
          ))}
        </div>
      )}
    </div>
  )
}
