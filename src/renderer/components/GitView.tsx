import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useGitStore } from '../stores/gitStore'
import { useChatStore } from '../stores/chatStore'
import { DiffLine } from './DiffLine'

type Tab = 'files' | 'branches' | 'stash' | 'log'

// ─── Icons ─────────────────────────────────────────────

const I = {
  Spinner: ({ s = 12 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  ),
  Branch: ({ s = 14 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 01-9 9" />
    </svg>
  ),
  Up: ({ s = 12 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
    </svg>
  ),
  Down: ({ s = 12 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
    </svg>
  ),
  Check: ({ s = 12 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Plus: ({ s = 10 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Git: ({ s = 24 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path d="M13 6h3a2 2 0 012 2v7" /><path d="M6 9v9" />
    </svg>
  ),
  Alert: ({ s = 16 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  File: ({ s = 16 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" /><line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  ),
  Archive: ({ s = 14 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  ),
  RotateCcw: ({ s = 14 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 109-9" /><polyline points="3 3 3 9 9 9" />
    </svg>
  ),
  Trash: ({ s = 14 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  ),
  ChevronDn: ({ s = 12 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  Close: ({ s = 10 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Fetch: ({ s = 12 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  ),
} as const

// ─── Status Badge ──────────────────────────────────────

function StatusBadge({ code }: { code: string }) {
  const colors: Record<string, string> = {
    M: '#eab308', A: '#22c55e', D: '#ef4444', R: '#3b82f6', '??': 'var(--text-outline-variant)',
    UU: '#ef4444',
  }
  return (
    <span title={code} className="shrink-0 flex items-center justify-center" style={{ width: 16, height: 16 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors[code] || 'var(--text-outline-variant)', opacity: code === '??' ? 0.4 : 0.8 }} />
    </span>
  )
}

// ─── Shared ────────────────────────────────────────────

function ActionBtn({ children, onClick, disabled, loading, primary }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; loading?: boolean; primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-medium rounded-[6px] py-1.5 transition-all duration-150 disabled:opacity-40 hover:brightness-110 active:scale-[0.98]"
      style={primary
        ? { background: 'var(--accent-primary)', color: '#fff', border: 'none', cursor: loading ? 'wait' : 'pointer' }
        : { background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: '1px solid var(--border-subtle)', cursor: loading ? 'wait' : 'pointer' }}
    >
      {loading && <I.Spinner s={11} />}
      {children}
    </button>
  )
}

function IconBtn({ icon, onClick, disabled, title, danger }: {
  icon: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center rounded-[6px] transition-all duration-150 disabled:opacity-40 hover:brightness-125"
      style={{ width: 32, height: 28, background: 'var(--bg-surface-container)', color: danger ? '#ef4444' : 'var(--text-on-surface)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
    >{icon}</button>
  )
}

// ─── File Row ──────────────────────────────────────────

function FileRow({ filePath, statusCode, staged, onToggle, onShowDiff, onDiscard }: {
  filePath: string; statusCode: string; staged: boolean
  onToggle: () => void; onShowDiff: () => void; onDiscard?: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const fileName = filePath.split(/[/\\]/).pop() || filePath
  const dir = filePath.slice(0, -fileName.length)

  const handleDiscard = () => {
    if (confirm) { onDiscard?.(); setConfirm(false) }
    else { setConfirm(true); setTimeout(() => setConfirm(false), 3000) }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 6, height: 0 }} transition={{ duration: 0.12 }}
      className="flex items-center gap-1.5 w-full rounded-[6px] hover:bg-[var(--bg-surface-container)] transition-colors group"
      style={{ padding: '3px 8px', minHeight: 26 }}
    >
      <label className="flex items-center justify-center shrink-0 cursor-pointer" style={{ width: 16, height: 16 }}>
        <input type="checkbox" checked={staged} onChange={onToggle} style={{ width: 12, height: 12, accentColor: 'var(--accent-primary)', cursor: 'pointer' }} />
      </label>
      <StatusBadge code={statusCode} />
      <button onClick={onShowDiff} className="flex-1 text-left truncate text-[12px] hover:text-[var(--accent-primary)] transition-colors min-w-0" style={{ color: 'var(--text-on-surface)' }}>
        <span className="opacity-40 text-[10px]">{dir}</span>
        <span>{fileName}</span>
      </button>
      {onDiscard && (
        <button onClick={handleDiscard} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded-[4px]"
          style={{ color: confirm ? '#ef4444' : 'var(--text-outline-variant)', background: confirm ? 'rgba(239,68,68,0.1)' : 'transparent', border: confirm ? '1px solid rgba(239,68,68,0.2)' : 'none' }}
        >{confirm ? 'Confirm?' : <I.RotateCcw s={10} />}</button>
      )}
    </motion.div>
  )
}

// ─── Files Tab ─────────────────────────────────────────

function FilesTab() {
  const { status, loading, stageFiles, unstageFiles, commit, commitAndPush, discardChanges, setSelectedDiffFile, fetchDiff } = useGitStore()
  const setView = useChatStore((s) => s.setRightSidebarView)
  const [msg, setMsg] = useState('')
  const [pushing, setPushing] = useState(false)

  const modified = (status?.modified || []).filter((f) => !(status?.staged || []).includes(f))
  const untracked = status?.not_added || []
  const staged = status?.staged || []
  const conflicts = status?.conflicts || []
  const total = modified.length + untracked.length + staged.length + conflicts.length

  const toggle = useCallback((f: string) => {
    status?.staged.includes(f) ? unstageFiles([f]) : stageFiles([f])
  }, [status, stageFiles, unstageFiles])

  const showDiff = useCallback((f: string, s: boolean) => {
    setSelectedDiffFile(f); fetchDiff([f], s); setView('diff')
  }, [setSelectedDiffFile, fetchDiff, setView])

  const doCommit = useCallback(async () => { if (!msg.trim()) return; await commit(msg.trim()); setMsg('') }, [msg, commit])

  const doCommitPush = useCallback(async () => {
    if (!msg.trim()) return; setPushing(true); await commitAndPush(msg.trim()); setPushing(false); setMsg('')
  }, [msg, commitAndPush])

  return (
    <div style={{ padding: '4px 0' }}>
      {total === 0 && (
        <div className="flex flex-col items-center gap-2 py-8">
          <span style={{ color: 'var(--text-outline-variant)', opacity: 0.25 }}><I.File s={20} /></span>
          <span className="text-[11px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>No changes</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {conflicts.length > 0 && (
          <div key="conflicts" className="mb-1 ml-1" style={{ borderLeft: '2px solid #ef4444', paddingLeft: 6 }}>
            {conflicts.map((f) => <FileRow key={f} filePath={f} statusCode="UU" staged={false} onToggle={() => {}} onShowDiff={() => showDiff(f, false)} />)}
          </div>
        )}
        {staged.length > 0 && (
          <div key="staged" className="mb-1 ml-1" style={{ borderLeft: '2px solid #22c55e', paddingLeft: 6 }}>
            {staged.map((f) => <FileRow key={f} filePath={f} statusCode="M" staged onToggle={() => toggle(f)} onShowDiff={() => showDiff(f, true)} />)}
          </div>
        )}
        {modified.length > 0 && (
          <div key="modified" className="mb-1 ml-1" style={{ borderLeft: '2px solid #eab308', paddingLeft: 6 }}>
            {modified.map((f) => <FileRow key={f} filePath={f} statusCode="M" staged={false} onToggle={() => toggle(f)} onShowDiff={() => showDiff(f, false)} onDiscard={() => discardChanges([f], true)} />)}
          </div>
        )}
        {untracked.length > 0 && (
          <div key="untracked" className="mb-1 ml-1" style={{ borderLeft: '2px solid var(--text-outline-variant)', paddingLeft: 6, opacity: 0.5 }}>
            {untracked.map((f) => <FileRow key={f} filePath={f} statusCode="??" staged={false} onToggle={() => toggle(f)} onShowDiff={() => showDiff(f, false)} onDiscard={() => discardChanges([f], false)} />)}
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {total > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="rounded-lg p-2.5 mt-2 overflow-hidden" style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}>
            <input type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Commit message"
              className="w-full text-[12px] outline-none rounded-[6px] px-2.5 py-1.5 mb-2 transition-colors focus:border-[var(--accent-primary)]"
              style={{ background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: '1px solid var(--border-subtle)' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.metaKey || e.ctrlKey ? doCommitPush() : doCommit() } }}
            />
            <div className="flex gap-1.5">
              <ActionBtn onClick={doCommit} disabled={!msg.trim()} loading={loading && !pushing} primary>
                <I.Check s={11} /> Commit
              </ActionBtn>
              <ActionBtn onClick={doCommitPush} disabled={!msg.trim()} loading={pushing}>
                <I.Up s={11} /> {pushing ? 'Pushing...' : 'Commit & Push'}
              </ActionBtn>
            </div>
            <div className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>Enter commit · Ctrl+Enter push</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Branches Tab ──────────────────────────────────────

function BranchesTab() {
  const { branches, loading, checkout, createBranch, deleteBranch, push, pull, fetch: gitFetch } = useGitStore()
  const [name, setName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [sync, setSync] = useState<'push' | 'pull' | 'fetch' | null>(null)
  const [del, setDel] = useState<string | null>(null)

  const doCreate = async () => { if (!name.trim()) return; await createBranch(name.trim()); setName(''); setShowNew(false) }

  return (
    <div style={{ padding: '4px 0' }}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}><I.Branch s={12} /></span>
          <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-outline-variant)' }}>Branches</span>
        </div>
        <button onClick={() => setShowNew(!showNew)} className="flex items-center gap-1 text-[10px] font-medium rounded-[4px] px-1.5 py-0.5 hover:brightness-110"
          style={{ color: 'var(--accent-primary)', border: '1px solid var(--border-subtle)', background: 'transparent' }}>
          <I.Plus /> New
        </button>
      </div>

      <AnimatePresence>
        {showNew && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex gap-1.5 mb-1.5 px-3 overflow-hidden">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Branch name" autoFocus
              className="flex-1 text-[11px] outline-none rounded-[6px] px-2 py-1.5 transition-colors focus:border-[var(--accent-primary)]"
              style={{ background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: '1px solid var(--border-subtle)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') doCreate() }} />
            <ActionBtn onClick={doCreate} disabled={!name.trim()} primary>Create</ActionBtn>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {branches.map((b) => (
            <motion.div key={b.name} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}
              className="flex items-center gap-2 w-full rounded-[6px] hover:bg-[var(--bg-surface-container)] transition-colors group"
              style={{ padding: '4px 8px', minHeight: 26, background: b.current ? 'var(--bg-surface-container)' : 'transparent', border: b.current ? '1px solid var(--border-subtle)' : '1px solid transparent' }}>
              <button onClick={() => checkout(b.name)} className="flex-1 flex items-center gap-2 min-w-0">
                <span className="shrink-0 flex items-center justify-center" style={{ width: 14, height: 14, color: b.current ? 'var(--accent-primary)' : 'var(--text-outline-variant)' }}>
                  {b.current ? <I.Check s={12} /> : <I.Branch s={10} />}
                </span>
                <span className="text-[12px] truncate" style={{ color: b.current ? 'var(--text-on-surface)' : 'var(--text-outline-variant)', fontWeight: b.current ? 500 : 400 }}>{b.name}</span>
              </button>
              {!b.current && (
                <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {del === b.name ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => { deleteBranch(b.name); setDel(null) }} className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)' }}>Delete</button>
                      <button onClick={() => { deleteBranch(b.name, true); setDel(null) }} className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.15)' }}>Force</button>
                      <button onClick={() => setDel(null)} className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ color: 'var(--text-outline-variant)' }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setDel(b.name)} className="p-1 rounded-[4px] hover:bg-[var(--bg-surface-container-high)]" style={{ color: 'var(--text-outline-variant)' }}><I.Trash s={12} /></button>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="flex gap-1.5 px-3 py-2 mt-1">
        <IconBtn icon={sync === 'push' ? <I.Spinner /> : <I.Up />} title="Push" onClick={() => { setSync('push'); push().finally(() => setSync(null)) }} disabled={!!sync} />
        <IconBtn icon={sync === 'pull' ? <I.Spinner /> : <I.Down />} title="Pull" onClick={() => { setSync('pull'); pull().finally(() => setSync(null)) }} disabled={!!sync} />
        <IconBtn icon={sync === 'fetch' ? <I.Spinner /> : <I.Fetch />} title="Fetch" onClick={() => { setSync('fetch'); gitFetch().finally(() => setSync(null)) }} disabled={!!sync} />
      </div>
    </div>
  )
}

// ─── Stash Tab ─────────────────────────────────────────

function StashTab() {
  const { stashes, loading, stashPush, stashPop, stashApply, stashDrop } = useGitStore()
  const [show, setShow] = useState(false)
  const [msg, setMsg] = useState('')
  const [untracked, setUntracked] = useState(false)

  const doStash = async () => { await stashPush(msg || undefined, untracked); setMsg(''); setUntracked(false); setShow(false) }

  return (
    <div style={{ padding: '4px 0' }}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}><I.Archive s={12} /></span>
          <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-outline-variant)' }}>Stash</span>
        </div>
        <button onClick={() => setShow(!show)} className="flex items-center gap-1 text-[10px] font-medium rounded-[4px] px-1.5 py-0.5 hover:brightness-110"
          style={{ color: 'var(--accent-primary)', border: '1px solid var(--border-subtle)', background: 'transparent' }}>
          <I.Plus /> Stash
        </button>
      </div>

      <AnimatePresence>
        {show && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="px-3 pb-2 overflow-hidden">
            <input type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message (optional)" autoFocus
              className="w-full text-[11px] outline-none rounded-[6px] px-2 py-1.5 mb-1.5 transition-colors focus:border-[var(--accent-primary)]"
              style={{ background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: '1px solid var(--border-subtle)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') doStash() }} />
            <label className="flex items-center gap-2 text-[11px] mb-1.5 cursor-pointer" style={{ color: 'var(--text-outline-variant)' }}>
              <input type="checkbox" checked={untracked} onChange={(e) => setUntracked(e.target.checked)} style={{ width: 12, height: 12, accentColor: 'var(--accent-primary)' }} />
              Include untracked
            </label>
            <ActionBtn onClick={doStash} loading={loading} primary>Stash</ActionBtn>
          </motion.div>
        )}
      </AnimatePresence>

      {stashes.length === 0 && !show && (
        <div className="flex flex-col items-center gap-2 py-8">
          <span style={{ color: 'var(--text-outline-variant)', opacity: 0.25 }}><I.Archive s={20} /></span>
          <span className="text-[11px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>No stashes</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {stashes.map((s) => (
          <motion.div key={s.hash} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6, height: 0 }} transition={{ duration: 0.12 }}
            className="flex items-center gap-2 w-full rounded-[6px] hover:bg-[var(--bg-surface-container)] transition-colors group"
            style={{ padding: '4px 8px', minHeight: 26 }}>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] truncate" style={{ color: 'var(--text-on-surface)' }}>{s.message}</div>
              <div className="text-[10px] flex items-center gap-2" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>
                <span className="font-mono">{s.hash}</span><span>{new Date(s.date).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => stashPop(s.index)} className="p-1 rounded-[4px] hover:bg-[var(--bg-surface-container-high)]" style={{ color: 'var(--text-on-surface)' }} title="Pop"><I.Down s={12} /></button>
              <button onClick={() => stashApply(s.index)} className="p-1 rounded-[4px] hover:bg-[var(--bg-surface-container-high)]" style={{ color: 'var(--text-outline-variant)' }} title="Apply"><I.Check s={12} /></button>
              <button onClick={() => stashDrop(s.index)} className="p-1 rounded-[4px] hover:bg-[rgba(239,68,68,0.1)]" style={{ color: '#ef4444' }} title="Drop"><I.Trash s={12} /></button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ─── Log Tab ───────────────────────────────────────────

function LogTab() {
  const { log, selectedCommitHash, commitDiff, loading, fetchCommitDiff, clearCommitDiff } = useGitStore()

  return (
    <div style={{ padding: '4px 0' }}>
      {log.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8">
          <span style={{ color: 'var(--text-outline-variant)', opacity: 0.25 }}><I.Git s={20} /></span>
          <span className="text-[11px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>No commits</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {log.map((c) => (
          <motion.div key={c.hash} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }} className="rounded-[6px] overflow-hidden">
            <button onClick={() => selectedCommitHash === c.hash ? clearCommitDiff() : fetchCommitDiff(c.hash)}
              className="flex items-start gap-2 w-full text-left rounded-[6px] hover:bg-[var(--bg-surface-container)] transition-colors"
              style={{ padding: '4px 8px', minHeight: 26, background: selectedCommitHash === c.hash ? 'var(--bg-surface-container)' : 'transparent' }}>
              <span className="text-[10px] font-mono shrink-0 mt-0.5" style={{ color: 'var(--accent-primary)', opacity: 0.6 }}>{c.hash.slice(0, 7)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] truncate" style={{ color: 'var(--text-on-surface)' }}>{c.message}</div>
                <div className="text-[10px] flex items-center gap-2" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>
                  <span>{c.author_name}</span><span>{new Date(c.date).toLocaleDateString()}</span>
                </div>
              </div>
              <span className="shrink-0 mt-0.5 transition-transform duration-200" style={{ color: 'var(--text-outline-variant)', opacity: 0.3, transform: selectedCommitHash === c.hash ? 'rotate(180deg)' : 'none' }}>
                <I.ChevronDn />
              </span>
            </button>

            <AnimatePresence>
              {selectedCommitHash === c.hash && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '4px 0' }}>
                    {loading && !commitDiff ? (
                      <div className="flex items-center justify-center py-4 gap-2 text-[11px]" style={{ color: 'var(--text-outline-variant)' }}><I.Spinner /> Loading...</div>
                    ) : commitDiff ? commitDiff.split('\n').map((l, i) => <DiffLine key={i} line={l} />)
                    : <div className="text-[11px] text-center py-4" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>No diff</div>}
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

const TABS: { key: Tab; label: string; icon: (p: { s?: number }) => React.ReactNode }[] = [
  { key: 'files', label: 'Files', icon: (p) => <I.File {...p} /> },
  { key: 'branches', label: 'Branches', icon: (p) => <I.Branch {...p} /> },
  { key: 'stash', label: 'Stash', icon: (p) => <I.Archive {...p} /> },
  { key: 'log', label: 'Log', icon: (p) => <I.Git {...p} /> },
]

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex items-center gap-1 px-3 py-1 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {TABS.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className="relative flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-medium pb-1.5 px-1 transition-colors"
          style={{ color: active === t.key ? 'var(--accent-primary)' : 'var(--text-outline-variant)' }}>
          {t.icon({ s: 12 })}
          {t.label}
          {active === t.key && (
            <motion.div layoutId="git-tab-underline" className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: 'var(--accent-primary)' }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
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

  useEffect(() => { if (chatConfig.cwd && chatConfig.cwd !== cwd) setCwd(chatConfig.cwd) }, [chatConfig.cwd, cwd, setCwd])
  useEffect(() => { if (cwd) refresh() }, [cwd])
  useEffect(() => { const unsub = (window as any).claude.onGitRefresh?.(() => useGitStore.getState().refresh()); return () => unsub?.() }, [])
  useEffect(() => { if (!cwd) return; const id = setInterval(() => useGitStore.getState().refresh(), 5000); return () => clearInterval(id) }, [cwd])
  useEffect(() => { if (!error) return; const t = setTimeout(clearError, 5000); return () => clearTimeout(t) }, [error, clearError])

  const branch = status?.current || ''

  if (!cwd) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[12px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>No workspace selected</div>
    </div>
  )

  if (error && !status) {
    if (error.toLowerCase().includes('not a git repository')) return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
        <span style={{ color: 'var(--text-outline-variant)', opacity: 0.3 }}><I.Git s={24} /></span>
        <div className="text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>Not a git repository</div>
        <ActionBtn onClick={init} loading={loading} primary>Init Repository</ActionBtn>
      </div>
    )
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
        <span style={{ color: '#ef4444' }}><I.Alert /></span>
        <div className="text-[11px] text-center" style={{ color: '#ef4444' }}>{error}</div>
      </div>
    )
  }

  if (loading && !status) return (
    <div className="flex items-center justify-center h-full">
      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-outline-variant)' }}><I.Spinner /> Loading...</div>
    </div>
  )

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -6, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -6, height: 0 }}
            className="rounded-[6px] mx-3 mt-2 px-3 py-2 text-[11px] flex items-center gap-2"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
            <I.Alert s={12} />
            <span className="flex-1 truncate">{error}</span>
            <button onClick={clearError} className="hover:opacity-70 transition-opacity"><I.Close /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Branch bar */}
      {branch && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 mx-3 mt-2 shrink-0" style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}>
          <span style={{ color: 'var(--accent-primary)' }}><I.Branch s={13} /></span>
          <span className="text-[12px] font-medium truncate" style={{ color: 'var(--text-on-surface)' }}>{branch}</span>
          {(status!.ahead > 0 || status!.behind > 0) && (
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              {status!.ahead > 0 && <span className="flex items-center gap-0.5 text-[10px] tabular-nums" style={{ color: 'var(--accent-primary)', opacity: 0.7 }}><I.Up s={9} />{status!.ahead}</span>}
              {status!.behind > 0 && <span className="flex items-center gap-0.5 text-[10px] tabular-nums" style={{ color: '#ef4444', opacity: 0.7 }}><I.Down s={9} />{status!.behind}</span>}
            </div>
          )}
        </div>
      )}

      <TabBar active={tab} onChange={setTab} />

      <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ padding: '0 8px 4px' }}>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.12 }}>
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
