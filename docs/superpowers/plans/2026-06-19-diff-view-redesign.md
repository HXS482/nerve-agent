# Diff View Unified Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat raw-diff rendering in both History tab and Changes tab with a structured diff view featuring a diff parser, line numbers, file headers with stats, and file navigation for multi-file commits.

**Architecture:** A pure `parseUnifiedDiff()` function converts raw git diff output into structured `ParsedDiff` data. Three new React components consume this data: `DiffLineView` (single line with line numbers), `DiffFileHeader` (file path + stats), and `CommitDiffView` (file nav + file diff for History tab). The existing `DiffView.tsx` for Changes tab is updated to use `DiffLineView`. Old `DiffLine.tsx` is deleted.

**Tech Stack:** React 19, TypeScript, Zustand (gitStore), Tailwind CSS v4, framer-motion (existing)

---

### Task 1: Diff Parser

**Files:**
- Create: `src/renderer/lib/diff-parser.ts`

- [ ] **Step 1: Create the diff parser module**

```ts
// src/renderer/lib/diff-parser.ts

export interface DiffLine {
  type: 'add' | 'delete' | 'context' | 'hunk'
  content: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath: string
  status: 'M' | 'A' | 'D' | 'R' | 'C'
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

export interface ParsedDiff {
  files: DiffFile[]
}

/**
 * Parse a `@@ ... @@` hunk header, returning [oldStart, oldCount, newStart, newCount].
 * Falls back to [0,0,0,0] on malformed headers.
 */
function parseHunkHeader(header: string): [number, number, number, number] {
  const m = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  if (!m) return [0, 0, 0, 0]
  return [
    parseInt(m[1], 10),
    m[2] !== undefined ? parseInt(m[2], 10) : 1,
    parseInt(m[3], 10),
    m[4] !== undefined ? parseInt(m[4], 10) : 1,
  ]
}

function parseHunk(hunkLines: string[], oldStart: number, newStart: number): DiffHunk {
  const header = hunkLines[0] ?? ''
  const lines: DiffLine[] = []
  let oldLine = oldStart
  let newLine = newStart

  for (let i = 1; i < hunkLines.length; i++) {
    const raw = hunkLines[i]
    if (raw.startsWith('+')) {
      lines.push({ type: 'add', content: raw.slice(1), oldLine: null, newLine: newLine++ })
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'delete', content: raw.slice(1), oldLine: oldLine++, newLine: null })
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" — skip, not a real line
      continue
    } else {
      // context line (starts with space or is empty)
      const content = raw.startsWith(' ') ? raw.slice(1) : raw
      lines.push({ type: 'context', content, oldLine: oldLine++, newLine: newLine++ })
    }
  }

  return { header, lines }
}

function parseFileChunk(chunk: string): DiffFile | null {
  const lines = chunk.split('\n')
  if (lines.length === 0) return null

  // Extract paths from diff --git a/... b/... line
  const diffGitLine = lines[0]
  const gitMatch = diffGitLine.match(/^diff --git a\/(.*) b\/(.*)$/)
  let path = gitMatch ? gitMatch[2] : ''
  let oldPath = gitMatch ? gitMatch[1] : path

  // Check for rename/copy
  let status: DiffFile['status'] = 'M'
  let additions = 0
  let deletions = 0

  for (const line of lines) {
    if (line.startsWith('rename from ')) {
      status = 'R'
      oldPath = line.slice('rename from '.length)
    } else if (line.startsWith('rename to ')) {
      path = line.slice('rename to '.length)
    } else if (line.startsWith('copy from ')) {
      status = 'C'
      oldPath = line.slice('copy from '.length)
    } else if (line.startsWith('copy to ')) {
      path = line.slice('copy to '.length)
    } else if (line.startsWith('new file')) {
      status = 'A'
    } else if (line.startsWith('deleted file')) {
      status = 'D'
    }
  }

  // Extract --- / +++ paths if available (more reliable than diff --git for renames)
  for (const line of lines) {
    if (line.startsWith('--- a/')) {
      oldPath = line.slice(6)
    } else if (line.startsWith('--- /dev/null')) {
      status = 'A'
    } else if (line.startsWith('+++ b/')) {
      path = line.slice(6)
    } else if (line.startsWith('+++ /dev/null')) {
      status = 'D'
    }
  }

  // Split into hunks by @@ markers
  const hunks: DiffHunk[] = []
  let currentHunkLines: string[] = []
  let inHunk = false

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (inHunk && currentHunkLines.length > 0) {
        const header = currentHunkLines[0]
        const [oldStart, , newStart] = parseHunkHeader(header)
        const hunk = parseHunk(currentHunkLines, oldStart, newStart)
        additions += hunk.lines.filter((l) => l.type === 'add').length
        deletions += hunk.lines.filter((l) => l.type === 'delete').length
        hunks.push(hunk)
      }
      currentHunkLines = [line]
      inHunk = true
    } else if (inHunk) {
      currentHunkLines.push(line)
    }
  }

  // Push last hunk
  if (inHunk && currentHunkLines.length > 0) {
    const header = currentHunkLines[0]
    const [oldStart, , newStart] = parseHunkHeader(header)
    const hunk = parseHunk(currentHunkLines, oldStart, newStart)
    additions += hunk.lines.filter((l) => l.type === 'add').length
    deletions += hunk.lines.filter((l) => l.type === 'delete').length
    hunks.push(hunk)
  }

  if (hunks.length === 0) return null

  return { path, oldPath, status, additions, deletions, hunks }
}

export function parseUnifiedDiff(raw: string): ParsedDiff {
  if (!raw) return { files: [] }

  const lines = raw.split('\n')
  const fileChunks: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      fileChunks.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) {
    fileChunks.push(current.join('\n'))
  }

  const files = fileChunks
    .map(parseFileChunk)
    .filter((f): f is DiffFile => f !== null)

  return { files }
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `npx tsc --noEmit src/renderer/lib/diff-parser.ts --esModuleInterop --moduleResolution node --target es2020 --module es2020 --jsx react-jsx --strict`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/diff-parser.ts
git commit -m "feat(git): add unified diff parser"
```

---

### Task 2: DiffLineView Component

**Files:**
- Create: `src/renderer/components/DiffLineView.tsx`

- [ ] **Step 1: Create the DiffLineView component**

```tsx
// src/renderer/components/DiffLineView.tsx

import type { DiffLine } from '../lib/diff-parser'

const COLORS = {
  addBg: 'rgba(63, 185, 80, 0.10)',
  addText: '#7ee787',
  delBg: 'rgba(248, 81, 73, 0.10)',
  delText: '#ff7b72',
  hunkText: '#79c0ff',
  hunkBg: 'rgba(6, 182, 212, 0.06)',
  contextText: 'var(--text-on-surface)',
  gutterText: 'var(--text-outline-variant)',
}

export function DiffLineView({ line }: { line: DiffLine }) {
  if (line.type === 'hunk') {
    return (
      <div
        className="flex font-mono text-[11px] leading-[18px]"
        style={{
          background: COLORS.hunkBg,
          color: COLORS.hunkText,
          borderTop: '1px solid rgba(6, 182, 212, 0.12)',
          padding: '2px 0',
        }}
      >
        <Gutter oldLine={null} newLine={null} />
        <span className="truncate px-2 opacity-80">{line.content}</span>
      </div>
    )
  }

  const isAdd = line.type === 'add'
  const isDel = line.type === 'delete'
  const bg = isAdd ? COLORS.addBg : isDel ? COLORS.delBg : 'transparent'
  const color = isAdd ? COLORS.addText : isDel ? COLORS.delText : COLORS.contextText
  const prefix = isAdd ? '+' : isDel ? '-' : ' '

  return (
    <div className="flex font-mono text-[11px] leading-[18px]" style={{ background: bg }}>
      <Gutter oldLine={line.oldLine} newLine={line.newLine} />
      <span className="shrink-0 w-4 text-center select-none opacity-50" style={{ color }}>{prefix}</span>
      <span className="flex-1 truncate pr-3" style={{ color }}>{line.content}</span>
    </div>
  )
}

function Gutter({ oldLine, newLine }: { oldLine: number | null; newLine: number | null }) {
  return (
    <>
      <span
        className="shrink-0 text-right select-none px-1"
        style={{ width: 36, color: COLORS.gutterText, opacity: oldLine != null ? 0.5 : 0 }}
      >
        {oldLine ?? ''}
      </span>
      <span
        className="shrink-0 text-right select-none px-1"
        style={{ width: 36, color: COLORS.gutterText, opacity: newLine != null ? 0.5 : 0 }}
      >
        {newLine ?? ''}
      </span>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/DiffLineView.tsx
git commit -m "feat(git): add DiffLineView component with line numbers"
```

---

### Task 3: DiffFileHeader Component

**Files:**
- Create: `src/renderer/components/DiffFileHeader.tsx`

- [ ] **Step 1: Create the DiffFileHeader component**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/DiffFileHeader.tsx
git commit -m "feat(git): add DiffFileHeader component"
```

---

### Task 4: CommitDiffView Component (History tab)

**Files:**
- Create: `src/renderer/components/CommitDiffView.tsx`

- [ ] **Step 1: Create the CommitDiffView component**

```tsx
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

  // Clamp index
  const idx = Math.min(selectedIdx, parsed.files.length - 1)
  const currentFile = parsed.files[idx]

  return (
    <div className="flex flex-col">
      {/* File nav — horizontal scrollable row */}
      {parsed.files.length > 1 && (
        <FileNav files={parsed.files} selectedIdx={idx} onSelect={setSelectedIdx} />
      )}

      {/* File header + hunks */}
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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/CommitDiffView.tsx
git commit -m "feat(git): add CommitDiffView with file navigation"
```

---

### Task 5: Wire CommitDiffView into HistoryTab

**Files:**
- Modify: `src/renderer/components/GitView.tsx`

- [ ] **Step 1: Update HistoryTab to use CommitDiffView**

In `GitView.tsx`, make these changes:

**a)** Add import at the top (after the existing `DiffLine` import on line 6):
```ts
import { CommitDiffView } from './CommitDiffView'
```

**b)** Remove the old `DiffLine` import (line 6):
```ts
// DELETE: import { DiffLine } from './DiffLine'
```

**c)** Replace lines 495-499 (the diff rendering inside HistoryTab's expandable section):

Current code:
```tsx
                  {loading ? (
                    <div className="flex items-center justify-center py-3 gap-1.5" style={{ fontSize: 10, color: GIT.mutedSub, fontFamily: GIT.fontUi }}><I.Spinner s={9} /> Loading diff…</div>
                  ) : commitDiff ? commitDiff.split('\n').map((l, i) => <DiffLine key={i} line={l} />)
                  : <div className="text-center py-3" style={{ fontSize: 10, color: GIT.mutedSub, opacity: 0.35, fontFamily: GIT.fontUi }}>No diff to show</div>}
```

Replace with:
```tsx
                  {loading ? (
                    <div className="flex items-center justify-center py-3 gap-1.5" style={{ fontSize: 10, color: GIT.mutedSub, fontFamily: GIT.fontUi }}><I.Spinner s={9} /> Loading diff…</div>
                  ) : commitDiff ? (
                    <CommitDiffView commitDiff={commitDiff} />
                  ) : (
                    <div className="text-center py-3" style={{ fontSize: 10, color: GIT.mutedSub, opacity: 0.35, fontFamily: GIT.fontUi }}>No diff to show</div>
                  )}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --project tsconfig.json` (or let Vite HMR report errors)
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/GitView.tsx
git commit -m "feat(git): wire CommitDiffView into HistoryTab"
```

---

### Task 6: Upgrade Changes tab DiffView

**Files:**
- Modify: `src/renderer/components/DiffView.tsx`

- [ ] **Step 1: Update DiffView to use DiffLineView + parser**

Replace the contents of `DiffView.tsx`:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/DiffView.tsx
git commit -m "feat(git): upgrade Changes tab DiffView with parser and line numbers"
```

---

### Task 7: Delete old DiffLine and verify

**Files:**
- Delete: `src/renderer/components/DiffLine.tsx`
- Verify: no remaining imports of `DiffLine`

- [ ] **Step 1: Search for remaining DiffLine imports**

Run: `grep -r "DiffLine" src/renderer/`
Expected: no results (all replaced by DiffLineView)

- [ ] **Step 2: Delete old DiffLine.tsx**

```bash
rm src/renderer/components/DiffLine.tsx
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add -A src/renderer/components/DiffLine.tsx
git commit -m "chore(git): remove old DiffLine component"
```

---

### Task 8: Manual verification

- [ ] **Step 1: Start dev server and test History tab**

Run: `npm run dev`

In the app:
1. Go to Git panel → History tab
2. Click any commit to expand
3. Verify: file nav appears (if multi-file), file header shows path + stats, lines have line numbers, add/delete coloring is correct

- [ ] **Step 2: Test Changes tab**

1. Go to Git panel → Changes tab
2. Click any modified file to view diff
3. Verify: file header shows path + stats, lines have line numbers, stage button still works

- [ ] **Step 3: Test edge cases**

1. Single-file commit: file nav should be hidden
2. New file (A): all lines green, oldLine all null
3. Deleted file (D): all lines red, newLine all null
4. Rename (R): old path shown, status badge shows R
5. Empty diff: "No diff to show" message
