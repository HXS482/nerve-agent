# Bot 驱动改造设计：Bot 实体 + Routines + Scheduler

> 日期：2026-11-12
> 状态：设计已确认，待实现
> 参考：[CopilotKit/OpenBot](https://github.com/CopilotKit/OpenBot) 的 Bot 模型（八原语）与 Routines 机制（docs/routines.md、docs/how-openbot-works.md）

## 0. 背景与目标

nerve 现在是 **session 驱动**：会话是主体，用户发消息 → agent 在会话上下文里跑。Agent 没有"身份"，只有"上下文"。

目标是改成 **bot 驱动**（OpenBot 模式）：引入持久化的 Bot 实体（角色 + 记忆 + 技能 + 常驻任务），session 降级为"Bot 的一次对话实例"。核心增量是 **Routine**——Bot 不被询问时也能自己干活（定时触发）。

已确认的产品决策：

| 决策点 | 结论 |
|---|---|
| Bot 与 session 关系 | Bot 是持久实体，session 是实例（OpenBot 模式） |
| Routine 回复投递 | 绑定创建时的会话；会话已删则回落 Bot 的 home session |
| 创建方式 | 模型工具 + UI 表单都做；**第一版先工具**，表单随后 |
| 护栏 | 照搬 OpenBot：15min 触发下限 / 20 个启用上限 / 10 次连续失败熄火，硬编码 |
| Scheduler 位置 | Electron main 进程内定时器（方案 1），**接受 app 关了就不跑** |
| 错过窗口 | 跳过不补（stamp 快进） |
| UI | 会话内 routine 列表 + Bot 页面，第一版都做 |
| Bot 数量 | 不限制（Bot 只是配置文件，不主动耗资源） |

## 1. Bot 实体层

**存储**：`NERVE_DIR/bots/<botId>.json`，每 Bot 一个 JSON 文件（Bot 是配置不是流水数据，不值得上 SQLite）。

```jsonc
{
  "id": "bot_xxx",
  "name": "小助手",
  "instructions": "你是一个日程管理助手...",   // 拼进 system prompt
  "isDefault": true,                          // 迁移标记
  "homeSessionId": "xxx",                     // 兜底投递目标
  "boundSkills": [],                          // 绑定 skill 名单（初期为空 = 全部，只读展示）
  "boundMcp": [],
  "createdAt": 0,
  "updatedAt": 0
}
```

**新模块 `src/main/core/bot-registry.ts`**：CRUD + 列表 + `getBySession(sessionId)`。

**启动迁移**：`AgentCore` 初始化时若 `bots/` 目录为空 → 自动创建一个 `isDefault: true` 的默认 Bot，把已有会话全部挂到它名下。老用户零感知。

**与 session 的关系**：
- session 侧加 `botId` 字段（`SessionContext` / `gateway-sessions.json` 映射里加一个键，缺省 = 默认 Bot）；
- `composeSystemPrompt`（`core/system-prompt.ts`）增加 Bot instructions 段；
- 一个 Bot 可有多个 session；一个 session 必属一个 Bot。

## 2. Routine 数据层

**存储**：SQLite（better-sqlite3），**新开 `routines.db`**，不混进 `tickets.db` —— TicketStore 的惰性打开/失败降级语义与 routine 无关，混表会互相牵连。

```sql
CREATE TABLE routines (
  id TEXT PRIMARY KEY,            -- rt_xxx
  bot_id TEXT NOT NULL,
  session_id TEXT,                -- 创建时的会话（回复投递目标）
  instruction TEXT NOT NULL,      -- What：用户原话
  schedule TEXT NOT NULL,         -- Starts：见 §4 schedule 格式
  next_run_at INTEGER,            -- 下次触发时间戳（stamp，不是队列）
  enabled INTEGER DEFAULT 1,
  consecutive_failures INTEGER DEFAULT 0,
  failure_notified INTEGER DEFAULT 0,  -- 疲劳规则：本轮首次失败已通知
  last_run_at INTEGER,
  created_by TEXT,                -- 'user' | 'model'
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE routine_sweeps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swept_at INTEGER NOT NULL       -- scheduler 心跳
);
```

**新模块 `src/main/store/routine-store.ts`**：CRUD、`dueRoutines(now)`、`advanceStamp(id, now)`、`recordFailure / recordSuccess`、心跳读写。

## 3. Scheduler（触发层）

**新模块 `src/main/core/scheduler.ts`**。Electron main 进程内 `setInterval`，每 30s 一轮：

```
sweep():
  1. 写 routine_sweeps 心跳
  2. dueRoutines(now) → 逐条：
     a. advanceStamp(id, now)   // 先推进 next_run_at，防执行慢导致重复触发
     b. 解析目标 sessionId：routine.session_id 存活？否则 bot.homeSessionId
     c. dispatch(kind:'system', text: "[Routine 触发] " + instruction,
                 source: "routine:<id>")
  3. 失败计数在执行结果回写时处理（见 §5）
```

**关键补丁 —— routine 触发不依赖 Gateway 启动**：`TicketRouter` 目前只在 `NerveGateway.start()` → `ensureQueue()` 里惰性创建。Scheduler 必须在没有 Gateway 流量的情况下也能投递。改造方向：把 `ensureQueue()` 的创建逻辑提为 Scheduler 可达的公共路径（细节在实现 plan 里定），或 Scheduler 内联一个最小化 ensureQueue。**设计红线：Gateway 未启动时 routine 照常触发**，此时输出通道用 `NullOutputChannel` + 落到 home session 的 transcript。

## 4. Routine 工具（模型侧）与 schedule 格式

`src/main/tools.ts` 新增 4 个内置工具，注册进 `getBuiltinTools`，**标记不可剥夺**（不给禁用入口，OpenBot 同款：服务器对回收这些工具返回 403）：

- `create_routine(instruction, schedule, session_hint?)` —— 校验 15min 下限、20 上限；`session_hint` 缺省 = 当前会话；`created_by='model'`
- `list_routines()` —— 当前 Bot 的列表（含 enabled / next_run_at）
- `update_routine(id, ...)` —— 可改 instruction / schedule / enabled
- `delete_routine(id)` —— 走现有审批链（`onToolApproval`）

**schedule 格式**（第一版只支持两种，不引 cron 解析库）：

| 格式 | 含义 | 校验 |
|---|---|---|
| `interval:<N>m` | 每 N 分钟 | N ≥ 15 |
| `daily:HH:mm` | 每天 HH:mm | — |
| `weekly:<d>-<d>:HH:mm` | 每周指定几天 HH:mm | d ∈ 0-6（0=周日） |

模型负责把自然语言翻成这三种；翻不出来（如"每隔一个周二"）就拒绝创建并说明。模型可以在回复里告诉用户覆盖不了。

## 5. 执行语义与护栏

**执行**：触发 = 一条 `kind: 'system'` 消息进 Ticket 队列，之后全部复用现有机制——SlotScheduler 槽位、per-ticket 串行链、持久化 effect 表、崩溃恢复。**不在 Scheduler 里发明新的执行通道。**

**权限**：以所属用户身份跑（单机 = 本人）；system 消息不触发"人说话"类前置行为。

**审计**：ticket 带来源标记 `source: "routine:<id>"`，ticket 视图能区分人发与定时触发（对应 OpenBot 的 initiator 语义）。

**护栏（硬编码，不可配置）**：

| 护栏 | 值 | 生效点 |
|---|---|---|
| 触发下限 | 15 分钟 | create/update 时校验 schedule，拒绝更密的 |
| 启用上限 | 每 Bot 20 个 enabled | create 时计数拒绝 |
| 疲劳规则 | 首次失败通知一次；连续失败 10 次 → `enabled=0` + 最终通知 | 执行结果回写时 |

**失败判定**：dispatch 后由 TicketRouter 的执行结果回调回写（成功 `recordSuccess` 清零计数；失败 `recordFailure` 递增）。疲劳规则**不是重试策略**：它回答"这个 routine 还值不值得跑"，重试由 effect 表现有 attempt 语义负责。

**错过窗口**：`advanceStamp` 把 `next_run_at` 快进到未来第一个到期点，**不补跑**过期的触发（app 关了一夜 = 只在启动后的下一个到期点跑一次，不会连跑 N 次）。

## 6. UI（第一版全做）

1. **会话内**：消息框旁时钟入口 → 该会话所属 Bot 的 routine 列表：指令、schedule、下次触发时间、开关、删除。数据经 IPC 读 `routine-store`。
2. **Bot 页面**：Bot 列表/详情——name、instructions（可编辑）、home session、该 Bot 的 routines。skills/MCP 绑定第一版**只读展示**，不做编辑。
3. **心跳指示**：routine 相关界面显示"最近 sweep 时间"（读 `routine_sweeps`）；超过 15 分钟（= 触发下限，不可能有一轮合法 sweep 需要更久）显示警告"调度器未运行"。**没 scheduler 时 UI 不能看起来一切正常**——OpenBot 明确踩过这个坑。

## 7. 测试

- `routine-store`：CRUD；`dueRoutines` 边界（等于/差一秒）；`advanceStamp` 快进语义；疲劳计数状态机（首次失败通知、第 10 次熄火、重新启用清零）
- `scheduler`：触发→dispatch 映射；session 失效回落 home session；Gateway 未启动兜底路径；先 advanceStamp 后 dispatch 的防重语义
- 工具：15min 下限拒绝、20 上限拒绝、非法 schedule 拒绝
- 手动验证：建 `interval:15m` routine 观察两次触发；kill app 重启，确认快进不补跑

## 8. 不做的（明确出界）

- 事件触发（webhook / 文件变化 / IM 事件唤醒）——远期，hook-registry 扩展
- Routine 表单编辑器（二期 UI）
- Bot 的 skills/MCP 绑定编辑（字段保留、只读）
- 每消息级 token 预算/配额
- 多用户
