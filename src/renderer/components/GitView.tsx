import { useEffect, useState } from 'react'
import { useGitStore } from '../stores/gitStore'
import { useChatStore } from '../stores/chatStore'

function FileRow({ filePath, statusCode, staged, onToggle, onShowDiff }: {
  filePath: string
  statusCode: string
  staged: boolean
  onToggle: () => void
  onShowDiff: () => void
}) {
  const badgeColor = statusCode === 'M' ? '#eab308'
    : statusCode === 'A' ? '#22c55e'
    : statusCode === 'D' ? '#ef4444'
    : statusCode === 'R' ? '#3b82f6'
    : statusCode === '??' ? '#6b7280'
    : '#6b7280'

  return (
    <div className="flex items-center gap-2 w-full rounded-[6px]" style={{ padding: '5px 12px', minHeight: 28 }}>
      <label className="flex items-center justify-center shrink-0" style={{ width: 14, height: 14 }}>
        <input
          type="checkbox"
          checked={staged}
          onChange={onToggle}
          className="cursor-pointer accent-[var(--accent-primary)]"
          style={{ width: 13, height: 13 }}
        />
      </label>
      <button
        onClick={onShowDiff}
        className="flex-1 text-left truncate text-[12px] hover:text-[var(--accent-primary)] transition-colors"
        style={{ color: 'var(--text-on-surface)' }}
      >
        {filePath}
      </button>
      <span
        className="text-[10px] font-mono font-bold shrink-0"
        style={{ color: badgeColor, width: 22, textAlign: 'right' }}
      >
        {statusCode}
      </span>
    </div>
  )
}

export function GitView() {
  const {
    status, branches, loading, error, cwd,
    fetchStatus, fetchBranches, fetchLog,
    stageFiles, unstageFiles, commit, push, pull,
    checkout, fetchDiff, init, createBranch,
    setCwd, setSelectedDiffFile,
  } = useGitStore()
  const chatConfig = useChatStore((s) => s.config)
  const setView = useChatStore((s) => s.setRightSidebarView)

  const [commitMsg, setCommitMsg] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [syncing, setSyncing] = useState<'push' | 'pull' | null>(null)

  useEffect(() => {
    if (chatConfig.cwd && chatConfig.cwd !== cwd) {
      setCwd(chatConfig.cwd)
    }
  }, [chatConfig.cwd, cwd, setCwd])

  useEffect(() => {
    if (cwd) {
      fetchStatus()
      fetchBranches()
      fetchLog()
    }
  }, [cwd, fetchStatus, fetchBranches, fetchLog])

  // Listen for git refresh notifications from main process
  useEffect(() => {
    const unsub = (window as any).claude.onGitRefresh?.(() => {
      useGitStore.getState().refresh(cwd)
    })
    return () => unsub?.()
  }, [cwd])

  // Polling fallback: refresh every 5s when view is active
  useEffect(() => {
    if (!cwd) return
    const interval = setInterval(() => {
      useGitStore.getState().refresh(cwd)
    }, 5000)
    return () => clearInterval(interval)
  }, [cwd])

  const handleToggleStage = (filePath: string, isStaged: boolean) => {
    if (isStaged) {
      unstageFiles([filePath], cwd)
    } else {
      stageFiles([filePath], cwd)
    }
  }

  const handleShowDiff = (filePath: string, isStaged: boolean) => {
    setSelectedDiffFile(filePath)
    fetchDiff([filePath], isStaged, cwd)
    setView('diff')
  }

  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    // Stage all first, then commit
    try {
      await (window as any).claude.gitStage(['.'], cwd)
    } catch { /* no unstaged changes is fine */ }
    await commit(commitMsg.trim(), cwd)
    setCommitMsg('')
  }

  const handleCommitAndPush = async () => {
    if (!commitMsg.trim()) return
    setSyncing('push')
    try {
      // Stage all first, then commit, then push
      try {
        await (window as any).claude.gitStage(['.'], cwd)
      } catch { /* no unstaged changes is fine */ }
      await commit(commitMsg.trim(), cwd)
      await push(cwd)
    } finally {
      setSyncing(null)
    }
    setCommitMsg('')
  }

  const handleInit = async () => {
    await init(cwd)
  }

  const handleCheckout = async (branch: string) => {
    await checkout(branch, cwd)
  }

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return
    await createBranch(newBranchName.trim(), cwd)
    setNewBranchName('')
    setShowNewBranch(false)
  }

  const currentBranch = status?.current || ''

  if (!cwd) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[12px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.6 }}>
          No workspace selected
        </div>
      </div>
    )
  }

  if (error && !status) {
    const isNoRepo = error.toLowerCase().includes('not a git repository') || error.toLowerCase().includes('no such path')
    if (isNoRepo) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>
            <circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
            <path d="M13 6h3a2 2 0 012 2v7" /><path d="M6 9v9" />
          </svg>
          <div className="text-[11px] text-center leading-relaxed" style={{ color: 'var(--text-outline-variant)' }}>
            Not a git repository
          </div>
          <button
            onClick={handleInit}
            disabled={loading}
            className="text-[11px] font-medium rounded-[6px] px-4 py-1.5 transition-opacity disabled:opacity-50"
            style={{
              background: 'var(--accent-primary)',
              color: '#fff',
              border: 'none',
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? 'Initializing...' : 'Init Repository'}
          </button>
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="text-[11px] text-center leading-relaxed" style={{ color: '#ef4444' }}>{error}</div>
      </div>
    )
  }

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
          Loading...
        </div>
      </div>
    )
  }

  const modifiedFiles = (status?.modified || []).filter((f) => !(status?.staged || []).includes(f))
  const untrackedFiles = status?.not_added || []
  const stagedFiles = status?.staged || []
  const totalChanges = modifiedFiles.length + untrackedFiles.length + stagedFiles.length

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ padding: '6px 8px 4px' }}>
        {/* Top bar: branch name + ahead/behind */}
        {currentBranch && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2" style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--accent-primary)', flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 01-9 9" />
            </svg>
            <span className="text-[12px] font-medium truncate" style={{ color: 'var(--text-on-surface)' }}>
              {currentBranch}
            </span>
            {(status!.ahead > 0 || status!.behind > 0) && (
              <div className="flex items-center gap-1.5 ml-auto shrink-0">
                {status!.ahead > 0 && (
                  <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-outline-variant)' }}>
                    ↑{status!.ahead}
                  </span>
                )}
                {status!.behind > 0 && (
                  <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-outline-variant)' }}>
                    ↓{status!.behind}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Changes section */}
        <div className="mb-2">
          <div className="flex items-center justify-between px-1 py-1.5">
            <div className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-outline-variant)' }}>
              Changes
            </div>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-outline-variant)', opacity: 0.6 }}>
              {totalChanges}
            </span>
          </div>

          {totalChanges === 0 && (
            <div className="text-[11px] text-center py-6" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>
              No changes
            </div>
          )}

          {/* Staged files */}
          {stagedFiles.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] px-3 py-1 font-medium" style={{ color: 'var(--text-outline-variant)', opacity: 0.7 }}>
                Staged
              </div>
              {stagedFiles.map((f) => (
                <FileRow
                  key={f}
                  filePath={f}
                  statusCode="M"
                  staged={true}
                  onToggle={() => handleToggleStage(f, true)}
                  onShowDiff={() => handleShowDiff(f, true)}
                />
              ))}
            </div>
          )}

          {/* Modified files */}
          {modifiedFiles.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] px-3 py-1 font-medium" style={{ color: 'var(--text-outline-variant)', opacity: 0.7 }}>
                Modified
              </div>
              {modifiedFiles.map((f) => (
                <FileRow
                  key={f}
                  filePath={f}
                  statusCode="M"
                  staged={false}
                  onToggle={() => handleToggleStage(f, false)}
                  onShowDiff={() => handleShowDiff(f, false)}
                />
              ))}
            </div>
          )}

          {/* Untracked files */}
          {untrackedFiles.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] px-3 py-1 font-medium" style={{ color: 'var(--text-outline-variant)', opacity: 0.7 }}>
                Untracked
              </div>
              {untrackedFiles.map((f) => (
                <FileRow
                  key={f}
                  filePath={f}
                  statusCode="??"
                  staged={false}
                  onToggle={() => handleToggleStage(f, false)}
                  onShowDiff={() => handleShowDiff(f, false)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Commit area */}
        {totalChanges > 0 && (
          <div className="rounded-lg p-2.5 mb-2" style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}>
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message"
              className="w-full text-[12px] outline-none rounded-[6px] px-2.5 py-1.5 mb-2"
              style={{
                background: 'var(--bg-surface-container-high)',
                color: 'var(--text-on-surface)',
                border: '1px solid var(--border-subtle)',
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleCommit() }}
            />
            <div className="flex gap-1.5">
              <button
                onClick={handleCommit}
                disabled={!commitMsg.trim() || loading}
                className="flex-1 text-[11px] font-medium rounded-[6px] py-1.5 transition-opacity disabled:opacity-40"
                style={{
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  border: 'none',
                  cursor: loading ? 'wait' : 'pointer',
                }}
              >
                Commit
              </button>
              <button
                onClick={handleCommitAndPush}
                disabled={!commitMsg.trim() || loading || syncing === 'push'}
                className="flex-1 text-[11px] font-medium rounded-[6px] py-1.5"
                style={{
                  background: 'var(--bg-surface-container-high)',
                  color: 'var(--text-on-surface)',
                  border: '1px solid var(--border-subtle)',
                  cursor: loading ? 'wait' : 'pointer',
                }}
              >
                {syncing === 'push' ? 'Pushing...' : 'Commit & Push'}
              </button>
            </div>
          </div>
        )}

        {/* Branch section */}
        <div className="mb-2">
          <div className="flex items-center justify-between px-1 py-1.5">
            <div className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-outline-variant)' }}>
              Branches
            </div>
            <button
              onClick={() => setShowNewBranch(!showNewBranch)}
              className="text-[10px] font-medium rounded-[4px] px-2 py-0.5 transition-colors"
              style={{ color: 'var(--accent-primary)', border: '1px solid var(--border-subtle)', background: 'transparent' }}
            >
              + New
            </button>
          </div>

          {showNewBranch && (
            <div className="flex gap-1.5 mb-1.5 px-1">
              <input
                type="text"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="Branch name"
                className="flex-1 text-[11px] outline-none rounded-[6px] px-2 py-1.5"
                style={{
                  background: 'var(--bg-surface-container-high)',
                  color: 'var(--text-on-surface)',
                  border: '1px solid var(--border-subtle)',
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBranch() }}
                autoFocus
              />
              <button
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim()}
                className="text-[11px] font-medium rounded-[6px] px-3 py-1.5 disabled:opacity-40"
                style={{
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Create
              </button>
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            {branches.map((b) => (
              <button
                key={b.name}
                onClick={() => handleCheckout(b.name)}
                className="flex items-center gap-2 w-full text-left rounded-[6px] transition-colors hover:bg-[var(--bg-surface-container)]"
                style={{
                  padding: '5px 12px',
                  minHeight: 28,
                  background: b.current ? 'var(--bg-surface-container)' : 'transparent',
                  border: b.current ? '1px solid var(--border-subtle)' : '1px solid transparent',
                }}
              >
                {b.current && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span className="text-[12px] truncate" style={{
                  color: b.current ? 'var(--text-on-surface)' : 'var(--text-outline-variant)',
                  marginLeft: b.current ? 0 : 20,
                }}>
                  {b.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Sync section */}
        <div className="flex gap-2 px-1 py-1.5 mb-2">
          <button
            onClick={() => { setSyncing('push'); push(cwd).finally(() => setSyncing(null)) }}
            disabled={loading || syncing !== null}
            className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-medium rounded-[6px] py-1.5 transition-opacity disabled:opacity-40"
            style={{
              background: 'var(--bg-surface-container)',
              color: 'var(--text-on-surface)',
              border: '1px solid var(--border-subtle)',
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {syncing === 'push' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
              </svg>
            )}
            Push
          </button>
          <button
            onClick={() => { setSyncing('pull'); pull(cwd).finally(() => setSyncing(null)) }}
            disabled={loading || syncing !== null}
            className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-medium rounded-[6px] py-1.5 transition-opacity disabled:opacity-40"
            style={{
              background: 'var(--bg-surface-container)',
              color: 'var(--text-on-surface)',
              border: '1px solid var(--border-subtle)',
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {syncing === 'pull' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
              </svg>
            )}
            Pull
          </button>
        </div>
      </div>
    </div>
  )
}
