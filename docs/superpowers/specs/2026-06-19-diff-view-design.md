# Diff View Unified Redesign

## Problem

History tab commit diff renders raw `git show` output as flat lines — no file separation, no line numbers, no file navigation. Changes tab diff also lacks line numbers. Both views need a unified, structured diff component.

## Scope

- **In**: History tab commit diff, Changes tab file diff, shared diff parser and line renderer
- **Out**: side-by-side view, syntax highlighting, intra-line word diff, diff collapsing/minimap

## Design

### 1. Diff Parser — `src/renderer/lib/diff-parser.ts`

Pure function: `parseUnifiedDiff(raw: string): ParsedDiff`

```ts
interface DiffLine {
  type: 'add' | 'delete' | 'context' | 'hunk' | 'header'
  content: string
  oldLine: number | null  // null for add lines
  newLine: number | null  // null for delete lines
}

interface DiffHunk {
  header: string          // e.g. "@@ -10,6 +10,8 @@ function foo()"
  lines: DiffLine[]
}

interface DiffFile {
  path: string            // new path (or old for pure deletes)
  oldPath: string         // for renames
  status: 'M' | 'A' | 'D' | 'R' | 'C'
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

type ParsedDiff = { files: DiffFile[] }
```

Parse logic:
- Split by `diff --git` boundaries to get per-file chunks
- Extract `---`/`+++` for paths, `rename from`/`rename to` for renames
- Split each file chunk by `@@` to get hunks
- Track line numbers: maintain `oldLine`/`newLine` counters, increment on context/delete and context/add respectively
- Count additions/deletions per file

### 2. DiffLineView — replace `DiffLine.tsx`

Enhanced single-line renderer:

- **Gutter**: two columns — old line number (right-aligned, muted) + new line number (right-aligned, muted)
- **Prefix**: `+` / `-` / space indicator (16px wide)
- **Content**: monospace, colored by type
  - `add`: green bg `rgba(63,185,80,0.12)`, green text `#7ee787`
  - `delete`: red bg `rgba(248,81,73,0.12)`, red text `#ff7b72`
  - `hunk`: cyan text `#79c0ff`, no bg, border-top separator
  - `context`: default text color, no bg
  - `header`: muted, 10px, skip in rendering (handled by file header component)

Gutter widths: 36px per number column, 16px prefix = 88px total gutter.

### 3. DiffFileHeader — file header component

Shown above each file's hunks:
- File path (truncated, monospace)
- Status badge (M/A/D/R/C) — reuse existing GIT.badge colors
- Stats: `+N` green, `-N` red
- Border-bottom separator

### 4. CommitDiffView — History tab component

Replaces the current inline `commitDiff.split('\n').map(DiffLine)` at `GitView.tsx:498`.

Structure:
```
┌─ FileNav ──────────────────────────┐
│ file-a.ts  M +5 -2  (active)      │
│ file-b.ts  A +12    (clickable)    │
│ file-c.ts  D -8     (clickable)    │
└────────────────────────────────────┘
┌─ DiffFileHeader ───────────────────┐
│ src/file-a.ts        +5 -2        │
└────────────────────────────────────┘
┌─ HunkHeader ───────────────────────┐
│ @@ -10,6 +10,8 @@ function foo()  │
├─ DiffLineView ×N ─────────────────┤
│  10  10   context line             │
│  11      - old line                │
│      11  + new line                │
│ ...                                │
└────────────────────────────────────┘
```

- FileNav: horizontal scrollable row of file chips, click to switch
- Default: first file selected
- State: `selectedFileIndex` local to CommitDiffView
- Parse once on `commitDiff` change, memoize with `useMemo`

### 5. Changes tab upgrade — `DiffView.tsx`

Replace `DiffLine` usage with new `DiffLineView`. The existing header (filename + stage button + close) stays. The file nav is not needed here since Changes tab already shows one file at a time.

### 6. Cleanup

- Delete old `DiffLine.tsx`
- Update imports in `GitView.tsx` and `DiffView.tsx`

## Files to modify

| File | Action |
|------|--------|
| `src/renderer/lib/diff-parser.ts` | **New** — diff parser |
| `src/renderer/components/DiffLineView.tsx` | **New** — enhanced line renderer |
| `src/renderer/components/DiffFileHeader.tsx` | **New** — file header with stats |
| `src/renderer/components/CommitDiffView.tsx` | **New** — commit diff with file nav |
| `src/renderer/components/GitView.tsx` | **Edit** — HistoryTab uses CommitDiffView |
| `src/renderer/components/DiffView.tsx` | **Edit** — use DiffLineView |
| `src/renderer/components/DiffLine.tsx` | **Delete** |

## Non-goals

- No side-by-side view
- No syntax highlighting on diff content
- No intra-line word-level highlighting
- No diff collapsing / context expansion
- No minimap
