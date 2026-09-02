import { useLayoutEffect, useRef, useState } from 'react'

// 思考 trace 内容：按行渲染，每行打勾；进行中最后一行显示 spinner
// 左侧竖线随内容高度生长（测量 + 500ms 过渡，对齐 Thinking 示例）
// chat（ToolflowUnit）与 stage（ThinkSpot）共用，样式见 globals.css .think-trace-*
export function ThinkTraceContent({ text, working }: { text: string; working: boolean }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const traceRef = useRef<HTMLDivElement>(null)
  const [lineHeight, setLineHeight] = useState(0)

  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight)
  }, [lines.length, working])

  return (
    <div className="think-trace-inner">
      <span
        aria-hidden
        className="think-trace-line"
        style={{ height: lineHeight ? lineHeight - 2 : 0 }}
      />
      <div ref={traceRef} className="think-trace-content">
        {lines.map((line, i) => {
          const isActiveRow = working && i === lines.length - 1
          return (
            <div
              key={i}
              className="think-trace-row"
              style={{ animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${Math.min(i, 8) * 120}ms both` }}
            >
              {isActiveRow ? (
                <span className="think-trace-spinner" />
              ) : (
                <svg className="think-trace-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
              <span className="think-trace-row-text">{line}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
