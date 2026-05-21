export function DiffLine({ line }: { line: string }) {
  if (line.startsWith('@@')) {
    return (
      <div
        className="flex font-mono text-[11px] leading-[18px]"
        style={{
          background: 'rgba(6, 182, 212, 0.08)',
          color: 'rgba(6, 182, 212, 0.9)',
          padding: '0 12px',
          borderBottom: '1px solid rgba(6, 182, 212, 0.1)',
        }}
      >
        <span className="shrink-0 text-center select-none" style={{ width: 20, marginRight: 8, opacity: 0.5 }} />
        <span className="truncate">{line}</span>
      </div>
    )
  }

  if (line.startsWith('+')) {
    return (
      <div
        className="flex font-mono text-[11px] leading-[18px]"
        style={{
          background: 'rgba(34, 197, 94, 0.08)',
          color: 'rgba(34, 197, 94, 0.9)',
          padding: '0 12px',
        }}
      >
        <span className="shrink-0 text-center select-none" style={{ width: 20, marginRight: 8, opacity: 0.6 }}>+</span>
        <span className="truncate">{line.slice(1)}</span>
      </div>
    )
  }

  if (line.startsWith('-')) {
    return (
      <div
        className="flex font-mono text-[11px] leading-[18px]"
        style={{
          background: 'rgba(239, 68, 68, 0.08)',
          color: 'rgba(239, 68, 68, 0.9)',
          padding: '0 12px',
        }}
      >
        <span className="shrink-0 text-center select-none" style={{ width: 20, marginRight: 8, opacity: 0.6 }}>-</span>
        <span className="truncate">{line.slice(1)}</span>
      </div>
    )
  }

  if (line.startsWith('\\ ')) {
    return (
      <div
        className="flex font-mono text-[11px] leading-[18px]"
        style={{
          color: 'var(--text-outline-variant)',
          opacity: 0.5,
          padding: '0 12px',
        }}
      >
        <span className="shrink-0 text-center select-none" style={{ width: 20, marginRight: 8 }} />
        <span className="truncate">{line}</span>
      </div>
    )
  }

  if (line.startsWith('diff --git') || line.startsWith('--- ') || line.startsWith('+++ ')) {
    return (
      <div
        className="flex font-mono text-[11px] leading-[18px]"
        style={{
          color: 'var(--text-outline-variant)',
          opacity: 0.5,
          padding: '0 12px',
        }}
      >
        <span className="shrink-0 text-center select-none" style={{ width: 20, marginRight: 8 }} />
        <span className="truncate">{line}</span>
      </div>
    )
  }

  return (
    <div
      className="flex font-mono text-[11px] leading-[18px]"
      style={{
        color: 'var(--text-on-surface)',
        padding: '0 12px',
      }}
    >
      <span className="shrink-0 text-center select-none" style={{ width: 20, marginRight: 8, opacity: 0.3 }} />
      <span className="truncate">{line}</span>
    </div>
  )
}
