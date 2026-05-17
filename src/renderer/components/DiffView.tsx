import { useCallback } from 'react'
import { useGitStore } from '../stores/gitStore'
import { useChatStore } from '../stores/chatStore'

function DiffLine({ line, lineIndex }: { line: string; lineIndex: number }) {
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

export function DiffView() {
  const {
    diff, selectedDiffFile, loading, error, cwd,
    fetchDiff, stageFiles, setSelectedDiffFile,
  } = useGitStore()
  const setView = useChatStore((s) => s.setRightSidebarView)

  const lines = diff ? diff.split('\n') : []

  const handleStage = useCallback(async () => {
    if (selectedDiffFile) {
      const files = selectedDiffFile ? [selectedDiffFile] : []
      await stageFiles(files, cwd)
      await fetchDiff(files, false, cwd)
    }
  }, [selectedDiffFile, cwd, stageFiles, fetchDiff])

  const handleClose = useCallback(() => {
    setSelectedDiffFile(null)
    setView('git')
  }, [setSelectedDiffFile, setView])

  if (!selectedDiffFile) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[12px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.6 }}>
          Select a file to view diff
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 shrink-0"
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          minHeight: 36,
        }}
      >
        <div className="flex-1 truncate text-[12px] font-medium" style={{ color: 'var(--text-on-surface)' }}>
          {selectedDiffFile}
        </div>
        <button
          onClick={handleStage}
          disabled={loading}
          className="text-[11px] font-medium rounded-[6px] px-2.5 py-1 transition-opacity disabled:opacity-40"
          style={{
            background: 'var(--bg-surface-container)',
            color: 'var(--text-on-surface)',
            border: '1px solid var(--border-subtle)',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          Stage
        </button>
        <button
          onClick={handleClose}
          className="flex items-center justify-center rounded-[4px] hover:bg-[var(--bg-surface-container)] transition-colors"
          style={{ width: 22, height: 22 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-outline-variant)' }}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              Loading diff...
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="text-[11px] text-center" style={{ color: '#ef4444' }}>{error}</div>
          </div>
        ) : lines.length === 0 || (lines.length === 1 && lines[0] === '') ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-[12px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>
              No changes to show
            </div>
          </div>
        ) : (
          <div style={{ padding: '4px 0' }}>
            {lines.map((line, i) => (
              <DiffLine key={i} line={line} lineIndex={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
