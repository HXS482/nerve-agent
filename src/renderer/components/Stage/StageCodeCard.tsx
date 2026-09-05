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

export function StageCodeCard({ language, code, fileName, caption }: { language?: string; code: string; fileName?: string; caption?: string }) {
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
      {/* 头栏：文件图标 + 文件名（Write 关联）或语言 · 行数 · Copy */}
      <div className="stage-code-header">
        <span className="stage-code-file">
          <FileIcon />
          <span className="stage-code-filename">{fileName || language || 'code'}</span>
        </span>
        {fileName && language && <span className="stage-code-meta">{language}</span>}
        <span className="stage-code-meta">{lines.length} lines</span>
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

      {/* 底部说明栏：模型对这段代码的解释常驻显示，不用点批注图标 */}
      {caption && <div className="stage-code-caption">{caption}</div>}
    </div>
  )
}

