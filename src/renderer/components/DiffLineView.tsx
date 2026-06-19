// src/renderer/components/DiffLineView.tsx

import type { DiffLine } from '../lib/diff-parser'

const COLORS = {
  addBg: 'rgba(63, 185, 80, 0.07)',
  addText: '#7ee787',
  addGutterBg: 'rgba(63, 185, 80, 0.04)',
  delBg: 'rgba(248, 81, 73, 0.07)',
  delText: '#ff7b72',
  delGutterBg: 'rgba(248, 81, 73, 0.04)',
  hunkText: '#79c0ff',
  hunkBg: 'rgba(6, 182, 212, 0.06)',
  contextText: 'var(--text-on-surface)',
  gutterText: 'var(--text-outline-variant)',
  gutterBg: 'var(--bg-surface-container-low)',
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
        <GutterBg type="hunk" />
        <span className="truncate px-2 opacity-80">{line.content}</span>
      </div>
    )
  }

  const isAdd = line.type === 'add'
  const isDel = line.type === 'delete'
  const bg = isAdd ? COLORS.addBg : isDel ? COLORS.delBg : 'transparent'
  const color = isAdd ? COLORS.addText : isDel ? COLORS.delText : COLORS.contextText
  const prefix = isAdd ? '+' : isDel ? '-' : ' '
  const gutterBg = isAdd ? COLORS.addGutterBg : isDel ? COLORS.delGutterBg : COLORS.gutterBg

  return (
    <div className="flex font-mono text-[11px] leading-[18px]" style={{ background: bg }}>
      <Gutter
        oldLine={line.oldLine}
        newLine={line.newLine}
        prefix={prefix}
        prefixColor={color}
        gutterBg={gutterBg}
      />
      <span className="flex-1 truncate pr-3" style={{ color }}>{line.content}</span>
    </div>
  )
}

function GutterBg({ type }: { type: 'add' | 'del' | 'hunk' | 'context' }) {
  const bg = type === 'add' ? COLORS.addGutterBg : type === 'del' ? COLORS.delGutterBg : COLORS.gutterBg
  return null // background is on the Gutter spans
}

function Gutter({
  oldLine,
  newLine,
  prefix,
  prefixColor,
  gutterBg,
}: {
  oldLine: number | null
  newLine: number | null
  prefix: string
  prefixColor: string
  gutterBg: string
}) {
  return (
    <div className="shrink-0 flex" style={{ background: gutterBg }}>
      <span
        className="text-right select-none"
        style={{ width: 28, paddingRight: 2, color: COLORS.gutterText, opacity: oldLine != null ? 0.45 : 0 }}
      >
        {oldLine ?? ''}
      </span>
      <span
        className="text-right select-none"
        style={{ width: 28, paddingRight: 2, color: COLORS.gutterText, opacity: newLine != null ? 0.45 : 0 }}
      >
        {newLine ?? ''}
      </span>
      <span
        className="text-center select-none"
        style={{ width: 16, color: prefixColor, opacity: 0.6 }}
      >
        {prefix}
      </span>
    </div>
  )
}
