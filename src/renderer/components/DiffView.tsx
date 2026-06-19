import { useCallback, useMemo } from 'react'
import { useGitStore } from '../stores/gitStore'
import { useChatStore } from '../stores/chatStore'
import { parseUnifiedDiff } from '../lib/diff-parser'
import { DiffFileHeader } from './DiffFileHeader'
import { DiffLineView } from './DiffLineView'

export function DiffView() {
  const {
    diff, selectedDiffFile, loading, error,
    fetchDiff, stageFiles, setSelectedDiffFile,
  } = useGitStore()
  const setView = useChatStore((s) => s.setRightSidebarView)

  const parsed = useMemo(() => parseUnifiedDiff(diff || ''), [diff])
  const file = parsed.files[0] ?? null

  const handleStage = useCallback(async () => {
    if (selectedDiffFile) {
      await stageFiles([selectedDiffFile])
      await fetchDiff([selectedDiffFile], false)
    }
  }, [selectedDiffFile, stageFiles, fetchDiff])

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
        ) : !file ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-[12px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>
              No changes to show
            </div>
          </div>
        ) : (
          <div style={{ padding: '4px 0' }}>
            <DiffFileHeader file={file} />
            {file.hunks.map((hunk, hi) => (
              <div key={hi}>
                <DiffLineView line={{ type: 'hunk', content: hunk.header, oldLine: null, newLine: null }} />
                {hunk.lines.map((line, li) => (
                  <DiffLineView key={li} line={line} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
