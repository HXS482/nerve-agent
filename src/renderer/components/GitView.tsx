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
  History: ({ s = 14 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Layers: ({ s = 14 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  Diff: ({ s = 14 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  ),
} as const

// ─── Tab Type ──────────────────────────────────────────

type GitTab = 'changes' | 'branches' | 'stashes' | 'history'

const TABS: { id: GitTab; label: string; icon: React.ReactNode }[] = [
  { id: 'changes', label: 'Changes', icon: <I.Diff s={13} /> },
  { id: 'branches', label: 'Branches', icon: <I.Branch s={13} /> },
  { id: 'stashes', label: 'Stashes', icon: <I.Layers s={13} /> },
  { id: 'history', label: 'History', icon: <I.History s={13} /> },
]

// ─── Design Tokens (theme-aware) ────────────────────────

const GIT = {
  // Accent states (for staged, success, error)
  accent: 'var(--accent-primary)',
  staged: 'var(--text-green, #34d399)',
  error: 'var(--text-red, #f87171)',
  // Muted states
  muted: 'var(--text-outline)',
  mutedSub: 'var(--text-outline-variant)',
  // Surfaces
  cardBg: 'var(--bg-surface-container-lowest, var(--bg-surface))',
  cardBorder: 'var(--border-default)',
  rowHover: 'var(--bg-surface-container)',
  rowBorder: 'var(--border-subtle)',
  // Typography
  fontUi: "var(--font-sans, 'Inter', system-ui, sans-serif)",
  fontMono: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
} as const

// ─── Card System ───────────────────────────────────────

const CARD = {
  surface: {
    borderRadius: 10,
    overflow: 'hidden' as const,
    margin: '0 6px',
  },
}

// ─── Status Badge (theme-aware) ────────────────────────

const STYLE: Record<string, { letter: string; bg: string; fg: string }> = {
  M: { letter: 'M', bg: 'color-mix(in srgb, var(--text-amber, #eab308) 15%, transparent)', fg: 'var(--text-amber, #eab308)' },
  A: { letter: 'A', bg: 'color-mix(in srgb, var(--text-green, #34d399) 15%, transparent)', fg: 'var(--text-green, #34d399)' },
  D: { letter: 'D', bg: 'color-mix(in srgb, var(--text-red, #f87171) 15%, transparent)', fg: 'var(--text-red, #f87171)' },
  R: { letter: 'R', bg: 'color-mix(in srgb, var(--text-blue, #60a5fa) 15%, transparent)', fg: 'var(--text-blue, #60a5fa)' },
  '??': { letter: 'U', bg: 'var(--bg-surface-container)', fg: GIT.muted },
  UU: { letter: '!', bg: 'color-mix(in srgb, var(--text-red, #f87171) 20%, transparent)', fg: 'var(--text-red, #f87171)' },
}

function StatusBadge({ code }: { code: string }) {
  const s = STYLE[code] || { letter: '?', bg: 'rgba(156,163,175,0.12)', fg: '#9ca3af' }
  return (
    <span className="shrink-0 flex items-center justify-center rounded-[4px] text-[10px] font-bold tabular-nums"
      style={{ width: 20, height: 18, background: s.bg, color: s.fg, letterSpacing: -0.5 }}
    >{s.letter}</span>
  )
}

// ─── Icon Button ───────────────────────────────────────

function GlassIconBtn({ icon, onClick, disabled, title }: {
  icon: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="flex items-center justify-center rounded-md transition-all duration-100 disabled:opacity-25 hover:brightness-110 active:scale-95"
      style={{
        width: 26, height: 26,
        background: 'transparent',
        color: GIT.mutedSub,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >{icon}</button>
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
      className="flex items-center gap-2 w-full transition-colors group cursor-pointer"
      style={{
        padding: '4px 10px 4px 8px',
        minHeight: 28,
        borderBottom: `1px solid ${GIT.rowBorder}`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container, rgba(0,0,0,0.03))' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <button onClick={onToggle} className="shrink-0 flex items-center justify-center rounded-sm transition-all"
        style={{ width: 18, height: 18 }}
      >
        {staged ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" fill="var(--text-green, #34d399)" stroke="var(--text-green, #34d399)" strokeWidth="2" />
            <polyline points="8 12 11 15 16 9" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" fill="none" stroke={GIT.mutedSub} strokeWidth="1.5" opacity="0.4" />
          </svg>
        )}
      </button>
      <StatusBadge code={statusCode} />
      <button onClick={onShowDiff} className="flex-1 text-left truncate min-w-0">
        <span style={{ fontSize: 10, color: GIT.muted, opacity: 0.4, fontFamily: GIT.fontMono }}>{dir}</span>
        <span style={{ fontSize: 12, color: 'var(--text-on-surface)', fontFamily: GIT.fontMono, lineHeight: 1.4 }}>{fileName}</span>
      </button>
      {onDiscard && !staged && (
        <button onClick={handleDiscard} className="shrink-0 opacity-0 group-hover:opacity-100 transition-all rounded-sm"
          style={{
            fontSize: 9,
            padding: '2px 6px',
            color: confirm ? GIT.error : GIT.mutedSub,
            background: confirm ? 'color-mix(in srgb, var(--text-red, #f87171) 12%, transparent)' : 'transparent',
          }}
        >{confirm ? 'Discard' : <I.RotateCcw s={10} />}</button>
      )}
    </div>
  )
})

// ─── Empty State ───────────────────────────────────────

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 h-full" style={{ minHeight: 100 }}>
      <span style={{ color: GIT.mutedSub, opacity: 0.15, display: 'flex' }}>{icon}</span>
      <span style={{ fontSize: 11, color: GIT.mutedSub, opacity: 0.35, fontFamily: GIT.fontUi }}>{text}</span>
    </div>
  )
}

// ─── Files List (no commit UI) ────────────────────────

function FilesList({ onShowDiff }: { onShowDiff: (f: string, s: boolean) => void }) {
  const { status, loading, stageFiles, unstageFiles, discardChanges } = useGitStore(useShallow((s) => ({
    status: s.status,
    loading: s.loading,
    stageFiles: s.stageFiles,
    unstageFiles: s.unstageFiles,
    discardChanges: s.discardChanges,
  })))

  const modified = useMemo(() => (status?.modified || []).filter((f) => !(status?.staged || []).includes(f)), [status])
  const untracked = useMemo(() => status?.not_added || [], [status])
  const staged = useMemo(() => status?.staged || [], [status])
  const conflicts = useMemo(() => status?.conflicts || [], [status])

  const toggle = useCallback((f: string) => {
    status?.staged.includes(f) ? unstageFiles([f]) : stageFiles([f])
  }, [status, stageFiles, unstageFiles])

  const hasConflicts = conflicts.length > 0
  const hasStaged = staged.length > 0
  const hasChanges = modified.length + untracked.length > 0
  const totalChanges = modified.length + untracked.length + staged.length + conflicts.length

  if (totalChanges === 0 && !loading) {
    return <EmptyState icon={<I.File s={22} />} text="Clean working tree" />
  }

  return (
    <div style={{
      ...CARD.surface,
      border: `1px solid ${GIT.cardBorder}`,
    }}>
      {hasConflicts && (
        <>
          {conflicts.map((f) => <FileRow key={f} filePath={f} statusCode="UU" staged={false} onToggle={() => {}} onShowDiff={() => onShowDiff(f, false)} />)}
        </>
      )}
      {hasStaged && (
        <>
          {staged.map((f) => <FileRow key={f} filePath={f} statusCode="M" staged onToggle={() => toggle(f)} onShowDiff={() => onShowDiff(f, true)} />)}
        </>
      )}
      {hasStaged && hasChanges && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '0 14px' }} />
      )}
      {hasChanges && (
        <>
          {modified.map((f) => <FileRow key={f} filePath={f} statusCode="M" staged={false} onToggle={() => toggle(f)} onShowDiff={() => onShowDiff(f, false)} onDiscard={() => discardChanges([f], true)} />)}
          {untracked.map((f) => <FileRow key={f} filePath={f} statusCode="??" staged={false} onToggle={() => toggle(f)} onShowDiff={() => onShowDiff(f, false)} onDiscard={() => discardChanges([f], false)} />)}
        </>
      )}
    </div>
  )
}

function BranchesTab() {
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
    <div className="flex flex-col">
      {branches.map((b) => (
        <div key={b.name}
          className="flex items-center gap-2 w-full transition-colors group cursor-pointer"
          style={{ padding: '4px 14px', minHeight: 28, borderBottom: `1px solid ${GIT.rowBorder}` }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container, rgba(0,0,0,0.03))' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <button onClick={() => checkout(b.name)} className="flex-1 flex items-center gap-2 min-w-0">
            <span className="shrink-0 flex items-center justify-center" style={{ width: 16, height: 16 }}>
              {b.current ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill={GIT.accent}>
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="4" fill="var(--bg-surface)" />
                </svg>
              ) : (
                <I.Branch s={12} />
              )}
            </span>
            <span style={{ fontSize: 12, color: b.current ? 'var(--text-on-surface)' : GIT.mutedSub, fontWeight: b.current ? 600 : 400, fontFamily: GIT.fontMono }} className="truncate">{b.name}</span>
          </button>
          {!b.current && (
            <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              {del === b.name ? (
                <>
                  <button onClick={() => { deleteBranch(b.name); setDel(null) }} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, color: GIT.error, background: 'color-mix(in srgb, var(--text-red, #f87171) 12%, transparent)' }}>Delete</button>
                  <button onClick={() => setDel(null)} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, color: GIT.mutedSub }}>Cancel</button>
                </>
              ) : (
                <button onClick={() => setDel(b.name)} className="p-1 rounded-md hover:bg-[var(--bg-surface-container)]" style={{ color: GIT.mutedSub }}><I.Trash s={11} /></button>
              )}
            </div>
          )}
        </div>
      ))}
      <AnimatePresence>
        {showNew ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex gap-2 px-4 py-3 overflow-hidden" style={{ borderTop: `1px solid ${GIT.rowBorder}` }}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="New branch name" autoFocus
              className="flex-1 text-[11px] outline-none rounded-md px-2.5 py-1.5 transition-all focus:ring-1 focus:ring-[var(--accent-primary)]"
              style={{ background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: `1px solid ${GIT.rowBorder}` }}
              onKeyDown={(e) => { if (e.key === 'Enter') doCreate() }} />
            <button onClick={doCreate} disabled={!name.trim()} className="text-[11px] font-semibold rounded-md px-3 py-1.5" style={{ background: GIT.accent, color: '#fff', border: 'none' }}>Create</button>
            <button onClick={() => setShowNew(false)} className="px-2" style={{ color: GIT.mutedSub }}><I.Close /></button>
          </motion.div>
        ) : (
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 w-full py-2.5 px-4 hover:bg-[var(--bg-surface-container-high)] transition-colors" style={{ fontSize: 11, color: GIT.accent, fontFamily: GIT.fontUi }}>
            <I.Plus s={9} /> New Branch
          </button>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Stashes Tab ───────────────────────────────────────

function StashesTab() {
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
    <div className="flex flex-col">
      <AnimatePresence>
        {show && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="px-4 py-3 overflow-hidden" style={{ borderBottom: `1px solid ${GIT.rowBorder}` }}>
            <input type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message (optional)" autoFocus
              className="w-full text-[11px] outline-none rounded-md px-2.5 py-1.5 mb-1.5 transition-all focus:ring-1 focus:ring-[var(--accent-primary)]"
              style={{ background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface)', border: `1px solid ${GIT.rowBorder}` }}
              onKeyDown={(e) => { if (e.key === 'Enter') doStash() }} />
            <label className="flex items-center gap-1.5 mb-2 cursor-pointer" style={{ fontSize: 10, color: GIT.mutedSub, fontFamily: GIT.fontUi }}>
              <input type="checkbox" checked={untracked} onChange={(e) => setUntracked(e.target.checked)} style={{ width: 12, height: 12, accentColor: GIT.accent }} />
              Include untracked
            </label>
            <button onClick={doStash} className="text-[11px] font-semibold rounded-md px-3 py-1.5 w-full transition-all hover:brightness-110" style={{ background: GIT.accent, color: '#fff', border: 'none' }}>
              {loading ? 'Stashing…' : 'Stash'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {stashes.length === 0 && !show && <EmptyState icon={<I.Archive s={18} />} text="No stashes" />}

      {stashes.map((s) => (
        <div key={s.hash}
          className="flex items-center gap-2 w-full transition-colors group cursor-pointer"
          style={{ padding: '4px 14px', minHeight: 28, borderBottom: `1px solid ${GIT.rowBorder}` }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container, rgba(0,0,0,0.03))' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 12, color: 'var(--text-on-surface)', fontFamily: GIT.fontUi, lineHeight: 1.4 }} className="truncate">{s.message}</div>
            <div className="flex items-center gap-2 mt-0.5" style={{ fontSize: 9, color: GIT.mutedSub, opacity: 0.45 }}>
              <span style={{ fontFamily: GIT.fontMono }}>{s.hash.slice(0, 7)}</span>
              <span>{new Date(s.date).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => stashPop(s.index)} className="p-1 rounded-md hover:bg-[var(--bg-surface-container)]" title="Pop" style={{ color: 'var(--text-on-surface)' }}><I.Down s={11} /></button>
            <button onClick={() => stashApply(s.index)} className="p-1 rounded-md hover:bg-[var(--bg-surface-container)]" title="Apply" style={{ color: GIT.mutedSub }}><I.Check s={11} /></button>
            <button onClick={() => stashDrop(s.index)} className="p-1 rounded-md hover:bg-[rgba(239,68,68,0.1)]" title="Drop" style={{ color: GIT.error }}><I.Trash s={11} /></button>
          </div>
        </div>
      ))}

      {!show && stashes.length > 0 && (
        <button onClick={() => setShow(true)} className="flex items-center gap-1.5 w-full py-2.5 px-4 hover:bg-[var(--bg-surface-container-high)] transition-colors" style={{ fontSize: 11, color: GIT.accent, fontFamily: GIT.fontUi }}>
          <I.Plus s={9} /> Stash Changes
        </button>
      )}
    </div>
  )
}

// ─── History Tab ───────────────────────────────────────

function HistoryTab() {
  const { log, selectedCommitHash, commitDiff, loading, fetchCommitDiff, clearCommitDiff } = useGitStore(useShallow((s) => ({
    log: s.log,
    selectedCommitHash: s.selectedCommitHash,
    commitDiff: s.commitDiff,
    loading: s.loading,
    fetchCommitDiff: s.fetchCommitDiff,
    clearCommitDiff: s.clearCommitDiff,
  })))

  if (log.length === 0) return <EmptyState icon={<I.History s={22} />} text="No commits yet" />

  return (
    <div className="flex flex-col">
      {log.slice(0, 30).map((c) => (
        <div key={c.hash}>
          <button onClick={() => selectedCommitHash === c.hash ? clearCommitDiff() : fetchCommitDiff(c.hash)}
            className="flex items-center gap-2 w-full text-left transition-colors cursor-pointer"
            style={{
              padding: '4px 14px',
              minHeight: 28,
              borderBottom: `1px solid ${GIT.rowBorder}`,
              background: selectedCommitHash === c.hash ? 'var(--bg-surface-container)' : 'transparent',
            }}
          >
            <span className="shrink-0" style={{ fontSize: 9, fontFamily: GIT.fontMono, color: GIT.accent, opacity: 0.55 }}>{c.hash.slice(0, 7)}</span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 12, color: 'var(--text-on-surface)', fontFamily: GIT.fontUi, lineHeight: 1.4 }} className="truncate">{c.message}</div>
              <div className="mt-0.5" style={{ fontSize: 9, color: GIT.mutedSub, opacity: 0.4 }}>{new Date(c.date).toLocaleDateString()}</div>
            </div>
            <motion.span animate={{ rotate: selectedCommitHash === c.hash ? 180 : 0 }} transition={{ duration: 0.15 }} className="shrink-0" style={{ color: GIT.mutedSub, opacity: 0.3 }}>
              <I.ChevronDn s={11} />
            </motion.span>
          </button>
          <AnimatePresence>
            {selectedCommitHash === c.hash && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div style={{ borderLeft: `2px solid ${GIT.rowBorder}`, margin: '2px 0 2px 24px', padding: '6px 0' }}>
                  {loading ? (
                    <div className="flex items-center justify-center py-3 gap-1.5" style={{ fontSize: 10, color: GIT.mutedSub, fontFamily: GIT.fontUi }}><I.Spinner s={9} /> Loading diff…</div>
                  ) : commitDiff ? commitDiff.split('\n').map((l, i) => <DiffLine key={i} line={l} />)
                  : <div className="text-center py-3" style={{ fontSize: 10, color: GIT.mutedSub, opacity: 0.35, fontFamily: GIT.fontUi }}>No diff to show</div>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}

// ─── Main ──────────────────────────────────────────────

const TAB_CONTENT: Record<GitTab, React.FC<{ onShowDiff: (f: string, s: boolean) => void }>> = {
  changes: FilesList,
  branches: BranchesTab,
  stashes: StashesTab,
  history: HistoryTab,
}

export function GitView() {
  const { status, loading, error, cwd, refresh, init, clearError, setCwd, push, pull, fetch: gitFetch, commit, setSelectedDiffFile, fetchDiff } = useGitStore(useShallow((s) => ({
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
    commit: s.commit,
    setSelectedDiffFile: s.setSelectedDiffFile,
    fetchDiff: s.fetchDiff,
  })))
  const chatConfig = useChatStore((s) => s.config)
  const setView = useChatStore((s) => s.setRightSidebarView)
  const theme = useChatStore((s) => s.theme)
  const isDark = theme !== 'light'
  const [activeTab, setActiveTab] = useState<GitTab>('changes')
  const [sync, setSync] = useState<'push' | 'pull' | 'fetch' | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => { if (chatConfig.cwd && chatConfig.cwd !== cwd) setCwd(chatConfig.cwd) }, [chatConfig.cwd, cwd, setCwd])
  useEffect(() => { if (cwd) refresh() }, [cwd])
  useEffect(() => { const unsub = (window as any).claude.onGitRefresh?.(() => useGitStore.getState().refresh()); return () => unsub?.() }, [])
  useEffect(() => { if (!cwd) return; const id = setInterval(() => useGitStore.getState().refresh(), 5000); return () => clearInterval(id) }, [cwd])
  useEffect(() => { if (!error) return; const t = setTimeout(clearError, 5000); return () => clearTimeout(t) }, [error, clearError])

  const branch = status?.current || ''

  const showDiff = useCallback((f: string, s: boolean) => {
    setSelectedDiffFile(f); fetchDiff([f], s); setView('diff')
  }, [setSelectedDiffFile, fetchDiff, setView])

  const doCommit = useCallback(async () => { if (!msg.trim()) return; await commit(msg.trim()); setMsg('') }, [msg, commit])

  const TabContent = TAB_CONTENT[activeTab]

  if (!cwd) return (
    <div className="flex items-center justify-center h-full">
      <div style={{ fontSize: 11, color: GIT.mutedSub, opacity: 0.5, fontFamily: GIT.fontUi }}>No workspace selected</div>
    </div>
  )

  if (error && !status) {
    if (error.toLowerCase().includes('not a git repository')) return (
      <div style={{ ...CARD.surface, overflow: 'visible', margin: '16px 8px', border: `1px solid ${GIT.cardBorder}` }}>
        <div className="flex flex-col items-center gap-3 py-8">
          <span style={{ color: GIT.mutedSub, opacity: 0.15, display: 'flex' }}><I.Git s={28} /></span>
          <div style={{ fontSize: 11, color: GIT.mutedSub, opacity: 0.5, fontFamily: GIT.fontUi }}>Not a git repository</div>
          <button onClick={init} disabled={loading}
            className="font-medium rounded-md px-4 py-2 transition-all hover:brightness-110 active:scale-95"
            style={{ fontSize: 12, background: GIT.accent, color: '#fff', border: 'none', fontFamily: GIT.fontUi }}
          >{loading ? 'Initializing…' : 'Init Repository'}</button>
        </div>
      </div>
    )
    return (
      <div style={{ ...CARD.surface, overflow: 'visible', margin: '16px 8px', border: `1px solid color-mix(in srgb, var(--text-red, #f87171) 30%, transparent)` }}>
        <div className="flex flex-col items-center gap-2 py-6 px-4">
          <span style={{ color: GIT.error, opacity: 0.6, display: 'flex' }}><I.Alert s={16} /></span>
          <div className="text-center leading-relaxed" style={{ fontSize: 11, color: GIT.error, opacity: 0.8, fontFamily: GIT.fontUi }}>{error}</div>
        </div>
      </div>
    )
  }

  if (loading && !status) return (
    <div className="flex items-center justify-center h-full">
      <div className="flex items-center gap-2" style={{ fontSize: 11, color: GIT.mutedSub, fontFamily: GIT.fontUi }}>
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
            <div style={{ margin: '4px 8px 0', padding: '8px 12px', background: 'color-mix(in srgb, var(--text-red, #f87171) 10%, transparent)', border: `1px solid color-mix(in srgb, var(--text-red, #f87171) 25%, transparent)`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <I.Alert s={11} />
              <span className="flex-1" style={{ fontSize: 10, color: GIT.error, fontFamily: GIT.fontUi }}>{error}</span>
              <button onClick={clearError} className="hover:opacity-70 transition-opacity" style={{ color: GIT.error }}><I.Close s={8} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Branch Hero — compact single row ── */}
      {branch && (
        <div className="flex flex-col shrink-0" style={{ padding: '7px 12px 0' }}>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0" style={{ color: GIT.accent }}><I.Branch s={13} /></span>
            <span className="truncate min-w-0 flex-1" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-on-surface)', fontFamily: GIT.fontMono }}>{branch}</span>
            {(status!.ahead > 0 || status!.behind > 0) && (
              <div className="flex items-center gap-1 shrink-0">
                {status!.ahead > 0 && (
                  <span className="flex items-center gap-0.5 tabular-nums px-1.5 py-0.5 rounded-full" style={{ fontSize: 9, fontWeight: 600, color: GIT.accent, background: 'color-mix(in srgb, var(--text-blue, #60a5fa) 12%, transparent)', fontFamily: GIT.fontUi }}>
                    <I.Up s={8} />{status!.ahead}
                  </span>
                )}
                {status!.behind > 0 && (
                  <span className="flex items-center gap-0.5 tabular-nums px-1.5 py-0.5 rounded-full" style={{ fontSize: 9, fontWeight: 600, color: GIT.error, background: 'color-mix(in srgb, var(--text-red, #f87171) 12%, transparent)', fontFamily: GIT.fontUi }}>
                    <I.Down s={8} />{status!.behind}
                  </span>
                )}
              </div>
            )}
            <div className="shrink-0 flex items-center gap-0.5" style={{ borderLeft: `1px solid ${GIT.rowBorder}`, paddingLeft: 8, marginLeft: 2 }}>
              <GlassIconBtn icon={<I.RotateCcw s={10} />} title="Refresh" onClick={refresh} disabled={loading} />
              <GlassIconBtn icon={sync === 'pull' ? <I.Spinner s={9} /> : <I.Down s={9} />} title="Pull" onClick={() => { setSync('pull'); pull().finally(() => setSync(null)) }} disabled={!!sync} />
              <GlassIconBtn icon={sync === 'push' ? <I.Spinner s={9} /> : <I.Up s={9} />} title="Push" onClick={() => { setSync('push'); push().finally(() => setSync(null)) }} disabled={!!sync} />
              <GlassIconBtn icon={sync === 'fetch' ? <I.Spinner s={9} /> : <I.Fetch s={9} />} title="Fetch" onClick={() => { setSync('fetch'); gitFetch().finally(() => setSync(null)) }} disabled={!!sync} />
            </div>
          </div>
          <div style={{ margin: '6px 10% 0', borderTop: `2px solid ${GIT.rowBorder}` }} />
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div className="flex items-center shrink-0" style={{ padding: '4px 12px 6px 16px', gap: 0 }}>
        {TABS.map((t, i) => (
          <span key={t.id} className="flex items-center shrink-0">
            {i > 0 && <span style={{ borderLeft: `1px solid ${GIT.rowBorder}`, height: 14, margin: '0 8px', opacity: 0.5 }} />}
            <button
              onClick={() => setActiveTab(t.id)}
              className="flex items-center gap-1.5 px-1.5 py-1.5 rounded-md transition-all duration-100"
              style={{
                fontSize: 11,
                fontWeight: 500,
                fontFamily: GIT.fontUi,
                color: activeTab === t.id ? GIT.accent : GIT.mutedSub,
                background: activeTab === t.id ? 'color-mix(in srgb, var(--accent-primary) 8%, transparent)' : 'transparent',
              }}
            >
              {t.icon}
              {t.label}
            </button>
          </span>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ minHeight: 0, paddingTop: 2 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {activeTab === 'changes' ? (
              <FilesList onShowDiff={showDiff} />
            ) : activeTab === 'branches' ? (
              <BranchesTab />
            ) : activeTab === 'stashes' ? (
              <StashesTab />
            ) : (
              <HistoryTab />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Commit Area (sticky bottom, only for Changes tab) ── */}
      {activeTab === 'changes' && (
        <div className="shrink-0" style={{ padding: '8px 6px 8px', borderTop: `1.5px solid ${GIT.cardBorder}` }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--bg-surface-container-high)',
            border: `1px solid ${GIT.rowBorder}`,
            borderRadius: 10,
            padding: '6px 8px',
          }}>
            <textarea
              value={msg} onChange={(e) => setMsg(e.target.value)}
              placeholder="Commit message…"
              rows={1}
              className="flex-1 text-[12px] outline-none resize-none bg-transparent"
              style={{ color: 'var(--text-on-surface)', minHeight: 20, maxHeight: 80, fontFamily: GIT.fontUi }}
              onInput={(e) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doCommit() }
              }}
            />
            <button onClick={doCommit} disabled={!msg.trim() || loading}
              className="shrink-0 flex items-center justify-center rounded-lg transition-all duration-100 disabled:opacity-30 hover:brightness-110 active:scale-95"
              style={{
                background: GIT.accent, color: '#fff', border: 'none',
                cursor: loading ? 'wait' : 'pointer',
                width: 30, height: 30,
              }}
            >{loading ? <I.Spinner s={10} /> : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <line x1="1.05" y1="12" x2="7" y2="12" />
                <line x1="17.01" y1="12" x2="22.96" y2="12" />
              </svg>
            )}</button>
          </div>
        </div>
      )}
    </div>
  )
}
