import { useEffect, useState, useCallback, memo, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useGitStore } from '../stores/gitStore'
import { useChatStore } from '../stores/chatStore'
import { useShallow } from 'zustand/react/shallow'
import { DiffLine } from './DiffLine'

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
  ChevronRt: ({ s = 12 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 6 15 12 9 18" />
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

// ─── Glass Card ────────────────────────────────────────

const CARD = {
  hero: {
    border: '1px solid var(--border-default)',
    borderRadius: 10,
    padding: '10px 14px',
    margin: '8px 8px 4px',
    background: 'var(--bg-surface-container)',
  },
  primary: {
    border: '1px solid var(--border-default)',
    borderRadius: 10,
    padding: '12px 14px',
    margin: '0 8px 8px',
    background: 'var(--bg-surface-container)',
  },
  surface: {
    border: '1px solid var(--border-default)',
    borderRadius: 10,
    overflow: 'hidden' as const,
    margin: '0 8px 8px',
    background: 'var(--bg-surface-container)',
  },
}

// ─── Collapsible Section ───────────────────────────────

function Section({ title, count, defaultOpen, children, accent, hero }: {
  title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode; accent?: string; hero?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen ?? true)
  return (
    <div style={CARD.surface}>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left py-2.5 px-3 transition-colors"
        style={{ color: 'var(--text-outline-variant)' }}
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.15 }} className="shrink-0" style={{ width: 14, height: 14, color: accent || 'var(--text-outline-variant)' }}>
          <I.ChevronDn s={12} />
        </motion.span>
        <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: accent || 'var(--text-outline-variant)' }}>{title}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }} className="overflow-hidden">
              {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Status Badge ──────────────────────────────────────

const STYLE: Record<string, { letter: string; bg: string; fg: string }> = {
  M: { letter: 'M', bg: 'rgba(234,179,8,0.2)', fg: '#eab308' },
  A: { letter: 'A', bg: 'rgba(34,197,94,0.2)', fg: '#22c55e' },
  D: { letter: 'D', bg: 'rgba(239,68,68,0.2)', fg: '#ef4444' },
  R: { letter: 'R', bg: 'rgba(59,130,246,0.2)', fg: '#3b82f6' },
  '??': { letter: 'U', bg: 'rgba(156,163,175,0.12)', fg: '#9ca3af' },
  UU: { letter: '!', bg: 'rgba(239,68,68,0.25)', fg: '#ef4444' },
}

function StatusBadge({ code }: { code: string }) {
  const s = STYLE[code] || { letter: '?', bg: 'rgba(156,163,175,0.12)', fg: '#9ca3af' }
  return (
    <span className="shrink-0 flex items-center justify-center rounded-[4px] text-[10px] font-bold tabular-nums"
      style={{ width: 20, height: 18, background: s.bg, color: s.fg, letterSpacing: -0.5 }}
    >{s.letter}</span>
  )
}

// ─── Glass Icon Button ─────────────────────────────────

function GlassIconBtn({ icon, onClick, disabled, title, danger }: {
  icon: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean
}) {
  const theme = useChatStore((s) => s.theme)
  const isDark = theme !== 'light'
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="flex items-center justify-center rounded-[8px] transition-all duration-150 disabled:opacity-30 hover:brightness-125 active:scale-[0.92]"
      style={{
        width: 32, height: 30,
        background: theme === 'aurora' ? undefined : isDark ? 'rgba(30, 30, 32, 0.6)' : 'rgba(255, 255, 255, 0.6)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        color: danger ? '#ef4444' : 'var(--text-outline-variant)',
        border: theme === 'aurora' ? '1px solid var(--glass-border)' : isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.06)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >{icon}</button>
  )
}

// ─── Action Group ──────────────────────────────────────

function ActionGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">{children}</div>
  )
}

// ─── File Row ──────────────────────────────────────────

const FileRow = memo(function FileRow({ filePath, statusCode, staged, onToggle, onShowDiff, onDiscard }: {
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
    <div
      className="flex items-center gap-2 w-full transition-colors group"
      style={{ padding: '5px 14px 5px 14px', minHeight: 30, borderBottom: '1px solid var(--border-subtle)' }}
    >
      <button onClick={onToggle} className="shrink-0 flex items-center justify-center rounded-[4px] hover:brightness-150 transition-all"
        style={{ width: 18, height: 18 }}
      >
        {staged ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="4" fill="rgba(34,197,94,0.15)" stroke="#22c55e" />
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-outline-variant)" strokeWidth="1.5" opacity="0.35">
            <rect x="3" y="3" width="18" height="18" rx="4" />
          </svg>
        )}
      </button>
      <StatusBadge code={statusCode} />
      <button onClick={onShowDiff} className="flex-1 text-left truncate min-w-0">
        <span className="text-[10px] opacity-35">{dir}</span>
        <span className="text-[12px] leading-tight" style={{ color: 'var(--text-on-surface)' }}>{fileName}</span>
      </button>
      {onDiscard && !staged && (
        <button onClick={handleDiscard} className="shrink-0 opacity-0 group-hover:opacity-100 transition-all text-[9px] px-1.5 py-0.5 rounded-[4px]"
          style={{
            color: confirm ? '#ef4444' : 'var(--text-outline-variant)',
            background: confirm ? 'rgba(239,68,68,0.12)' : 'transparent',
            border: confirm ? '1px solid rgba(239,68,68,0.25)' : 'none',
          }}
        >{confirm ? 'Discard' : <I.RotateCcw s={10} />}</button>
      )}
    </div>
  )
})

// ─── Empty State ───────────────────────────────────────

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8" style={{ padding: '24px 0' }}>
      <span style={{ color: 'var(--text-outline-variant)', opacity: 0.15, display: 'flex' }}>{icon}</span>
      <span className="text-[10px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.3 }}>{text}</span>
    </div>
  )
}

// ─── Files Section ─────────────────────────────────────

function FilesSection() {
  const { status, loading, stageFiles, unstageFiles, commit, commitAndPush, discardChanges, setSelectedDiffFile, fetchDiff, refresh } = useGitStore(useShallow((s) => ({
    status: s.status,
    loading: s.loading,
    stageFiles: s.stageFiles,
    unstageFiles: s.unstageFiles,
    commit: s.commit,
    commitAndPush: s.commitAndPush,
    discardChanges: s.discardChanges,
    setSelectedDiffFile: s.setSelectedDiffFile,
    fetchDiff: s.fetchDiff,
    refresh: s.refresh,
  })))
  const setView = useChatStore((s) => s.setRightSidebarView)
  const [msg, setMsg] = useState('')
  const [pushing, setPushing] = useState(false)

  const modified = useMemo(() => (status?.modified || []).filter((f) => !(status?.staged || []).includes(f)), [status])
  const untracked = useMemo(() => status?.not_added || [], [status])
  const staged = useMemo(() => status?.staged || [], [status])
  const conflicts = useMemo(() => status?.conflicts || [], [status])

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

  const hasConflicts = conflicts.length > 0
  const hasStaged = staged.length > 0
  const hasChanges = modified.length + untracked.length > 0
  const totalChanges = modified.length + untracked.length + staged.length + conflicts.length

  return (
    <div>
      {/* ── Commit Card ── */}
      <div style={CARD.primary}>
        <textarea
          value={msg} onChange={(e) => setMsg(e.target.value)}
          placeholder="Commit message…"
          rows={2}
          className="w-full text-[12px] outline-none rounded-[8px] px-3 py-2 resize-none transition-all focus:ring-1 focus:ring-[var(--accent-primary)]"
          style={{
            background: 'var(--bg-surface-container-high)',
            color: 'var(--text-on-surface)',
            border: '1px solid var(--border-subtle)',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doCommitPush() }
            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doCommit() }
          }}
        />
        <div className="flex items-center gap-2 mt-2.5">
          <button onClick={doCommit} disabled={!msg.trim() || loading}
            className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold rounded-[8px] py-2 transition-all duration-150 disabled:opacity-35 hover:brightness-110 active:scale-[0.97]"
            style={{
              background: 'var(--accent-primary)', color: '#fff', border: 'none',
              cursor: loading || pushing ? 'wait' : 'pointer',
              boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
            }}
          >{loading && !pushing ? <I.Spinner s={11} /> : <I.Check s={11} />} Commit</button>
          <button onClick={doCommitPush} disabled={!msg.trim() || loading}
            className="flex items-center justify-center rounded-[8px] px-3 py-2 transition-all duration-150 disabled:opacity-35 hover:brightness-110 active:scale-[0.97]"
            style={{
              background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)',
              border: '1px solid var(--border-subtle)',
              cursor: loading || pushing ? 'wait' : 'pointer',
            }}
          >{pushing ? <I.Spinner s={11} /> : <I.Up s={12} />}</button>
        </div>
        <div className="text-[9px] mt-1.5 text-center" style={{ color: 'var(--text-outline-variant)', opacity: 0.25 }}>
          Enter to commit · {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to push
        </div>
      </div>

      {/* ── Conflict Section ── */}
      {hasConflicts && (
        <Section key="conflicts" title="Merge Conflicts" count={conflicts.length} accent="#ef4444">
          {conflicts.map((f) => <FileRow key={f} filePath={f} statusCode="UU" staged={false} onToggle={() => {}} onShowDiff={() => showDiff(f, false)} />)}
        </Section>
      )}

      {/* ── Staged Section ── */}
      {hasStaged && (
        <Section key="staged" title="Staged Changes" count={staged.length} accent="#22c55e">
          <div style={{ borderLeft: '2px solid rgba(34,197,94,0.35)', margin: '2px 0 2px 6px' }}>
            {staged.map((f) => <FileRow key={f} filePath={f} statusCode="M" staged onToggle={() => toggle(f)} onShowDiff={() => showDiff(f, true)} />)}
          </div>
        </Section>
      )}

      {/* ── Changes Section ── */}
      {hasChanges && (
        <Section key="changes" title="Changes" count={modified.length + untracked.length}>
          <div style={{ borderLeft: '2px solid var(--border-subtle)', margin: '2px 0 2px 6px' }}>
            {modified.map((f) => <FileRow key={f} filePath={f} statusCode="M" staged={false} onToggle={() => toggle(f)} onShowDiff={() => showDiff(f, false)} onDiscard={() => discardChanges([f], true)} />)}
            {untracked.map((f) => <FileRow key={f} filePath={f} statusCode="??" staged={false} onToggle={() => toggle(f)} onShowDiff={() => showDiff(f, false)} onDiscard={() => discardChanges([f], false)} />)}
          </div>
        </Section>
      )}

      {/* ── Empty State ── */}
      {totalChanges === 0 && !loading && (
        <div style={{ ...CARD.surface, overflow: 'visible' }}>
          <EmptyState icon={<I.File s={22} />} text="Clean working tree — no changes" />
        </div>
      )}
    </div>
  )
}

// ─── Branches Section ──────────────────────────────────

function BranchesSection() {
  const { branches, loading, checkout, createBranch, deleteBranch } = useGitStore(useShallow((s) => ({
    branches: s.branches,
    loading: s.loading,
    checkout: s.checkout,
    createBranch: s.createBranch,
    deleteBranch: s.deleteBranch,
  })))
  const [name, setName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [del, setDel] = useState<string | null>(null)

  const doCreate = async () => { if (!name.trim()) return; await createBranch(name.trim()); setName(''); setShowNew(false) }

  return (
    <Section title="Branches" count={branches.length}>
      {branches.map((b) => (
        <div key={b.name}
          className="flex items-center gap-2 w-full transition-colors group"
          style={{ padding: '5px 14px 5px 14px', minHeight: 30, borderBottom: '1px solid var(--border-subtle)' }}
        >
          <button onClick={() => checkout(b.name)} className="flex-1 flex items-center gap-2.5 min-w-0">
            <span className="shrink-0 flex items-center justify-center" style={{ width: 16, height: 16 }}>
              {b.current ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent-primary)">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="4" fill="var(--bg-surface)" />
                </svg>
              ) : (
                <I.Branch s={12} />
              )}
            </span>
            <span className="text-[12px] truncate" style={{ color: b.current ? 'var(--text-on-surface)' : 'var(--text-outline-variant)', fontWeight: b.current ? 600 : 400 }}>{b.name}</span>
          </button>
          {!b.current && (
            <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              {del === b.name ? (
                <>
                  <button onClick={() => { deleteBranch(b.name); setDel(null) }} className="text-[9px] font-medium px-1.5 py-0.5 rounded-[4px]" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.12)' }}>Delete</button>
                  <button onClick={() => setDel(null)} className="text-[9px] px-1.5 py-0.5 rounded-[4px]" style={{ color: 'var(--text-outline-variant)' }}>Cancel</button>
                </>
              ) : (
                <button onClick={() => setDel(b.name)} className="p-1 rounded-[4px] hover:bg-[var(--bg-surface-container)]" style={{ color: 'var(--text-outline-variant)' }}><I.Trash s={11} /></button>
              )}
            </div>
          )}
        </div>
      ))}
      <AnimatePresence>
        {showNew ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex gap-1.5 px-4 py-2 overflow-hidden" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="New branch name" autoFocus
              className="flex-1 text-[11px] outline-none rounded-[6px] px-2.5 py-1.5 transition-all focus:ring-1 focus:ring-[var(--accent-primary)]"
              style={{ background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: '1px solid var(--border-subtle)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') doCreate() }} />
            <button onClick={doCreate} disabled={!name.trim()} className="text-[11px] font-semibold rounded-[6px] px-3 py-1.5" style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none' }}>Create</button>
            <button onClick={() => setShowNew(false)} className="px-2" style={{ color: 'var(--text-outline-variant)' }}><I.Close /></button>
          </motion.div>
        ) : (
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[11px] w-full py-2 px-4 hover:bg-[var(--bg-surface-container-high)] transition-colors" style={{ color: 'var(--accent-primary)' }}>
            <I.Plus s={9} /> New Branch
          </button>
        )}
      </AnimatePresence>
    </Section>
  )
}

// ─── Stashes Section ───────────────────────────────────

function StashesSection() {
  const { stashes, loading, stashPush, stashPop, stashApply, stashDrop } = useGitStore(useShallow((s) => ({
    stashes: s.stashes,
    loading: s.loading,
    stashPush: s.stashPush,
    stashPop: s.stashPop,
    stashApply: s.stashApply,
    stashDrop: s.stashDrop,
  })))
  const [show, setShow] = useState(false)
  const [msg, setMsg] = useState('')
  const [untracked, setUntracked] = useState(false)

  const doStash = async () => { await stashPush(msg || undefined, untracked); setMsg(''); setUntracked(false); setShow(false) }

  return (
    <Section title="Stashes" count={stashes.length}>
      <AnimatePresence>
        {show && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="px-4 py-2 overflow-hidden" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <input type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message (optional)" autoFocus
              className="w-full text-[11px] outline-none rounded-[6px] px-2.5 py-1.5 mb-1.5 transition-all focus:ring-1 focus:ring-[var(--accent-primary)]"
              style={{ background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: '1px solid var(--border-subtle)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') doStash() }} />
            <label className="flex items-center gap-1.5 text-[10px] mb-2 cursor-pointer" style={{ color: 'var(--text-outline-variant)' }}>
              <input type="checkbox" checked={untracked} onChange={(e) => setUntracked(e.target.checked)} style={{ width: 12, height: 12, accentColor: 'var(--accent-primary)' }} />
              Include untracked
            </label>
            <button onClick={doStash} className="text-[11px] font-semibold rounded-[6px] px-3 py-1.5 w-full transition-all hover:brightness-110" style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none' }}>
              {loading ? 'Stashing…' : 'Stash'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {stashes.length === 0 && !show && <EmptyState icon={<I.Archive s={18} />} text="No stashes" />}

      {stashes.map((s) => (
        <div key={s.hash}
          className="flex items-center gap-2 w-full transition-colors group"
          style={{ padding: '5px 14px 5px 14px', minHeight: 30, borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[12px] truncate leading-tight" style={{ color: 'var(--text-on-surface)' }}>{s.message}</div>
            <div className="text-[9px] flex items-center gap-2 mt-0.5" style={{ color: 'var(--text-outline-variant)', opacity: 0.45 }}>
              <span className="font-mono">{s.hash.slice(0, 7)}</span>
              <span>{new Date(s.date).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => stashPop(s.index)} className="p-1 rounded-[4px] hover:bg-[var(--bg-surface-container)]" title="Pop" style={{ color: 'var(--text-on-surface)' }}><I.Down s={11} /></button>
            <button onClick={() => stashApply(s.index)} className="p-1 rounded-[4px] hover:bg-[var(--bg-surface-container)]" title="Apply" style={{ color: 'var(--text-outline-variant)' }}><I.Check s={11} /></button>
            <button onClick={() => stashDrop(s.index)} className="p-1 rounded-[4px] hover:bg-[rgba(239,68,68,0.1)]" title="Drop" style={{ color: '#ef4444' }}><I.Trash s={11} /></button>
          </div>
        </div>
      ))}
    </Section>
  )
}

// ─── Log Section ───────────────────────────────────────

function LogSection() {
  const { log, selectedCommitHash, commitDiff, loading, fetchCommitDiff, clearCommitDiff } = useGitStore(useShallow((s) => ({
    log: s.log,
    selectedCommitHash: s.selectedCommitHash,
    commitDiff: s.commitDiff,
    loading: s.loading,
    fetchCommitDiff: s.fetchCommitDiff,
    clearCommitDiff: s.clearCommitDiff,
  })))

  if (log.length === 0) return null

  return (
    <Section title="Recent Commits" count={log.length} defaultOpen={false}>
      {log.slice(0, 20).map((c) => (
        <div key={c.hash}>
          <button onClick={() => selectedCommitHash === c.hash ? clearCommitDiff() : fetchCommitDiff(c.hash)}
            className="flex items-center gap-2 w-full text-left transition-colors"
            style={{ padding: '5px 14px 5px 14px', minHeight: 30, borderBottom: '1px solid var(--border-subtle)', background: selectedCommitHash === c.hash ? 'var(--bg-surface-container-high)' : 'transparent' }}
          >
            <span className="text-[9px] font-mono shrink-0" style={{ color: 'var(--accent-primary)', opacity: 0.55 }}>{c.hash.slice(0, 7)}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] truncate leading-tight" style={{ color: 'var(--text-on-surface)' }}>{c.message}</div>
              <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>{new Date(c.date).toLocaleDateString()}</div>
            </div>
            <motion.span animate={{ rotate: selectedCommitHash === c.hash ? 180 : 0 }} transition={{ duration: 0.15 }} className="shrink-0" style={{ color: 'var(--text-outline-variant)', opacity: 0.3 }}>
              <I.ChevronDn s={11} />
            </motion.span>
          </button>
          <AnimatePresence>
            {selectedCommitHash === c.hash && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div style={{ borderLeft: '2px solid var(--border-subtle)', margin: '2px 0 2px 24px', padding: '6px 0' }}>
                  {loading ? (
                    <div className="flex items-center justify-center py-3 gap-1.5 text-[10px]" style={{ color: 'var(--text-outline-variant)' }}><I.Spinner s={9} /> Loading diff…</div>
                  ) : commitDiff ? commitDiff.split('\n').map((l, i) => <DiffLine key={i} line={l} />)
                  : <div className="text-[10px] text-center py-3" style={{ color: 'var(--text-outline-variant)', opacity: 0.35 }}>No diff to show</div>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </Section>
  )
}

// ─── Main ──────────────────────────────────────────────

export function GitView() {
  const { status, loading, error, cwd, refresh, init, clearError, setCwd, push, pull, fetch: gitFetch } = useGitStore(useShallow((s) => ({
    status: s.status,
    loading: s.loading,
    error: s.error,
    cwd: s.cwd,
    refresh: s.refresh,
    init: s.init,
    clearError: s.clearError,
    setCwd: s.setCwd,
    push: s.push,
    pull: s.pull,
    fetch: s.fetch,
  })))
  const chatConfig = useChatStore((s) => s.config)
  const [sync, setSync] = useState<'push' | 'pull' | 'fetch' | null>(null)

  useEffect(() => { if (chatConfig.cwd && chatConfig.cwd !== cwd) setCwd(chatConfig.cwd) }, [chatConfig.cwd, cwd, setCwd])
  useEffect(() => { if (cwd) refresh() }, [cwd])
  useEffect(() => { const unsub = (window as any).claude.onGitRefresh?.(() => useGitStore.getState().refresh()); return () => unsub?.() }, [])
  useEffect(() => { if (!cwd) return; const id = setInterval(() => useGitStore.getState().refresh(), 5000); return () => clearInterval(id) }, [cwd])
  useEffect(() => { if (!error) return; const t = setTimeout(clearError, 5000); return () => clearTimeout(t) }, [error, clearError])

  const branch = status?.current || ''

  if (!cwd) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[11px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>No workspace selected</div>
    </div>
  )

  if (error && !status) {
    if (error.toLowerCase().includes('not a git repository')) return (
      <div style={{ ...CARD.surface, overflow: 'visible', margin: '16px 8px' }}>
        <div className="flex flex-col items-center gap-3 py-8">
          <span style={{ color: 'var(--text-outline-variant)', opacity: 0.2, display: 'flex' }}><I.Git s={28} /></span>
          <div className="text-[11px]" style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>Not a git repository</div>
          <button onClick={init} disabled={loading}
            className="text-[12px] font-semibold rounded-[8px] px-4 py-2 transition-all hover:brightness-110 active:scale-[0.97]"
            style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', boxShadow: '0 2px 8px rgba(59,130,246,0.3)' }}
          >{loading ? 'Initializing…' : 'Init Repository'}</button>
        </div>
      </div>
    )
    return (
      <div style={{ ...CARD.surface, overflow: 'visible', margin: '16px 8px', borderColor: 'rgba(239,68,68,0.3)' }}>
        <div className="flex flex-col items-center gap-2 py-6 px-4">
          <span style={{ color: '#ef4444', opacity: 0.6, display: 'flex' }}><I.Alert s={16} /></span>
          <div className="text-[11px] text-center leading-relaxed" style={{ color: '#ef4444', opacity: 0.8 }}>{error}</div>
        </div>
      </div>
    )
  }

  if (loading && !status) return (
    <div className="flex items-center justify-center h-full">
      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>
        <I.Spinner s={11} /> Loading…
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -6, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -6, height: 0 }} className="overflow-hidden">
            <div style={{ margin: '4px 8px 0', padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <I.Alert s={11} />
              <span className="flex-1 text-[10px]" style={{ color: '#ef4444' }}>{error}</span>
              <button onClick={clearError} className="hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}><I.Close s={8} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Branch Hero Card ── */}
      {branch && (
        <div style={CARD.hero}>
          <div className="flex items-center gap-2">
            <span className="shrink-0 flex items-center justify-center" style={{ color: 'var(--accent-primary)' }}>
              <I.Branch s={15} />
            </span>
            <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-on-surface)' }}>{branch}</span>
            {(status!.ahead > 0 || status!.behind > 0) && (
              <div className="flex items-center gap-1.5 ml-auto shrink-0">
                {status!.ahead > 0 && (
                  <span className="flex items-center gap-0.5 text-[9px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full" style={{ color: 'var(--accent-primary)', background: 'rgba(59,130,246,0.12)' }}>
                    <I.Up s={8} />{status!.ahead}
                  </span>
                )}
                {status!.behind > 0 && (
                  <span className="flex items-center gap-0.5 text-[9px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.12)' }}>
                    <I.Down s={8} />{status!.behind}
                  </span>
                )}
              </div>
            )}
            <div className="shrink-0 flex items-center gap-1 ml-1" style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: 8 }}>
              <GlassIconBtn icon={<I.RotateCcw s={11} />} title="Refresh" onClick={refresh} disabled={loading} />
              <GlassIconBtn icon={sync === 'pull' ? <I.Spinner s={10} /> : <I.Down s={10} />} title="Pull" onClick={() => { setSync('pull'); pull().finally(() => setSync(null)) }} disabled={!!sync} />
              <GlassIconBtn icon={sync === 'push' ? <I.Spinner s={10} /> : <I.Up s={10} />} title="Push" onClick={() => { setSync('push'); push().finally(() => setSync(null)) }} disabled={!!sync} />
              <GlassIconBtn icon={sync === 'fetch' ? <I.Spinner s={10} /> : <I.Fetch s={10} />} title="Fetch" onClick={() => { setSync('fetch'); gitFetch().finally(() => setSync(null)) }} disabled={!!sync} />
            </div>
          </div>
        </div>
      )}

      {/* ── Scrolling content ── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ paddingTop: 2 }}>
        <FilesSection />
        <BranchesSection />
        <StashesSection />
        <LogSection />
        <div className="h-4" />
      </div>
    </div>
  )
}
