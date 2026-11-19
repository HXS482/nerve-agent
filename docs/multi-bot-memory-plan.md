# 多 Bot 记忆架构 — 方案与可行性

> 结论先放这里：**引擎不用换，改的是「它不知道 Bot 是谁」。**
> P0 是一处填坑（约 1 天），P1 是新管线（约 2-3 天），P2 可选。
> 下面每条都标了「代码读到的」还是「跑实验验证过的」。

---

## 0. 事实基线

### 0.1 现在的记忆里根本没有 Bot 维度（代码读到）

| 检查点 | 位置 | 现状 |
|---|---|---|
| 召回入口 | `tdai-core.ts:243` | `handleBeforeRecall(userText, sessionKey)` —— 只有 sessionKey，没有 botId |
| 写入入口 | `tdai-core.ts:264` | `handleTurnCommitted(turn)` —— `CompletedTurn` 里没有 agent 字段 |
| 本地库 l1 表 | `sqlite.ts:560` | 列里**没有** `agent_id` |
| l1 全文索引 | `sqlite.ts:795` | 有 `session_key`，**没有** `agent_id` |
| 向量检索 | `sqlite.ts:1147` | `searchL1Vector(emb, topK, queryText)` —— 全库扫，无 scope 参数 |
| 关键词检索 | `sqlite.ts:2075` | `searchL1Fts(query, limit)` —— 同上 |
| 最近记忆回退 | `sqlite.ts:2125` | `searchRecentL1(limit)` —— 直接 `ORDER BY timestamp DESC` 全库 |
| 记忆工具 | `memory-tools.ts` | grep `botId` 零命中 |
| 记忆核心实例 | `index.ts:379` | 全局一个，`dataDir` 硬编码 `~/.nerve/memory-tdai` |

### 0.2 云端那条路设计对了，但喂的 key 格式不对（代码读到 + 数据核对）

`tcvdb.ts:105` 的 `extractAgentId()`：

```ts
// Format: "agent:<agentId>:..." → parts[1]
if (parts.length >= 2 && parts[0] === "agent") return parts[1]
return ""   // ← 永远走这里
```

而 nerve 实际传的是裸 UUID。库里的真实值：

```
session_key = 94130714-c512-46c3-8637-01082887b89e
→ parts[0] !== 'agent' → agent_id = ""（空）
```

云端 collection 里 `agent_id` 确实按 `indexType: "filter"` 建了索引（`tcvdb.ts:261`），**但从来没有值**。

### 0.3 所有「关于用户的知识」和「关于 AI 自己的知识」混在一个流里

现有 11 条 L1 记录（我全读了一遍）都是用户向的：

```
[episodic|OrCAD 打不开原理图]  用户使用 Cadence Allegro/OrCAD…
[persona |杭州滨江]            敬厚萍是杭州 H3C 硬件工程师…
[instruction|天气播报]          用户要求…先用 web_search 查询…
```

`persona.md` 是 `User Narrative Profile`（74 行），`scene_blocks/` 三个文件全是用户生活的场景。

**所以不是「四个 Bot 共享一份档案」，而是「根本没有 Bot 自己的档案」。** 这是两件不同的事，对应两种不同的工作量。

### 0.4 数据量极小（可以放心迁移）

```
l1_records        11 条
l0_conversations 634 条
scene_blocks       3 个文件
persona.md        74 行
l1_vec 表          不存在（embedding 未配置，走纯 FTS）
```

### 0.5 一条隐藏的排序问题（代码读到）

`agent-core.ts` 里 recall 在 `resolveBot` **之前**：

```
:639  this.memoryCore.handleBeforeRecall(payload.prompt, sessionId)
:659  const bot = await this.resolveBot(payload.sessionId ?? '', payload.botId)
```

要给召回带 botId，必须把 bot 解析提到 recall 之前。`resolveBot` 是纯读操作，提上去没有副作用。

---

## 1. 两个实验（这两个决定了方案可不可行）

### 1.1 sqlite-vec：过滤列能用，而且 k 在过滤**之后**生效 ✅

跑在 electron 里（node 直接 require 会 `ERR_DLOPEN_FAILED`，better-sqlite3 是 electron ABI）：

```sql
CREATE VIRTUAL TABLE v USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[2] distance_metric=cosine,
  agent_id TEXT                     -- 普通列，可以当过滤键
);

-- bot-b 三条离查询最近，bot-a 三条较远
SELECT id FROM v WHERE embedding MATCH ? AND k=3 AND agent_id='bot-a'
→ ["a1","a2","a3"]          ← 过滤后取 3 条，不是「取 3 条再过滤」
```

这一条很关键：如果 `k` 在过滤前生效，就会出现「top-3 全是别人的，过滤完剩 0 条」的经典 bug。实测没这个问题。

### 1.2 vec0 / fts5 老库加列：vec0 不行，fts5 可以 ❌ / ✅

```
ALTER TABLE v ADD COLUMN agent_id TEXT
→ "virtual tables may not be altered"

vec0 的影子表：v_info / v_chunks / v_rowids / v_vector_chunks00

fts5 的 UNINDEXED 列可以直接建，也能当过滤条件：
CREATE VIRTUAL TABLE f USING fts5(content, record_id UNINDEXED, agent_id UNINDEXED);
SELECT record_id FROM f WHERE f MATCH ? AND agent_id IN (?, 'shared')
→ ["r1","r3"]               ← 正常
```

**影响**：`l1_vec` 不能 ALTER，只能 DROP + 重建。好消息是它现在**根本不存在**（embedding 没配），所以这一步是免费的。将来开 embedding 时直接按新 schema 建。

注意 fts5 表的迁移代价：`sqlite.ts:2223` 已经有现成的 `migrateFtsTablesIfNeeded()` + `rebuildFtsIndex()`，照抄即可。

---

## 2. 设计：三类记忆

| 类型 | 内容 | 谁能读 | 谁写 | 对应参考实现 |
|---|---|---|---|---|
| **用户档** | 他是谁、偏好、项目背景、习惯 | 所有 Bot | 记忆管线（L1→L3） | EverOS 的 user track；现有 `persona.md` |
| **Bot 档** | 我怎么干活、踩过什么坑、我的判断风格 | 只有自己 | 记忆管线 + Bot 自己 | EverOS 的 agent track |
| **共享板** | 团队共识、当前任务状态 | 所有 Bot，只读 | 单一写者（交接落款那条路） | Munder Difflin 的 `board.md` |

**关键判断：用户档必须全局唯一。** 四个 Bot 各记一份「老板是谁」→ 认知必然漂移，这正是 mem0 用 `user_id` 而不是 `agent_id` 做主体维度的原因。而 `agent_id` 是**过器**（这个 Bot 能不能看），不是**主体**（这是谁的记忆）。

这不是我拍的，是上面四个仓库的共同点：

- mem0：`user_id` / `agent_id` / `run_id` 三个都是 scope，**至少给一个**，但语义上 user 是主体
- Letta：`persona` 块每个 agent 私有，`human` 块…也是私有（它的局限），但 shared block 是**写一次所有人可见**
- EverOS：明确把 `user episodes/profile` 和 `agent cases/skills` 列成两个 first-class surface
- HIVE：`identity.md` + `memory.md` 私有，`board.md` 共享

---

## 3. Scope 的编码方式

### 方案 A：复用 sessionKey 前缀（推荐）

```
agent:<botId>:<sessionId>
```

理由：
- `extractAgentId()` 已经认这个格式，云端那条路立刻生效（零改动）
- 不用给 `handleBeforeRecall` / `handleTurnCommitted` / `CompletedTurn` 加参数
- `sessionId` 仍然是裸 UUID，per-session 查询不受影响

代价：
- 本地 sqlite 要加列并从 sessionKey 解析（一次性）
- `l1-reader.ts:149` 的 `parsed.sessionKey !== sessionKey` 比对要保证两边格式一致（同一个函数传同一个值，天然一致）
- 老数据（11 条裸 UUID）解析出空 agentId → 当作 `shared`，对所有 Bot 可见。这恰好是升级前的正确语义。

### 方案 B：显式传 agentId

签名一路加参数：`performAutoRecall` / `performAutoCapture` / `upsertL1` / `searchL1*`。语义更干净，但要改 6+ 个签名、2 个接口、以及 gateway 那条独立路径。

**选 A。** 格式约定处写死注释，比散落 6 处的参数更容易守。

---

## 4. 改动清单

### P0 — 堵住泄漏（必做，约 1 天）

| # | 文件 | 改动 | 风险 |
|---|---|---|---|
| 1 | `agent-core.ts:639` | 把 `resolveBot` 提到 recall 之前；recall 传 `agent:${bot.id}:${sessionId}` | 低（纯读操作提前） |
| 2 | `agent-core.ts:1745` | capture 的 `sessionKey` 同款拼接；`handleResult` 里已有 `bot` 在作用域 | 低 |
| 3 | `sqlite.ts:560` | `l1_records` 加 `agent_id TEXT DEFAULT ''` + 索引 | 低（普通表，可 ALTER） |
| 4 | `sqlite.ts:795` | `l1_fts` 加 `agent_id UNINDEXED`；走现成的 `migrateFtsTablesIfNeeded` + `rebuildFtsIndex` | 中（要改重建 SQL） |
| 5 | `sqlite.ts:1147` | `searchL1Vector(emb, topK, queryText?, scope?)` —— vec0 那条 SQL 加 `AND agent_id IN (...)` | 中（要重建 vec 表，但现在没有） |
| 6 | `sqlite.ts:2075` | `searchL1Fts(query, limit, scope?)` | 低 |
| 7 | `sqlite.ts:2125` | `searchRecentL1(limit, scope?)` —— **这个最容易漏**，漏了就等于「最近记忆」回退路径把全库端出来 | 低 |
| 8 | `auto-recall.ts:412/446/487` | 三处调用把 scope 传下去；scope 从 sessionKey 推 | 低 |
| 9 | `l1-writer.ts:195` | 写入时把 `agentId` 存进行 | 低 |
| 10 | `l1-dedup.ts:230/277` | 去重候选也要 scoped —— 否则新记忆可能被合并进**别人**的记录里 | 中 |
| 11 | `memory-tools.ts` | `tdai_memory_search` / `tdai_conversation_search` 带当前 Bot 的 scope | 低 |

**Scope 语义**：`agent_id IN (本 Bot, 'shared')`。老数据 agent_id 为空 → 归 `shared`。

**这一步的收益**：召回精度不再被别的 Bot 稀释；dedup 不会跨 Bot 错误合并；记忆工具不会把同事的对话端出来。

**这一步不做的收益**：文档 §1「用户档」和「Bot 档」还是混在一起 —— 但至少不再互相污染。

### P1 — 加 Bot 轨（约 2-3 天）

现在 L1 提取的 prompt 是 `l1-extraction.ts`，产出的是「用户叙事」。要加一条 Bot 轨，需要：

| # | 内容 | 工作量 |
|---|---|---|
| 1 | 新 prompt：从同一批对话里抽「我（这个 Bot）学到了什么」—— 工具用法、踩坑、判断偏好 | 半天（照 `l1-extraction.ts` 改） |
| 2 | 写入时按 type 分流：`episodic`/`persona`/`instruction` 进用户档，`agent_skill`/`agent_pitfall` 进 Bot 档 | 半天 |
| 3 | 召回时分两路：用户档按 `shared` 取，Bot 档按 `agent_id` 取，拼进不同段落（用户档 → `<memory>`，Bot 档 → `<my-experience>`） | 1 天 |

**一个必须先想清的问题**：Bot 档到底存什么？现在库里**一条都没有**，我不知道你的实际需求是：
- (a) 「nerve 记得自己上次怎么修的 visit_jobs schema」这种工作记忆
- (b) 「redbook 的文风偏好」这种人设记忆
- (c) 两者都要

(a) 更像 skill，(b) 更像 persona。**我倾向先做 (a)** —— 因为它可直接观察效果（问它同一个坑会不会再犯），(b) 太虚，做完了看不出来对不对。

### P2 — 共享板（可选）

抄 HIVE 的 `board.md`：单写者、只读给其他 Bot。在 nerve 里的位置大概是 `~/.nerve/memory-tdai/shared/board.md`，注入在 `<memory>` 之前。

这个和交接（`hops.db`）有重叠 —— 交接的 `notice` 行本来就在做「告诉别人一件事」。**建议先不做**，等 P0/P1 跑一阵看还需要什么。

---

## 5. 迁移

数据量决定了这是小事：

```sql
-- 普通表，直接加
ALTER TABLE l1_records ADD COLUMN agent_id TEXT DEFAULT '';
CREATE INDEX idx_l1_agent ON l1_records(agent_id);

-- 老记录：session_key 是裸 UUID，解析出空 → 归 shared
UPDATE l1_records SET agent_id = 'shared' WHERE agent_id = '';

-- fts5：DROP + 重建（照 migrateFtsTablesIfNeeded 的模式）
-- vec0：现在不存在，将来按新 schema 建，无需迁移
```

**回滚**：`agent_id` 全填 `shared` 就等于没改（所有 Bot 都看得到）。所以出问题时的退路是一行 SQL。

---

## 6. 风险

| 风险 | 严重度 | 说明 |
|---|---|---|
| **vendor 里零测试** | 高 | `find src/vendor -name "*.test.ts"` → 空。改动全靠手工验证，而 vendor 大量 `catch { return [] }` 会**静默降级** |
| 静默失败 | 高 | 召回挂了只是没注入记忆，界面上看不出来。建议：加一个「本轮回灌了几条、scope 是什么」的 debug 日志，并在 UI 上可见 |
| vec0 不能 ALTER | 中 | 现在没表所以免费；将来开 embedding 时如果已有数据，必须 DROP 重建 + 重新 embed（费 token） |
| sessionKey 格式散落 | 中 | 拼接的格式只有一处 `agent:`+botId+`:`+sessionId，但消费方有 4 处（解析、JSONL 比对、pipeline 分组、工具过滤）。要写一个 `buildScopeKey` / `parseScopeKey` 统一 |
| gateway 第二条路径 | 中 | `gateway` 有独立的 `AgentCore`（之前踩过），不接的话 IM 那边还是全共享 |
| persona 生成输入是混合流 | 中 | `persona.md` 由所有 Bot 的对话共同蒸馏。P0 不会改这个 —— 用户档本来就是共享的，但**输入里混着四个 Bot 的不同声线**，蒸馏出来的人设可能更模糊 |

---

## 7. 落地顺序

```
P0-1  加 buildScopeKey/parseScopeKey + agent-core 两处接线   （半天）
P0-2  sqlite 加列 + fts 重建 + 三个 search 加 scope          （半天）
P0-3  auto-recall / dedup / memory-tools 传 scope            （半天）
P0-4  验证：造两个 Bot 各存一条独有记忆，互查不到             （半天）
─────────────────────────────────────────────────────────
P1    用户档 / Bot 档分流（需先定 Bot 档存什么）
P2    共享板（建议等等）
```

**P0 的验收标准**（可测，不靠感觉）：

1. Bot A 的记忆在 `tdai_memory_search` 里 Bot B 搜不到
2. 「最近记忆」回退路径也不泄漏（最容易漏的那条）
3. 老数据（11 条）仍能被所有 Bot 召回（= shared 语义正确）
4. dedup 不会把新记忆合并进别的 Bot 的记录

---

## 8. 参考实现对照

| 仓库 | 学什么 | 不学什么 |
|---|---|---|
| **mem0** (69K) | `_strip_identity_keys`：不允许调用方用 metadata 把记忆塞进未授权的 scope | 三层嵌套 scope，对 nerve 是过度设计 |
| **Letta/MemGPT** | memory block 四要素（label/description/value/limit），`description` 决定模型怎么写它；shared block 是**协调原语** | 它把 `human` 块也做成每 agent 私有 —— 那正是要避免的漂移 |
| **EverOS** | 用户轨 / agent 轨分开，`agent_id` 是正交过滤维而非主体；markdown 是 source of truth，索引是可重建的 shadow | 全套 markdown 重写，代价不划算 |
| **Munder Difflin / HIVE** | 单写者 per 文件；`board.md` 单写者；反活锁（`hops` 上限） | 它自己说「5-15 个 agent 不需要向量层」—— 而 nerve 已有完整 L1/L2/L3 |
| **腾讯 Agent Memory**（现用） | 分层本身就比大多数仓库强（token −61%，PersonaMem 48%→76%） | 它的 `agent_id` 没接对 —— 这才是要修的 |

---

## 附：为什么不是「每个 Bot 一个 dataDir」

考虑过，否决了：

- 每个 Bot 一份 `persona.md` + `scene_blocks/` → 「老板是谁」这个认知会被蒸馏四遍，必然漂移
- 共享板要跨库查 → 得再搞一套跨库检索
- 4 个 `MemoryTdaiCore` 实例 = 4 个 SQLite 连接 + 4 条 pipeline，内存和后台任务翻四倍
- 而收益（彻底隔离）在「用户档本来就该共享」的前提下并不成立

**一句话：隔离要按信息类型分，不能按 Bot 分。**
