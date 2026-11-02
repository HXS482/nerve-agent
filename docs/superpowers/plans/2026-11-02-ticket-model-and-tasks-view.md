# 阶段 3-4：Ticket 领域模型 + 调度槽位 + Tasks 视图

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把并发单位从「人」改成「任务（Ticket）」，让一个人能同时持有多个独立上下文的任务，并在右侧栏给出 Tasks 视图。

**Architecture:** 在 `TicketStore` 里补 `ticket`/`assignment`/`input` 三张表；新增 `ticket-router` 负责 dispatch（按 `threadKey` 归并）与槽位调度（含 1 个 human 槽位）。渲染层只在 `RightSidebar` 新增第 5 个视图，不动 `SessionList`。

**Tech Stack:** TypeScript、Electron、better-sqlite3、React 18、zustand、vitest

**Spec:** `docs/superpowers/specs/2026-11-02-ticket-superagent-design.md`（§6、§7.2、§7.4、§8 阶段 3-4）

**前置：** 必须先完成 `2026-11-02-persistent-queue-and-session-isolation.md`（`TicketStore.open`、`EffectRunner`、`resolveCwd`、`mergeConfig` 都必须已存在）。

## Global Constraints

- 不新增 npm 依赖。
- `threadKey` 格式固定为：Telegram 私聊 `tg:chat:<chatId>`、Telegram 话题 `tg:chat:<chatId>:topic:<topicId>`、Discord `dc:guild:<guildId>:channel:<channelId>`、本地 `local:<sessionId>`。
- 槽位：`concurrencyLimit` 默认 3，**另有 1 个 human 槽位**，人的消息可占用，system/CI Input 只能等 normal 槽位。
- Stage 名称固定为 7 个：`delivery`/`answer`/`review`/`blocked`/`queued`/`idle`/`working`。
- 新增 IPC 一律用 `IPC_CHANNELS.TICKET_*` 常量。
- 现有三个视图（flow/folder/git/gateway）行为不得变化。

## Review Focus

- **一个用户同时发两件事**：必须是两个独立 Ticket、两套上下文，互不串台。
- **长任务进行中人插话**：必须立刻响应（human 槽位），不能排队等前面跑完。
- **同一 thread 的后续消息**：必须落回同一 Ticket，不能每次新建。
- **进程重启后的 in-flight Ticket**：`running` 状态的 Assignment 必须被标成可恢复，而不是永远卡在 working。
- **停止一个 Ticket**：只影响它自己，其他 Ticket 和它所在的 Session 不能被误杀。

---

### Task 1: ticket / assignment / input 三张表

**Files:**
- Modify: `src/main/store/ticket-store.ts`（`open()` 里的建表语句）
- Test: `src/main/__tests__/store/ticket-store-schema.test.ts`

**Interfaces:**
- Consumes: `TicketStore.open()`（前一份计划 Task 1）
- Produces: `TicketStore` 新增以下方法
  - `insertTicket(t: TicketRow): void`
  - `findTicketByThread(threadKey: string): TicketRow | undefined`（只看未结束的）
  - `getTicket(id: string): TicketRow | undefined`
  - `listTickets(opts?: { includeEnded?: boolean; limit?: number }): TicketRow[]`
  - `updateTicketStage(id: string, stage: TicketStage, lastActiveAt: number): void`
  - `endTicket(id: string, at: number): void`
  - `insertAssignment(a: AssignmentRow): void`
  - `latestAssignment(ticketId: string): AssignmentRow | undefined`
  - `updateAssignmentStatus(id: string, status: 'pending' | 'running' | 'ended', error?: string): void`
  - `insertInput(i: InputRow): void`
  - `markInputDelivered(id: string, at: number): void`

  类型（放在 `src/main/store/ticket-types.ts`）：
  ```ts
  export type TicketStage = 'delivery' | 'answer' | 'review' | 'blocked' | 'queued' | 'idle' | 'working'
  export interface TicketRow {
    id: string; title: string; cwd: string; sessionId: string
    platform?: string; userId?: string; chatId?: string
    threadKey: string; stage: TicketStage; mandate?: string
    createdAt: number; lastActiveAt: number; endedAt?: number
  }
  export interface AssignmentRow {
    id: string; ticketId: string; status: 'pending' | 'running' | 'ended'
    error?: string; createdAt: number; endedAt?: number
  }
  export interface InputRow {
    id: string; ticketId: string; kind: 'human' | 'system'
    body: string; seq: number; deliveredAt?: number
  }
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/store/ticket-store-schema.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'

describe('ticket schema', () => {
  let dir: string, store: TicketStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tk-')); store = TicketStore.open(join(dir, 't.db')) })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  const base = {
    id: 't1', title: 'first', cwd: '/p', sessionId: 's1',
    threadKey: 'tg:chat:42', stage: 'queued' as const,
    createdAt: 1, lastActiveAt: 1,
  }

  it('creates the three tables', () => {
    const names = (store.rawQuery(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ticket','assignment','input')",
    ) as Array<{ name: string }>).map(r => r.name).sort()
    expect(names).toEqual(['assignment', 'input', 'ticket'])
  })

  it('finds an open ticket by thread key', () => {
    store.insertTicket(base)
    expect(store.findTicketByThread('tg:chat:42')?.id).toBe('t1')
  })

  it('does not return a ticket once it has ended', () => {
    store.insertTicket(base)
    store.endTicket('t1', 2)
    expect(store.findTicketByThread('tg:chat:42')).toBeUndefined()
  })

  it('updates the stage', () => {
    store.insertTicket(base)
    store.updateTicketStage('t1', 'working', 5)
    const t = store.getTicket('t1')!
    expect(t.stage).toBe('working')
    expect(t.lastActiveAt).toBe(5)
  })

  it('returns the latest assignment only', () => {
    store.insertTicket(base)
    store.insertAssignment({ id: 'a1', ticketId: 't1', status: 'ended', createdAt: 1 })
    store.insertAssignment({ id: 'a2', ticketId: 't1', status: 'running', createdAt: 2 })
    expect(store.latestAssignment('t1')!.id).toBe('a2')
  })

  it('excludes ended tickets from listTickets by default', () => {
    store.insertTicket(base)
    store.insertTicket({ ...base, id: 't2', threadKey: 'tg:chat:43' })
    store.endTicket('t2', 3)
    expect(store.listTickets().map(t => t.id)).toEqual(['t1'])
    expect(store.listTickets({ includeEnded: true })).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/store/ticket-store-schema.test.ts`
Expected: FAIL — `store.insertTicket is not a function`

- [ ] **Step 3: 建表 + 实现 11 个方法**

建表 SQL 用 spec §7.1 原文。`findTicketByThread` 必须带 `AND ended_at IS NULL`。`latestAssignment` 用 `ORDER BY created_at DESC LIMIT 1`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/store/ticket-store-schema.test.ts`
Expected: PASS，6 passed

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(store): add ticket/assignment/input tables"
```

---

### Task 2: Stage 判定函数

**Files:**
- Create: `src/main/gateway/ticket-stage.ts`
- Test: `src/main/__tests__/gateway/ticket-stage.test.ts`

**Interfaces:**
- Consumes: `TicketStage`、`AssignmentRow`（Task 1）
- Produces: `computeStage(input: { assignment?: AssignmentRow; deliveryFailed?: boolean; hasAttention?: boolean; lastReport?: 'progress'|'waiting'|'ready'|'blocked'|'failed'; humanMessageSinceReport?: boolean }): TicketStage`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/gateway/ticket-stage.test.ts
import { describe, it, expect } from 'vitest'
import { computeStage } from '../../gateway/ticket-stage'

const A = (status: 'pending' | 'running' | 'ended') => ({ id: 'a', ticketId: 't', status, createdAt: 1 })

describe('computeStage', () => {
  it('delivery wins over everything', () => {
    expect(computeStage({ deliveryFailed: true, hasAttention: true })).toBe('delivery')
  })
  it('attention beats review', () => {
    expect(computeStage({ hasAttention: true, lastReport: 'ready' })).toBe('answer')
  })
  it('ready report is review', () => {
    expect(computeStage({ lastReport: 'ready' })).toBe('review')
  })
  it('blocked only while no human message has arrived since', () => {
    expect(computeStage({ lastReport: 'blocked', humanMessageSinceReport: false })).toBe('blocked')
    expect(computeStage({ lastReport: 'blocked', humanMessageSinceReport: true })).toBe('working')
  })
  it('no assignment is queued', () => {
    expect(computeStage({})).toBe('queued')
  })
  it('pending assignment is queued', () => {
    expect(computeStage({ assignment: A('pending') })).toBe('queued')
  })
  it('waiting report is idle', () => {
    expect(computeStage({ assignment: A('ended'), lastReport: 'waiting' })).toBe('idle')
  })
  it('running assignment is working', () => {
    expect(computeStage({ assignment: A('running') })).toBe('working')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/gateway/ticket-stage.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 `computeStage`**

严格按 spec §6 的阶段表自上而下判定，先命中先返回。注意 `blocked`/`failed` 共用 `blocked` 阶段。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/gateway/ticket-stage.test.ts`
Expected: PASS，8 passed

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(gateway): add ticket stage computation"
```

---

### Task 3: 槽位调度器

**Files:**
- Create: `src/main/gateway/slot-scheduler.ts`
- Test: `src/main/__tests__/gateway/slot-scheduler.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type SlotKind = 'human' | 'normal'`
  - `class SlotScheduler`，`constructor(opts: { concurrency: number })`
  - `acquire(kind: SlotKind): Promise<() => void>`（返回 release 函数）
  - `get active(): { normal: number; human: number }`
  - `setConcurrency(n: number): void`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/gateway/slot-scheduler.test.ts
import { describe, it, expect } from 'vitest'
import { SlotScheduler } from '../../gateway/slot-scheduler'

describe('SlotScheduler', () => {
  it('caps normal slots at concurrency', async () => {
    const s = new SlotScheduler({ concurrency: 2 })
    const r1 = await s.acquire('normal')
    const r2 = await s.acquire('normal')
    expect(s.active.normal).toBe(2)
    let third = false
    const p = s.acquire('normal').then(r => { third = true; return r })
    await new Promise(r => setTimeout(r, 10))
    expect(third).toBe(false)      // 被挡住
    r1()
    const r3 = await p
    expect(third).toBe(true)       // 释放后立刻拿到
    r2(); r3()
  })

  it('lets a human slot through even when normal slots are full', async () => {
    const s = new SlotScheduler({ concurrency: 1 })
    const r1 = await s.acquire('normal')
    const rh = await s.acquire('human')   // 不该被挡住
    expect(s.active.human).toBe(1)
    r1(); rh()
  })

  it('only allows one human slot at a time', async () => {
    const s = new SlotScheduler({ concurrency: 1 })
    const rh = await s.acquire('human')
    let second = false
    const p = s.acquire('human').then(r => { second = true; return r })
    await new Promise(r => setTimeout(r, 10))
    expect(second).toBe(false)
    rh()
    const rh2 = await p
    expect(second).toBe(true)
    rh2()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/gateway/slot-scheduler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 `SlotScheduler`**

用 FIFO 等待队列：每次 release 时先看有没有等在 human 队列里的（human 优先），再按 normal 的等待顺序发放。human 容量恒为 1。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/gateway/slot-scheduler.test.ts`
Expected: PASS，3 passed

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(gateway): add slot scheduler with a reserved human slot"
```

---

### Task 4: `threadKey` 推导

**Files:**
- Create: `src/main/gateway/thread-key.ts`
- Test: `src/main/__tests__/gateway/thread-key.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `deriveThreadKey(msg: { platform: string; chatId: string; threadId?: string; guildId?: string; topicId?: string; localSessionId?: string }): string`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/gateway/thread-key.test.ts
import { describe, it, expect } from 'vitest'
import { deriveThreadKey } from '../../gateway/thread-key'

describe('deriveThreadKey', () => {
  it('telegram private chat', () => {
    expect(deriveThreadKey({ platform: 'telegram', chatId: '42' })).toBe('tg:chat:42')
  })
  it('telegram topic', () => {
    expect(deriveThreadKey({ platform: 'telegram', chatId: '42', topicId: '7' })).toBe('tg:chat:42:topic:7')
  })
  it('discord guild channel', () => {
    expect(deriveThreadKey({ platform: 'discord', chatId: 'c1', guildId: 'g1' })).toBe('dc:guild:g1:channel:c1')
  })
  it('local session', () => {
    expect(deriveThreadKey({ platform: 'local', chatId: '', localSessionId: 's9' })).toBe('local:s9')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/gateway/thread-key.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 + 接入 gateway**

实现 `deriveThreadKey`（格式见本计划 Global Constraints）。然后在 `gateway.ts` 的 `handleAdapterMessage`（约 `:280`）里，在 `sessionRouter.resolve` 之后加上 `const threadKey = deriveThreadKey(...)`，传给 Task 5 的 `ticketRouter.dispatch`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/gateway/thread-key.test.ts`
Expected: PASS，4 passed

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(gateway): derive stable thread keys per platform"
```

---

### Task 5: `TicketRouter` —— dispatch 与执行

**Files:**
- Create: `src/main/gateway/ticket-router.ts`
- Test: `src/main/__tests__/gateway/ticket-router.test.ts`

**Interfaces:**
- Consumes: `TicketStore`（Task 1）、`computeStage`（Task 2）、`SlotScheduler`（Task 3）、`deriveThreadKey`（Task 4）、`resolveCwd`/`mergeConfig`（前一份计划）
- Produces:
  - `class TicketRouter`，`constructor(deps: { store: TicketStore; scheduler: SlotScheduler; agentCore: AgentCore; runner?: EffectRunner })` —— `runner` 可选，本计划只用来在 Task 6 的恢复后重新入队，多数测试不需要传。
  - `dispatch(msg: DispatchMessage, channel: OutputChannel): void`
  - `stop(ticketId: string): void`
  - `start(): void`
  - `onChanged(fn: (ticket: TicketRow) => void): void`
  - `interface DispatchMessage { platform: string; userId: string; chatId: string; threadKey: string; text: string; cwd: string; files?: FileAttachment[] }`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/gateway/ticket-router.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'
import { TicketRouter } from '../../gateway/ticket-router'
import { SlotScheduler } from '../../gateway/slot-scheduler'

describe('TicketRouter', () => {
  let dir: string, store: TicketStore, core: any, router: TicketRouter, channel: any

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tr-'))
    store = TicketStore.open(join(dir, 't.db'))
    channel = { sendText: vi.fn(), sendDone: vi.fn(), sendError: vi.fn() }
    core = { sendMessage: vi.fn().mockResolvedValue(undefined), cancelSession: vi.fn() }
    router = new TicketRouter({ store, scheduler: new SlotScheduler({ concurrency: 2 }), agentCore: core })
    router.start()
  })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  const msg = (threadKey: string, text: string) => ({
    platform: 'telegram', userId: 'u1', chatId: '42', threadKey, text, cwd: '/p',
  })

  it('creates a ticket on the first message of a thread', async () => {
    router.dispatch(msg('tg:chat:42', 'first'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(1))
    expect(store.listTickets()).toHaveLength(1)
  })

  it('routes a second message in the same thread to the same ticket', async () => {
    router.dispatch(msg('tg:chat:42', 'first'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(1))
    router.dispatch(msg('tg:chat:42', 'second'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(2))
    expect(store.listTickets()).toHaveLength(1)
  })

  it('creates separate tickets for different threads', async () => {
    router.dispatch(msg('tg:chat:42', 'a'), channel)
    router.dispatch(msg('tg:chat:43', 'b'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(2))
    expect(store.listTickets()).toHaveLength(2)
  })

  it('passes the ticket cwd into sendMessage', async () => {
    router.dispatch(msg('tg:chat:42', 'x'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalled())
    expect(core.sendMessage.mock.calls[0][0]).toMatchObject({ cwd: '/p' })
  })

  it('does not block a second thread while the first is running', async () => {
    let release!: () => void
    core.sendMessage.mockImplementationOnce(() => new Promise<void>(r => { release = r }))
    router.dispatch(msg('tg:chat:42', 'slow'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(1))
    router.dispatch(msg('tg:chat:43', 'fast'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(2))  // 并行
    release()
  })

  it('stop() cancels only that ticket', async () => {
    router.dispatch(msg('tg:chat:42', 'a'), channel)
    router.dispatch(msg('tg:chat:43', 'b'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(2))
    const t = store.listTickets().find(x => x.threadKey === 'tg:chat:42')!
    router.stop(t.id)
    expect(core.cancelSession).toHaveBeenCalledWith(t.sessionId)
    expect(core.cancelSession).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/gateway/ticket-router.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 `TicketRouter`**

`dispatch` 流程：`findTicketByThread` → 有则复用，无则建 Ticket（`stage: 'queued'`）+ 首次 Assignment → `insertInput(kind: 'human')` → 异步跑 `runTicket`。

`runTicket`：`scheduler.acquire('human')` → `updateAssignmentStatus('running')` → `updateTicketStage('working')` → `agentCore.sendMessage({ prompt, sessionId, cwd, files }, channel, ctx)` → 成功后 `updateAssignmentStatus('ended')` 并设 `idle`（或 `ready` 相关阶段，本 Task 先统一 `idle`）→ `release()` → `onChanged` 回调。

**关键**：不同 thread 的 `runTicket` 必须并行（不要 await），这是取消串行的核心。同一 thread 内用 `per-ticket` 的 Promise 链保证顺序。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/gateway/ticket-router.test.ts`
Expected: PASS，6 passed

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(gateway): add TicketRouter with per-thread concurrency"
```

---

### Task 6: 进程重启后恢复 in-flight Ticket

**Files:**
- Modify: `src/main/gateway/ticket-router.ts`
- Test: `src/main/__tests__/gateway/ticket-router-recover.test.ts`

**Interfaces:**
- Consumes: `TicketRouter.start()`（Task 5）
- Produces: `start()` 在注册 handler 之外，额外做一次恢复：所有 `status='running'` 的 Assignment 改为 `status='pending'`，其 Ticket 阶段回到 `queued`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/gateway/ticket-router-recover.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'
import { TicketRouter } from '../../gateway/ticket-router'
import { SlotScheduler } from '../../gateway/slot-scheduler'

describe('TicketRouter recovery', () => {
  let dir: string, store: TicketStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rec-')); store = TicketStore.open(join(dir, 't.db')) })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  it('resets a running assignment to pending on start', () => {
    store.insertTicket({
      id: 't1', title: 'x', cwd: '/p', sessionId: 's1', threadKey: 'tg:chat:42',
      stage: 'working', createdAt: 1, lastActiveAt: 1,
    })
    store.insertAssignment({ id: 'a1', ticketId: 't1', status: 'running', createdAt: 1 })

    const router = new TicketRouter({
      store, scheduler: new SlotScheduler({ concurrency: 1 }),
      agentCore: { sendMessage: async () => {}, cancelSession: () => {} } as any,
    })
    router.start()

    expect(store.latestAssignment('t1')!.status).toBe('pending')
    expect(store.getTicket('t1')!.stage).toBe('queued')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/__tests__/gateway/ticket-router-recover.test.ts`
Expected: FAIL — status 仍是 `running`

- [ ] **Step 3: 在 `start()` 里加恢复逻辑**

在 `TicketStore` 加一个方法 `recoverRunningAssignments(now: number): number`：`UPDATE assignment SET status='pending' WHERE status='running'`，并把对应 ticket 的 stage 设回 `queued`，返回影响行数。在 `TicketRouter.start()` 里调用它。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/__tests__/gateway/ticket-router-recover.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(gateway): recover interrupted assignments on startup"
```

---

### Task 7: gateway 接到 TicketRouter

**Files:**
- Modify: `src/main/gateway/gateway.ts`（`:280-310` 的消息入口）
- Test: 手工

**Interfaces:**
- Consumes: `TicketRouter.dispatch`（Task 5）
- Produces: `Gateway` 构造里创建 `TicketRouter` 实例并暴露 `getTicketRouter(): TicketRouter`

- [ ] **Step 1: 替换消息入口**

把 `gateway.ts:306` 的 `this.sessionRouter.submit(sessionId, msg.content, channel, files)` 换成 `this.ticketRouter.dispatch({ platform, userId, chatId, threadKey, text: msg.content, cwd, files }, channel)`。`cwd` 从 gateway 配置取（`process.env.NERVE_GATEWAY_PROJECT` 或 `projectDir`）。

保留 `sessionRouter.resolve` 用于建 `sessionId`（Ticket 需要它）。

- [ ] **Step 2: 手工验证（需要真实 Telegram bot）**

1. 启动 gateway，接一个 Telegram bot。
2. 同一用户连发两条不同话题的消息（比如「写个快速排序」和「今天天气怎么样」）。
3. Expected：两个 Ticket 并行出现；两条回答不串上下文。
4. 发第一条后立刻发第二条长任务消息，Expected：第二条立刻得到响应，不等第一条跑完。

- [ ] **Step 3: 全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat(gateway): route adapter messages through TicketRouter"
```

---

### Task 8: `TICKET_*` IPC 通道

**Files:**
- Modify: `src/shared/types.ts`（`IPC_CHANNELS`，紧跟 `GATEWAY_PUBLIC_ACCESS_SAVE` 之后）
- Modify: `src/main/ipc.ts`（注册 handler，参考 `:550-553` 的 `GATEWAY_SESSIONS`）
- Modify: `src/preload/*`（暴露给渲染层）
- Test: 手工（IPC 层无单测惯例）

**Interfaces:**
- Consumes: `TicketRouter`、`TicketStore`
- Produces:
  - `TICKET_LIST: 'ticket:list'` → `() => Promise<TicketRow[]>`
  - `TICKET_GET: 'ticket:get'` → `(id: string) => Promise<TicketRow | undefined>`
  - `TICKET_STOP: 'ticket:stop'` → `(id: string) => Promise<void>`
  - `TICKET_CHANGED: 'ticket:changed'` → 主进程 → 渲染层推送

- [ ] **Step 1: 加 channel 常量**

在 `types.ts` 的 `IPC_CHANNELS` 里加四个（三个 invoke + 一个 push）。

- [ ] **Step 2: 注册 handler**

`ipc.ts` 里：
```ts
ipcMain.handle(IPC_CHANNELS.TICKET_LIST, async () => ticketStore.listTickets())
ipcMain.handle(IPC_CHANNELS.TICKET_GET, async (_e, id: string) => ticketStore.getTicket(id))
ipcMain.handle(IPC_CHANNELS.TICKET_STOP, async (_e, id: string) => { ticketRouter.stop(id) })
```
推送照 `ipc.ts:18` 的 `GATEWAY_LOG` 写法：`ticketRouter.onChanged(t => window.webContents.send(IPC_CHANNELS.TICKET_CHANGED, t))`。

- [ ] **Step 3: preload 暴露**

在 preload 里加 `listTickets/getTicket/stopTicket/onTicketChanged` 四个方法，照现有 `GATEWAY_*` 的桥接写法。

- [ ] **Step 4: 手工验证**

在 devtools console 调 `await window.claude.listTickets()`，Expected：返回数组（可以为空）。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(ipc): expose ticket list/get/stop channels"
```

---

### Task 9: `ticketStore`（渲染层）

**Files:**
- Create: `src/renderer/stores/ticketStore.ts`
- Test: `src/renderer/stores/__tests__/ticketStore.test.ts`

**Interfaces:**
- Consumes: `TICKET_*` IPC（Task 8）
- Produces:
  - `useTicketStore`，state: `{ tickets: TicketRow[]; loading: boolean; filter: 'all' | 'local' }`
  - actions: `refresh(): Promise<void>`、`stop(id: string): Promise<void>`、`applyChange(t: TicketRow): void`、`setFilter(f: 'all' | 'local'): void`

- [ ] **Step 1: 写失败测试**

```ts
// src/renderer/stores/__tests__/ticketStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useTicketStore } from '../ticketStore'

const t = (id: string, platform?: string) => ({
  id, title: id, cwd: '/p', sessionId: 's1', threadKey: 'k',
  stage: 'working' as const, createdAt: 1, lastActiveAt: 1, platform,
})

describe('ticketStore', () => {
  beforeEach(() => { useTicketStore.setState({ tickets: [], loading: false, filter: 'all' }) })

  it('upserts an incoming change by id', () => {
    useTicketStore.getState().applyChange(t('a'))
    useTicketStore.getState().applyChange({ ...t('a'), stage: 'idle' })
    const list = useTicketStore.getState().tickets
    expect(list).toHaveLength(1)
    expect(list[0].stage).toBe('idle')
  })

  it('appends a new ticket', () => {
    useTicketStore.getState().applyChange(t('a'))
    useTicketStore.getState().applyChange(t('b'))
    expect(useTicketStore.getState().tickets).toHaveLength(2)
  })

  it('filters to local-only when asked', () => {
    useTicketStore.getState().applyChange(t('a', 'telegram'))
    useTicketStore.getState().applyChange(t('b'))          // 本地，无 platform
    useTicketStore.setState({ filter: 'local' })
    expect(useTicketStore.getState().visibleTickets()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/stores/__tests__/ticketStore.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 store**

用 `zustand`（照 `chatStore.ts` 的写法）。`visibleTickets()` 是派生函数，按 `filter` 过滤。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/renderer/stores/__tests__/ticketStore.test.ts`
Expected: PASS，3 passed

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(renderer): add ticket store"
```

---

### Task 10: `TasksView` 组件

**Files:**
- Create: `src/renderer/components/TasksView.tsx`
- Modify: `src/renderer/components/RightSidebar.tsx:40,42,470`
- Test: 手工

**Interfaces:**
- Consumes: `useTicketStore`（Task 9）
- Produces: `export function TasksView(): JSX.Element`

- [ ] **Step 1: 写组件（先静态渲染）**

骨架照 `GatewayView.tsx`：顶部一行标题 + 过滤切换（全部 / 仅本地），下面是列表。每行显示：
- 标题（`ticket.title`，超长省略）
- 阶段徽章（7 个 stage 各自的颜色，用现有 `styles/` 的 token，不要硬编码颜色）
- 相对时间（`lastActiveAt`）
- cwd 简写（取最后两段路径）
- 两个按钮：「打开会话」→ `setSessionId(ticket.sessionId)` + 切 chat 模式；「停止」→ `stop(ticket.id)`

空的列表状态给一句提示文案，不要空白页。

- [ ] **Step 2: 挂到 RightSidebar**

`RightSidebar.tsx` 三处改动：
1. `:40` `type RightSidebarView = 'flow' | 'folder' | 'git' | 'gateway' | 'tasks'`
2. `VIEWS` 数组加一项（id `'tasks'`，label `'Tasks'`，图标用一个列表/清单样式的 SVG，与现有图标风格一致）
3. `:470` `VIEW_COMPONENTS` 加 `tasks: TasksView`

- [ ] **Step 3: 订阅推送**

在 `TasksView` 里 `useEffect` 订阅 `window.claude.onTicketChanged(applyChange)`，并在挂载时 `refresh()`。卸载时取消订阅（照 `Sidebar.tsx:24-36` 的 cleanup 写法）。

- [ ] **Step 4: 手工验证**

1. 用 Telegram 发两件不同的事，制造两个 Ticket。
2. 打开右侧栏 Tasks 视图，Expected：两行，阶段徽章正确。
3. 点其中一行的「打开会话」，Expected：左栏跳到对应会话，消息可见。
4. 点另一行的「停止」，Expected：只有这一行消失，第一个 Ticket 继续跑。
5. 切到 flow/folder/git/gateway 四个原有视图，Expected：行为与改造前完全一致。

- [ ] **Step 5: 全量测试 + 提交**

```bash
npm test && git add -A && git commit -m "feat(renderer): add Tasks view to the right sidebar"
```

---

## 完成标准

- `npm test` 全绿。
- Task 7 / 10 的手工验证全部通过，记录在 PR 描述。
- 同一用户两件事并行、互不串台；长任务进行中人插话即时响应。
- 进程重启后 `running` 的 Assignment 自动回到 `pending`，不会永久卡住。
- 四个原有右侧栏视图行为无变化。
