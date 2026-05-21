import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useGitStore } from '../stores/gitStore'
import { useChatStore } from '../stores/chatStore'
import { DiffLine } from './DiffLine'

type Tab = 'files' | 'branches' | 'stash' | 'log'

const STATUS_COLORS: Record<string, string> = {
  M: '#eab308', A: '#22c55e', D: '#ef4444', R: '#3b82f6', '??': '#6b7280',
}

// ─── Shared ────────────────────────────────────────────

function ActionButton({ children, onClick, disabled, loading, variant = 'default' }: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'default'
}) {
  const styles = variant === 'primary'
    ? { background: 'var(--accent-primary)', color: '#fff', border: 'none' }
    : { background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: '1px solid var(--border-subtle)' }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-medium rounded-[6px] py-1.5 transition-all duration-150 disabled:opacity-40 hover:brightness-110 active:scale-[0.98]"
      style={{ ...styles, cursor: loading ? 'wait' : 'pointer' }}
    >
      {loading && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
          <path d="M21 12a9 9 0 11-6.219-8.56" />
        </svg>
      )}
      {children}
    </button>
  )
}

function EmptyState({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      {icon || (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-outline-variant)', opacity: 0.3 }}>
          <circle cx="12" cy="12" r="10" />
        </svg>
      )}
      <div className="text-[11px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>{text}</div>
    </div>
  )
}

// ─── File Row ──────────────────────────────────────────

function FileRow({ filePath, statusCode, staged, onToggle, onShowDiff, onDiscard }: {
  filePath: string
  statusCode: string
  staged: boolean
  onToggle: () => void
  onShowDiff: () => void
  onDiscard?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const fileName = filePath.split(/[/\\]/).pop() || filePath
  const dirPath = filePath.slice(0, -fileName.length)

  const handleDiscard = () => {
    if (confirming) {
      onDiscard?.()
      setConfirming(false)
    } else {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 3000)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8, height: 0 }}
      transition={{ duration: 0.15 }}
      className="flex items-center gap-2 w-full rounded-[6px] hover:bg-[var(--bg-surface-container)] transition-colors group"
      style={{ padding: '5px 12px', minHeight: 28 }}
    >
      <label className="flex items-center justify-center shrink-0 cursor-pointer" style={{ width: 14, height: 14 }}>
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
        className="flex-1 text-left truncate text-[12px] hover:text-[var(--accent-primary)] transition-colors min-w-0"
        style={{ color: 'var(--text-on-surface)' }}
      >
        <span className="opacity-50 text-[10px]">{dirPath}</span>
        <span>{fileName}</span>
      </button>
      {onDiscard && (
        <button
          onClick={handleDiscard}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded-[4px]"
          style={{
            color: confirming ? '#ef4444' : 'var(--text-outline-variant)',
            background: confirming ? 'rgba(239,68,68,0.1)' : 'transparent',
            border: confirming ? '1px solid rgba(239,68,68,0.2)' : 'none',
          }}
        >
          {confirming ? 'Confirm?' : 'Discard'}
        </button>
      )}
      <span
        className="text-[10px] font-mono font-bold shrink-0 tabular-nums"
        style={{ color: STATUS_COLORS[statusCode] || '#6b7280', width: 22, textAlign: 'right' }}
      >
        {statusCode}
      </span>
    </motion.div>
  )
}

// ─── Tabs ──────────────────────────────────────────────

function FilesTab() {
  const { status, loading, stageFiles, unstageFiles, commit, commitAndPush, discardChanges, setSelectedDiffFile, fetchDiff } = useGitStore()
  const setView = useChatStore((s) => s.setRightSidebarView)
  const [commitMsg, setCommitMsg] = useState('')
  const [syncing, setSyncing] = useState(false)

  const modifiedFiles = (status?.modified || []).filter((f) => !(status?.staged || []).includes(f))
  const untrackedFiles = status?.not_added || []
  const stagedFiles = status?.staged || []
  const conflictedFiles = status?.conflicts || []
  const totalChanges = modifiedFiles.length + untrackedFiles.length + stagedFiles.length + conflictedFiles.length

  const handleToggleStage = useCallback((filePath: string) => {
    const isStaged = status?.staged.includes(filePath)
    if (isStaged) unstageFiles([filePath])
    else stageFiles([filePath])
  }, [status, stageFiles, unstageFiles])

  const handleShowDiff = useCallback((filePath: string, staged: boolean) => {
    setSelectedDiffFile(filePath)
    fetchDiff([filePath], staged)
    setView('diff')
  }, [setSelectedDiffFile, fetchDiff, setView])

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return
    await commit(commitMsg.trim())
    setCommitMsg('')
  }, [commitMsg, commit])

  const handleCommitAndPush = useCallback(async () => {
    if (!commitMsg.trim()) return
    setSyncing(true)
    await commitAndPush(commitMsg.trim())
    setSyncing(false)
    setCommitMsg('')
  }, [commitMsg, commitAndPush])

  return (
    <div style={{ padding: '4px 0' }}>
      {totalChanges === 0 && <EmptyState text="No changes" />}

      <AnimatePresence initial={false}>
        {conflictedFiles.length > 0 && (
          <div className="mb-1">
            <div className="text-[10px] px-3 py-1 font-medium flex items-center gap-1.5" style={{ color: '#ef4444', opacity: 0.8 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <span>Conflicts</span>
              <span className="tabular-nums opacity-60">({conflictedFiles.length})</span>
            </div>
            {conflictedFiles.map((f) => (
              <FileRow key={f} filePath={f} statusCode="UU" staged={false} onToggle={() => {}} onShowDiff={() => handleShowDiff(f, false)} />
            ))}
          </div>
        )}

        {stagedFiles.length > 0 && (
          <div className="mb-1">
            <div className="text-[10px] px-3 py-1 font-medium flex items-center gap-1.5" style={{ color: 'var(--text-outline-variant)', opacity: 0.7 }}>
              <span>Staged</span>
              <span className="tabular-nums opacity-60">({stagedFiles.length})</span>
            </div>
            {stagedFiles.map((f) => (
              <FileRow key={f} filePath={f} statusCode="M" staged onToggle={() => handleToggleStage(f)} onShowDiff={() => handleShowDiff(f, true)} />
            ))}
          </div>
        )}

        {modifiedFiles.length > 0 && (
          <div className="mb-1">
            <div className="text-[10px] px-3 py-1 font-medium flex items-center gap-1.5" style={{ color: 'var(--text-outline-variant)', opacity: 0.7 }}>
              <span>Modified</span>
              <span className="tabular-nums opacity-60">({modifiedFiles.length})</span>
            </div>
            {modifiedFiles.map((f) => (
              <FileRow key={f} filePath={f} statusCode="M" staged={false} onToggle={() => handleToggleStage(f)} onShowDiff={() => handleShowDiff(f, false)} onDiscard={() => discardChanges([f], true)} />
            ))}
          </div>
        )}

        {untrackedFiles.length > 0 && (
          <div className="mb-1">
            <div className="text-[10px] px-3 py-1 font-medium flex items-center gap-1.5" style={{ color: 'var(--text-outline-variant)', opacity: 0.7 }}>
              <span>Untracked</span>
              <span className="tabular-nums opacity-60">({untrackedFiles.length})</span>
            </div>
            {untrackedFiles.map((f) => (
              <FileRow key={f} filePath={f} statusCode="??" staged={false} onToggle={() => handleToggleStage(f)} onShowDiff={() => handleShowDiff(f, false)} onDiscard={() => discardChanges([f], false)} />
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* Commit area */}
      <AnimatePresence>
        {totalChanges > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-lg p-2.5 mt-2 overflow-hidden"
            style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}
          >
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message"
              className="w-full text-[12px] outline-none rounded-[6px] px-2.5 py-1.5 mb-2 transition-colors focus:border-[var(--accent-primary)]"
              style={{ background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: '1px solid var(--border-subtle)' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (e.metaKey || e.ctrlKey) handleCommitAndPush()
                  else handleCommit()
                }
              }}
            />
            <div className="flex gap-1.5">
              <ActionButton onClick={handleCommit} disabled={!commitMsg.trim()} loading={loading && !syncing} variant="primary">Commit</ActionButton>
              <ActionButton onClick={handleCommitAndPush} disabled={!commitMsg.trim()} loading={syncing}>{syncing ? 'Pushing...' : 'Commit & Push'}</ActionButton>
            </div>
            <div className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>Enter to commit · Ctrl+Enter to commit & push</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function BranchesTab() {
  const { branches, loading, checkout, createBranch, deleteBranch, push, pull, fetch } = useGitStore()
  const [newBranchName, setNewBranchName] = useState('')
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [syncing, setSyncing] = useState<'push' | 'pull' | 'fetch' | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!newBranchName.trim()) return
    await createBranch(newBranchName.trim())
    setNewBranchName('')
    setShowNewBranch(false)
  }

  const handleDelete = async (name: string, force: boolean) => {
    await deleteBranch(name, force)
    setDeleting(null)
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {/* New branch */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-outline-variant)' }}>Branches</div>
        <button
          onClick={() => setShowNewBranch(!showNewBranch)}
          className="text-[10px] font-medium rounded-[4px] px-2 py-0.5 transition-colors hover:brightness-110"
          style={{ color: 'var(--accent-primary)', border: '1px solid var(--border-subtle)', background: 'transparent' }}
        >+ New</button>
      </div>

      <AnimatePresence>
        {showNewBranch && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex gap-1.5 mb-1.5 px-3 overflow-hidden"
          >
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="Branch name"
              className="flex-1 text-[11px] outline-none rounded-[6px] px-2 py-1.5 transition-colors focus:border-[var(--accent-primary)]"
              style={{ background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: '1px solid var(--border-subtle)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              autoFocus
            />
            <ActionButton onClick={handleCreate} disabled={!newBranchName.trim()} variant="primary">Create</ActionButton>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Branch list */}
      <div className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {branches.map((b) => (
            <motion.div
              key={b.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              className="flex items-center gap-2 w-full text-left rounded-[6px] transition-colors hover:bg-[var(--bg-surface-container)] group"
              style={{
                padding: '5px 12px',
                minHeight: 28,
                background: b.current ? 'var(--bg-surface-container)' : 'transparent',
                border: b.current ? '1px solid var(--border-subtle)' : '1px solid transparent',
              }}
            >
              <button onClick={() => checkout(b.name)} className="flex-1 flex items-center gap-2 min-w-0">
                {b.current && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span className="text-[12px] truncate" style={{
                  color: b.current ? 'var(--text-on-surface)' : 'var(--text-outline-variant)',
                  marginLeft: b.current ? 0 : 20,
                }}>{b.name}</span>
              </button>
              {!b.current && (
                <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {deleting === b.name ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleDelete(b.name, false)} className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)' }}>Delete</button>
                      <button onClick={() => handleDelete(b.name, true)} className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.15)' }}>Force</button>
                      <button onClick={() => setDeleting(null)} className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ color: 'var(--text-outline-variant)' }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleting(b.name)} className="text-[10px] px-1.5 py-0.5 rounded-[4px] hover:bg-[var(--bg-surface-container-high)]" style={{ color: 'var(--text-outline-variant)' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" /></svg>
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Sync buttons */}
      <div className="flex gap-2 px-3 py-2 mt-2">
        <ActionButton onClick={() => { setSyncing('push'); push().finally(() => setSyncing(null)) }} loading={syncing === 'push'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
          Push
        </ActionButton>
        <ActionButton onClick={() => { setSyncing('pull'); pull().finally(() => setSyncing(null)) }} loading={syncing === 'pull'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
          Pull
        </ActionButton>
        <ActionButton onClick={() => { setSyncing('fetch'); fetch().finally(() => setSyncing(null)) }} loading={syncing === 'fetch'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
          Fetch
        </ActionButton>
      </div>
    </div>
  )
}

function StashTab() {
  const { stashes, loading, stashPush, stashPop, stashApply, stashDrop } = useGitStore()
  const [showCreate, setShowCreate] = useState(false)
  const [msg, setMsg] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(false)

  const handleStash = async () => {
    await stashPush(msg || undefined, includeUntracked)
    setMsg('')
    setIncludeUntracked(false)
    setShowCreate(false)
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-outline-variant)' }}>Stash</div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-[10px] font-medium rounded-[4px] px-2 py-0.5 transition-colors hover:brightness-110"
          style={{ color: 'var(--accent-primary)', border: '1px solid var(--border-subtle)', background: 'transparent' }}
        >+ Stash</button>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 pb-2 overflow-hidden"
          >
            <input
              type="text"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="Stash message (optional)"
              className="w-full text-[11px] outline-none rounded-[6px] px-2 py-1.5 mb-1.5 transition-colors focus:border-[var(--accent-primary)]"
              style={{ background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: '1px solid var(--border-subtle)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleStash() }}
              autoFocus
            />
            <label className="flex items-center gap-2 text-[11px] mb-1.5 cursor-pointer" style={{ color: 'var(--text-outline-variant)' }}>
              <input type="checkbox" checked={includeUntracked} onChange={(e) => setIncludeUntracked(e.target.checked)} className="accent-[var(--accent-primary)]" style={{ width: 13, height: 13 }} />
              Include untracked files
            </label>
            <ActionButton onClick={handleStash} loading={loading} variant="primary">Stash</ActionButton>
          </motion.div>
        )}
      </AnimatePresence>

      {stashes.length === 0 && !showCreate && <EmptyState text="No stashes" />}

      <AnimatePresence initial={false}>
        {stashes.map((s) => (
          <motion.div
            key={s.hash}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8, height: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2 w-full rounded-[6px] hover:bg-[var(--bg-surface-container)] transition-colors group"
            style={{ padding: '5px 12px', minHeight: 28 }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[12px] truncate" style={{ color: 'var(--text-on-surface)' }}>{s.message}</div>
              <div className="text-[10px] flex items-center gap-2" style={{ color: 'var(--text-outline-variant)', opacity: 0.6 }}>
                <span className="font-mono">{s.hash}</span>
                <span>{new Date(s.date).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => stashPop(s.index)} className="text-[10px] px-1.5 py-0.5 rounded-[4px] hover:bg-[var(--bg-surface-container-high)]" style={{ color: 'var(--text-on-surface)' }} title="Pop (apply + remove)">Pop</button>
              <button onClick={() => stashApply(s.index)} className="text-[10px] px-1.5 py-0.5 rounded-[4px] hover:bg-[var(--bg-surface-container-high)]" style={{ color: 'var(--text-outline-variant)' }} title="Apply (keep in stash)">Apply</button>
              <button onClick={() => stashDrop(s.index)} className="text-[10px] px-1.5 py-0.5 rounded-[4px] hover:bg-[rgba(239,68,68,0.1)]" style={{ color: '#ef4444' }} title="Drop">Drop</button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function LogTab() {
  const { log, selectedCommitHash, commitDiff, loading, fetchCommitDiff, clearCommitDiff } = useGitStore()

  const handleToggleCommit = (hash: string) => {
    if (selectedCommitHash === hash) {
      clearCommitDiff()
    } else {
      fetchCommitDiff(hash)
    }
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {log.length === 0 && <EmptyState text="No commits" />}

      <AnimatePresence initial={false}>
        {log.map((c) => (
          <motion.div
            key={c.hash}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            className="rounded-[6px] overflow-hidden"
          >
            <button
              onClick={() => handleToggleCommit(c.hash)}
              className="flex items-start gap-2 w-full text-left rounded-[6px] transition-colors hover:bg-[var(--bg-surface-container)]"
              style={{
                padding: '5px 12px',
                minHeight: 28,
                background: selectedCommitHash === c.hash ? 'var(--bg-surface-container)' : 'transparent',
              }}
            >
              <span className="text-[10px] font-mono shrink-0 mt-0.5" style={{ color: 'var(--accent-primary)', opacity: 0.7 }}>{c.hash.slice(0, 7)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] truncate" style={{ color: 'var(--text-on-surface)' }}>{c.message}</div>
                <div className="text-[10px] flex items-center gap-2" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>
                  <span>{c.author_name}</span>
                  <span>{new Date(c.date).toLocaleDateString()}</span>
                </div>
              </div>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className="shrink-0 mt-1 transition-transform duration-200"
                style={{ color: 'var(--text-outline-variant)', opacity: 0.4, transform: selectedCommitHash === c.hash ? 'rotate(180deg)' : 'none' }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <AnimatePresence>
              {selectedCommitHash === c.hash && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '4px 0' }}>
                    {loading && !commitDiff ? (
                      <div className="flex items-center justify-center py-4 gap-2 text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                          <path d="M21 12a9 9 0 11-6.219-8.56" />
                        </svg>
                        Loading diff...
                      </div>
                    ) : commitDiff ? (
                      commitDiff.split('\n').map((line, i) => <DiffLine key={i} line={line} />)
                    ) : (
                      <div className="text-[11px] text-center py-4" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>No diff available</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ─── Tab Bar ───────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: 'files', label: 'Files' },
  { key: 'branches', label: 'Branches' },
  { key: 'stash', label: 'Stash' },
  { key: 'log', label: 'Log' },
]

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex items-center gap-4 px-3 py-1.5 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className="relative text-[11px] uppercase tracking-wider font-medium pb-1.5 transition-colors"
          style={{ color: active === tab.key ? 'var(--accent-primary)' : 'var(--text-outline-variant)' }}
        >
          {tab.label}
          {active === tab.key && (
            <motion.div
              layoutId="tab-underline"
              className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
              style={{ background: 'var(--accent-primary)' }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
        </button>
      ))}
    </div>
  )
}

// ─── Main ──────────────────────────────────────────────

export function GitView() {
  const { status, loading, error, cwd, refresh, init, clearError, setCwd } = useGitStore()
  const chatConfig = useChatStore((s) => s.config)
  const [tab, setTab] = useState<Tab>('files')

  // Sync cwd from chat config
  useEffect(() => {
    if (chatConfig.cwd && chatConfig.cwd !== cwd) {
      setCwd(chatConfig.cwd)
    }
  }, [chatConfig.cwd, cwd, setCwd])

  // Initial fetch
  useEffect(() => {
    if (cwd) refresh()
  }, [cwd])

  // Listen for git refresh from main process
  useEffect(() => {
    const unsub = (window as any).claude.onGitRefresh?.(() => {
      useGitStore.getState().refresh()
    })
    return () => unsub?.()
  }, [])

  // Poll: refresh every 5s
  useEffect(() => {
    if (!cwd) return
    const interval = setInterval(() => useGitStore.getState().refresh(), 5000)
    return () => clearInterval(interval)
  }, [cwd])

  // Auto-dismiss error after 5s
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(clearError, 5000)
    return () => clearTimeout(timer)
  }, [error, clearError])

  const currentBranch = status?.current || ''

  // === Empty States ===

  if (!cwd) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[12px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.6 }}>No workspace selected</div>
      </div>
    )
  }

  if (error && !status) {
    const isNoRepo = error.toLowerCase().includes('not a git repository')
    if (isNoRepo) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>
            <circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
            <path d="M13 6h3a2 2 0 012 2v7" /><path d="M6 9v9" />
          </svg>
          <div className="text-[11px] text-center leading-relaxed" style={{ color: 'var(--text-outline-variant)' }}>Not a git repository</div>
          <ActionButton onClick={init} loading={loading} variant="primary">Init Repository</ActionButton>
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

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            className="rounded-[6px] mx-3 mt-2 px-3 py-2 text-[11px] flex items-center gap-2"
            style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="flex-1 truncate">{error}</span>
            <button onClick={clearError} className="hover:opacity-70 transition-opacity">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Branch bar */}
      {currentBranch && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 mx-3 mt-2 shrink-0" style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--accent-primary)', flexShrink: 0 }}>
            <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 01-9 9" />
          </svg>
          <span className="text-[12px] font-medium truncate" style={{ color: 'var(--text-on-surface)' }}>{currentBranch}</span>
          {(status!.ahead > 0 || status!.behind > 0) && (
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              {status!.ahead > 0 && <span className="text-[10px] tabular-nums" style={{ color: '#22c55e' }}>↑{status!.ahead}</span>}
              {status!.behind > 0 && <span className="text-[10px] tabular-nums" style={{ color: '#eab308' }}>↓{status!.behind}</span>}
            </div>
          )}
        </div>
      )}

      {/* Tab bar */}
      <TabBar active={tab} onChange={setTab} />

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ padding: '0 8px 4px' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {tab === 'files' && <FilesTab />}
            {tab === 'branches' && <BranchesTab />}
            {tab === 'stash' && <StashTab />}
            {tab === 'log' && <LogTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
