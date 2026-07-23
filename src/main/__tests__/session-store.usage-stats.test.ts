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
