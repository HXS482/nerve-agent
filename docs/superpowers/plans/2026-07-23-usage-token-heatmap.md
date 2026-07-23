# Usage Token Heatmap + Active Hours Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the left-sidebar usage heatmap reflect real token consumption (not message count), fix the UTC/local timezone inconsistency, and add a click-to-expand detail view showing a day × 3-hour-slot activity grid for the last 7 days.

**Architecture:** Backend (`FileSessionStore.getUsageStats`) gains a new `dailyHourlyTokens` field and switches all date bucketing to local time. Frontend (`UsageStatsPanel`) gains a two-state view (`heatmap` ↔ `detail`): the existing 53-week heatmap now uses token intensity and becomes clickable; clicking overlays a 7-day × 8-slot active-hours grid with a peak summary. No IPC/preload/sidebar changes — `UsageStats` passes through unchanged.

**Tech Stack:** TypeScript, Electron, React 19, `motion/react` (animation), vitest (tests), existing glassmorphism CSS conventions.

**Spec:** `docs/superpowers/specs/2026-07-21-usage-stats-token-heatmap-design.md`

**Git workflow (per user):** Work on a new branch `feature/usage-token-heatmap` off `master`; push to origin; open a PR; merge to remote `master` via `gh pr merge`; then `git checkout master && git pull` to sync local. See the final task.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/shared/types.ts` | Type contract for `UsageStats` | Add `dailyHourlyTokens` field |
| `src/main/session-store.ts` | Aggregation in `getUsageStats()` | Local-time dateKey; hoist per-entry vars; fill new field; return it |
| `src/main/__tests__/session-store.usage-stats.test.ts` | Unit tests for new aggregation | NEW file |
| `src/renderer/components/UsageStatsPanel.tsx` | Sidebar panel UI | Two-state view; token metric; summary rows; detail grid; `formatTokens` helper |

Each backend task produces a testable, committable unit. The UI task is one larger task (single component file, cohesive change) but is broken into steps with a manual verification checkpoint before commit.

---

## Task 1: Add `dailyHourlyTokens` to `UsageStats` type

**Files:**
- Modify: `src/shared/types.ts` (the `UsageStats` interface, around lines 303-317)

- [ ] **Step 1: Add the field to the interface**

In `src/shared/types.ts`, locate the `UsageStats` interface and add `dailyHourlyTokens` as the last field (keep all existing fields and their order):

```ts
export interface UsageStats {
  totalSessions: number
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  dailyActivity: Record<string, { messages: number; tokens: number }>
  hourlyDistribution: number[]
  modelUsage: Record<string, number>
  firstSessionAt: number
  /** Local date `YYYY-MM-DD` → 24-element array of token counts per hour. */
  dailyHourlyTokens: Record<string, number[]>
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors. (If `session-store.ts` reports that its return object is missing `dailyHourlyTokens`, that's expected — Task 2 adds it. If the typecheck surfaces *pre-existing* unrelated errors, note them and proceed; only newly-introduced errors matter.)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(usage-stats): add dailyHourlyTokens field to UsageStats type"
```

---

## Task 2: Fill `dailyHourlyTokens` + fix local timezone in `getUsageStats()`

This is the core backend change. We do it test-first: write the failing test, run it, implement, run again.

**Files:**
- Create: `src/main/__tests__/session-store.usage-stats.test.ts`
- Modify: `src/main/session-store.ts` (the `getUsageStats()` method, lines ~255-335)

- [ ] **Step 1: Write the failing test**

Create `src/main/__tests__/session-store.usage-stats.test.ts`:

```ts
/**
 * FileSessionStore.getUsageStats() — aggregation tests
 * Verifies dailyHourlyTokens population + local-timezone dateKey.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileSessionStore } from '../session-store'

describe('FileSessionStore.getUsageStats', () => {
  let baseDir: string
  let store: FileSessionStore

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'nerve-usage-'))
    store = await FileSessionStore.create(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('fills dailyHourlyTokens with per-hour token sums', async () => {
    // Two assistant entries on the same local day, at hours 10 and 15
    await store.append({ sessionId: 's1' }, [
      {
        type: 'assistant',
        timestamp: new Date(2026, 6, 15, 10, 30).toISOString(), // local 2026-07-15 10:30
        usage: { inputTokens: 100, outputTokens: 50 },
        message: { content: 'a' },
      },
      {
        type: 'assistant',
        timestamp: new Date(2026, 6, 15, 15, 0).toISOString(), // local 2026-07-15 15:00
        usage: { inputTokens: 200, outputTokens: 100 },
        message: { content: 'b' },
      },
    ])

    const stats = await store.getUsageStats()

    expect(stats.dailyHourlyTokens['2026-07-15']).toBeDefined()
    const hours = stats.dailyHourlyTokens['2026-07-15']
    expect(hours.length).toBe(24)
    // hour 10 = 150 tokens, hour 15 = 300 tokens, all others 0
    expect(hours[10]).toBe(150)
    expect(hours[15]).toBe(300)
    expect(hours[0]).toBe(0)
    expect(hours[23]).toBe(0)
  })

  it('uses LOCAL time for the dateKey (boundary case)', async () => {
    // This test only fails under UTC+X. Construct a timestamp at 23:00 local
    // on 2026-07-15; under UTC bucketing (if TZ offset pushes it past midnight)
    // the key might land on 07-16. We assert it stays on 07-15 in local time.
    // NOTE: JavaScript Date(2026,6,15,23,0) is inherently local, and
    // toISOString() converts to UTC — but the *aggregation* must bucket by
    // local hour, so the key is derived from the LOCAL components.
    await store.append({ sessionId: 's1' }, [
      {
        type: 'assistant',
        timestamp: new Date(2026, 6, 15, 23, 30).toISOString(), // local 2026-07-15 23:30
        usage: { inputTokens: 10, outputTokens: 5 },
        message: { content: 'a' },
      },
    ])

    const stats = await store.getUsageStats()

    // Local-hour bucketing: the entry's local hour is 23, local date is 07-15.
    expect(stats.dailyHourlyTokens['2026-07-15']).toBeDefined()
    expect(stats.dailyHourlyTokens['2026-07-15'][23]).toBe(15)
    // The entry should NOT have leaked into 07-16's bucket.
    expect(stats.dailyHourlyTokens['2026-07-16']).toBeUndefined()
  })

  it('still computes correct totalInputTokens / totalOutputTokens', async () => {
    await store.append({ sessionId: 's1' }, [
      {
        type: 'assistant',
        timestamp: new Date(2026, 6, 15, 10, 0).toISOString(),
        usage: { inputTokens: 100, outputTokens: 50 },
        message: { content: 'a' },
      },
      {
        type: 'assistant',
        timestamp: new Date(2026, 6, 16, 10, 0).toISOString(),
        usage: { inputTokens: 200, outputTokens: 100 },
        message: { content: 'b' },
      },
    ])

    const stats = await store.getUsageStats()

    expect(stats.totalInputTokens).toBe(300)
    expect(stats.totalOutputTokens).toBe(150)
    expect(stats.dailyActivity['2026-07-15'].tokens).toBe(150)
    expect(stats.dailyActivity['2026-07-16'].tokens).toBe(300)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/__tests__/session-store.usage-stats.test.ts`
Expected: FAIL.
- The first test fails because `stats.dailyHourlyTokens` is `undefined` (field not yet returned).
- The boundary test fails for the same reason (and would also catch a UTC-vs-local regression once implemented).

- [ ] **Step 3: Implement — hoist per-entry vars, switch to local dateKey, fill new field**

In `src/main/session-store.ts`, inside `getUsageStats()`, make these changes:

**(a) Add a local-time dateKey helper at the top of the method** (right after the `firstSessionAt` initializer, before the `for` loop):

```ts
const localDateKey = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
```

**(b) Add the accumulator** next to the other accumulators (`const modelUsage = ...` line):

```ts
const dailyHourlyTokens: Record<string, number[]> = {}
```

**(c) Hoist shared per-entry values out of the inner `if` blocks.** Currently the per-entry loop looks like:

```ts
for (const entry of entries) {
  const e = entry as Record<string, unknown>
  const rawTs = e.timestamp
  const ts = typeof rawTs === 'number' ? rawTs
    : typeof rawTs === 'string' ? new Date(rawTs).getTime() || mtime
    : mtime

  if (e.type === 'user' || e.type === 'assistant') {
    totalMessages++
    const d = new Date(ts)
    const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    if (!dailyActivity[dateKey]) dailyActivity[dateKey] = { messages: 0, tokens: 0 }
    dailyActivity[dateKey].messages++

    const hour = new Date(ts).getHours()
    hourlyDistribution[hour]++
  }

  if (e.type === 'assistant') {
    const usage = e.usage as Record<string, number> | undefined
    if (usage) {
      const inp = usage.inputTokens || 0
      const out = usage.outputTokens || 0
      totalInputTokens += inp
      totalOutputTokens += out
      const td = new Date(ts)
      const dateKey = `${td.getUTCFullYear()}-${String(td.getUTCMonth() + 1).padStart(2, '0')}-${String(td.getUTCDate()).padStart(2, '0')}`
      if (dailyActivity[dateKey]) dailyActivity[dateKey].tokens += inp + out
    }
    // ... model block unchanged ...
  }
}
```

Replace the per-entry loop body (from `const e = entry as Record<string, unknown>` through the end of the second `if` block) with:

```ts
const e = entry as Record<string, unknown>
const rawTs = e.timestamp
const ts = typeof rawTs === 'number' ? rawTs
  : typeof rawTs === 'string' ? new Date(rawTs).getTime() || mtime
  : mtime

// Hoisted once per entry; reused by message-count + token blocks.
const dateKey = localDateKey(ts)
const hour = new Date(ts).getHours()

if (e.type === 'user' || e.type === 'assistant') {
  totalMessages++
  if (!dailyActivity[dateKey]) dailyActivity[dateKey] = { messages: 0, tokens: 0 }
  dailyActivity[dateKey].messages++
  hourlyDistribution[hour]++
}

if (e.type === 'assistant') {
  const usage = e.usage as Record<string, number> | undefined
  if (usage) {
    const inp = usage.inputTokens || 0
    const out = usage.outputTokens || 0
    totalInputTokens += inp
    totalOutputTokens += out
    if (!dailyActivity[dateKey]) dailyActivity[dateKey] = { messages: 0, tokens: 0 }
    dailyActivity[dateKey].tokens += inp + out
    if (!dailyHourlyTokens[dateKey]) dailyHourlyTokens[dateKey] = new Array(24).fill(0)
    dailyHourlyTokens[dateKey][hour] += inp + out
  }
  const model = e.model as string | undefined
  if (model) {
    const alias = model.includes('/') ? model.split('/').pop()! : model
    modelUsage[alias] = (modelUsage[alias] || 0) + 1
  }
}
```

Notes on what changed:
- `dateKey` and `hour` are computed once per entry (DRY).
- `localDateKey(ts)` replaces both `getUTC*` constructions → consistent local time.
- The token block now defensively ensures `dailyActivity[dateKey]` exists (it could be missing if an `assistant` entry somehow has `usage` but the message-count branch was skipped — rare but the guard is cheap and correct).
- New `dailyHourlyTokens` is populated only on `assistant` entries that carry `usage`.

**(d) Add the field to the return object.** The current return:

```ts
return {
  totalSessions,
  totalMessages,
  totalInputTokens,
  totalOutputTokens,
  dailyActivity,
  hourlyDistribution,
  modelUsage,
  firstSessionAt,
}
```

Add `dailyHourlyTokens`:

```ts
return {
  totalSessions,
  totalMessages,
  totalInputTokens,
  totalOutputTokens,
  dailyActivity,
  hourlyDistribution,
  modelUsage,
  firstSessionAt,
  dailyHourlyTokens,
}
```

Also: the method's return-type annotation (lines ~255-264) must add the field. Find:

```ts
async getUsageStats(): Promise<{
  totalSessions: number
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  dailyActivity: Record<string, { messages: number; tokens: number }>
  hourlyDistribution: number[]
  modelUsage: Record<string, number>
  firstSessionAt: number
}>
```

Change to:

```ts
async getUsageStats(): Promise<{
  totalSessions: number
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  dailyActivity: Record<string, { messages: number; tokens: number }>
  hourlyDistribution: number[]
  modelUsage: Record<string, number>
  firstSessionAt: number
  dailyHourlyTokens: Record<string, number[]>
}>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/__tests__/session-store.usage-stats.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: All tests pass (no regressions in other suites).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors related to this change. (If pre-existing unrelated errors exist, note them and proceed.)

- [ ] **Step 7: Commit**

```bash
git add src/main/session-store.ts src/main/__tests__/session-store.usage-stats.test.ts
git commit -m "feat(usage-stats): token-based dailyHourlyTokens aggregation + local timezone fix"
```

---

## Task 3: Rewrite `UsageStatsPanel.tsx` — token heatmap + active-hours detail view

This is one cohesive component change, broken into verifiable steps. No automated tests (repo has no React testing setup); verification is manual against the running dev server.

**Files:**
- Modify: `src/renderer/components/UsageStatsPanel.tsx` (full rewrite of the body; preserve the file's imports and the `UsageStats` import)

- [ ] **Step 1: Add `formatTokens` helper + `view` state + slot constants**

Open `src/renderer/components/UsageStatsPanel.tsx`. After the existing constants block (`const ROWS = 7 ...` at line 5, `const CELL = 10` / `const GAP = 2` at lines 56-57), add:

```ts
// --- Detail view constants ---
const DETAIL_DAYS = 7          // rows: last 7 days, newest at top
const SLOTS = 8                // columns: 8 × 3-hour slots
const SLOT_STARTS = [0, 3, 6, 9, 12, 15, 18, 21]  // start hour of each slot

/** Format a token count with K/M suffixes. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}
```

Then in the `UsageStatsPanel` component, add `view` state next to the existing `collapsed` state:

```ts
const [collapsed, setCollapsed] = useState(false)
const [view, setView] = useState<'heatmap' | 'detail'>('heatmap')
```

- [ ] **Step 2: Switch heatmap to token metric**

In `buildYearGrid` (the helper function, lines 15-54), change the count map population from messages to tokens:

Find:
```ts
const countMap: Record<string, number> = {}
for (const [k, v] of Object.entries(dailyActivity)) {
  countMap[k] = v.messages
}
```

Replace with:
```ts
const countMap: Record<string, number> = {}
for (const [k, v] of Object.entries(dailyActivity)) {
  countMap[k] = v.tokens
}
```

Update the parameter type annotation accordingly. The function signature is currently:
```ts
function buildYearGrid(dailyActivity: Record<string, { messages: number }>): { grid: (number | null)[][]; maxVal: number }
```

Change to:
```ts
function buildYearGrid(dailyActivity: Record<string, { messages: number; tokens: number }>): { grid: (number | null)[][]; maxVal: number }
```

- [ ] **Step 3: Add detail-view data memo**

Inside the `UsageStatsPanel` component, after the existing `{ grid, maxVal }` `useMemo`, add a memo for the detail view. It builds the 7-day × 8-slot matrix and the global max + peak slot.

```ts
const detail = useMemo(() => {
  if (!stats) return null

  // Build last DETAIL_DAYS local dates, newest first.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days: { key: string; label: string }[] = []
  for (let i = 0; i < DETAIL_DAYS; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}` })
  }

  // 2D matrix: rows = days, cols = slots. Values = token sums.
  const matrix: number[][] = days.map(({ key }) => {
    const hours = stats.dailyHourlyTokens[key] || new Array(24).fill(0)
    return SLOT_STARTS.map((start) =>
      hours[start] + hours[start + 1] + hours[start + 2]
    )
  })

  let globalMax = 0
  for (const row of matrix) for (const v of row) if (v > globalMax) globalMax = v

  // Peak slot = the slot column with the highest 7-day total.
  const slotTotals = new Array(SLOTS).fill(0)
  for (const row of matrix) {
    for (let s = 0; s < SLOTS; s++) slotTotals[s] += row[s]
  }
  let peakSlot = 0
  for (let s = 1; s < SLOTS; s++) if (slotTotals[s] > slotTotals[peakSlot]) peakSlot = s
  const peakValue = slotTotals[peakSlot]

  return { days, matrix, globalMax, peakSlot, peakValue, hasData: globalMax > 0 }
}, [stats])
```

- [ ] **Step 4: Add `motion` import**

At the top of the file, add to the existing imports:

```ts
import { motion, AnimatePresence } from 'motion/react'
```

(The repo already uses this exact import in `RightSidebar.tsx` and `GitView.tsx`, so the dependency is available.)

- [ ] **Step 5: Make the heatmap card clickable**

In the JSX, find the heatmap card container — the `<div className={\`rounded-[10px] ${theme === 'aurora' ? 'dynamic-island' : ''}\`}>` that wraps the grid scroll area. Add click + cursor styling.

Find the opening tag:
```tsx
<div
  className={`rounded-[10px] ${theme === 'aurora' ? 'dynamic-island' : ''}`}
  style={{
```

Add `onClick` and `cursor: 'pointer'`:

```tsx
<div
  className={`rounded-[10px] ${theme === 'aurora' ? 'dynamic-island' : ''}`}
  onClick={() => setView('detail')}
  style={{
    cursor: 'pointer',
    ...
```

Also add a small hover affordance: append `transition: 'transform 0.12s ease-out'` to the existing style object and (optionally) a hover scale via a CSS class — but the minimal version is just `cursor: pointer` plus the existing border. Keep it simple.

- [ ] **Step 6: Stop header-click from toggling collapse when entering detail view**

The header currently toggles `collapsed` on click. We want the heatmap card itself to drive navigation to detail, while the header keeps its collapse behavior. No change needed to the header itself — the header and the card are separate elements, so clicking the card won't bubble to the header. (Verify: the card is a sibling of the header inside the `!collapsed` block, not a child of the header. ✓ Confirmed in current code.)

No code change in this step — just verify the DOM structure is header-sibling-of-card.

- [ ] **Step 7: Add summary rows below the heatmap card**

Still inside the `!collapsed` block, after the scrollbar track `</div>` (the one with `ref={trackRef}`), but before the closing `</div>` of the `!collapsed` wrapper, add a summary block:

```tsx
{/* Summary */}
<div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, padding: '0 6px' }}>
  <SummaryRow label="Total tokens" value={formatTokens(stats.totalInputTokens + stats.totalOutputTokens)} theme={theme} />
  <SummaryRow label="Sessions" value={String(stats.totalSessions)} theme={theme} />
</div>
```

And add the `SummaryRow` component at the bottom of the file (outside `UsageStatsPanel`):

```tsx
function SummaryRow({ label, value, theme }: { label: string; value: string; theme: string }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: '1px 0' }}>
      <span style={{ fontSize: 10, color: 'var(--text-on-surface-variant)', letterSpacing: '0.3px' }}>
        {label}
      </span>
      <span style={{
        fontSize: 10,
        fontWeight: 500,
        color: theme === 'light' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  )
}
```

- [ ] **Step 8: Render the detail view as an overlay using AnimatePresence**

Wrap the entire `!collapsed` block's content (heatmap card + scrollbar + summary) in a conditional. When `view === 'detail'`, render the detail view instead.

Locate the `{!collapsed && (...)}` JSX block. Restructure it so the content is chosen by `view`:

```tsx
{!collapsed && (
  <div style={{ padding: '0 5px 6px' }}>
    <AnimatePresence mode="wait" initial={false}>
      {view === 'heatmap' ? (
        <motion.div
          key="heatmap"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
        >
          {/* === existing heatmap card + scrollbar + summary === */}
          {/* paste the entire previous content of the !collapsed block here */}
        </motion.div>
      ) : (
        <motion.div
          key="detail"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.1 }}
        >
          <DetailView
            detail={detail}
            theme={theme}
            onBack={() => setView('heatmap')}
          />
        </motion.div>
      )}
    </AnimatePresence>
  </div>
)}
```

(Concretely: the previous children of the `!collapsed` block — (a) the heatmap card `<div className={\`rounded-[10px]...\`}>` with its grid scroll area, (b) the scrollbar track `<div ref={trackRef}>`, and (c) the summary `<div>` added in Step 7 — move verbatim inside the `view === 'heatmap'` branch's `<motion.div key="heatmap">`. Only the outermost wrapper changes; the three child blocks are untouched.)

- [ ] **Step 9: Add the `DetailView` component**

At the bottom of the file (next to `SummaryRow`), add:

```tsx
function DetailView({
  detail,
  theme,
  onBack,
}: {
  detail: {
    days: { key: string; label: string }[]
    matrix: number[][]
    globalMax: number
    peakSlot: number
    peakValue: number
    hasData: boolean
  } | null
  theme: string
  onBack: () => void
}) {
  if (!detail) return null

  const slotLabel = (s: number) => `${String(s).padStart(2, '0')}:00`

  return (
    <div
      className={`rounded-[10px] ${theme === 'aurora' ? 'dynamic-island' : ''}`}
      style={{
        background: theme === 'aurora'
          ? undefined
          : theme === 'light'
            ? 'rgba(255, 255, 255, 0.6)'
            : 'rgba(30, 30, 32, 0.6)',
        backdropFilter: theme === 'aurora' ? undefined : 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: theme === 'aurora' ? undefined : 'blur(20px) saturate(180%)',
        border: theme === 'aurora'
          ? '1px solid var(--glass-border)'
          : theme === 'light'
            ? '1px solid rgba(0,0,0,0.06)'
            : '1px solid rgba(255,255,255,0.08)',
        padding: 8,
      }}
    >
      {/* Header: back + title */}
      <div className="flex items-center" style={{ marginBottom: 8 }}>
        <button
          onClick={onBack}
          className="flex items-center"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 4px',
            color: 'var(--text-on-surface-variant)',
          }}
          aria-label="Back to heatmap"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-on-surface-variant)',
          letterSpacing: '0.4px',
          marginLeft: 4,
        }}>
          Active Hours
        </span>
      </div>

      {!detail.hasData ? (
        <div style={{
          fontSize: 10,
          color: 'var(--text-outline-variant)',
          textAlign: 'center',
          padding: '16px 0',
        }}>
          No usage data
        </div>
      ) : (
        <>
          {/* X axis: slot labels */}
          <div style={{ display: 'flex', marginLeft: 28, gap: 2, marginBottom: 3 }}>
            {SLOT_STARTS.map((h) => (
              <div key={h} style={{
                flex: 1,
                fontSize: 7,
                color: 'var(--text-outline-variant)',
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows: one per day */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {detail.days.map((day, ri) => (
              <div key={day.key} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <div style={{
                  width: 26,
                  fontSize: 8,
                  color: 'var(--text-outline-variant)',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0,
                }}>
                  {day.label}
                </div>
                <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                  {detail.matrix[ri].map((val, ci) => {
                    const intensity = detail.globalMax > 0 ? val / detail.globalMax : 0
                    return (
                      <div
                        key={ci}
                        title={`${day.label} ${slotLabel(SLOT_STARTS[ci])}-${slotLabel(SLOT_STARTS[ci] + 3)}: ${formatTokens(val)} tokens`}
                        style={{
                          flex: 1,
                          height: 12,
                          borderRadius: 2,
                          background: intensity > 0
                            ? `rgba(99, 148, 255, ${0.12 + intensity * 0.88})`
                            : theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Peak summary */}
          <div className="flex items-center justify-between" style={{ marginTop: 8, paddingTop: 6, borderTop: theme === 'light' ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 9, color: 'var(--text-outline-variant)' }}>Peak</span>
            <span style={{
              fontSize: 9,
              fontWeight: 500,
              color: theme === 'light' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {slotLabel(SLOT_STARTS[detail.peakSlot])}–{slotLabel(SLOT_STARTS[detail.peakSlot] + 3)} · {formatTokens(detail.peakValue)}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors related to this change. (If the `motion` import reports "could not find declaration file", that's a pre-existing project quirk — `motion` ships its own types, so this should resolve. If not, verify `motion` is in `package.json` deps — it is: `"motion": "^12.38.0"`.)

- [ ] **Step 11: Manual verification against dev server**

The dev server should already be running (`npm run dev`). If not, start it. Then in the Electron app:

1. **Heatmap metric**: Verify the heatmap cells now vary by token intensity, not message count. (Cells on high-token days should be darker even if message count was low.)
2. **Summary rows**: Verify "Total tokens" and "Sessions" appear below the heatmap with reasonable values.
3. **Click → detail**: Click the heatmap card. Verify the detail view slides in (fade + slight upward motion).
4. **Detail grid**: Verify a 7-row × 8-column grid renders with day labels on the left (M/D, newest at top) and hour labels along the top (0, 3, 6, 9, 12, 15, 18, 21).
5. **Peak summary**: Verify the bottom shows the peak 3-hour slot in `HH:00–HH:00 · X.XK` format.
6. **Back button**: Click the `← Back` arrow. Verify you return to the heatmap view.
7. **Empty state** (optional): If you have a clean profile, verify "No usage data" shows when there's no recent activity.
8. **Collapse toggle**: Click the "Usage" header. Verify the whole panel collapses/expands (existing behavior preserved).

- [ ] **Step 12: Run the full test suite once more**

Run: `npx vitest run`
Expected: All tests pass (the UI change doesn't touch backend logic, but this confirms nothing broke).

- [ ] **Step 13: Commit**

```bash
git add src/renderer/components/UsageStatsPanel.tsx
git commit -m "feat(usage-stats): token heatmap + click-to-expand active-hours detail view"
```

---

## Task 4: PR workflow — branch, push, PR, merge, sync

**Files:** none (git operations only)

**Precondition:** Tasks 1-3 are committed on the working branch. Confirm with `git log --oneline -4` — you should see the three feature commits plus the spec commit.

- [ ] **Step 1: Verify clean state and current branch**

Run: `git status && git log --oneline -5`
Expected: clean working tree; HEAD on the branch where you've been committing (likely still `master` if you started before branching).

- [ ] **Step 2: Create the feature branch from current HEAD**

If you've been committing directly on `master` (the commits from Tasks 1-3 are on `master`), you need to move them onto a new branch and reset `master`.

First, create the branch at the current HEAD (this captures all your commits):
```bash
git checkout -b feature/usage-token-heatmap
```

Now `feature/usage-token-heatmap` has all your commits, and `master` is behind by those commits. (If you instead branched at the very start before Task 1, you're already on `feature/usage-token-heatmap` and can skip ahead to Step 4.)

If `master` needs to be reset to its pre-feature state (so the PR is meaningful and `master` stays clean):
```bash
git checkout master
git reset --hard origin/master
git checkout feature/usage-token-heatmap
```

⚠️ **Verify before running `git reset --hard`**: `git log --oneline origin/master..HEAD` should list exactly your feature commits (spec + 3 implementation commits). If anything unexpected shows up, STOP and ask the user.

- [ ] **Step 3: Push the branch to origin**

```bash
git push -u origin feature/usage-token-heatmap
```

Expected: branch created on the remote, tracking set up.

- [ ] **Step 4: Open the PR**

```bash
gh pr create \
  --base master \
  --head feature/usage-token-heatmap \
  --title "feat(usage-stats): token heatmap + active hours detail view" \
  --body "## What

Fixes the left-sidebar usage heatmap to reflect real **token consumption** instead of message count, fixes a UTC/local timezone inconsistency in date bucketing, and adds a click-to-expand **active hours** detail view (7 days × 8 three-hour slots).

## Why

The heatmap labeled itself as a usage indicator but actually colored cells by message count — the backend already computed per-day tokens but the UI discarded them. Date keys were also UTC while hour buckets were local, causing boundary-day drift.

## Changes

- **Backend** (\`FileSessionStore.getUsageStats\`): new \`dailyHourlyTokens\` field (\`Record<localDate, number[24]>\`); all date bucketing switched to local time; per-entry \`dateKey\`/\`hour\` hoisted out of inner blocks (DRY).
- **Frontend** (\`UsageStatsPanel\`): heatmap intensity now uses tokens; card is clickable; new two-state view (\`heatmap\` ↔ \`detail\`) with \`motion/react\` transitions; \`DetailView\` renders a 7-day × 8-slot grid + peak summary; \`formatTokens\` helper + \`SummaryRow\` for total tokens / sessions.
- **Tests**: new vitest suite covering \`dailyHourlyTokens\` population, local-timezone dateKey boundary case, and token totals.
- **Spec**: \`docs/superpowers/specs/2026-07-21-usage-stats-token-heatmap-design.md\`.

## Verification

- \`npx vitest run\` — all green.
- \`npx tsc --noEmit\` — no new errors.
- Manual: heatmap colors vary by token; summary rows render; click → detail slides in; grid shows day×slot matrix; peak summary correct; back arrow returns to heatmap; collapse toggle preserved.

## Non-goals (deferred)

- Caching / incremental aggregation for \`getUsageStats()\` (still O(sessions × entries)).
- Per-cell hover tooltips (only native \`title\` tooltips for now).
- Model-usage breakdown view.

Closes #N/A"
```

Expected: PR URL printed. Open it in the browser to sanity-check.

- [ ] **Step 5: Merge the PR to remote master**

```bash
gh pr merge --squash --delete-branch
```

(Using `--squash` keeps \`master\` history clean with one commit per PR; `--delete-branch` removes the remote feature branch after merge. If the user prefers merge commits, use `--merge` instead — but squash is the conventional default for this kind of single-purpose feature.)

Expected: "✓ Merged" message; remote `master` now contains the squashed commit; remote `feature/usage-token-heatmap` deleted.

- [ ] **Step 6: Sync local master + clean up**

```bash
git checkout master
git pull --ff-only origin master
```

Expected: local `master` fast-forwards to match remote (now includes the squashed feature commit). `git pull --ff-only` will fail loudly if the histories diverged, which is what we want.

Delete the local feature branch:
```bash
git branch -D feature/usage-token-heatmap
```

- [ ] **Step 7: Final verification**

```bash
git log --oneline -3
git status
```

Expected: HEAD on `master`, the top commit is the squashed feature, working tree clean.

---

## Done criteria

- [ ] `npx vitest run` — all green, including the 3 new tests.
- [ ] `npx tsc --noEmit` — no new errors.
- [ ] Manual UI verification (Task 3 Step 11) passes all 8 checks.
- [ ] PR merged to remote `master` via `gh pr merge`.
- [ ] Local `master` synced with `git pull --ff-only`.
- [ ] Local feature branch deleted.
