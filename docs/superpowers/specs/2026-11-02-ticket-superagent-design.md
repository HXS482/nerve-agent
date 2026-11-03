# Nerve Agent：Ticket 化改造设计（Super-agent 形态）

日期：2026-11-02
状态：待批准

## 1. 意图与原因

Nerve 现在的并发单位是「人」：`SessionRouter.resolve(platform, userId, chatId) → sessionId`，
一个人所有消息进同一条上下文、同一条串行队列。后果是：

- 同一个人的第二件事必须等第一件跑完；长任务直接堵死对话。
- 所有任务共用全局 `this.projectDir`，两个任务会改同一份工作目录。
- 换项目触发全局 `setCwd()`，重建 `sessionStore`，旧会话历史当场消失。
- 群聊里一个用户调 `setModel` 会覆盖所有人的模型（现存 bug）。

目标形态参考 DeepSeek Harness 的 Super-agent 设计：**并发单位从「人」变成「任务（Ticket）」**，
一个人可以同时持有多个独立上下文、独立工作目录、独立生命周期的任务，人随时能插入新消息。

## 2. 目标 / 非目标 / 反目标

**目标**
1. 一个用户可以同时有多个进行中的 Ticket，互不干扰。
2. 每个 Ticket 有自己的工作目录（复用 UI 已经存着的 `Session.cwd`）。
3. 队列持久化，进程重启后未执行的工作不丢。
4. 人的消息有独立槽位，永远不被后台任务挡住。
5. UI 上有独立的 Tasks 视图，能看到所有 Ticket 及其阶段。

**非目标（本期不做）**
- 不做云端 / BYOM / 跨设备 daemon（本地 Electron，形态不同）。
- 不做推测执行（speculative execution）。
- 不做 Watchdog 独立会话。
- 不做 A2A 跨实例通信。
- 不做 Chain of Recall / 对象引用图。
- 不重写 agent-core 的 ReAct 循环。

**反目标（技术上做到了也算失败）**
- 为了并发而让 UI 变复杂：Ticket 视图不出现时，现有 Chat/Stage 体验必须完全不变。
- 为了 Ticket 化而牺牲「一个人的连续感」：同一用户在同一个 Thread 的后续消息必须落回同一个 Ticket。
- 引入新的重依赖（不新增框架、不引入 DSH 包）。

## 3. 约束

- Electron 主进程 + 渲染进程，IPC 走 `src/shared/types.ts` 的 `IPC_CHANNELS`。
- 已有 `better-sqlite3@^12.4.1` 和 `sqlite-vec`（`memory-browser.ts`、`tencentdb-memory` 在用），
  持久化队列和 Ticket 表可直接复用，不新增依赖。
- `tsconfig` 严格模式；有 `vitest`，现有测试在 `src/main/__tests__/`。
- 工作区是 git repo（master 干净），建议本改造开独立分支。

## 4. 现状核查（全部来自真实代码）

| 位置 | 现状 | 结论 |
|---|---|---|
| `agent-core.ts:301-302` | `pendingToolCalls`/`pendingApprovals` 从 ctx 取 | 会话级隔离**已成立** |
| `session-context.ts` | 每 session 一个 `AbortController` | **已成立** |
| `session-store.ts:41-43` | `${sessionId}.jsonl` | 历史隔离**已成立** |
| `agent-core.ts:324` | `buildTools()` 在 `sendMessage` 内每次重建 | **已成立** |
| `session-context.ts` 的 `config` 字段 | 注释写「会话级配置可覆盖全局」，但 `ctx.config` **生产代码从未读取**（只在测试里出现） | **死代码** |
| `agent-core.ts:316/545/631` | 读 `this.config.model/effort/provider`（全局单例） | **不隔离** |
| `gateway.ts:516-517` | `agentCore.setModel(params.model)` 直接改全局 | **现存 bug** |
| `agent-core.ts:588/629` | `getBuiltinTools(this.projectDir)` | **不隔离** |
| `agent-core.ts:124-127` | `sessionStore` 单一 baseDir | **不隔离** |
| `agent-core.ts:985-988` | `setCwd()` 重建 sessionStore | **换项目丢历史** |
| `tools.ts:251/319` | Bash 固定 `timeout: 120000`，无后台模式 | **长命令阻塞** |
| `session-router.ts:46-49` | 内存 Map 队列 + `processing` Set | **重启即丢，串行** |
| `chatStore.ts:11-21` | `Session.cwd?: string` 建会话时已写入 | **UI 已有数据，后端丢弃** |
| `useClaude.ts:746` | `sendMessage(prompt, sessionId, files, runId)` | 不传 cwd |
| `types.ts:213-219` | `SendMessagePayload` 无 cwd 字段 | 需扩展 |
| `RightSidebar.tsx:40,470` | `RightSidebarView = 'flow'\|'folder'\|'git'\|'gateway'`，`VIEW_COMPONENTS` 映射 | **加视图的现成挂点** |
| `GatewayView.tsx` | 4 个 view 中最接近的自包含组件样板 | 可作 TasksView 模板 |
| `types.ts:119-132` | `GATEWAY_*` 一组 IPC channel | 新增 `TICKET_*` 沿用同模式 |

## 5. 方案取舍（已选定）

**A. Ticket 复用 Session 行**：给 `Session` 加字段，Ticket 直接出现在现有 `SessionList`。
渲染层改动小，但会话列表会膨胀，且 gateway 会话混进个人列表。

**B. 独立 Tasks 视图（已选）**：`RightSidebar` 加第 5 个 view `tasks`，Ticket 有自己的一套
列表与详情。Session 列表不动，Chat/Stage 体验零改动。

- 好处：职责清晰；`VIEW_COMPONENTS` 已有挂点，新增视图是加法不是改造；gateway 会话与本地会话
  可以都进 Tasks，而 SessionList 保持不变，两类使用者的心智模型不打架。
- 代价：新增一套 UI 组件；用户要在两个地方找东西（会话在左栏，任务在右侧栏）。
- 缓解：Tasks 视图里每行提供「打开对应会话」，点击直接跳转左栏会话。

**C. 只改后端**：用户明确要求改 UI，已排除。

**未选 A 的理由**：A 会让 gateway 的租户消息和非租户消息挤在同一个 SessionList，
而这两类数据的可见性边界不同（见 §9 待定项）。

## 6. 领域模型（最小集）

只引入支撑本次改造所需的概念，不做完整 DSH 复刻。

```
Message ──(dispatch)──> Ticket ──> Assignment ──> Session(已有)
                          │
                          └─ cwd / stage / threadKey / platform origin
```

- **Ticket**：一件工作的容器。字段：`id`、`title`、`cwd`、`sessionId`、`origin`(platform/userId/chatId)、
  `threadKey`、`stage`、`createdAt`、`lastActiveAt`、`mandate`(允许的动作范围，本期仅记录不强制)。
- **Assignment**：Ticket 的一次执行。字段：`id`、`ticketId`、`status`(pending/running/ended)、`error?`。
- **Stage**（阶段表，判定自上而下，先命中先赢，抄 DSH 的结构）：

| stage | 条件 |
|---|---|
| `delivery` | 上一条 Input 投递失败，等待重试 |
| `answer` | 有待人工回答的问题 |
| `review` | 最近一次 Report = ready，等人验收 |
| `blocked` | 最近一次 Report = blocked/failed，且此后无人发言 |
| `queued` | 没有 Assignment，或有 pending 的 |
| `idle` | 最近一次 Report = waiting |
| `working` | 其余 |

- **Input**：投递到 Ticket 的消息（人发的、system 的、job 完成回调）。

**Thread**：`origin` 相同且 `threadKey` 相同的一组消息归同一个 Ticket。
`threadKey` 的取值：电信平台用 `chat:<chatId>`（私聊）或 `chat:<chatId>:topic:<topicId>`；
本地界面用 `local:<sessionId>`。首条消息建立 Ticket，后续同 key 消息直通该 Ticket（订阅直通）。

## 7. 架构改动

### 7.1 数据层：`src/main/store/ticket-store.ts`（新增）

用 `better-sqlite3`，表结构：

```sql
CREATE TABLE ticket (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, cwd TEXT NOT NULL,
  session_id TEXT NOT NULL, platform TEXT, user_id TEXT, chat_id TEXT,
  thread_key TEXT NOT NULL, stage TEXT NOT NULL, mandate TEXT,
  created_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE TABLE assignment (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, status TEXT NOT NULL,
  error TEXT, created_at INTEGER NOT NULL, ended_at INTEGER
);
CREATE TABLE input (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, kind TEXT NOT NULL,
  body TEXT NOT NULL, seq INTEGER NOT NULL, delivered_at INTEGER
);
CREATE TABLE effect (
  kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL,
  seq INTEGER PRIMARY KEY AUTOINCREMENT, attempts INTEGER DEFAULT 0,
  due INTEGER NOT NULL, generation INTEGER DEFAULT 0
);
CREATE INDEX idx_ticket_thread ON ticket(thread_key, ended_at);
CREATE INDEX idx_effect_due ON effect(kind, due, seq);
```

要点（借鉴 `dsh-superagent-prototype` 的 `src/app/effects.ts`）：
- **先落库再执行**。`enqueue` 在调用方事务内写入，事务提交后才 dispatch。
- 同 `(kind, key)` 合并，保留原队列位置（`generation` 递增防覆盖）。
- 指数退避，`attempts` 记次。
- 进程启动时 `start()`，把 `due <= now` 的行捞起来继续跑。

### 7.2 调度层：`src/main/gateway/ticket-router.ts`（新增）

替代 `session-router.ts` 的队列部分。`session-router` 保留 `resolve/getAllMappings` 等映射职责，
队列与串行控制迁走。

```
submit(message)
  → dispatch(threadKey) → 已有 Ticket?
        是 → 直通该 Ticket 队列
        否 → 建 Ticket → 入队
  → scheduler.pick(ticket, slotKind)
       slotKind = 'human' | 'normal'
  → 执行
```

**槽位**：`concurrencyLimit`（默认 3）+ **1 个额外 human 槽位**。
人的消息可以占用 human 槽位；CI / system Input 只能等 normal 槽位。
这条保证「新工作永远不会挡住人」，是本次改造最关键的一行规则。

### 7.3 执行层：`agent-core.ts` 改造（最小侵入）

1. `SendMessagePayload` 增加 `cwd?: string`（`types.ts:213`）。
2. `sendMessage` 内解析 `const cwd = payload.cwd ?? this.projectDir`，传给 `buildTools(cwd, ...)`。
3. `buildTools` / `prepareMessages` 的 `this.projectDir` 全替换为参数 `cwd`。
4. `this.config.*` 改为 `{ ...this.config, ...ctx.config }` 合并读取（把死代码接活）。
5. `setModel/setProvider/setEffort` 增加可选 `sessionId` 参数：传了写 `ctx.config`，没传才写全局。
   `gateway.ts:516-517` 改为传 sessionId。
6. `sessionStore` 保持单一 baseDir（见 §9 待定项 1）；`setCwd` 不再重建 store。

### 7.4 UI：Tasks 视图（新增）

- `RightSidebar.tsx:40` 的 `RightSidebarView` 加 `'tasks'`，`VIEWS` 加一项，`VIEW_COMPONENTS` 加映射。
- 新组件 `src/renderer/components/TasksView.tsx`，以 `GatewayView.tsx` 为结构模板。
- 新 store `src/renderer/stores/ticketStore.ts`：`tickets`、`activeTicketId`、`ticketsLoading`，
  以及 `refresh()` / `stop(id)` / `openSession(id)`。
- IPC：`types.ts` 新增 `TICKET_LIST / TICKET_GET / TICKET_STOP / TICKET_RESUME / TICKET_CHANGED`，
  沿用 `GATEWAY_*` 的命名与注册模式（`src/main/ipc.ts`）。
- 推送：主进程 `ticket.changed` 事件通过 `webContents.send(IPC_CHANNELS.TICKET_CHANGED, payload)` 推给渲染层，
  参考 `ipc.ts:18` 的 `GATEWAY_LOG` 写法。
- TasksView 每行：标题、阶段徽章、耗时、cwd 简写、操作（打开会话 / 停止）。
  点「打开会话」→ `setSessionId(ticket.sessionId)` + 切到 chat 模式。

## 8. 分阶段落地

每阶段独立可上线、可回滚。

**阶段 0 — 持久化队列（无 UI 改动）**
- 新增 `ticket-store.ts`、`effect` 表。
- `session-router` 的 `queues`/`processing` 改为从 store 读写。
- 验收：跑任务时 `kill -9` 主进程，重启后未执行消息继续跑；同一 session 仍串行（此阶段不改并发语义）。

**阶段 1 — 修 `ctx.config` 与 `setModel` 全局污染**
- 打通 `ctx.config` 合并读取；`setModel(sessionId?, model)`。
- 验收：两个会话设不同模型，并发跑，各自请求的 model 正确（用日志断言）。
- 这一阶段独立于 Ticket，是现存 bug 修复，应最先合入。

**阶段 2 — per-session cwd**
- `SendMessagePayload.cwd`、`buildTools(cwd)`、`setCwd` 不再重建 store。
- 渲染层 `sendMessage` 带上 `session.cwd`。
- 验收：两个会话不同 cwd 并发执行 `pwd`/`Get-Location`，各自结果正确；切换项目后旧会话历史仍可读。

**阶段 3 — Ticket 领域模型 + 调度器**
- `ticket` / `assignment` / `input` 表，`ticket-router.ts`，槽位（含 human 槽位）。
- gateway 消息走 dispatch → threadKey → Ticket。
- 验收：同一 Telegram 用户同时发两件事，两个 Ticket 并行，互不串上下文；
  跑长任务时发新消息，即时得到响应（占 human 槽位）。

**阶段 4 — Tasks 视图**
- `TasksView.tsx`、`ticketStore.ts`、`TICKET_*` IPC。
- 验收：UI 能看到所有 Ticket 及阶段，能停止一个 Ticket 而不影响其他；
  现有 Chat/Stage/Gateway 三个视图行为无变化。

**阶段 5 — 后台任务（可选）**
- Bash 工具拆 `start()` / `stop()`，job 注册表，5 秒后转后台。
- 验收：一条超过 5 秒的命令不再阻塞该 Ticket 的下一轮输入。

阶段 0/1 可并行，阶段 2 依赖 1，阶段 3 依赖 2，阶段 4 依赖 3，阶段 5 独立。

## 9. 待定项（需人决定）

1. **sessionStore 是否按 cwd 分目录**。当前单 baseDir + `setCwd` 重建。
   改成「每 cwd 一个 store」能彻底解决换项目丢历史，但会让 `listSessions` 变复杂
   （要跨目录聚合）。本设计先取「单一 baseDir」这个更小的改动，换项目丢历史的问题留到后续。
   —— 若你希望本期一并解决，阶段 2 的规模要放大。
2. **gateway 会话在 UI 的可见性**。Tasks 视图会展示所有 Ticket（含 gateway 来源）。
   如果机器人是给外部人用的，是否需要一个「只看本地 / 全部」的过滤开关？
3. **`mandate` 本期只记录不强制**。参考 DSH 的授权模型，真正的动作准入（哪些命令能跑）
   需要额外的 policy 层。本期不做，但表结构预留字段。

## 10. 留给实现者的决定

- 槽位实现方式（信号量 vs 事件循环 tick）——建议 `better-sqlite3` 事务内 `SELECT ... LIMIT 1` 抢占，简单可靠。
- `threadKey` 在 Discord 侧的具体取值（Telegram 有 topic，Discord 有 thread/channel）。
- Stage 判定的边界情形（例如 `blocked` 之后来了 system Input，是否解冻）——建议沿用 DSH 规则：不解冻，只由人的消息解冻。
- TasksView 的视觉细节。

## 11. 风险

- **串行改并发是行为变更**，用户可能依赖「我说一句它回一句」的节拍。阶段 3 需要灰度（配置开关）。
- **per-session cwd 改动面大**：`buildTools` 有 500+ 行，所有内置工具都吃 `cwd`，需逐个验证。
- **SQLite 与 Electron 打包**：`better-sqlite3` 已在 `allowScripts` 与 `electron-rebuild` 中，
  但仍需在打包产物上实测一次。
- **`ctx.config` 合并读取可能与 `setEffort`/`setPermissionMode` 的现有调用点冲突**，需逐个核对调用方。

---

## 12. 执行锚点（2026-11-03 阶段 0-2 落地后实测）

阶段 0-2 已合并进 master（15 commits，303 tests 全绿）。以下是**实测的**文件行数、接口与坑位，供阶段 3-4 直接引用，不必重新探索。

### 12.1 可直接复用的既有实现

| 文件 | 行数 | 已提供 |
|---|---|---|
| `src/main/store/ticket-store.ts` | 167 | `export class TicketStore`(:6)、`static open(dbPath)`、`rawQuery`、`rawExec`、`close`、`enqueueEffect`、`claimDueEffects`、`deleteEffect(seq, generation): boolean`、`bumpAttempt(seq, generation, nextDue): boolean`。**已有 effect 表**；ticket/assignment/input 三表尚未创建 |
| `src/main/store/effect-runner.ts` | 179 | `export class EffectRunner`(:35)、`register(kind, handler, opts?)`(:47)、`start/stop/idle`。**handlers 收 `(payload, key)`** |
| `src/main/gateway/session-router.ts` | 350 | `export class SessionRouter`(:52)、`constructor(agentCore, dataDir, store, runner)`(:74)、`async submit(...)`(:141，必须保持 `Promise<void>`)、`resetChannels()`。**队列已持久化，注册为 `{ordered:true, concurrency:1}`** |
| `src/main/gateway/gateway.ts` | 669 | `ensureQueue()` 懒开 store/runner/router（不在构造函数）；`start()`/`stop()` 的排空顺序已按 runner→reset→adapters→server 修好 |

### 12.2 阶段 3 的硬约束（从 0-2 的教训来）

1. **不要动 `submit` 的返回类型** —— `gateway.ts` 的 WS 路径 `await` 它，IM 路径挂 `.catch()`。两者都要求 `Promise<void>`。
2. **新表必须自己建** —— `TicketStore.open()` 目前只建 `effect` 表，且用 `IF NOT EXISTS`。加表要同时兼顾已有用户库（他们已有 `effect` 表，没有新表）。
3. **任何 `delete*` 都要带 generation** —— 0-2 阶段最严重的 bug 是"in-flight 时合并导致丢消息"，修法是 `WHERE seq=? AND generation=?`。新增的 assignment/input 删除路径必须沿用这个模式，否则会重现同一类数据丢失。
4. **测试命令必须用 Electron ABI**：
   ```
   ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run <path>
   ```
   原因：`better-sqlite3` 编译为 Electron ABI 139，本地 node 是 137。用 `npx vitest` 会在任何 SQLite 测试上崩。**不要重编译或替换 node_modules。**
5. **`npm run build` 在这台机器上坏了**（Windows wrapper 调 `'"node"'`）。构建验证用 `./node_modules/.bin/electron-vite build`。
6. **typecheck 基线不是 0**：`tsc -p tsconfig.node.json` 有约 46 条既有错误（vendor、`shadow`、隐式 any 等）。新增代码必须做到**零新增**，对比方式：
   ```
   ./node_modules/.bin/tsc --noEmit -p tsconfig.node.json 2>&1 | grep "error TS" | sed 's/([0-9]*,[0-9]*)//' | sort -u
   ```
   改动前后各存一份，`comm -13` 出差异。

### 12.3 阶段 4 的 UI 挂点（实测行号）

- `src/renderer/components/RightSidebar.tsx:40` — `type RightSidebarView = 'flow' | 'folder' | 'git' | 'gateway'`，加 `'tasks'`
- 同文件 `:42` — `VIEWS` 数组，加一项（id/label/icon）
- 同文件 `:470` — `VIEW_COMPONENTS` 映射，加 `tasks: TasksView`
- 同文件 `:516` — `const ViewContent = VIEW_COMPONENTS[view] || VIEW_COMPONENTS.flow`，无需改
- 模板参考 `src/renderer/components/GatewayView.tsx`（自包含，最多 4 个 view 的样板）
- IPC 命名照 `src/shared/types.ts` 的 `IPC_CHANNELS`（`GATEWAY_*` 一组在 :119-132）

### 12.4 阶段 3-4 必须继承的已知缺口（不要当成已解决）

- **渲染层不传 sessionId**：`preload` 的 `setModel/setProvider/setEffort/setPermissionMode` 都不带 sessionId，`ConfigSetRequestSchema` 也没有该字段。**"每会话单独设模型"在后端成立、在 UI 上不可用。** 阶段 3 若要打通，需同时改 protocol + preload + useClaude，并注意渲染层的临时 id（`session-<ts>`）不是后端 id。
- **插件工具不是会话隔离的**：`PluginBus` 在 `agent-core.ts:122` 用全局 `projectDir` 构造一次，无 setter，`loadPlugin` 传 `sessionId: ''`。插件读的 `ctx.projectDir`/`allowedRoots` 是启动时目录。修它需要 `plugin-bus.ts`/`plugin-context.ts` 重新设计。
- **崩溃重放不幂等**：协议里有 `idempotencyKey`（`protocol.ts:56`）但 `gateway.ts` 解构时丢掉了。崩在 turn 中间会重放整个 turn（重复计费）。
- **`Session.cwd` 是写一次**：只在建会话时写，切项目不更新。`StageSessions` 头部读的是全局 `config.cwd`，可能与会话实际运行目录不一致。
- **队列的 `MessagePayload.cwd` 目前恒为 `undefined`**：两个调用方都显式传 `undefined`，因为 WS 协议还没有 cwd 字段。阶段 3 若让 UI 消息走队列，必须同时给协议加字段，否则又变回全局目录。

### 12.5 阶段 3 建议先做的一件事

`TicketStore` 加三张表时，**先看 `docs/superpowers/plans/2026-11-02-ticket-model-and-tasks-view.md` 的 Task 1**，它已经写好了建表 SQL 和 11 个方法签名。那份计划是基于阶段 0-2 之前的代码写的，**行号需要重新核对**，但接口设计仍然适用。

### 12.6 Task 0 已完成（2026-11-03）：UI 会话级配置接线

已合并，commit `c775233`（+ `0fb915c` 报告）。**写入路径**现在是会话级的：

| 环节 | 文件:行 | 改了什么 |
|---|---|---|
| 协议 | `src/main/gateway/protocol.ts:116` | `ConfigSetRequestSchema.params.sessionId: z.string().optional()` |
| 预加载 | `src/preload/index.ts:21-30` | 四个 setter 桥都加了 `sessionId?` 并透传 |
| 主进程 IPC | `src/main/ipc.ts:40,44,48,56` | 四个 handler 接收并转给 `claude.*` |
| 渲染层 | `src/renderer/hooks/useClaude.ts:807-816` | `updateConfig` 解析出真实会话 id 后传给全部四个 setter |
| 纯函数 | `src/renderer/utils/sessionConfigId.ts:19-44` | `resolveConfigSessionId(sid, aliases)` |

**id 解析规则（有测试，四个分支全覆盖）：**
1. 无会话 → `undefined`（写全局）
2. 临时 id 且有别名 → 返回别名（真实后端 id）
3. 临时 id 且无别名 → `undefined`（首轮还没拿到后端 id）
4. 真实 id → 原样返回

临时 id 前缀 `'session-'`，生成点 `useClaude.ts:676`。**把临时 id 当 sessionId 传给主进程是静默失败**：`setModel` 会 `getOrCreate` 一个没有任何 run 会读的上下文。

**测试基线已更新：42 files / 321 tests。** typecheck 基线不变（node 46 / web 39）。

### 12.7 ⚠️ Task 0 遗留：显示侧仍然是全局的（**同一类缺陷，方向相反**）

写入已按会话隔离，但 `useClaude.ts:815` 仍然 `setConfig(partial)` 写**全局**渲染层对象。后果比"暂时不一致"严重 —— 是**永久不一致**：

- 主进程的全局配置**不再被写**，所以 `chatStore.config.model` 这个值在主进程里不存在
- `getConfig` 只在挂载时拉一次（`useClaude.ts:288`），且 `ipc.ts:129-131` 不带 sessionId，重新拉也修不好
- 因此在会话 A 选了 opus 之后：新建的会话实际继承全局 sonnet，但选择器显示 opus
- `SettingsPanel.tsx:574,592,601` 和 `InputBar.tsx:74` 会显示错误的 model / effort / permissionMode

**要真正修好，需要一个按会话读取的配置 API**（`GET_CONFIG` 支持 sessionId + `AgentCore` 暴露会话级只读访问器 + 渲染层按会话存配置快照）。这是阶段 3 的新任务，不是 Task 0 的范围。

另外，**新会话的首轮仍然是全局写入**（规则 3），所以"在新聊天里选模型"依然影响所有会话 —— 这是有意为之的折中，但用户体感上和原 bug 同形。

### 12.8 Task 0 遗留：无渲染层→预加载的测试覆盖

`updateConfig` 是否正确传了 sid 给四个 setter、preload 的参数顺序是否对得上，目前**只靠人工核对**。漏传一个 `setPermissionMode` 不会有任何测试失败。补法是 `vi.spyOn(window.claude, 'setModel')` 这类渲染层测试。
