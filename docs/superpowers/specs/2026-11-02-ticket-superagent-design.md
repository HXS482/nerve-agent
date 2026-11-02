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
