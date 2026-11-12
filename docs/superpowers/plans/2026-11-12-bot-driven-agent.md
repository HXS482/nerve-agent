# Bot 驱动改造实现计划（Bot 实体 + Routines + Scheduler）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 nerve 从 session 驱动改成 bot 驱动：引入持久化 Bot 实体、Routine（定时任务）与 main 进程内 Scheduler，Bot 能在会话里自己创建/管理定时任务并在到期时自动执行。

**Architecture:** Bot 是 `NERVE_DIR/bots/<id>.json` 持久实体，session 挂 `botId`；Routine 存独立 `routines.db`（better-sqlite3）；Scheduler 在 Electron main 进程每 30s 扫描到期 routine，先快进 stamp 再 dispatch（复用 TicketRouter / 兜底直连 AgentCore）。模型侧通过 4 个内置工具管理 routine。

**Tech Stack:** TypeScript / Electron main / better-sqlite3 / vitest（`npm test` = `vitest run`）

**设计文档:** `docs/bot-driven-agent-design.md`（护栏、执行语义、出界范围以它为准）

## Global Constraints

- 护栏硬编码：触发下限 **15 分钟**、每 Bot 启用上限 **20 个**、连续失败 **10 次** 熄火。不做可配置。
- schedule 格式仅三种：`interval:<N>m`（N≥15）、`daily:HH:mm`、`weekly:<d>-<d>:HH:mm`（d∈0-6，0=周日）。不引 cron 库。
- 错过窗口跳过不补：`advanceStamp` 快进到未来第一个到期点。
- Routine 触发**不得依赖 Gateway 启动**。
- routine 数据放独立 `routines.db`，禁止写进 `tickets.db`。
- 测试命令一律在仓库根 `H:\Arch\Worktree\nerve-agent` 下跑：`npm test -- <path>`。
- 提交信息沿用仓库现有风格（`feat(scope): ...` / `test(scope): ...`）。
- 测试风格参照 `src/main/__tests__/gateway/ticket-router.test.ts`：`mkdtempSync` 临时目录、`vi.fn()` mock、中文用例名。
- Windows 环境：路径用 `join()`，不要硬编码分隔符。

## File Structure

```
src/main/core/schedule-time.ts       # schedule 解析 + 下次触发计算（新，纯函数，无依赖）
src/main/core/bot-registry.ts        # Bot 实体 CRUD（新，fs JSON）
src/main/store/routine-store.ts      # routines.db 数据层（新，better-sqlite3）
src/main/core/scheduler.ts           # 30s sweep 触发器（新）
src/main/core/system-prompt.ts       # 增加 bot 层（改）
src/main/core/agent-core.ts          # system prompt 拼 Bot instructions（改）
src/main/tools.ts                    # 追加 4 个 routine 工具（改）
src/main/gateway/gateway.ts          # 暴露 ensureQueue 给 Scheduler（改）
src/main/index.ts                    # 启动/停止 scheduler（改）
src/main/ipc.ts                      # routine IPC handlers（改）
src/shared/types.ts                  # RoutineRow / BotInfo 等类型（改）

测试：
src/main/__tests__/core/schedule-time.test.ts
src/main/__tests__/core/bot-registry.test.ts
src/main/__tests__/store/routine-store.test.ts
src/main/__tests__/core/scheduler.test.ts
```

模块依赖方向：`schedule-time` ← `routine-store` / `scheduler`；`bot-registry` 独立；`scheduler` 依赖 `routine-store` + `bot-registry` + 注入的 dispatch 函数（不直接 import TicketRouter，便于测试与解耦）。

---

### Task 1: schedule-time — schedule 解析与触发计算（纯函数）

**Files:**
- Create: `src/main/core/schedule-time.ts`
- Test: `src/main/__tests__/core/schedule-time.test.ts`

**Interfaces:**
- Produces（后续 Task 2/4/5 依赖，签名必须一致）:
  - `parseSchedule(raw: string): { ok: true; value: ScheduleSpec } | { ok: false; error: string }`
  - `type ScheduleSpec = { kind: 'interval'; minutes: number } | { kind: 'daily'; hour: number; minute: number } | { kind: 'weekly'; days: number[]; hour: number; minute: number }`
  - `nextRunAt(spec: ScheduleSpec, afterMs: number): number` — afterMs 之后（严格大于）的第一个到期时间戳
  - `MIN_INTERVAL_MINUTES = 15`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/core/schedule-time.test.ts
import { describe, it, expect } from 'vitest'
import { parseSchedule, nextRunAt, MIN_INTERVAL_MINUTES } from '../../core/schedule-time'

describe('parseSchedule', () => {
  it('解析 interval', () => {
    expect(parseSchedule('interval:15m')).toEqual({ ok: true, value: { kind: 'interval', minutes: 15 } })
    expect(parseSchedule('interval:60m')).toEqual({ ok: true, value: { kind: 'interval', minutes: 60 } })
  })
  it('interval 小于下限拒绝', () => {
    const r = parseSchedule('interval:5m')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('15')
  })
  it('interval 非数字/零/负数拒绝', () => {
    expect(parseSchedule('interval:abc').ok).toBe(false)
    expect(parseSchedule('interval:0m').ok).toBe(false)
    expect(parseSchedule('interval:-3m').ok).toBe(false)
  })
  it('解析 daily', () => {
    expect(parseSchedule('daily:09:30')).toEqual({ ok: true, value: { kind: 'daily', hour: 9, minute: 30 } })
  })
  it('daily 非法时间拒绝', () => {
    expect(parseSchedule('daily:24:00').ok).toBe(false)
    expect(parseSchedule('daily:09:60').ok).toBe(false)
    expect(parseSchedule('daily:9:30').ok).toBe(false) // 必须两位
  })
  it('解析 weekly 区间', () => {
    expect(parseSchedule('weekly:1-5:09:00')).toEqual({ ok: true, value: { kind: 'weekly', days: [1, 2, 3, 4, 5], hour: 9, minute: 0 } })
  })
  it('weekly 单日与乱序区间', () => {
    expect(parseSchedule('weekly:3-3:23:59')).toEqual({ ok: true, value: { kind: 'weekly', days: [3], hour: 23, minute: 59 } })
    expect(parseSchedule('weekly:0-6:08:00').ok).toBe(true)
  })
  it('weekly 非法 day 拒绝', () => {
    expect(parseSchedule('weekly:1-7:09:00').ok).toBe(false)
    expect(parseSchedule('weekly:5-1:09:00').ok).toBe(false)
  })
  it('未知格式拒绝', () => {
    expect(parseSchedule('every other tuesday').ok).toBe(false)
    expect(parseSchedule('').ok).toBe(false)
  })
})

describe('nextRunAt', () => {
  // 固定基准：2026-11-12 10:00:00 本地时间（周四）
  const base = new Date(2026, 10, 12, 10, 0, 0).getTime()

  it('interval：严格大于 after', () => {
    const spec = parseSchedule('interval:15m')
    expect(spec.ok && nextRunAt(spec.value, base)).toBe(base + 15 * 60_000)
    // after 恰好落在整点时也不能等于
    const later = nextRunAt({ kind: 'interval', minutes: 15 }, base + 15 * 60_000)
    expect(later).toBe(base + 30 * 60_000)
  })
  it('interval：after 在未来某次触发之后，快进到下一个', () => {
    // base + 2h，应快进到 base + 2h15m（跳过不补）
    const spec = { kind: 'interval', minutes: 15 } as const
    expect(nextRunAt(spec, base + 120 * 60_000)).toBe(base + 135 * 60_000)
  })
  it('daily：当天时间未过用今天，已过用明天', () => {
    const spec = { kind: 'daily', hour: 9, minute: 30 }
    // base 10:00 > 09:30 → 明天 09:30
    expect(nextRunAt(spec, base)).toBe(new Date(2026, 10, 13, 9, 30).getTime())
    const spec2 = { kind: 'daily', hour: 10, minute: 30 }
    expect(nextRunAt(spec2, base)).toBe(new Date(2026, 10, 12, 10, 30).getTime())
  })
  it('weekly：跳到下一个命中的日子', () => {
    // 2026-11-12 是周四(4)。weekly:1-5:11:00 → 今天周五还没到 11:00，用今天
    const spec = { kind: 'weekly', days: [1, 2, 3, 4, 5], hour: 11, minute: 0 }
    expect(nextRunAt(spec, base)).toBe(new Date(2026, 10, 12, 11, 0).getTime())
    // weekly:5-5:09:00（周五 9 点）→ 今天 10 点已过 9 点，明天周五 9 点
    const spec2 = { kind: 'weekly', days: [5], hour: 9, minute: 0 }
    expect(nextRunAt(spec2, base)).toBe(new Date(2026, 10, 13, 9, 0).getTime())
    // weekly:1-1:09:00（周一）→ 下周一 2026-11-16
    const spec3 = { kind: 'weekly', days: [1], hour: 9, minute: 0 }
    expect(nextRunAt(spec3, base)).toBe(new Date(2026, 10, 16, 9, 0).getTime())
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/main/__tests__/core/schedule-time.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/main/core/schedule-time.ts
/**
 * Routine schedule 的解析与触发计算。纯函数、无依赖，方便单测。
 *
 * 格式（设计文档 §4）：
 *   interval:<N>m      每 N 分钟，N >= MIN_INTERVAL_MINUTES
 *   daily:HH:mm        每天
 *   weekly:<d>-<d>:HH:mm  每周 [d1..d2] 天，d ∈ 0-6，0=周日
 */

export const MIN_INTERVAL_MINUTES = 15

export type ScheduleSpec =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; days: number[]; hour: number; minute: number }

export type ParseResult =
  | { ok: true; value: ScheduleSpec }
  | { ok: false; error: string }

const TIME_RE = /^(\d{2}):(\d{2})$/

function parseHhMm(s: string): { hour: number; minute: number } | null {
  const m = TIME_RE.exec(s)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export function parseSchedule(raw: string): ParseResult {
  const s = raw.trim()
  if (s.startsWith('interval:')) {
    const m = /^(\d+)m$/.exec(s.slice('interval:'.length).trim())
    if (!m) return { ok: false, error: 'interval 格式应为 interval:<N>m，如 interval:15m' }
    const minutes = Number(m[1])
    if (minutes < MIN_INTERVAL_MINUTES) {
      return { ok: false, error: `触发间隔不能小于 ${MIN_INTERVAL_MINUTES} 分钟` }
    }
    return { ok: true, value: { kind: 'interval', minutes } }
  }
  if (s.startsWith('daily:')) {
    const t = parseHhMm(s.slice('daily:'.length).trim())
    if (!t) return { ok: false, error: 'daily 格式应为 daily:HH:mm（两位数）' }
    return { ok: true, value: { kind: 'daily', ...t } }
  }
  if (s.startsWith('weekly:')) {
    // weekly:<d>-<d>:HH:mm
    const m = /^(\d)-(\d):(\d{2}):(\d{2})$/.exec(s.slice('weekly:'.length).trim())
    if (!m) return { ok: false, error: 'weekly 格式应为 weekly:<d>-<d>:HH:mm，d ∈ 0-6（0=周日）' }
    const from = Number(m[1])
    const to = Number(m[2])
    if (from > 6 || to > 6 || from > to) {
      return { ok: false, error: 'weekly 的 day 必须在 0-6 内且起点不大于终点' }
    }
    const hour = Number(m[3])
    const minute = Number(m[4])
    if (hour > 23 || minute > 59) return { ok: false, error: 'weekly 时间非法' }
    const days: number[] = []
    for (let d = from; d <= to; d++) days.push(d)
    return { ok: true, value: { kind: 'weekly', days, hour, minute } }
  }
  return { ok: false, error: '不支持的 schedule 格式。支持：interval:<N>m / daily:HH:mm / weekly:<d>-<d>:HH:mm' }
}

/** afterMs 之后（严格大于）的第一个到期时间戳 */
export function nextRunAt(spec: ScheduleSpec, afterMs: number): number {
  if (spec.kind === 'interval') {
    const step = spec.minutes * 60_000
    // 严格大于：落在边界上时跳到下一档
    return (Math.floor(afterMs / step) + 1) * step
  }
  const after = new Date(afterMs)
  // 从 after 所在天的 00:00 起逐天找
  const dayStart = new Date(after.getFullYear(), after.getMonth(), after.getDate()).getTime()
  for (let i = 0; i < 8; i++) {
    const day = new Date(dayStart + i * 86_400_000)
    if (spec.kind === 'weekly' && !spec.days.includes(day.getDay())) continue
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), spec.hour, spec.minute).getTime()
    if (at > afterMs) return at
  }
  // 不可达（8 天内必有命中）；防御性返回
  return afterMs + 86_400_000
}
```

注意：`i < 8` 是覆盖 weekly 全周 + 安全余量；interval 的对齐语义是**相对 epoch 的整档**（`floor/step`），这样「快进」天然成立——stamp 落在任意档位边界之后都会跳到下一档。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/main/__tests__/core/schedule-time.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/main/core/schedule-time.ts src/main/__tests__/core/schedule-time.test.ts
git commit -m "feat(core): schedule 解析与触发计算（routine 时间层）"
```

### Task 2: bot-registry — Bot 实体 CRUD

**Files:**
- Create: `src/main/core/bot-registry.ts`
- Test: `src/main/__tests__/core/bot-registry.test.ts`

**Interfaces:**
- Consumes: 无（独立模块；baseDir 由调用方传入，便于测试）
- Produces:
  - `interface BotInfo { id: string; name: string; instructions: string; isDefault: boolean; homeSessionId: string; boundSkills: string[]; boundMcp: string[]; createdAt: number; updatedAt: number }`
  - `class BotRegistry`: `static async create(baseDir: string): Promise<BotRegistry>` / `list(): Promise<BotInfo[]>` / `get(id: string): Promise<BotInfo | null>` / `getDefault(): Promise<BotInfo>` / `create(input: { name: string; instructions?: string; homeSessionId?: string; isDefault?: boolean }): Promise<BotInfo>` / `update(id: string, patch: Partial<Pick<BotInfo, 'name' | 'instructions' | 'homeSessionId' | 'boundSkills' | 'boundMcp'>>): Promise<BotInfo>` / `remove(id: string): Promise<boolean>`
  - `getDefault()` 语义：无任何 Bot 时自动创建默认 Bot（`name: 'Assistant'`, `isDefault: true`）——老用户零迁移的关键。

实现要点（写给零上下文的工程师）：
- `baseDir` 生产环境传 `join(NERVE_DIR, 'bots')`；`create()` 里 `mkdir -p`。
- id 格式 `bot_<randomUUID>`；文件名 `<id>.json`；每 Bot 一个文件。
- `remove` 不允许删默认 Bot（抛错）；不级联删 session（Task 6 的回落逻辑兜底）。

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/core/bot-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { BotRegistry } from '../../core/bot-registry'

describe('BotRegistry', () => {
  let dir: string, reg: BotRegistry

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bots-'))
    reg = await BotRegistry.create(join(dir, 'bots'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('空目录 getDefault 自动创建默认 Bot', async () => {
    const bot = await reg.getDefault()
    expect(bot.isDefault).toBe(true)
    expect(bot.name).toBe('Assistant')
    expect(bot.id).toMatch(/^bot_/)
  })

  it('create 与 get', async () => {
    const bot = await reg.create({ name: 'coder', instructions: '写代码', homeSessionId: 's1' })
    expect(bot.instructions).toBe('写代码')
    const got = await reg.get(bot.id)
    expect(got?.name).toBe('coder')
    expect(await reg.list()).toHaveLength(2) // 默认 + coder
  })

  it('update 修改字段并刷新 updatedAt', async () => {
    const bot = await reg.create({ name: 'a' })
    await new Promise((r) => setTimeout(r, 5))
    const upd = await reg.update(bot.id, { instructions: 'new' })
    expect(upd.instructions).toBe('new')
    expect(upd.updatedAt).toBeGreaterThanOrEqual(bot.updatedAt)
  })

  it('remove 禁止删除默认 Bot', async () => {
    const def = await reg.getDefault()
    await expect(reg.remove(def.id)).rejects.toThrow()
  })

  it('remove 普通 Bot', async () => {
    const bot = await reg.create({ name: 'x' })
    expect(await reg.remove(bot.id)).toBe(true)
    expect(await reg.get(bot.id)).toBeNull()
  })

  it('损坏的 JSON 文件被跳过不炸整体', async () => {
    const bot = await reg.create({ name: 'ok' })
    writeFileSync(join(dir, 'bots', 'bot_broken.json'), '{oops')
    const list = await reg.list()
    expect(list.map((b) => b.id)).toContain(bot.id)
    expect(list).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/main/__tests__/core/bot-registry.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/main/core/bot-registry.ts
/**
 * Bot 实体注册表（设计文档 §1）。一个 JSON 文件一个 Bot，存 NERVE_DIR/bots/。
 * session 是 Bot 的会话实例，通过 session 元数据的 botId 字段关联（Task 6）。
 */
import { mkdir, readdir, readFile, writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'

export interface BotInfo {
  id: string
  name: string
  instructions: string
  isDefault: boolean
  homeSessionId: string
  boundSkills: string[]
  boundMcp: string[]
  createdAt: number
  updatedAt: number
}

export class BotRegistry {
  private constructor(private baseDir: string) {}

  static async create(baseDir: string): Promise<BotRegistry> {
    await mkdir(baseDir, { recursive: true })
    return new BotRegistry(baseDir)
  }

  private path(id: string): string {
    return join(this.baseDir, `${id}.json`)
  }

  private async read(id: string): Promise<BotInfo | null> {
    try {
      return JSON.parse(await readFile(this.path(id), 'utf-8')) as BotInfo
    } catch {
      return null // 不存在或损坏都当没有
    }
  }

  async list(): Promise<BotInfo[]> {
    let names: string[] = []
    try {
      names = await readdir(this.baseDir)
    } catch {
      return []
    }
    const bots: BotInfo[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        bots.push(JSON.parse(await readFile(join(this.baseDir, name), 'utf-8')) as BotInfo)
      } catch {
        // 损坏文件跳过，不炸整体
      }
    }
    return bots
  }

  async get(id: string): Promise<BotInfo | null> {
    return this.read(id)
  }

  /** 取默认 Bot；一个都没有时自动创建（老用户零迁移）。 */
  async getDefault(): Promise<BotInfo> {
    const bots = await this.list()
    const existingDefault = bots.find((b) => b.isDefault)
    if (existingDefault) return existingDefault
    return this.create({ name: 'Assistant', isDefault: true })
  }

  async create(input: { name: string; instructions?: string; homeSessionId?: string; isDefault?: boolean }): Promise<BotInfo> {
    const now = Date.now()
    const bot: BotInfo = {
      id: `bot_${randomUUID()}`,
      name: input.name,
      instructions: input.instructions ?? '',
      isDefault: input.isDefault ?? false,
      homeSessionId: input.homeSessionId ?? '',
      boundSkills: [],
      boundMcp: [],
      createdAt: now,
      updatedAt: now,
    }
    await writeFile(this.path(bot.id), JSON.stringify(bot, null, 2), 'utf-8')
    return bot
  }

  async update(id: string, patch: Partial<Pick<BotInfo, 'name' | 'instructions' | 'homeSessionId' | 'boundSkills' | 'boundMcp'>>): Promise<BotInfo> {
    const bot = await this.read(id)
    if (!bot) throw new Error(`Bot not found: ${id}`)
    const updated: BotInfo = { ...bot, ...patch, updatedAt: Date.now() }
    await writeFile(this.path(id), JSON.stringify(updated, null, 2), 'utf-8')
    return updated
  }

  async remove(id: string): Promise<boolean> {
    const bot = await this.read(id)
    if (!bot) return false
    if (bot.isDefault) throw new Error('不能删除默认 Bot')
    await unlink(this.path(id))
    return true
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/main/__tests__/core/bot-registry.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/core/bot-registry.ts src/main/__tests__/core/bot-registry.test.ts
git commit -m "feat(core): Bot 实体注册表（JSON 持久化 + 默认 Bot 自建）"
```

---

### Task 3: routine-store — routines.db 数据层

**Files:**
- Create: `src/main/store/routine-store.ts`
- Test: `src/main/__tests__/store/routine-store.test.ts`

**Interfaces:**
- Consumes: `parseSchedule` / `nextRunAt`（Task 1 的 `src/main/core/schedule-time.ts`）
- Produces:
  - `interface RoutineRow { id: string; botId: string; sessionId: string; instruction: string; schedule: string; nextRunAt: number; enabled: boolean; consecutiveFailures: number; failureNotified: boolean; lastRunAt: number | null; createdBy: 'user' | 'model'; createdAt: number; updatedAt: number }`
  - `class RoutineStore`: `static open(dbPath: string): RoutineStore` / `close(): void` / `create(input: { botId; sessionId; instruction; schedule; createdBy }): RoutineRow`（schedule 非法抛错；该 Bot enabled 计数 ≥20 抛错）/ `get(id): RoutineRow | null` / `listByBot(botId, opts?: { includeDisabled?: boolean }): RoutineRow[]` / `listAll(): RoutineRow[]` / `due(now): RoutineRow[]` / `update(id, patch: { instruction?; schedule?; enabled? }): RoutineRow` / `remove(id): boolean` / `advanceStamp(id, now): void` / `recordSuccess(id): void` / `recordFailure(id): { notified: boolean; disabled: boolean }` / `lastSweep(): number | null` / `recordSweep(now): void`
  - 常量 `MAX_ENABLED_PER_BOT = 20`

疲劳规则语义（写给零上下文的工程师）：
- `recordFailure` 递增 `consecutiveFailures`；返回 `notified=true` 仅当本轮（上次 success/重新启用之后）首次失败。
- `consecutiveFailures >= 10` → `enabled=false`，返回 `disabled=true`（调用方发最终通知）。
- `recordSuccess` 清零 `consecutiveFailures` 与 `failureNotified`；重新启用（update enabled: true）同样清零。
- store 只管状态，通知由调用方（scheduler 的上游）根据返回值发。

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/store/routine-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RoutineStore } from '../../store/routine-store'

describe('RoutineStore', () => {
  let dir: string, store: RoutineStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rt-'))
    store = RoutineStore.open(join(dir, 'routines.db'))
  })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  const mk = (over: Record<string, string> = {}) =>
    store.create({ botId: 'bot_1', sessionId: 's1', instruction: '每天汇报', schedule: 'interval:15m', createdBy: 'model' as const, ...over } as any)

  it('create 计算 nextRunAt 并落库', () => {
    const r = mk()
    expect(r.id).toMatch(/^rt_/)
    expect(r.enabled).toBe(true)
    expect(r.nextRunAt).toBeGreaterThan(Date.now() - 1000)
    expect(r.consecutiveFailures).toBe(0)
  })

  it('create 非法 schedule 抛错', () => {
    expect(() => mk({ schedule: 'every minute' })).toThrow()
    expect(() => mk({ schedule: 'interval:5m' })).toThrow()
  })

  it('启用数量上限 20', () => {
    for (let i = 0; i < 20; i++) mk({ instruction: `job-${i}` })
    expect(() => mk({ instruction: 'job-21' })).toThrow(/20/)
  })

  it('禁用后不计入上限，重新启用被上限拦住', () => {
    for (let i = 0; i < 20; i++) mk({ instruction: `job-${i}` })
    const first = store.listByBot('bot_1')[0]
    store.update(first.id, { enabled: false })
    const r = mk({ instruction: 'job-21' })
    expect(r.enabled).toBe(true)
    expect(() => store.update(first.id, { enabled: true })).toThrow(/20/)
  })

  it('due 只返回 enabled 且到期的', () => {
    const a = mk()
    mk({ schedule: 'daily:23:59' })
    store.update(a.id, { enabled: false })
    expect(store.due(Date.now() + 16 * 60_000)).toHaveLength(0)
    const b = mk({ instruction: 'live' })
    expect(store.due(Date.now() + 16 * 60_000).map((r) => r.id)).toContain(b.id)
  })

  it('advanceStamp 快进到未来第一个到期点', () => {
    const r = mk()
    const future = Date.now() + 45 * 60_000
    store.advanceStamp(r.id, future)
    const after = store.get(r.id)!
    expect(after.nextRunAt).toBeGreaterThan(future)
    expect(after.nextRunAt).toBeLessThanOrEqual(future + 15 * 60_000 + 1000)
    expect(after.lastRunAt).not.toBeNull()
  })

  it('疲劳规则：首轮失败 notified，第 10 次熄火', () => {
    const r = mk()
    const f1 = store.recordFailure(r.id)
    expect(f1.notified).toBe(true)
    expect(f1.disabled).toBe(false)
    for (let i = 0; i < 8; i++) {
      expect(store.recordFailure(r.id).notified).toBe(false)
    }
    const f10 = store.recordFailure(r.id)
    expect(f10.notified).toBe(false)
    expect(f10.disabled).toBe(true)
    expect(store.get(r.id)!.enabled).toBe(false)
  })

  it('recordSuccess 清零，重新启用也清零', () => {
    const r = mk()
    store.recordFailure(r.id)
    store.recordSuccess(r.id)
    expect(store.recordFailure(r.id).notified).toBe(true)
    expect(store.get(r.id)!.consecutiveFailures).toBe(1)
    // 熄火后重新启用 → 计数清零
    for (let i = 0; i < 9; i++) store.recordFailure(r.id)
    store.recordFailure(r.id) // 第 10 次 → disabled
    store.update(r.id, { enabled: true })
    expect(store.get(r.id)!.consecutiveFailures).toBe(0)
  })

  it('sweep 心跳读写', () => {
    expect(store.lastSweep()).toBeNull()
    store.recordSweep(1000)
    store.recordSweep(2000)
    expect(store.lastSweep()).toBe(2000)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/main/__tests__/store/routine-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/main/store/routine-store.ts
/**
 * Routine 数据层（设计文档 §2）。独立 routines.db，不进 tickets.db。
 * 护栏（下限/上限）与疲劳规则的判定在这里，调用方只消费结果。
 */
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import { parseSchedule, nextRunAt } from '../core/schedule-time'

export interface RoutineRow {
  id: string
  botId: string
  sessionId: string
  instruction: string
  schedule: string
  nextRunAt: number
  enabled: boolean
  consecutiveFailures: number
  failureNotified: boolean
  lastRunAt: number | null
  createdBy: 'user' | 'model'
  createdAt: number
  updatedAt: number
}

export const MAX_ENABLED_PER_BOT = 20
const FAILURE_LIMIT = 10

type Database = any // better-sqlite3 惰性 require，与 ticket-store 同款

export class RoutineStore {
  private constructor(private db: Database) {}

  static open(dbPath: string): RoutineStore {
    mkdirSync(dirname(dbPath), { recursive: true })
    const Database = require('better-sqlite3')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, session_id TEXT NOT NULL,
        instruction TEXT NOT NULL, schedule TEXT NOT NULL,
        next_run_at INTEGER NOT NULL, enabled INTEGER DEFAULT 1,
        consecutive_failures INTEGER DEFAULT 0, failure_notified INTEGER DEFAULT 0,
        last_run_at INTEGER, created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_routines_bot ON routines(bot_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_routines_due ON routines(enabled, next_run_at);
      CREATE TABLE IF NOT EXISTS routine_sweeps (
        id INTEGER PRIMARY KEY AUTOINCREMENT, swept_at INTEGER NOT NULL
      );
    `)
    return new RoutineStore(db)
  }

  close(): void {
    this.db.close()
  }

  private rowToRoutine(r: any): RoutineRow {
    return {
      id: r.id, botId: r.bot_id, sessionId: r.session_id,
      instruction: r.instruction, schedule: r.schedule,
      nextRunAt: r.next_run_at, enabled: !!r.enabled,
      consecutiveFailures: r.consecutive_failures, failureNotified: !!r.failure_notified,
      lastRunAt: r.last_run_at, createdBy: r.created_by,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }
  }

  private countEnabled(botId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM routines WHERE bot_id = ? AND enabled = 1').get(botId) as { n: number }).n
  }

  create(input: { botId: string; sessionId: string; instruction: string; schedule: string; createdBy: 'user' | 'model' }): RoutineRow {
    const parsed = parseSchedule(input.schedule)
    if (!parsed.ok) throw new Error(`schedule 非法: ${parsed.error}`)
    if (this.countEnabled(input.botId) >= MAX_ENABLED_PER_BOT) {
      throw new Error(`该 Bot 启用中的 routine 已达上限 ${MAX_ENABLED_PER_BOT} 个`)
    }
    const now = Date.now()
    const row = {
      id: `rt_${randomUUID()}`,
      bot_id: input.botId, session_id: input.sessionId,
      instruction: input.instruction, schedule: input.schedule,
      next_run_at: nextRunAt(parsed.value, now),
      enabled: 1, consecutive_failures: 0, failure_notified: 0,
      last_run_at: null, created_by: input.createdBy,
      created_at: now, updated_at: now,
    }
    this.db.prepare(`INSERT INTO routines (id, bot_id, session_id, instruction, schedule, next_run_at, enabled, consecutive_failures, failure_notified, last_run_at, created_by, created_at, updated_at)
      VALUES (@id, @bot_id, @session_id, @instruction, @schedule, @next_run_at, @enabled, @consecutive_failures, @failure_notified, @last_run_at, @created_by, @created_at, @updated_at)`).run(row)
    return this.rowToRoutine(row)
  }

  get(id: string): RoutineRow | null {
    const r = this.db.prepare('SELECT * FROM routines WHERE id = ?').get(id)
    return r ? this.rowToRoutine(r) : null
  }

  listByBot(botId: string, opts: { includeDisabled?: boolean } = {}): RoutineRow[] {
    const sql = opts.includeDisabled
      ? 'SELECT * FROM routines WHERE bot_id = ? ORDER BY enabled DESC, next_run_at'
      : 'SELECT * FROM routines WHERE bot_id = ? AND enabled = 1 ORDER BY next_run_at'
    return (this.db.prepare(sql).all(botId) as any[]).map((r) => this.rowToRoutine(r))
  }

  listAll(): RoutineRow[] {
    return (this.db.prepare('SELECT * FROM routines').all() as any[]).map((r) => this.rowToRoutine(r))
  }

  due(now: number): RoutineRow[] {
    return (this.db.prepare('SELECT * FROM routines WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at').all(now) as any[]).map((r) => this.rowToRoutine(r))
  }

  update(id: string, patch: { instruction?: string; schedule?: string; enabled?: boolean }): RoutineRow {
    const cur = this.get(id)
    if (!cur) throw new Error(`routine not found: ${id}`)
    let nextAt = cur.nextRunAt
    if (patch.schedule !== undefined && patch.schedule !== cur.schedule) {
      const parsed = parseSchedule(patch.schedule)
      if (!parsed.ok) throw new Error(`schedule 非法: ${parsed.error}`)
      nextAt = nextRunAt(parsed.value, Date.now())
    }
    if (patch.enabled === true && !cur.enabled) {
      if (this.countEnabled(cur.botId) >= MAX_ENABLED_PER_BOT) {
        throw new Error(`该 Bot 启用中的 routine 已达上限 ${MAX_ENABLED_PER_BOT} 个`)
      }
      // 重新启用视为重新开始计数
      this.db.prepare('UPDATE routines SET consecutive_failures = 0, failure_notified = 0 WHERE id = ?').run(id)
    }
    this.db.prepare(`UPDATE routines SET
      instruction = COALESCE(?, instruction), schedule = COALESCE(?, schedule),
      next_run_at = ?, enabled = COALESCE(?, enabled), updated_at = ?
      WHERE id = ?`).run(
        patch.instruction ?? null, patch.schedule ?? null,
        nextAt, patch.enabled === undefined ? null : (patch.enabled ? 1 : 0),
        Date.now(), id)
    return this.get(id)!
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM routines WHERE id = ?').run(id).changes > 0
  }

  /** 快进 stamp 到未来第一个到期点（跳过不补，设计文档 §5）。 */
  advanceStamp(id: string, now: number): void {
    const cur = this.get(id)
    if (!cur) return
    const parsed = parseSchedule(cur.schedule)
    if (!parsed.ok) return
    this.db.prepare('UPDATE routines SET next_run_at = ?, last_run_at = ?, updated_at = ? WHERE id = ?')
      .run(nextRunAt(parsed.value, now), now, Date.now(), id)
  }

  recordSuccess(id: string): void {
    this.db.prepare('UPDATE routines SET consecutive_failures = 0, failure_notified = 0, updated_at = ? WHERE id = ?').run(Date.now(), id)
  }

  /** notified=本轮首次失败（调用方发通知）；disabled=连续失败达上限已熄火。 */
  recordFailure(id: string): { notified: boolean; disabled: boolean } {
    const cur = this.get(id)
    if (!cur) return { notified: false, disabled: false }
    const count = cur.consecutiveFailures + 1
    const first = !cur.failureNotified
    const disable = count >= FAILURE_LIMIT
    this.db.prepare('UPDATE routines SET consecutive_failures = ?, failure_notified = ?, enabled = ?, updated_at = ? WHERE id = ?')
      .run(count, first || cur.failureNotified ? 1 : 0, disable ? 0 : 1, Date.now(), id)
    return { notified: first, disabled: disable }
  }

  recordSweep(now: number): void {
    this.db.prepare('INSERT INTO routine_sweeps (swept_at) VALUES (?)').run(now)
  }

  lastSweep(): number | null {
    const r = this.db.prepare('SELECT MAX(swept_at) AS t FROM routine_sweeps').get() as { t: number | null }
    return r.t
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/main/__tests__/store/routine-store.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/store/routine-store.ts src/main/__tests__/store/routine-store.test.ts
git commit -m "feat(store): routines.db 数据层（护栏 + 疲劳规则 + 心跳）"
```

---

### Task 4: system prompt 接入 Bot instructions

**Files:**
- Modify: `src/main/core/system-prompt.ts`（`SystemPromptLayers` 增加 `bot` 字段）
- Modify: `src/main/core/agent-core.ts:472` 附近（`composeSystemPrompt` 调用处传入 Bot instructions）
- Test: `src/main/__tests__/core/system-prompt.test.ts`（追加用例）

**Interfaces:**
- Consumes: `BotRegistry`（Task 2）
- Produces: `SystemPromptLayers.bot?: string`，位于 soul 之后、persona 之前；`agent-core.ts` 新增 `private async resolveBot(sessionId: string): Promise<BotInfo>` 与占位 `private async getSessionBotId(sessionId: string): Promise<string | null>`（Task 6 换真实现）。

- [ ] **Step 1: 追加失败测试**

在现有 `src/main/__tests__/core/system-prompt.test.ts` 末尾追加（保留原内容）：

```ts
describe('bot 层', () => {
  it('bot instructions 拼在 soul 之后 persona 之前', () => {
    const p = composeSystemPrompt({ soul: 'S', bot: 'B', persona: 'P', memoryContext: 'M' })
    const si = p.indexOf('S'), bi = p.indexOf('B'), pi = p.indexOf('P'), mi = p.indexOf('M')
    expect(si).toBeLessThan(bi)
    expect(bi).toBeLessThan(pi)
    expect(pi).toBeLessThan(mi)
  })
  it('bot 为空时不产生空层', () => {
    const p = composeSystemPrompt({ soul: 'S', persona: 'P' })
    expect(p).not.toContain('<bot>')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/main/__tests__/core/system-prompt.test.ts`
Expected: FAIL（顺序断言失败 / `<bot>` 不存在）

- [ ] **Step 3: 实现 system-prompt.ts**

`SystemPromptLayers` 增加字段：

```ts
export interface SystemPromptLayers {
  soul?: string
  /** Bot 实体的角色指令（bot 驱动改造，设计文档 §1） */
  bot?: string
  persona?: string
  memoryContext?: string
}
```

`composeSystemPrompt` 解构参数加 `bot`，soul push 之后插入：

```ts
  const botText = bot?.trim()
  if (botText) layers.push(`<bot>\n${botText}\n</bot>`)
```

- [ ] **Step 4: agent-core.ts 接线**

1. 类内新增（懒初始化 BotRegistry，避免构造函数变 async）：

```ts
  private botRegistry: import('./bot-registry').BotRegistry | null = null

  private async getBotRegistry() {
    if (!this.botRegistry) {
      const { BotRegistry } = await import('./bot-registry')
      const { NERVE_DIR } = await import('../settings')
      this.botRegistry = await BotRegistry.create(join(NERVE_DIR, 'bots'))
    }
    return this.botRegistry
  }

  /** 解析会话所属 Bot：session 元数据 botId 优先，失效回落默认 Bot（设计文档 §1）。 */
  private async resolveBot(sessionId: string): Promise<import('./bot-registry').BotInfo> {
    const reg = await this.getBotRegistry()
    const botId = await this.getSessionBotId(sessionId)
    if (botId) {
      const bot = await reg.get(botId)
      if (bot) return bot
    }
    return reg.getDefault()
  }

  /** Task 6 前的占位实现：读不到返回 null。 */
  private async getSessionBotId(_sessionId: string): Promise<string | null> {
    return null
  }
```

2. `sendMessage` 里 `composeSystemPrompt` 调用处（原 `soul: this.settings.soul` 那段，约 472 行）改为：

```ts
    const bot = await this.resolveBot(payload.sessionId ?? '')
    let systemPrompt = composeSystemPrompt({
      soul: this.settings.soul,
      bot: bot.instructions || undefined,
      persona: recalledPersona,
      memoryContext,
    })
```

- [ ] **Step 5: 跑测试**

Run: `npm test -- src/main/__tests__/core/system-prompt.test.ts`
Expected: PASS（含原有用例）

Run: `npm test`
Expected: 无新增失败

- [ ] **Step 6: 提交**

```bash
git add src/main/core/system-prompt.ts src/main/core/agent-core.ts src/main/__tests__/core/system-prompt.test.ts
git commit -m "feat(core): system prompt 接入 Bot instructions 层"
```

---

### Task 5: scheduler — 触发器

**Files:**
- Create: `src/main/core/scheduler.ts`
- Test: `src/main/__tests__/core/scheduler.test.ts`

**Interfaces:**
- Consumes: `RoutineStore`（Task 3）、`BotRegistry`（Task 2）
- Produces:
  - `interface RoutineDispatch { kind: 'system'; text: string; sessionId: string; source: string; botId: string }`
  - `class Scheduler`: `constructor(deps: { store: RoutineStore; bots: BotRegistry; dispatch: (d: RoutineDispatch) => Promise<boolean>; intervalMs?: number })` / `start(): void` / `stop(): void` / `sweep(): Promise<number>` / `isRunning: boolean`
  - `dispatch` 返回 `true`=接受。`false` 或抛错都计为该 routine 本次执行失败（走 recordFailure）。
  - `sweep()` 返回本轮处理的到期 routine 数（测试直接调它，不等 timer）。

执行语义（设计文档 §3/§5）：
- 先 `advanceStamp` 再 dispatch（防执行慢导致重复触发）。
- Bot 被外部删除（`bots.get(botId)` 为 null）→ 跳过、console.warn、不计失败。
- 文本格式 `[Routine 触发] ${instruction}`；source 格式 `routine:<id>`。

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/core/scheduler.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RoutineStore } from '../../store/routine-store'
import { BotRegistry } from '../../core/bot-registry'
import { Scheduler, type RoutineDispatch } from '../../core/scheduler'

describe('Scheduler', () => {
  let dir: string, store: RoutineStore, bots: BotRegistry
  let dispatched: RoutineDispatch[]
  let accept: boolean

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sched-'))
    store = RoutineStore.open(join(dir, 'r.db'))
    bots = await BotRegistry.create(join(dir, 'bots'))
    dispatched = []
    accept = true
  })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  const mkSched = () => new Scheduler({
    store, bots,
    dispatch: async (d) => { dispatched.push(d); return accept },
  })

  it('到期 routine 被触发，stamp 先快进', async () => {
    const bot = await bots.getDefault()
    const r = store.create({ botId: bot.id, sessionId: 's1', instruction: '汇报天气', schedule: 'interval:15m', createdBy: 'model' })
    store.advanceStamp(r.id, Date.now() - 17 * 60_000)
    const n = await mkSched().sweep()
    expect(n).toBe(1)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].text).toBe('[Routine 触发] 汇报天气')
    expect(dispatched[0].source).toBe(`routine:${r.id}`)
    expect(dispatched[0].sessionId).toBe('s1')
    expect(dispatched[0].kind).toBe('system')
    expect(store.get(r.id)!.nextRunAt).toBeGreaterThan(Date.now())
  })

  it('dispatch 拒绝计入失败，首轮失败标记 notified', async () => {
    const bot = await bots.getDefault()
    const r = store.create({ botId: bot.id, sessionId: 's1', instruction: 'x', schedule: 'interval:15m', createdBy: 'model' })
    store.advanceStamp(r.id, Date.now() - 17 * 60_000)
    accept = false
    await mkSched().sweep()
    const after = store.get(r.id)!
    expect(after.consecutiveFailures).toBe(1)
    expect(after.failureNotified).toBe(true)
    expect(after.enabled).toBe(true)
  })

  it('dispatch 抛错同样计入失败', async () => {
    const bot = await bots.getDefault()
    store.create({ botId: bot.id, sessionId: 's1', instruction: 'x', schedule: 'interval:15m', createdBy: 'model' })
    store.advanceStamp(store.listByBot(bot.id)[0].id, Date.now() - 17 * 60_000)
    const s = new Scheduler({ store, bots, dispatch: async () => { throw new Error('boom') } })
    await s.sweep()
    expect(store.listByBot(bot.id)[0].consecutiveFailures).toBe(1)
  })

  it('Bot 已删除的 routine 跳过不计失败', async () => {
    const bot = await bots.create({ name: 'temp' })
    const r = store.create({ botId: bot.id, sessionId: 's1', instruction: 'x', schedule: 'interval:15m', createdBy: 'model' })
    store.advanceStamp(r.id, Date.now() - 17 * 60_000)
    await bots.remove(bot.id)
    const n = await mkSched().sweep()
    expect(n).toBe(0)
    expect(store.get(r.id)!.consecutiveFailures).toBe(0)
  })

  it('成功清零失败计数', async () => {
    const bot = await bots.getDefault()
    const r = store.create({ botId: bot.id, sessionId: 's1', instruction: 'x', schedule: 'interval:15m', createdBy: 'model' })
    store.advanceStamp(r.id, Date.now() - 17 * 60_000)
    accept = false
    await mkSched().sweep()
    accept = true
    store.advanceStamp(r.id, Date.now() - 17 * 60_000)
    await mkSched().sweep()
    expect(store.get(r.id)!.consecutiveFailures).toBe(0)
  })

  it('sweep 记录心跳', async () => {
    await mkSched().sweep()
    expect(store.lastSweep()).not.toBeNull()
  })

  it('start/stop 管理定时器', () => {
    vi.useFakeTimers()
    const s = mkSched()
    s.start()
    expect(s.isRunning).toBe(true)
    s.stop()
    expect(s.isRunning).toBe(false)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/main/__tests__/core/scheduler.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/main/core/scheduler.ts
/**
 * Routine 触发器（设计文档 §3）。main 进程内 setInterval，每 30s 一轮：
 * 写心跳 → 取到期 routine → 先快进 stamp 再 dispatch。
 *
 * 不直接依赖 TicketRouter：dispatch 是注入的回调（index.ts 里接
 * Gateway 的 TicketRouter，未启动时接 AgentCore 兜底）。
 * 满足“routine 触发不依赖 Gateway 启动”的红线，且本模块可独立单测。
 */
import type { RoutineStore } from '../store/routine-store'
import type { BotRegistry } from './bot-registry'

export interface RoutineDispatch {
  kind: 'system'
  text: string
  sessionId: string
  /** 审计标记：routine:<id> */
  source: string
  botId: string
}

const SWEEP_INTERVAL_MS = 30_000

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private sweeping = false

  constructor(
    private deps: {
      store: RoutineStore
      bots: BotRegistry
      dispatch: (d: RoutineDispatch) => Promise<boolean>
      /** 测试注入用；生产固定 30s */
      intervalMs?: number
    },
  ) {}

  get isRunning(): boolean {
    return this.timer !== null
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.sweep().catch((err) => console.error('[Scheduler] sweep failed:', err))
    }, this.deps.intervalMs ?? SWEEP_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 一轮扫描。返回处理的到期 routine 数。 */
  async sweep(): Promise<number> {
    if (this.sweeping) return 0 // 防御重入
    this.sweeping = true
    try {
      const now = Date.now()
      this.deps.store.recordSweep(now)
      const due = this.deps.store.due(now)
      let fired = 0
      for (const r of due) {
        // 先快进 stamp：执行慢/失败都不至于重复触发（错过窗口跳过不补）
        this.deps.store.advanceStamp(r.id, now)
        const bot = await this.deps.bots.get(r.botId)
        if (!bot) {
          console.warn(`[Scheduler] routine ${r.id} 的 Bot ${r.botId} 不存在，跳过`)
          continue
        }
        try {
          const ok = await this.deps.dispatch({
            kind: 'system',
            text: `[Routine 触发] ${r.instruction}`,
            sessionId: r.sessionId,
            source: `routine:${r.id}`,
            botId: r.botId,
          })
          if (ok) this.deps.store.recordSuccess(r.id)
          else this.deps.store.recordFailure(r.id)
        } catch {
          this.deps.store.recordFailure(r.id)
        }
        fired++
      }
      return fired
    } finally {
      this.sweeping = false
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/main/__tests__/core/scheduler.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/core/scheduler.ts src/main/__tests__/core/scheduler.test.ts
git commit -m "feat(core): Routine scheduler（30s sweep + 疲劳规则接线）"
```

---

### Task 6: session 侧 botId + 兜底 dispatch + 组装

**Files:**
- Modify: `src/main/session-store.ts`（`FileSessionStore` 加 `getMeta`/`setMeta`）
- Modify: `src/main/core/agent-core.ts`（`getSessionBotId` 真实现 + `setSessionBot` + `dispatchRoutine`）
- Modify: `src/main/gateway/gateway.ts`（`ensureQueue` 去掉 private）
- Modify: `src/main/index.ts`（组装 Scheduler，quit 时停止）
- Test: `src/main/__tests__/core/session-botid.test.ts`

**Interfaces:**
- Consumes: Task 2/3/5 全部产物；现有 `FileSessionStore`、`NerveGateway.getTicketRouter()`（已存在）、`NullOutputChannel`（`core/output-channel.ts` 已存在）
- Produces:
  - `FileSessionStore.getMeta(sessionId): Promise<Record<string, unknown>>` / `setMeta(sessionId, patch): Promise<void>` —— meta 存 `<sessionId>.meta.json`，与消息 JSONL、branches 文件互不干扰。
  - `AgentCore.setSessionBot(sessionId, botId): Promise<void>`（IPC 用；默认 Bot 顺带补 homeSessionId）
  - `AgentCore.dispatchRoutine(d: { text: string; sessionId: string }): Promise<boolean>` —— Scheduler 的投递通道
  - `NerveGateway.ensureQueue(): void` 改为 public（JSDoc 注明「Scheduler 在 Gateway 未启动时也会调用」）

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/core/session-botid.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileSessionStore } from '../../session-store'

describe('session botId 元数据', () => {
  let dir: string, store: FileSessionStore

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sessbot-'))
    store = await FileSessionStore.create(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('setMeta/getMeta 往返', async () => {
    await store.setMeta('sess-1', { botId: 'bot_a' })
    expect(await store.getMeta('sess-1')).toEqual({ botId: 'bot_a' })
  })

  it('未设置过返回空对象', async () => {
    expect(await store.getMeta('nope')).toEqual({})
  })

  it('setMeta 合并而非覆盖', async () => {
    await store.setMeta('sess-2', { botId: 'bot_a' })
    await store.setMeta('sess-2', { customTitle: '我的会话' })
    expect(await store.getMeta('sess-2')).toEqual({ botId: 'bot_a', customTitle: '我的会话' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/main/__tests__/core/session-botid.test.ts`
Expected: FAIL（`setMeta`/`getMeta` 不存在）

- [ ] **Step 3: 实现 FileSessionStore.setMeta/getMeta**

`session-store.ts` 的 `FileSessionStore` 类内追加：

```ts
  private metaPath(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.meta.json`)
  }

  /** 会话级元数据（botId 等）。独立文件，不碰消息 JSONL。 */
  async getMeta(sessionId: string): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(this.metaPath(sessionId), 'utf-8'))
    } catch {
      return {}
    }
  }

  async setMeta(sessionId: string, patch: Record<string, unknown>): Promise<void> {
    const cur = await this.getMeta(sessionId)
    await writeFile(this.metaPath(sessionId), JSON.stringify({ ...cur, ...patch }, null, 2), 'utf-8')
  }
```

- [ ] **Step 4: agent-core 真实现 + dispatchRoutine**

替换 Task 4 的占位 `getSessionBotId`，并新增两个方法：

```ts
  private async getSessionBotId(sessionId: string): Promise<string | null> {
    if (!this.sessionStore || !sessionId) return null
    const meta = await this.sessionStore.getMeta(sessionId) as { botId?: string }
    return meta.botId ?? null
  }

  /** 会话绑定 Bot（IPC 层调用；默认 Bot 顺带补 homeSessionId）。 */
  async setSessionBot(sessionId: string, botId: string): Promise<void> {
    if (!this.sessionStore) throw new Error('session store 未初始化')
    const reg = await this.getBotRegistry()
    const bot = await reg.get(botId)
    if (!bot) throw new Error(`Bot not found: ${botId}`)
    await this.sessionStore.setMeta(sessionId, { botId })
    if (bot.isDefault && !bot.homeSessionId) {
      await reg.update(bot.id, { homeSessionId: sessionId })
    }
  }

  /**
   * Scheduler 的投递通道（设计文档 §3 兜底）。
   * TicketRouter 可用走队列（持久化/恢复/槽位全复用）；不可用直连
   * sendMessage + NullOutputChannel（结果落 session transcript，不丢内容）。
   */
  async dispatchRoutine(d: { text: string; sessionId: string }): Promise<boolean> {
    const ctx = this.getSessionContextManager().getOrCreate(d.sessionId)
    const { NullOutputChannel } = await import('./output-channel')
    const gatewayProvider = (this as any).gatewayProvider as (() => { getTicketRouter: () => any } | null) | undefined
    const router = gatewayProvider?.()?.getTicketRouter?.() ?? null
    if (router) {
      router.dispatch(
        {
          platform: 'local', userId: 'scheduler', chatId: d.sessionId,
          threadKey: `local:${d.sessionId}`,
          text: d.text, cwd: this.config.cwd, kind: 'system' as const,
        },
        new NullOutputChannel(),
      )
      return true
    }
    try {
      await this.sendMessage({ prompt: d.text, sessionId: d.sessionId, cwd: this.config.cwd }, new NullOutputChannel(), ctx)
      return true
    } catch (err) {
      console.error('[AgentCore] dispatchRoutine fallback failed:', err)
      return false
    }
  }

  /** index.ts 组装时注入，避免 core 反向依赖 gateway 模块。 */
  setGatewayProvider(p: () => { getTicketRouter: () => any } | null): void {
    (this as any).gatewayProvider = p
  }
```

注意 `sendMessage` 的实际签名以现有代码为准（第三参是 `SessionContext`）；`NullOutputChannel` 从 `./output-channel` 导出（已确认存在）。

- [ ] **Step 5: gateway.ts 暴露 ensureQueue**

`NerveGateway` 里 `private ensureQueue(): void` 改为 `ensureQueue(): void`，JSDoc 追加一句：「Scheduler 在 Gateway 未启动时也会调用，保证 routine 触发不依赖 Gateway。」

- [ ] **Step 6: index.ts 组装**

在 Gateway 创建处附近加：

```ts
  const routineStore = RoutineStore.open(join(NERVE_DIR, 'routines.db'))
  const schedulerBots = await BotRegistry.create(join(NERVE_DIR, 'bots'))
  const scheduler = new Scheduler({
    store: routineStore,
    bots: schedulerBots,
    dispatch: (d) => agentCore.dispatchRoutine(d),
  })
  scheduler.start()
  agentCore.setGatewayProvider(() => gateway.getTicketRouter() ? gateway : null)
```

app quit 路径（现有 will-quit / quit-drain 处）加 `scheduler.stop()` 与 `routineStore.close()`。import 行：`RoutineStore` from `./store/routine-store`、`BotRegistry` from `./core/bot-registry`、`Scheduler` from `./core/scheduler`（Scheduler/BotRegistry 的实例由 index 持有，AgentCore 内部自建的 BotRegistry 与之同读同写 JSON 文件——Bot 是低频配置数据，无缓存一致性问题）。

- [ ] **Step 7: 跑测试**

Run: `npm test -- src/main/__tests__/core/session-botid.test.ts`
Expected: PASS

Run: `npm test`
Expected: 全量无新增失败

- [ ] **Step 8: 提交**

```bash
git add src/main/session-store.ts src/main/core/agent-core.ts src/main/gateway/gateway.ts src/main/index.ts src/main/__tests__/core/session-botid.test.ts
git commit -m "feat(core): session 绑定 Bot + Scheduler 接线（Gateway 无关触发）"
```

---

### Task 7: routine 工具（模型侧）

**Files:**
- Modify: `src/main/tools.ts`（`getBuiltinTools` 追加 4 个工具）
- Test: `src/main/__tests__/routine-tools.test.ts`

**Interfaces:**
- Consumes: `RoutineStore`（Task 3）
- Produces: `getBuiltinTools` 返回值新增 4 个键：`create_routine` / `list_routines` / `update_routine` / `delete_routine`
- 签名变化：`getBuiltinTools` 增加第 7 个可选尾参 `routineCtx?: { store: RoutineStore; getSession: () => { sessionId: string; botId: string } }`。不传则不注册这 4 个工具（现有调用点零影响）。
- 错误约定：护栏/校验错误以 `{ error: string }` 返回（不 throw），模型能读到并改口。

- [ ] **Step 1: 写失败测试**

```ts
// src/main/__tests__/routine-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RoutineStore } from '../store/routine-store'
import { getBuiltinTools } from '../tools'

describe('routine tools', () => {
  let dir: string, store: RoutineStore, tools: Record<string, any>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rttools-'))
    store = RoutineStore.open(join(dir, 'r.db'))
    const routineCtx = { store, getSession: () => ({ sessionId: 'sess-1', botId: 'bot_1' }) }
    tools = getBuiltinTools('/tmp', undefined, undefined, undefined, undefined, undefined, routineCtx)
  })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  it('未传 routineCtx 时不注册 routine 工具', () => {
    const bare = getBuiltinTools('/tmp')
    expect(bare['create_routine']).toBeUndefined()
  })

  it('create_routine 成功', async () => {
    const r = await tools['create_routine'].execute({ instruction: '每天站会前提醒', schedule: 'daily:08:50' })
    expect(r.error).toBeUndefined()
    expect(r.id).toMatch(/^rt_/)
    expect(store.get(r.id)!.botId).toBe('bot_1')
    expect(store.get(r.id)!.sessionId).toBe('sess-1')
    expect(store.get(r.id)!.createdBy).toBe('model')
  })

  it('create_routine schedule 非法返回 error 而非抛出', async () => {
    const r = await tools['create_routine'].execute({ instruction: 'x', schedule: 'every minute' })
    expect(typeof r.error).toBe('string')
  })

  it('list_routines 只见当前 Bot', async () => {
    store.create({ botId: 'bot_1', sessionId: 'sess-1', instruction: 'a', schedule: 'interval:15m', createdBy: 'user' })
    store.create({ botId: 'bot_2', sessionId: 'sess-9', instruction: 'b', schedule: 'interval:15m', createdBy: 'user' })
    const r = await tools['list_routines'].execute({})
    expect(r.routines).toHaveLength(1)
    expect(r.routines[0].instruction).toBe('a')
  })

  it('update / delete 限定当前 Bot', async () => {
    const mine = store.create({ botId: 'bot_1', sessionId: 'sess-1', instruction: 'a', schedule: 'interval:15m', createdBy: 'model' })
    const other = store.create({ botId: 'bot_2', sessionId: 'sess-9', instruction: 'b', schedule: 'interval:15m', createdBy: 'model' })

    const upd = await tools['update_routine'].execute({ id: mine.id, enabled: false })
    expect(upd.error).toBeUndefined()
    expect(store.get(mine.id)!.enabled).toBe(false)

    expect((await tools['update_routine'].execute({ id: other.id, enabled: false })).error).toBe('not found')

    expect((await tools['delete_routine'].execute({ id: mine.id })).error).toBeUndefined()
    expect(store.get(mine.id)).toBeNull()
    expect((await tools['delete_routine'].execute({ id: other.id })).error).toBe('not found')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/main/__tests__/routine-tools.test.ts`
Expected: FAIL（工具不存在）

- [ ] **Step 3: 实现**

`tools.ts`：

1. `getBuiltinTools` 签名末尾加第 7 个可选参：

```ts
  routineCtx?: { store: import('./store/routine-store').RoutineStore; getSession: () => { sessionId: string; botId: string } },
```

2. 函数体末尾、return 之前注册（仅当 `routineCtx` 存在）。注意：函数内部累积工具的对象名以实际代码为准（下例写 `tools`，若是别的名字用实际名）：

```ts
  if (routineCtx) {
    const { store } = routineCtx
    tools['create_routine'] = {
      description: '创建一个定时任务（routine）。到点后你会收到一条 [Routine 触发] 消息并执行 instruction。schedule 仅支持三种格式：interval:<N>m（N≥15，如 interval:30m）、daily:HH:mm（如 daily:09:30）、weekly:<d>-<d>:HH:mm（d=0..6，0=周日，如 weekly:1-5:09:00）。无法表达的时刻表要如实告诉用户，不要硬造。',
      input_schema: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: '到点要做的事，用用户的原话或充分展开的指令' },
          schedule: { type: 'string', description: 'interval:<N>m / daily:HH:mm / weekly:<d>-<d>:HH:mm' },
          session_hint: { type: 'string', description: '结果投递的会话 id；缺省为当前会话' },
        },
        required: ['instruction', 'schedule'],
      },
      execute: async (args: any) => {
        try {
          const row = store.create({
            botId: routineCtx.getSession().botId,
            sessionId: args.session_hint || routineCtx.getSession().sessionId,
            instruction: String(args.instruction ?? ''),
            schedule: String(args.schedule ?? ''),
            createdBy: 'model' as const,
          })
          return { id: row.id, nextRunAt: row.nextRunAt, schedule: row.schedule }
        } catch (err: any) {
          return { error: err?.message || String(err) }
        }
      },
    }
    tools['list_routines'] = {
      description: '列出当前 Bot 的全部定时任务（含停用的）。',
      input_schema: { type: 'object', properties: {} },
      execute: async () => {
        return { routines: store.listByBot(routineCtx.getSession().botId, { includeDisabled: true }) }
      },
    }
    tools['update_routine'] = {
      description: '修改当前 Bot 的定时任务（指令/时刻表/启停）。只有 id 必填，其余可选。',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          instruction: { type: 'string' },
          schedule: { type: 'string' },
          enabled: { type: 'boolean' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        const cur = store.get(String(args.id ?? ''))
        if (!cur || cur.botId !== routineCtx.getSession().botId) return { error: 'not found' }
        try {
          const patch: { instruction?: string; schedule?: string; enabled?: boolean } = {}
          if (args.instruction !== undefined) patch.instruction = String(args.instruction)
          if (args.schedule !== undefined) patch.schedule = String(args.schedule)
          if (args.enabled !== undefined) patch.enabled = !!args.enabled
          const row = store.update(cur.id, patch)
          return { id: row.id, enabled: row.enabled, nextRunAt: row.nextRunAt }
        } catch (err: any) {
          return { error: err?.message || String(err) }
        }
      },
    }
    tools['delete_routine'] = {
      description: '删除当前 Bot 的一个定时任务。',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async (args: any) => {
        const cur = store.get(String(args.id ?? ''))
        if (!cur || cur.botId !== routineCtx.getSession().botId) return { error: 'not found' }
        store.remove(cur.id)
        return { deleted: cur.id }
      },
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/main/__tests__/routine-tools.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/tools.ts src/main/__tests__/routine-tools.test.ts
git commit -m "feat(tools): routine 管理工具（模型侧 CRUD，Bot 隔离）"
```

---

### Task 8: IPC + preload（UI 数据通路）

**Files:**
- Modify: `src/main/ipc.ts`（追加 handlers）
- Modify: `src/main/index.ts`（注册时闭包传入 `routineStore` / `botRegistry`）
- Modify: `src/main/preload/index.ts`（暴露 API，命名跟随现有风格）

**Interfaces:**
- Consumes: Task 3 store、Task 6 的 `agentCore.setSessionBot`
- Produces（渲染层契约）:
  - `invoke('routine:list', botId) → RoutineRow[]`
  - `invoke('routine:create', { botId, sessionId, instruction, schedule }) → RoutineRow`（护栏拒绝时 reject，message 带原因）
  - `invoke('routine:update', id, patch) → RoutineRow`
  - `invoke('routine:delete', id) → boolean`
  - `invoke('routine:sweepStatus') → { lastSweep: number | null; healthy: boolean }`（healthy = lastSweep 距今 < 15min）
  - `invoke('bot:list') → BotInfo[]`、`invoke('bot:update', id, patch) → BotInfo`
  - `invoke('session:bindBot', sessionId, botId)`

- [ ] **Step 1: ipc.ts 追加 handlers**

在现有 IPC 注册区追加（`routineStore` / `botRegistry` 由 index.ts 注册时闭包传入，`agentCore` 已是该文件现有引用）：

```ts
  ipcMain.handle('routine:list', (_e, botId: string) => routineStore.listByBot(botId, { includeDisabled: true }))
  ipcMain.handle('routine:create', (_e, input: { botId: string; sessionId: string; instruction: string; schedule: string }) =>
    routineStore.create({ ...input, createdBy: 'user' as const }))
  ipcMain.handle('routine:update', (_e, id: string, patch: { instruction?: string; schedule?: string; enabled?: boolean }) => routineStore.update(id, patch))
  ipcMain.handle('routine:delete', (_e, id: string) => routineStore.remove(id))
  ipcMain.handle('routine:sweepStatus', () => {
    const lastSweep = routineStore.lastSweep()
    return { lastSweep, healthy: lastSweep !== null && Date.now() - lastSweep < 15 * 60_000 }
  })
  ipcMain.handle('bot:list', () => botRegistry.list())
  ipcMain.handle('bot:update', (_e, id: string, patch: { name?: string; instructions?: string; homeSessionId?: string }) => botRegistry.update(id, patch))
  ipcMain.handle('session:bindBot', (_e, sessionId: string, botId: string) => agentCore.setSessionBot(sessionId, botId))
```

- [ ] **Step 2: preload 暴露**

跟随现有 preload 的 `contextBridge.exposeInMainWorld` 风格追加（现有 key 名如 `api` / 直接挂方法——以实际为准）：

```ts
  routine: {
    list: (botId: string) => ipcRenderer.invoke('routine:list', botId),
    create: (input: { botId: string; sessionId: string; instruction: string; schedule: string }) => ipcRenderer.invoke('routine:create', input),
    update: (id: string, patch: { instruction?: string; schedule?: string; enabled?: boolean }) => ipcRenderer.invoke('routine:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('routine:delete', id),
    sweepStatus: () => ipcRenderer.invoke('routine:sweepStatus'),
  },
  bot: {
    list: () => ipcRenderer.invoke('bot:list'),
    update: (id: string, patch: { name?: string; instructions?: string; homeSessionId?: string }) => ipcRenderer.invoke('bot:update', id, patch),
  },
  // session 现有对象上加一个方法：
  // bindBot: (sessionId: string, botId: string) => ipcRenderer.invoke('session:bindBot', sessionId, botId),
```

- [ ] **Step 3: 手动验证（devtools console）**

Run: `npm run dev`，然后：
1. `await window.<api前缀>.bot.list()` → 至少一个默认 Bot。
2. `await window.<api前缀>.routine.create({ botId: <上一步 id>, sessionId: <当前会话>, instruction: '报时', schedule: 'interval:15m' })` → 返回 `rt_` id。
3. 等 1 分钟，`await window.<api前缀>.routine.sweepStatus()` → `healthy: true` 且 `lastSweep` 在 30s 内。
4. 等触发周期 → transcript 出现 `[Routine 触发] 报时` 且 agent 回复。
5. `await window.<api前缀>.routine.update(<id>, { enabled: false })` → 之后不再触发。

- [ ] **Step 4: 全量测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/ipc.ts src/main/preload/index.ts src/main/index.ts
git commit -m "feat(ipc): routine/bot IPC 与 preload API（UI 数据通路）"
```

---

### Task 9: 渲染层 UI（会话内 routine 面板 + Bot 页面 + 心跳指示）

**Files:**
- Create: RoutinePanel 组件、BotPage 组件（路径与框架以 `src/renderer` 现有结构为准——实现者先读渲染层，确认是 Vue 还是 React、路由怎么注册、现有面板类组件的写法，跟随现有模式，不新引依赖）
- Modify: 会话视图组件（消息框旁时钟入口按钮）、侧边栏/路由（Bot 页入口）

**Interfaces:**
- Consumes: Task 8 的 preload API
- Produces: 用户可见 UI（设计文档 §6）：
  1. 会话内时钟入口 → 面板：该会话所属 Bot 的 routine 列表（指令、schedule、下次触发时间、启用开关、删除）+ 新建表单（instruction 文本框；schedule 下拉：每15/30/60分钟 / 每天时间 / 每周几+时间）。
  2. Bot 页：Bot 列表 → 详情（name、instructions 可编辑保存、该 Bot 的 routine 列表复用 RoutinePanel）。
  3. 心跳指示：面板底部「调度器：N 秒前巡检」；`healthy === false` 时红字「调度器未运行」。

- [ ] **Step 1: 读渲染层结构**

确认组件框架、样式方案、路由注册方式。列出要动的具体文件后再动手。

- [ ] **Step 2: RoutinePanel 组件**

数据流：`onMounted` 拉 `routine.list(botId)` 与 `routine.sweepStatus()`；30s 轮询 sweepStatus；开关调 `routine.update(id, { enabled })`；删除带确认；新建表单调 `routine.create(...)`，护栏拒绝的 error 原样展示。

- [ ] **Step 3: BotPage 组件**

`bot.list()` 列表 → 选中详情：`bot.update(id, { name, instructions })` 保存；routine 区嵌入 RoutinePanel。

- [ ] **Step 4: 会话入口 + 路由**

消息框旁时钟图标（现有工具按钮同款样式）开关 RoutinePanel；侧边栏加「Bots」入口。

- [ ] **Step 5: 手动验证**

Run: `npm run dev`：
1. 时钟入口新建 `interval:15m` routine → 列表出现，下次触发时间合理。
2. 关开关 → 不再触发；删除 → 列表消失。
3. Bot 页改 instructions 保存 → 新会话 agent 行为带该角色设定。
4. 把 app 的 scheduler 停掉（或等 15 分钟）→ 面板显示「调度器未运行」。

- [ ] **Step 6: 提交**

```bash
git add src/renderer
git commit -m "feat(renderer): Routine 面板与 Bot 页面（含调度器心跳指示）"
```

---

### Task 10: 收尾——审批核对 + 全量回归 + 文档勾稽

**Files:**
- Modify（如需）: `src/main/tools.ts`（delete_routine 接审批链）
- Modify: `docs/bot-driven-agent-design.md`（如有实现偏差回写）

**Interfaces:**
- Consumes: 全部前序任务

- [ ] **Step 1: delete_routine 审批核对**

设计文档 §4 要求 delete 走现有审批链（`onToolApproval`）。检查仓库现有删除类工具（如文件删除）怎么接审批：若是按工具名全局配置，把 `delete_routine` 加进名单；若是逐工具标记，给它加 `requiresApproval` 类标记。照抄现有模式。

- [ ] **Step 2: 全量测试与类型检查**

Run: `npm test`
Expected: PASS

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无类型错误

- [ ] **Step 3: 端到端手动回归（设计文档 §7 清单）**

1. 建 `interval:15m` routine → 观察两次触发（间隔 15 分钟）。
2. 直接关窗口 kill app → 重开 → 不补跑错过的窗口，只在下一个到期点触发一次。
3. 建 `interval:5m` → 被拒（15 分钟下限）。
4. 建满 21 个 → 第 21 个被拒（20 上限）。
5. 换无效模型 key 制造执行失败 → 首次失败一条通知；连续 10 次后 routine 自动停用 + 最终通知。

- [ ] **Step 4: 回写设计文档**

实现与 `docs/bot-driven-agent-design.md` 有偏差（字段名/模块位置/语义微调）就更新文档使其一致；无偏差跳过。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore: bot 驱动改造收尾（审批核对 + 回归 + 文档勾稽）"
```

---

## Self-Review 记录

- **Spec 覆盖**：设计文档 §1→Task 2/4/6；§2→Task 3；§3→Task 5/6；§4→Task 7/10；§5→Task 3（护栏）/Task 5（dispatch 语义）；§6→Task 8/9；§7→Task 10。§8 出界项均未排入。✓
- **类型一致性**：`RoutineRow` / `BotInfo` / `RoutineDispatch` / `parseSchedule` / `nextRunAt` 在各任务的 Consumes/Produces 块中签名一致。✓
- **实现者需现场核对的点**（非设计空洞，是仓库细节）：Task 7 工具累积对象的实际变量名；Task 6 `sendMessage` 实际签名与 `NullOutputChannel` 导出名；Task 8 preload 的 API 前缀；Task 9 渲染层框架（Vue/React）。


