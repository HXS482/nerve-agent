// src/renderer/components/DiffFileHeader.tsx

import type { DiffFile } from '../lib/diff-parser'

const STATUS_LABELS: Record<DiffFile['status'], string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', C: 'C',
}

const STATUS_COLORS: Record<DiffFile['status'], { bg: string; fg: string }> = {
  M: { bg: 'rgba(250, 204, 21, 0.15)', fg: '#fbbf24' },
  A: { bg: 'rgba(63, 185, 80, 0.15)', fg: '#7ee787' },
  D: { bg: 'rgba(248, 81, 73, 0.15)', fg: '#ff7b72' },
  R: { bg: 'rgba(139, 148, 158, 0.15)', fg: '#8b949e' },
  C: { bg: 'rgba(139, 148, 158, 0.15)', fg: '#8b949e' },
}

export function DiffFileHeader({ file }: { file: DiffFile }) {
  const sc = STATUS_COLORS[file.status]

  return (
    <div
      className="flex items-center gap-2 font-mono text-[11px]"
      style={{
        padding: '6px 12px',
        background: 'var(--bg-surface-container)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <span
        className="shrink-0 text-[10px] font-semibold rounded px-1"
        style={{ background: sc.bg, color: sc.fg }}
      >
        {STATUS_LABELS[file.status]}
      </span>
      <span className="flex-1 truncate" style={{ color: 'var(--text-on-surface)' }}>
        {file.path}
      </span>
      <span className="shrink-0 flex items-center gap-1.5">
        {file.additions > 0 && (
          <span style={{ color: '#7ee787', fontSize: 10 }}>+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span style={{ color: '#ff7b72', fontSize: 10 }}>-{file.deletions}</span>
        )}
      </span>
    </div>
  )
}
