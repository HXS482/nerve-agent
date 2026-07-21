# Usage Stats — Token Heatmap + Active Hours Detail View

**Date:** 2026-07-21
**Status:** Approved (pending spec review)
**Scope:** Fix the left-sidebar usage heatmap so it reflects real token usage (not message count), and add a click-to-expand detail view showing a day × hour activity grid.

---

## Background & Problem

The left-sidebar usage panel (`UsageStatsPanel.tsx`) renders a GitHub-style contribution heatmap, but:

1. **Wrong metric.** Cell intensity is driven by `dailyActivity[date].messages` (`UsageStatsPanel.tsx:29`), i.e. how many messages were sent that day. The backend already computes `dailyActivity[date].tokens` (`session-store.ts:312`) but the UI never reads it. The heatmap therefore does **not** visualize token usage frequency despite its label.
2. **Timezone inconsistency.** The per-day bucket key uses UTC (`getUTCDate()`, `session-store.ts:295` & `311`), while the hourly bucket uses local time (`getHours()`, `session-store.ts:299`). Boundary days drift, especially in eastern longitudes.
3. **Unused data.** The backend returns `hourlyDistribution`, `modelUsage`, and per-day tokens, but the UI discards everything except message counts.
4. **No drill-down.** The heatmap is read-only; there is no way to inspect when tokens are actually being spent.

## Goals

- Heatmap cell color = total tokens (input + output) consumed that day.
- All date/hour bucketing in local time, consistently.
- Clicking the heatmap reveals an in-place detail view: a **day × 3-hour-slot** grid (last 7 days) showing active-hour patterns, plus a peak-slot summary.
- Stay in the current sidebar position; keep the change focused — do **not** tackle the full-rescan performance issue in this iteration.

## Non-Goals

- Caching / incremental aggregation for `getUsageStats()` (pre-existing; separate iteration).
- Rendering `modelUsage` or a per-model breakdown.
- Adding tooltip-on-hover for individual cells (may come later).
- Migrating aggregation to SQLite.

## Data Contract

### New field on `UsageStats`

`src/shared/types.ts`:

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
  /** NEW: local date `YYYY-MM-DD` → 24-element array of token counts per hour. */
  dailyHourlyTokens: Record<string, number[]>
}
```

`dailyHourlyTokens[dateKey][hour]` accumulates `inputTokens + outputTokens` from `assistant` entries whose local-time hour is `hour`. Token-only (not messages), so it stays consistent with the new heatmap metric.

### Aggregation changes (`src/main/session-store.ts`, `getUsageStats()`)

1. **Initialize** the new map next to the existing accumulators:
   ```ts
   const dailyHourlyTokens: Record<string, number[]> = {}
   ```
2. **Local-time date key.** Replace the UTC dateKey construction in both the message-count block (line ~295) and the token block (line ~311) with a local-time helper:
   ```ts
   const localDateKey = (ms: number) => {
     const d = new Date(ms)
     return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
   }
   ```
   Both blocks use `localDateKey(ts)`. Hour bucketing already uses local `getHours()` — unchanged.
3. **Hoist shared per-entry values.** Currently `hour` and `dateKey` are computed inside separate `if` blocks with different scopes. Hoist them to the top of the loop body (right after `ts` is resolved) so both the message-count block and the token block reuse the same values:
   ```ts
   const d = new Date(ts)
   const dateKey = localDateKey(ts)
   const hour = d.getHours()
   ```
   Then drop the duplicate `new Date(ts)` / dateKey construction from both inner blocks (lines ~294-295 and ~310-311). This also removes the prior UTC/local mismatch in one place.

4. **Fill the new field** inside the existing `if (e.type === 'assistant') { ... usage ... }` block (line ~303), right after `dailyActivity[dateKey].tokens += inp + out`:
   ```ts
   if (!dailyHourlyTokens[dateKey]) dailyHourlyTokens[dateKey] = new Array(24).fill(0)
   dailyHourlyTokens[dateKey][hour] += inp + out
   ```
5. **Return** the new field in the stats object.

The `dailyActivity` shape and all other returned fields stay the same (only the timezone used to compute `dateKey` changes, which may shift counts by a day at boundaries — that is the intended fix).

## UI: `UsageStatsPanel.tsx`

Two view states managed by local component state `view: 'heatmap' | 'detail'`.

### Default view (heatmap + summary)

```
┌─────────────────────────────┐
│ ▦ Usage               ▾     │  ← existing header; toggles panel collapse (unchanged)
├─────────────────────────────┤
│ ░░▒▓██▓▒░ ▒▓██▒░ ░▒▒▓░░  ░ │  ← 53w × 7d grid, TOKEN metric, clickable card
│  (existing horizontal track)│
├─────────────────────────────┤
│ Total tokens       1.2M     │  ← summary row 1
│ Sessions             42     │  ← summary row 2
└─────────────────────────────┘
```

Changes:

- `buildYearGrid`: `countMap[k] = v.tokens` (was `v.messages`). Everything else in the grid logic (start/end, null cells, max) is unchanged.
- Wrap the heatmap card in a clickable container: `onClick={() => setView('detail')}`, `cursor: pointer`. The header row's collapse toggle remains independent (stop propagation on the header).
- New summary block below the card: two rows, label left / value right. Token total = `totalInputTokens + totalOutputTokens`, formatted with `formatTokens()` helper (e.g. `1234` → `1.2K`, `1500000` → `1.5M`). Sessions = `stats.totalSessions`.
- Glass / aurora styling on the card stays as-is.

### Detail view (day × 3-hour grid, in-place overlay)

```
┌─────────────────────────────┐
│ ← Back       Active Hours   │  ← back button (left) + title (right)
├─────────────────────────────┤
│        0  3  6  9 12 15 18 21   ← X axis: 8 slots, every 3 hours
│ 7/21   ░  ░  ▒  ▓  ██ ▓  ▒  ░
│ 7/20   ░  ▒  ▓  ██ ██ ▓  ▒  ░
│ 7/19   ░  ░  ░  ▒  ▓  ▒  ░  ░
│ 7/18   ...
│ 7/17   ...
│ 7/16   ...
│ 7/15   ...
├─────────────────────────────┤
│ Peak  15:00–18:00   3.4K    │  ← peak 3-hour slot across the 7 days
└─────────────────────────────┘
```

Layout & computation:

- **Days**: last 7 days, local time, newest at top. Each row label = `M/D`.
- **Slots**: 8 columns, each covers 3 hours — `[0-2], [3-5], [6-8], [9-11], [12-14], [15-17], [18-20], [21-23]`. Slot `s` value for a given day = `sum(tokensByHour[3s], tokensByHour[3s+1], tokensByHour[3s+2])` from `dailyHourlyTokens[date]` (missing day → all zeros).
- **Cell intensity**: `slotValue / globalMax` across all 7×8 cells, using the same blue ramp `rgba(99,148,255, 0.12 + intensity*0.88)`. Zero-value cells get the faint base color (`rgba(0,0,0,0.06)` / `rgba(255,255,255,0.06)`) like the heatmap.
- **Peak summary**: scan the 8 slot totals (summed across all 7 days), pick the max, render `Peak  HH:00–HH+3:00   <tokens>` where tokens is the 7-day sum for that slot, formatted via `formatTokens()`.
- **Back button**: top-left `← Back`, `onClick={() => setView('heatmap')}`. Single, explicit exit — no click-outside-to-close (avoid accidental dismissal).
- **Empty state**: if all 7 days have zero tokens, render `No usage data` in place of the grid.

Animation: the detail view replaces the default view with a `motion.div` fade + 8px upward translate, ~100ms. Use the already-installed `motion` package.

### Shared helper

```ts
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}
```

## Testing

Vitest unit test(s) for `FileSessionStore.getUsageStats()` — construct a temporary `baseDir` with one or two mock `.jsonl` session files containing known `assistant` entries with timestamps and `usage` fields, then assert:

1. `dailyHourlyTokens[dateKey]` exists and each of the 24 slots holds the expected summed tokens for the hours present.
2. The `dateKey` is a local-time key (construct test timestamps such that local vs UTC would land on different days — e.g. 23:00 local on day D — and assert it lands on D, not D+1).
3. Token totals (`totalInputTokens`, `totalOutputTokens`, `dailyActivity[*].tokens`) remain correct after the timezone change.

Place under `src/main/__tests__/` or alongside existing vitest tests (discover via existing test layout). UI component tests are out of scope (no existing React testing setup in this repo).

## Files Touched

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `dailyHourlyTokens: Record<string, number[]>` to `UsageStats`. |
| `src/main/session-store.ts` | Local-time dateKey (both blocks), fill `dailyHourlyTokens`, return it. |
| `src/renderer/components/UsageStatsPanel.tsx` | `view` state; heatmap uses `tokens`; card click → detail; summary rows; detail grid view; `formatTokens` helper. |
| `src/main/__tests__/session-store.usage-stats.test.ts` (new) | Unit tests for new field + local timezone. |

No changes to: IPC layer (`ipc.ts`, `claude.ts`, `agent-core.ts`), preload bridge, or `Sidebar.tsx` mounting — all pass `UsageStats` through unchanged.

## Risks & Notes

- **Timezone fix changes historical bucketing.** Counts that previously landed on day D (UTC) may now land on D-1 or D+1 in local time. This is intended; users looking at "today" will now see today's local activity correctly. No data migration needed — aggregation is runtime.
- **208px sidebar width.** Detail view fits 8 columns + label at ~180px usable width (each slot ~18px). Verified feasible; if a user shrinks sidebar to the 160px minimum, cells get tight but remain visible (no overflow due to fixed cell sizing).
- **`getUsageStats()` full rescan** remains O(sessions × entries). Explicitly deferred.
