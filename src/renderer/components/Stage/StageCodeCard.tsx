import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Check, Copy, FileCode2, LoaderCircle } from 'lucide-react'
import { common, createLowlight } from 'lowlight'

// Stage 代码卡：回复中的 ``` 围栏代码块落地为产物卡。
// 结构与交互参照 beui CodeBlock：头栏（FileCode2 图标 + 文件名 + 语言大写 +
// Writing/Ready 状态 + 圆形 Copy 按钮）、行号槽 + 分隔竖线、pre-wrap 换行、
// lowlight(highlight.js) 真语法高亮（hljs-* 类名映射到 --sc-* token，见 globals.css）。

const low = createLowlight(common)

interface CodeSeg { cls?: string; text: string }

// 整段代码一次高亮（跨行注释/字符串不断色），再把 hast 树按行拆成片段数组——
// 行号槽仍按逻辑行对齐，包裹 span 在换行处克隆延续
function splitHighlightLines(code: string, language?: string): CodeSeg[][] {
  const lang = language && low.registered(language) ? language : undefined
  if (!lang) return code.split('\n').map((t) => [{ text: t }])
  const tree = low.highlight(lang, code)
  const lines: CodeSeg[][] = [[]]
  const push = (cls: string | undefined, text: string) => {
    text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push(cls ? { cls, text: part } : { text: part })
    })
  }
  const walk = (node: any, cls?: string) => {
    if (node.type === 'text') {
      push(cls, node.value)
    } else if (node.type === 'element') {
      const own = ((node.properties?.className as string[] | undefined) ?? []).join(' ')
      // 嵌套元素合并类名（如 hljs-string > hljs-subst），外层色可继承
      node.children?.forEach((ch: any) => walk(ch, cls && own ? `${cls} ${own}` : own || cls))
    } else {
      node.children?.forEach((ch: any) => walk(ch, cls))
    }
  }
  walk(tree)
  return lines
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
  const lines = useMemo(() => splitHighlightLines(code, language), [code, language])
  const langLabel = (language ?? 'code').toLowerCase()

  // 复制完成后清理定时器，避免卸载后 setState
  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
  }, [])

  // 流式状态：新内容到达时滚到底；用户上翻超过阈值则暂停跟随，回到底部附近自动恢复。
  // 用瞬时滚动（非 smooth）：smooth 动画途中 scrollHeight 继续增长，onScroll 的
  // 距底判定会瞬时超阈值，把程序滚动误判成用户上翻而永久暂停跟随
  const followRef = useRef(true)
  const onBodyScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    followRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24
  }, [])
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !streaming || !followRef.current) return
    const frame = requestAnimationFrame(() => {
      if (viewport.scrollHeight <= viewport.clientHeight) return
      viewport.scrollTop = viewport.scrollHeight
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
      <div className="stage-code-body" ref={viewportRef} onScroll={onBodyScroll} role={streaming ? 'log' : undefined} aria-live={streaming ? 'polite' : undefined}>
        <span className="stage-code-gutter-line" aria-hidden />
        {lines.map((line, i) => (
          <div key={i} className="stage-code-line">
            <span className="stage-code-num">{i + 1}</span>
            <code className="stage-code-text">
              {line.map((seg, j) =>
                seg.cls ? <span key={j} className={seg.cls}>{seg.text}</span> : seg.text,
              )}
            </code>
          </div>
        ))}
      </div>

      {/* 底部说明栏：模型对这段代码的解释常驻显示，不用点批注图标 */}
      {caption && <div className="stage-code-caption">{caption}</div>}
    </div>
  )
}
