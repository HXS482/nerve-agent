// src/renderer/components/CommitDiffView.tsx

import { useMemo, useState } from 'react'
import { parseUnifiedDiff } from '../lib/diff-parser'
import type { DiffFile } from '../lib/diff-parser'
import { DiffFileHeader } from './DiffFileHeader'
import { DiffLineView } from './DiffLineView'

interface Props {
  commitDiff: string
}

export function CommitDiffView({ commitDiff }: Props) {
  const parsed = useMemo(() => parseUnifiedDiff(commitDiff), [commitDiff])
  const [selectedIdx, setSelectedIdx] = useState(0)

  if (parsed.files.length === 0) {
    return (
      <div className="text-center py-4" style={{ fontSize: 10, color: 'var(--text-outline-variant)', opacity: 0.5 }}>
        No diff to show
      </div>
    )
  }

  const idx = Math.min(selectedIdx, parsed.files.length - 1)
  const currentFile = parsed.files[idx]

  return (
    <div className="flex flex-col">
      {parsed.files.length > 1 && (
        <FileNav files={parsed.files} selectedIdx={idx} onSelect={setSelectedIdx} />
      )}

      <DiffFileHeader file={currentFile} />
      {currentFile.hunks.map((hunk, hi) => (
        <div key={hi}>
          <DiffLineView line={{ type: 'hunk', content: hunk.header, oldLine: null, newLine: null }} />
          {hunk.lines.map((line, li) => (
            <DiffLineView key={li} line={line} />
          ))}
        </div>
      ))}
    </div>
  )
}

function FileNav({
  files,
  selectedIdx,
  onSelect,
}: {
  files: DiffFile[]
  selectedIdx: number
  onSelect: (i: number) => void
}) {
  return (
    <div
      className="flex gap-1 overflow-x-auto scrollbar-hide shrink-0"
      style={{
        padding: '4px 8px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface-container-low)',
      }}
    >
      {files.map((f, i) => {
        const active = i === selectedIdx
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className="shrink-0 flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors cursor-pointer"
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              background: active ? 'var(--bg-surface-container-high)' : 'transparent',
              color: active ? 'var(--text-on-surface)' : 'var(--text-outline)',
              border: active ? '1px solid var(--border-subtle)' : '1px solid transparent',
            }}
          >
            <StatusDot status={f.status} />
            <span className="truncate max-w-[120px]">{f.path.split('/').pop()}</span>
          </button>
        )
      })}
    </div>
  )
}

function StatusDot({ status }: { status: DiffFile['status'] }) {
  const colors: Record<DiffFile['status'], string> = {
    M: '#fbbf24', A: '#7ee787', D: '#ff7b72', R: '#8b949e', C: '#8b949e',
  }
  return (
    <span
      className="shrink-0 rounded-full"
      style={{ width: 6, height: 6, background: colors[status] }}
    />
  )
}
