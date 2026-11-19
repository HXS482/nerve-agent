/**
 * Bot 交接的队列与投递。
 *
 * 这里刻意**不**碰 better-sqlite3：仓库里那个原生模块是给 Electron 的 ABI 编的，
 * 在 vitest 的 node 进程里 require 就会 ERR_DLOPEN_FAILED（scheduler.test 全红就是这个原因）。
 * 所以投递逻辑对着一个假队列测，真队列的 SQL 单独一组、跑不了就跳过。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHandoffRunner, type HandoffWork } from '../../core/handoff-runner'
import type { HopQueue, HopRow } from '../../store/hop-queue'

function work(over: Partial<HandoffWork> = {}): HandoffWork {
  return {
    kind: 'hop',
    threadId: 'sess-asker',
    fromBotId: 'bot_a',
    fromName: 'Assistant',
    toBotId: 'bot_b',
    toName: 'Knowledge',
    envelope: { task: 'count open PRs' },
    depth: 1,
    chain: ['Assistant'],
    ...over,
  }
}

/**
 * 假队列：只实现 runner 用到的那几个方法，语义与真队列一致（含 attempts 计数）。
 *
 * 用假队列不是为了省事，而是为了把「投递的三条分支」和「SQL 的认领规则」分开测：
 * 混在一起的话，一条断言失败时你不知道是逻辑错了还是 SQL 错了。
 */
function fakeQueue() {
  const rows = new Map<string, HopRow>()
  const offered: string[] = []
  const q = {
    offer(key: string, payload: unknown): 'queued' | 'already' {
      offered.push(key)
      if (rows.has(key)) return 'already'
      rows.set(key, {
        key,
        status: 'queued',
        attempts: 0,
        availableAt: 0,
        leaseUntil: null,
        owner: null,
        payload: JSON.stringify(payload),
        lastError: null,
        createdAt: 0,
        updatedAt: 0,
      })
      return 'queued'
    },
    claim(_owner: string): HopRow[] {
      const out: HopRow[] = []
      for (const row of rows.values()) {
        if (row.status !== 'queued') continue
        row.status = 'running'
        row.attempts += 1
        out.push({ ...row })
      }
      return out
    },
    finish(key: string): void {
      const row = rows.get(key)
      if (row) row.status = 'done'
    },
    fail(key: string, error: string): void {
      const row = rows.get(key)
      if (row) {
        row.status = 'failed'
        row.lastError = error
      }
    },
    release(key: string, error: string, _backoffMs: number): 'retry' | 'failed' {
      const row = rows.get(key)
      if (!row) return 'failed'
      row.lastError = error
      if (row.attempts >= 3) {
        row.status = 'failed'
        return 'failed'
      }
      row.status = 'queued'
      return 'retry'
    },
    renew(): boolean {
      return true
    },
    reap(): number {
      return 0
    },
    stats() {
      const out = { queued: 0, running: 0, done: 0, failed: 0 }
      for (const row of rows.values()) out[row.status] += 1
      return out
    },
    close(): void {},
  }
  return q as unknown as HopQueue & typeof q
}

describe('handoff runner 的投递分支', () => {
  it('hop 跑完：把目标 Bot 的答复入队成一条 relay', async () => {
    const queue = fakeQueue()
    const prompts: string[] = []
    const appended: any[] = []
    const runner = createHandoffRunner({
      queue,
      owner: 'w1',
      retryBaseMs: 0,
      delivery: {
        run: async ({ prompt }) => {
          prompts.push(prompt)
          return ' 上周有 3 个 PR  '
        },
        appendBotMessage: async (input) => {
            appended.push(input)
          },
          resolveBotSession: async (_botId, fallback) => fallback,
      },
    })

    queue.offer('k1', work())
    const first = await runner.sweep()
    expect(first.delivered).toBe(1)
    // 这一轮只跑了 hop；relay 是新一轮 sweep 的事
    expect(appended).toHaveLength(0)
    expect(prompts[0]).toContain('Task: count open PRs')
    expect(queue.stats().done).toBe(1)

    const second = await runner.sweep()
    expect(second.delivered).toBe(1)
    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({
      sessionId: 'sess-asker',
      botId: 'bot_b',
      botName: 'Knowledge',
      text: '上周有 3 个 PR',
      speakerIsAsker: false,
    })
  })

  it('跑失败：重试到上限后去会话里用发起方的身份说一句', async () => {
    const queue = fakeQueue()
    let calls = 0
    const appended: any[] = []
    const runner = createHandoffRunner({
      queue,
      owner: 'w1',
      retryBaseMs: 0,
      delivery: {
        run: async () => {
          calls += 1
          throw new Error('provider 429')
        },
        appendBotMessage: async (input) => {
            appended.push(input)
          },
          resolveBotSession: async (_botId, fallback) => fallback,
      },
    })

    queue.offer('k1', work())
    await runner.sweep()
    await runner.sweep()
    await runner.sweep()
    expect(calls).toBe(3)

    // 第四轮扫到那条 notice
    await runner.sweep()
    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({
      sessionId: 'sess-asker',
      botId: 'bot_a',
      speakerIsAsker: true,
    })
    expect(appended[0].text).toContain('没有回应')
  })

  it('载荷坏掉的行直接终态失败，不会无限重试', async () => {
    const queue = fakeQueue()
    queue.offer('bad', { kind: 'hop' } as any)
    const runner = createHandoffRunner({
      queue,
      owner: 'w1',
      delivery: {
        run: async () => 'x',
        appendBotMessage: async () => {},
        resolveBotSession: async (_botId, fallback) => fallback,
      },
    })
    const swept = await runner.sweep()
    expect(swept.failed).toBe(1)
    expect(queue.stats().failed).toBe(1)
  })

  it('同一跳重复入队不会产生第二条', async () => {
    const queue = fakeQueue()
    const runner = createHandoffRunner({
      queue,
      owner: 'w1',
      delivery: { run: async () => 'ok', appendBotMessage: async () => {}, resolveBotSession: async (_b, f) => f },
    })
    queue.offer('k1', work())
    expect(queue.offer('k1', work())).toBe('already')
    await runner.sweep()
    expect(queue.stats().done).toBe(1)
  })

  it('跑这一行期间会周期性续租（租约 120s，一跳可能跑几分钟）', async () => {
    const queue = fakeQueue()
    const renewed: string[] = []
    ;(queue as any).renew = (key: string) => { renewed.push(key); return true }
    let finishHop!: () => void
    const runner = createHandoffRunner({
      queue,
      owner: 'w1',
      retryBaseMs: 0,
      renewEveryMs: 5,
      delivery: {
        run: () => new Promise<string>((r) => { finishHop = () => r('done') }),
        appendBotMessage: async () => {},
        resolveBotSession: async (_b, f) => f,
      },
    })
    queue.offer('k1', work())
    const sweep = runner.sweep()
    await new Promise((r) => setTimeout(r, 30))
    finishHop()
    await sweep
    expect(renewed.filter((k) => k === 'k1').length).toBeGreaterThan(0)
  })
})

/** better-sqlite3 是给 Electron ABI 编的，node 下 require 会失败 —— 那就跳过，而不是假绿。 */
function sqliteAvailable(): boolean {
  // 只 require 不够：模块能加载，但原生 .node 是给 Electron 的 ABI 编的，
  // 真正 new Database() 才炸。所以这里真的开一个临时库再关掉。
  let db: any
  let dir = ''
  try {
    const Database = require('better-sqlite3')
    dir = mkdtempSync(join(tmpdir(), 'probe-'))
    db = new Database(join(dir, 'p.db'))
    return true
  } catch {
    return false
  } finally {
    try {
      db?.close()
    } catch {
      /* 已经关了或没开起来 */
    }
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!sqliteAvailable())('HopQueue 的认领规则（真 sqlite）', () => {
  let dir: string
  let queue: HopQueue

  beforeEach(async () => {
    const { HopQueue } = await import('../../store/hop-queue')
    dir = mkdtempSync(join(tmpdir(), 'hopq-'))
    queue = HopQueue.open(join(dir, 'hops.db'))
  })
  afterEach(() => {
    queue?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('认领后置 running，同一租约内别人拿不到', () => {
    queue.offer('k1', work())
    expect(queue.claim('w1')).toHaveLength(1)
    expect(queue.claim('w2')).toHaveLength(0)
  })

  it('finish 后不再被认领', () => {
    queue.offer('k1', work())
    queue.claim('w1')
    queue.finish('k1')
    expect(queue.claim('w1')).toHaveLength(0)
  })
})
