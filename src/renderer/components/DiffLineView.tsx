// src/renderer/components/DiffLineView.tsx

import type { DiffLine } from '../lib/diff-parser'

const COLORS = {
  addBg: 'rgba(63, 185, 80, 0.10)',
  addText: '#7ee787',
  delBg: 'rgba(248, 81, 73, 0.10)',
  delText: '#ff7b72',
  hunkText: '#79c0ff',
  hunkBg: 'rgba(6, 182, 212, 0.06)',
  contextText: 'var(--text-on-surface)',
  gutterText: 'var(--text-outline-variant)',
}

export function DiffLineView({ line }: { line: DiffLine }) {
  if (line.type === 'hunk') {
    return (
      <div
        className="flex font-mono text-[11px] leading-[18px]"
        style={{
          background: COLORS.hunkBg,
          color: COLORS.hunkText,
          borderTop: '1px solid rgba(6, 182, 212, 0.12)',
          padding: '2px 0',
        }}
      >
        <Gutter oldLine={null} newLine={null} />
        <span className="truncate px-2 opacity-80">{line.content}</span>
      </div>
    )
  }

  const isAdd = line.type === 'add'
  const isDel = line.type === 'delete'
  const bg = isAdd ? COLORS.addBg : isDel ? COLORS.delBg : 'transparent'
  const color = isAdd ? COLORS.addText : isDel ? COLORS.delText : COLORS.contextText
  const prefix = isAdd ? '+' : isDel ? '-' : ' '

  return (
    <div className="flex font-mono text-[11px] leading-[18px]" style={{ background: bg }}>
      <Gutter oldLine={line.oldLine} newLine={line.newLine} />
      <span className="shrink-0 w-4 text-center select-none opacity-50" style={{ color }}>{prefix}</span>
      <span className="flex-1 truncate pr-3" style={{ color }}>{line.content}</span>
    </div>
  )
}

function Gutter({ oldLine, newLine }: { oldLine: number | null; newLine: number | null }) {
  return (
    <>
      <span
        className="shrink-0 text-right select-none px-1"
        style={{ width: 36, color: COLORS.gutterText, opacity: oldLine != null ? 0.5 : 0 }}
      >
        {oldLine ?? ''}
      </span>
      <span
        className="shrink-0 text-right select-none px-1"
        style={{ width: 36, color: COLORS.gutterText, opacity: newLine != null ? 0.5 : 0 }}
      >
        {newLine ?? ''}
      </span>
    </>
  )
}
