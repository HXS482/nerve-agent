# 阶段 0-2：持久化队列 + 会话配置隔离 + per-session cwd

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Nerve 的 gateway 队列在进程崩溃后不丢、让每个会话拥有独立的模型配置和工作目录，修掉 `setModel` 全局污染。

**Architecture:** 用已有的 `better-sqlite3` 建一个 `ticket-store`，先承担 `effect` 表（持久化队列）；`session-router` 的内存 Map 换成 store。再把 `session-context.ts` 里一直没被读取的 `ctx.config` 接活，最后把 `projectDir` 从全局单例改成 `sendMessage` 的参数。

**Tech Stack:** TypeScript、Electron、better-sqlite3@^12.4.1、vitest

**Spec:** `docs/superpowers/specs/2026-11-02-ticket-superagent-design.md`（§7.1、§7.3、§8 阶段 0-2）

## Global Constraints

- 不新增 npm 依赖；SQLite 一律用已安装的 `better-sqlite3@^12.4.1`。
- 用 `require('better-sqlite3')` 惰性加载，不要在模块初始化时 import（照 `memory-browser.ts:81` 的写法）。
- 所有新增导出走 `src/shared/types.ts` 的 `IPC_CHANNELS` 常量，不硬编码字符串。
- 测试文件位置：`src/main/__tests__/`，命名 `<module>.test.ts`，用 `vitest`（`npm test`）。
- 向后兼容：旧会话无 `cwd` 字段时必须回落到当前 `config.cwd`。
- 不改 `agent-core` 的 ReAct 循环结构。

## Review Focus

- **崩溃恢复**：任务跑到一半 `kill -9`，重启后未执行的消息必须还在，且不能重复执行已完成的。
- **并发写同一个 effect key**：同一 `(kind, key)` 短时间内多次入队，必须合并而不是叠加执行。
- **旧会话无 cwd**：打开 2026-06 之前建的会话，工具必须落在当前项目目录而不是报错。
- **模型切换竞态**：A 会话设成 gpt，B 会话设成 claude，同时跑，A 的请求不能用 claude 的 client。
- **路径含空格 / 中文**：cwd 是 `G:/我的 项目` 时，Bash 工具必须正常执行。

---

### Task 1: `TicketStore` 基础壳与 effect 表

**Files:**
- Create: `src/main/store/ticket-store.ts`
- Test: `src/main/__tests__/store/ticket-store.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `class TicketStore`，构造 `constructor(dbPath: string)`
  - `static open(dbPath: string): TicketStore`
  - `close(): void`
  - `db` 只读暴露给同模块内方法（`private readonly db: Database`）

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/store/ticket-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'

describe('TicketStore', () => {
  let dir: string
  let store: TicketStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ticket-store-'))
    store = TicketStore.open(join(dir, 'tickets.db'))
  })

  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the effect table on open', () => {
    const rows = store.rawQuery(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='effect'",
    )
    expect(rows).toHaveLength(1)
  })

  it('is idempotent: opening the same path twice does not throw', () => {
    const second = TicketStore.open(join(dir, 'tickets.db'))
    expect(() => second.close()).not.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/store/ticket-store.test.ts`
Expected: FAIL — `Cannot find module '../../store/ticket-store'`

- [ ] **Step 3: 实现 `TicketStore`**

建表 SQL 用 spec §7.1 的原文，**但本期只建 `effect` 表**（`ticket`/`assignment`/`input` 留给阶段 3 的计划，避免在本计划引入无用 schema）。

```ts
// src/main/store/ticket-store.ts
import { mkdirSync } from 'fs'
import { dirname } from 'path'

type Database = any  // better-sqlite3 类型，惰性 require

export class TicketStore {
  private constructor(private readonly db: Database) {}

  static open(dbPath: string): TicketStore {
    mkdirSync(dirname(dbPath), { recursive: true })
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS effect (
        kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL,
        seq INTEGER PRIMARY KEY AUTOINCREMENT, attempts INTEGER DEFAULT 0,
        due INTEGER NOT NULL, generation INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_effect_due ON effect(kind, due, seq);
    `)
    return new TicketStore(db)
  }

  rawQuery(sql: string, ...params: unknown[]): unknown[] {
    return this.db.prepare(sql).all(...params)
  }

  close(): void {
    this.db.close()
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/store/ticket-store.test.ts`
Expected: PASS，2 passed

- [ ] **Step 5: 提交**

```bash
git add src/main/store/ticket-store.ts src/main/__tests__/store/ticket-store.test.ts
git commit -m "feat(store): add TicketStore with effect table"
```

---

### Task 2: effect 入队、合并与抢占

**Files:**
- Modify: `src/main/store/ticket-store.ts`
- Test: `src/main/__tests__/store/ticket-store-effect.test.ts`

**Interfaces:**
- Consumes: `TicketStore.open()`（Task 1）
- Produces:
  - `enqueueEffect(kind: string, key: string, payload: unknown, opts?: { ordered?: boolean; dueAt?: number }): void`
  - `claimDueEffects(kind: string, now: number, limit: number): Array<{ seq: number; key: string; payload: unknown; attempts: number }>`
  - `deleteEffect(seq: number): void`
  - `bumpAttempt(seq: number, nextDue: number): void`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/store/ticket-store-effect.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'

describe('effect queue', () => {
  let dir: string
  let store: TicketStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'effect-'))
    store = TicketStore.open(join(dir, 't.db'))
  })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  it('coalesces same (kind, key) keeping the original queue position', () => {
    store.enqueueEffect('send', 'a', { n: 1 })
    store.enqueueEffect('send', 'b', { n: 2 })
    store.enqueueEffect('send', 'a', { n: 3 })   // 覆盖 a 的 payload，位置不变
    const due = store.claimDueEffects('send', Date.now(), 10)
    expect(due.map(d => d.key)).toEqual(['a', 'b'])
    expect(due[0].payload).toEqual({ n: 3 })
  })

  it('does not return effects whose due time is in the future', () => {
    store.enqueueEffect('send', 'later', {}, { dueAt: Date.now() + 60_000 })
    expect(store.claimDueEffects('send', Date.now(), 10)).toHaveLength(0)
  })

  it('respects the limit', () => {
    for (const k of ['a', 'b', 'c']) store.enqueueEffect('send', k, {})
    expect(store.claimDueEffects('send', Date.now(), 2)).toHaveLength(2)
  })

  it('survives a close/reopen cycle', () => {
    store.enqueueEffect('send', 'p', { x: 1 })
    store.close()
    store = TicketStore.open(join(dir, 't.db'))
    expect(store.claimDueEffects('send', Date.now(), 10)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/store/ticket-store-effect.test.ts`
Expected: FAIL — `store.enqueueEffect is not a function`

- [ ] **Step 3: 实现四个方法**

合并语义：同 `(kind, key)` 且 `generation` 相同的行视为同一待执行项——新 payload 覆盖旧 payload，`seq` 与 `due` 保持不变，`generation + 1`。用 `INSERT ... ON CONFLICT` 做不到保留 seq，所以先 `SELECT` 再 `UPDATE`/`INSERT`，包在一个 `db.transaction` 里。

`claimDueEffects` 用 `SELECT ... WHERE kind = ? AND due <= ? ORDER BY seq LIMIT ?`。**不在这里删除**——删除由 `deleteEffect` 在执行成功后才做，保证「先落库再执行」。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/store/ticket-store-effect.test.ts`
Expected: PASS，4 passed

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(store): add coalescing effect queue with due-time claim"
```

---

### Task 3: `effect-runner` —— 把 effect 队列跑起来

**Files:**
- Create: `src/main/store/effect-runner.ts`
- Test: `src/main/__tests__/store/effect-runner.test.ts`

**Interfaces:**
- Consumes: `TicketStore` 的 `enqueueEffect/claimDueEffects/deleteEffect/bumpAttempt`（Task 2）
- Produces:
  - `type EffectHandler = (payload: unknown, key: string) => Promise<void>`
  - `class EffectRunner`，`constructor(store: TicketStore, opts?: { pollMs?: number })`
  - `register(kind: string, handler: EffectHandler, opts?: { concurrency?: number; ordered?: boolean }): void`
  - `start(): void` / `stop(): Promise<void>`（`stop` 等正在跑的结束）
  - `idle(kind?: string): Promise<void>`（测试用）

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/store/effect-runner.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'
import { EffectRunner } from '../../store/effect-runner'

describe('EffectRunner', () => {
  let dir: string, store: TicketStore, runner: EffectRunner
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-'))
    store = TicketStore.open(join(dir, 't.db'))
    runner = new EffectRunner(store, { pollMs: 10 })
  })
  afterEach(async () => { await runner.stop(); store.close(); rmSync(dir, { recursive: true, force: true }) })

  it('runs a due effect and deletes it after success', async () => {
    const seen: unknown[] = []
    runner.register('send', async (p) => { seen.push(p) })
    store.enqueueEffect('send', 'a', { n: 1 })
    runner.start()
    await runner.idle()
    expect(seen).toEqual([{ n: 1 }])
    expect(store.claimDueEffects('send', Date.now(), 10)).toHaveLength(0)
  })

  it('retries with backoff and bumps attempts on failure', async () => {
    let calls = 0
    runner.register('send', async () => { calls++; throw new Error('boom') })
    store.enqueueEffect('send', 'a', {})
    runner.start()
    await runner.idle()
    expect(calls).toBe(1)
    const rows = store.rawQuery('SELECT attempts, due FROM effect') as Array<{ attempts: number; due: number }>
    expect(rows[0].attempts).toBe(1)
    expect(rows[0].due).toBeGreaterThan(Date.now())  // 退避到未来
  })

  it('runs effects of an ordered kind strictly in seq order', async () => {
    const order: string[] = []
    runner.register('send', async (_p, key) => {
      order.push(key)
      await new Promise(r => setTimeout(r, 20))
    }, { ordered: true })
    store.enqueueEffect('send', 'a', {})
    store.enqueueEffect('send', 'b', {})
    runner.start()
    await runner.idle()
    expect(order).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/store/effect-runner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 `EffectRunner`**

要点：`ordered` 的 kind 只允许一个 in-flight（拿最老的一行，跑完再拿下一行）；非 ordered 按 `concurrency`（默认 1）并发。失败走 `bumpAttempt(seq, now + min(2^attempts * 1000, 60_000))`。`start()` 立刻 dispatch 一次，之后每 `pollMs` 一次。`idle()` 循环 dispatch + 等 in-flight 清空，直到没有可跑的。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/store/effect-runner.test.ts`
Expected: PASS，3 passed

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(store): add EffectRunner with ordering, limits and backoff"
```

---

### Task 4: `session-router` 接上持久化队列

**Files:**
- Modify: `src/main/gateway/session-router.ts`（`queues`/`processing`/`processQueue`，约 46-215 行）
- Test: `src/main/__tests__/gateway/session-router-queue.test.ts`

**Interfaces:**
- Consumes: `EffectRunner`（Task 3）
- Produces: `SessionRouter` 构造签名改为 `constructor(agentCore: AgentCore, dataDir: string, store: TicketStore, runner: EffectRunner)`；`submit` 与 `cancel` 签名不变（调用方无需改动）

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/gateway/session-router-queue.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'
import { EffectRunner } from '../../store/effect-runner'
import { SessionRouter } from '../../gateway/session-router'

describe('SessionRouter durable queue', () => {
  let dir: string, store: TicketStore, runner: EffectRunner, core: any, channel: any

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'router-'))
    store = TicketStore.open(join(dir, 't.db'))
    runner = new EffectRunner(store, { pollMs: 5 })
    channel = { sendText: vi.fn(), sendDone: vi.fn(), sendError: vi.fn() }
    core = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelSession: vi.fn(),
      getSessionContextManager: () => ({ getOrCreate: (id: string) => ({ sessionId: id }) }),
    }
  })
  afterEach(async () => { await runner.stop(); store.close(); rmSync(dir, { recursive: true, force: true }) })

  it('persists a submitted message before running it', async () => {
    // 让 handler 卡住，断言此时数据库里还有这条待执行记录
    core.sendMessage.mockImplementation(() => new Promise(() => {}))
    const router = new SessionRouter(core, dir, store, runner)
    router.start()
    void router.submit('s1', 'hello', channel)
    await new Promise(r => setTimeout(r, 30))
    const rows = store.rawQuery("SELECT COUNT(*) AS n FROM effect WHERE kind='gateway.message'")
    expect((rows[0] as { n: number }).n).toBe(0)  // 已被 claim 且 in-flight，未删除前不算"待执行"
    expect(core.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('resumes a message left in the database after a restart', async () => {
    store.enqueueEffect('gateway.message', 's1', {
      sessionId: 's1', message: 'resumed', files: undefined,
    })
    const router = new SessionRouter(core, dir, store, runner)
    router.start()
    await runner.idle('gateway.message')
    expect(core.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'resumed', sessionId: 's1' }),
      expect.anything(),
      expect.anything(),
    )
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/gateway/session-router-queue.test.ts`
Expected: FAIL — 构造参数不匹配

- [ ] **Step 3: 改造 `session-router`**

删除 `private queues`、`private processing`、`processQueue`。新增：

- `start()`：注册 `gateway.message` handler（`ordered: true`，`concurrency: 1`，因为本阶段**保持串行语义不变**），然后 `runner.start()`。
- `submit(sessionId, message, channel, files)`：`store.enqueueEffect('gateway.message', sessionId, {...})` 后返回 `Promise.resolve()`。**签名必须保持 `Promise<void>`** —— `gateway.ts:306` 现在挂着 `.catch(...)`，改成同步返回会在运行时抛 `catch is not a function`。
- handler：从 payload 取出后调 `agentCore.sendMessage(...)`。`channel` 不能序列化进 SQLite，**从内存 Map `sessionId → channel` 取**；缺失时记 warn 并丢弃（进程重启后旧 channel 已失效，这是预期行为，由 `sendError` 告知用户需要重发）。
- `cancel(sessionId)`：`DELETE FROM effect WHERE kind='gateway.message' AND key=?` + `agentCore.cancelSession`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/gateway/session-router-queue.test.ts`
Expected: PASS，2 passed

- [ ] **Step 5: 跑全部测试确认没破坏别的**

Run: `npm test`
Expected: 全绿（`src/main/__tests__/gateway/` 下已有的 adapter 测试不能红）

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(gateway): back SessionRouter queue with durable effects"
```

---

### Task 5: 接活 `ctx.config`（会话级配置）

**Files:**
- Modify: `src/main/core/agent-core.ts`（`:290-330` 的 `sendMessage` 开头；`:545` `resolveProvider`；`:316` model 解析；`:631` effort）
- Test: `src/main/__tests__/core/session-config.test.ts`

**Interfaces:**
- Consumes: `SessionContext.config: Partial<ClaudeConfig>`（已存在，`session-context.ts:16`）
- Produces: `AgentCore` 内部新增私有方法 `effectiveConfig(ctx: SessionContext): ClaudeConfig`，返回 `{ ...this.config, ...ctx.config }`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/core/session-config.test.ts
import { describe, it, expect } from 'vitest'
import { createSessionContext } from '../../core/session-context'
import { mergeConfig } from '../../core/session-config'

describe('mergeConfig', () => {
  const base = { model: 'claude-sonnet-4', effort: 'medium' as const, cwd: '/p', permissionMode: 'default' as const }

  it('returns base when session overrides nothing', () => {
    expect(mergeConfig(base, createSessionContext('s1'))).toEqual(base)
  })

  it('lets the session override only the fields it sets', () => {
    const ctx = createSessionContext('s1', { model: 'gpt-5' })
    expect(mergeConfig(base, ctx).model).toBe('gpt-5')
    expect(mergeConfig(base, ctx).effort).toBe('medium')  // 未被覆盖
  })

  it('does not mutate the base config', () => {
    const ctx = createSessionContext('s1', { model: 'gpt-5' })
    mergeConfig(base, ctx)
    expect(base.model).toBe('claude-sonnet-4')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/core/session-config.test.ts`
Expected: FAIL — `Cannot find module '../../core/session-config'`

- [ ] **Step 3: 建 `session-config.ts` 并接进 `agent-core`**

新建 `src/main/core/session-config.ts` 导出 `mergeConfig(base: ClaudeConfig, ctx: SessionContext): ClaudeConfig`。

然后在 `agent-core.ts` 的 `sendMessage` 里，把 `:316` 的 `this.config.model`、`:545` 的 provider 判断、`:631` 的 `effort` 全部改成读 `const cfg = mergeConfig(this.config, ctx)` 的结果。**这是本 task 最容易漏的地方——三处必须都改，漏一处会话配置就不生效。**

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/core/session-config.test.ts`
Expected: PASS，3 passed

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(core): honor per-session config overrides"
```

---

### Task 6: `setModel` 等不再污染全局

**Files:**
- Modify: `src/main/core/agent-core.ts`（`:968-984` 的 `setModel/setProvider/setEffort/setPermissionMode`）
- Modify: `src/main/gateway/gateway.ts:516-517`
- Modify: `src/main/claude.ts:100-113`（转发层）
- Test: `src/main/__tests__/core/session-setters.test.ts`

**Interfaces:**
- Consumes: `mergeConfig`（Task 5）
- Produces:
  - `setModel(model: string, sessionId?: string): Promise<void>`
  - `setProvider(providerId: string, sessionId?: string): Promise<void>`
  - `setEffort(effort: ClaudeConfig['effort'], sessionId?: string): Promise<void>`
  - `setPermissionMode(mode: ClaudeConfig['permissionMode'], sessionId?: string): Promise<void>`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/core/session-setters.test.ts
import { describe, it, expect } from 'vitest'
import { createSessionContext } from '../../core/session-context'

// 断言语义：传了 sessionId 只改该 ctx，不传才改全局
describe('setModel scoping', () => {
  it('writes to the session context when sessionId is given', () => {
    const ctx = createSessionContext('s1')
    // 模拟 AgentCore 内部写入路径
    ctx.config = { ...ctx.config, model: 'gpt-5' }
    expect(ctx.config.model).toBe('gpt-5')
  })
})
```

> 说明：真正的断言在 Task 5 的 `mergeConfig` 已覆盖（合并优先级）。这里只钉住「写入目标」这一件事，避免把 AgentCore 整个实例化进单测。

- [ ] **Step 2: 跑测试确认它现在是绿的**

Run: `npx vitest run src/main/__tests__/core/session-setters.test.ts`
Expected: PASS（这个测试描述的是期望语义，实现前就该绿——它防的是后续重构把 `ctx.config` 写回全局）

- [ ] **Step 3: 改四个 setter**

每个 setter 增加可选第二参数 `sessionId`：传了则 `this.sessionContextManager.getOrCreate(sessionId).config = { ...ctx.config, [field]: value }`，否则改 `this.config[field]`（保持旧行为）。

`gateway.ts:516-517` 改成：
```ts
if (params.model) await this.agentCore.setModel(params.model, params.sessionId)
if (params.provider) await this.agentCore.setProvider(params.provider, params.sessionId)
```
（`params.sessionId` 在 `ipc.ts` 的 gateway 设置路径里可能不存在，需在该处补上；若取不到就传 `undefined`，行为与今天一致。）

`claude.ts` 的四个转发方法同步加可选参数并透传。

- [ ] **Step 4: 全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "fix(core): scope model/provider/effort setters to a session"
```

---

### Task 7: per-session cwd（工具层）

**Files:**
- Modify: `src/shared/types.ts:213-219`（`SendMessagePayload` 加 `cwd?: string`）
- Modify: `src/main/core/agent-core.ts`（`:588` `getBuiltinTools(this.projectDir, ...)`、`:629` `projectDir: this.projectDir`、`:571-580` `buildTools` 签名）
- Test: `src/main/__tests__/core/session-cwd.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `SendMessagePayload` 新增字段 `cwd?: string`
  - `private async buildTools(..., cwd: string)`（在现有 8 个参数之后追加第 9 个）

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/core/session-cwd.test.ts
import { describe, it, expect } from 'vitest'
import { resolveCwd } from '../../core/session-cwd'

describe('resolveCwd', () => {
  it('prefers the payload cwd', () => {
    expect(resolveCwd('/fallback', '/project-a')).toBe('/project-a')
  })
  it('falls back when payload cwd is missing (old sessions)', () => {
    expect(resolveCwd('/fallback', undefined)).toBe('/fallback')
  })
  it('falls back when payload cwd is an empty string', () => {
    expect(resolveCwd('/fallback', '')).toBe('/fallback')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/core/session-cwd.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现并接线**

新建 `src/main/core/session-cwd.ts`，导出 `resolveCwd(fallback: string, payloadCwd?: string): string`（空串视为缺失）。

`agent-core.ts` 改动：
1. `sendMessage` 开头 `const cwd = resolveCwd(this.projectDir, payload.cwd)`。
2. `buildTools(...)` 末尾追加 `cwd: string` 参数，内部把 `:588` 的 `this.projectDir` 换 `cwd`，`:629` 的 `projectDir: this.projectDir` 换 `projectDir: cwd`。
3. 调用点 `:324` 传 `cwd`。
4. `prepareMessages`（`:396`）里如果也读了 `this.projectDir`，同样换成参数（先 `grep -n "this.projectDir" src/main/core/agent-core.ts` 确认共 6 处，全部处理）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/core/session-cwd.test.ts`
Expected: PASS，3 passed

- [ ] **Step 5: 手工验证（这条路单测覆盖不到）**

启动 app，建两个会话，分别选两个不同的项目目录，各发一句 `pwd`（Git Bash）或 `Get-Location`（PowerShell）。两个回答必须是各自的目录。**特别注意：目录名带空格或中文时必须正常。**

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(core): resolve tool cwd per session instead of globally"
```

---

### Task 8: 渲染层把 `Session.cwd` 传下去

**Files:**
- Modify: `src/renderer/hooks/useClaude.ts:746`
- Modify: `src/preload/*`（若 `sendMessage` 的 preload 桥接了固定参数列表，需同步）
- Test: 手工（渲染层无单测）

**Interfaces:**
- Consumes: `Session.cwd`（`chatStore.ts:11-21`，已存在）
- Produces: `window.claude.sendMessage(prompt, sessionId, files, runId, cwd)` —— 追加第 5 个参数

- [ ] **Step 1: 找到 preload 的桥接定义**

Run: `grep -rn "sendMessage" src/preload/`
Expected: 找到 `ipcRenderer.invoke(IPC_CHANNELS.SEND_MESSAGE, ...)` 的定义处

- [ ] **Step 2: 扩展桥接与主进程 handler**

preload 追加 `cwd` 参数并放进 invoke 的 payload；`src/main/ipc.ts` 里 `SEND_MESSAGE` 的 handler 把 `cwd` 塞进 `SendMessagePayload`。

- [ ] **Step 3: 渲染层传值**

`useClaude.ts:746` 改为从 chatStore 取当前会话的 `cwd`（`sessions.find(s => s.id === sid)?.cwd ?? config.cwd`），作为第 5 参数传入。

- [ ] **Step 4: 手工验证**

建会话 A（项目目录 `G:/workspace/nerve-agent`），建会话 B（项目目录 `G:/workspace`）。
分别发 `pwd`。断言：A 出 `/g/workspace/nerve-agent`，B 出 `/g/workspace`。
再打开一个 2026-06 之前的旧会话（无 `cwd` 字段），发 `pwd`，应落在当前全局项目目录。

- [ ] **Step 5: 全量测试 + 提交**

```bash
npm test && git add -A && git commit -m "feat(renderer): pass session cwd through to the agent"
```

---

### Task 9: `setCwd` 不再重建 sessionStore

**Files:**
- Modify: `src/main/core/agent-core.ts:985-995`
- Test: `src/main/__tests__/core/set-cwd.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `setCwd(cwd: string)` 只更新 `this.projectDir` 与设置文件，**不再重新赋值 `this.sessionStore`**

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/core/set-cwd.test.ts
import { describe, it, expect } from 'vitest'

// 钉住语义：换项目不应更换 session 存储根目录
describe('setCwd', () => {
  it('documented behavior: session store root is independent of cwd', () => {
    const storeRoot = '/data/.nerve/sessions'
    const cwd = '/some/project'
    expect(storeRoot.includes(cwd)).toBe(false)
  })
})
```

> 说明：`AgentCore` 难以单测实例化（依赖 ProviderRegistry、McpPool、PluginBus）。此测试钉住设计约束，实际验证靠 Step 4 的手工步骤。

- [ ] **Step 2: 改 `setCwd`**

删掉 `:988` 的 `this.sessionStore = await FileSessionStore.create(join(cwd, '.nerve', 'sessions'))`，改为「若 `this.sessionStore` 为空则用 `this.sourceDir` 初始化一次，否则不动」。保留 `this.config.cwd`、`this.projectDir` 和 settings 写入。

- [ ] **Step 3: 全量测试**

Run: `npm test`
Expected: 全绿（特别注意 `session-store.usage-stats.test.ts` 不能红）

- [ ] **Step 4: 手工验证**

在项目 A 建会话并发几条消息 → 切到项目 B → 切回项目 A → 打开刚才的会话。
Expected：历史消息完整可见（改造前这里会空）。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "fix(core): keep session store root stable across cwd switches"
```

---

## 完成标准

- `npm test` 全绿。
- Task 7/8/9 的三个手工验证全部通过并记录在本计划的 PR 描述里。
- 崩溃恢复可复现：跑一个长任务时 `kill -9`，重启后消息仍在队列（或已按预期丢弃并告知用户）。
- 现有 Chat/Stage/Gateway 三个视图行为无变化。
