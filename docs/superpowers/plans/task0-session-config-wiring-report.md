# Task 0 — 会话级模型配置打通到 UI（实现报告）

日期：2026-11-03 · 分支：master · commit：`c775233`

## 一、问题回顾

Phase 0-2 已经把后端做成"能按会话配置"：`AgentCore.setModel(model, sessionId?)` 在给了
`sessionId` 时写该会话的 `ctx.config`，`sendMessage` 用 `mergeConfig` 合并生效。但**整条链路上
没有任何一环能把 sessionId 送进去**：顶部模型选择器仍然只改全局，所有会话一起变。本次修的就是
这条断开的路。

四条链路 + 1 条附带：

---

## 二、逐文件改动（行号基于 `c775233`）

### 1. `src/main/gateway/protocol.ts:110-122`

`ConfigSetRequestSchema.params` 新增 `sessionId: z.string().optional()`（第 116 行，带注释）。

这是**根因**：zod 默认剥掉未声明的键，所以 `gateway.ts:614-616` 里的 `params.sessionId` 永远是
`undefined` —— 外部 agent 传了 sessionId 也一律落到全局写入，把别的客户端一起改掉。

### 2. `src/preload/index.ts:21-30`

四个 setter 加可选尾参并转发：

| 行 | 方法 |
| --- | --- |
| 22-23 | `setModel(model, sessionId?)` → `invoke(SET_MODEL, model, sessionId)` |
| 24-25 | `setEffort(effort, sessionId?)` → `invoke(SET_EFFORT, effort, sessionId)` |
| 26-27 | `setProvider(providerId, sessionId?)` → `invoke(SET_PROVIDER, providerId, sessionId)` |
| 28 | `setCwd(cwd)` —— **未改**，cwd 是"跑在哪"，全局语义 |
| 29-30 | `setPermissionMode(mode, sessionId?)` → `invoke(SET_PERMISSION_MODE, mode, sessionId)` |

### 3. `src/main/ipc.ts:39-58`

四个 handler 接 `sessionId?: string` 并透传：

- `:40-42` `SET_MODEL` → `claude.setModel(model, sessionId)`
- `:44-46` `SET_PROVIDER` → `claude.setProvider(providerId, sessionId)`
- `:48-50` `SET_EFFORT` → `claude.setEffort(effort as ClaudeConfig['effort'], sessionId)`
- `:56-58` `SET_PERMISSION_MODE` → `claude.setPermissionMode(mode as ..., sessionId)`

**核实过** `src/main/claude.ts:101-119`：`ClaudeService.setModel/setProvider/setEffort/
setPermissionMode` 都已经是 `(x, sessionId?: string)` 并原样转给 `this.core.setXxx`。没有改动。

### 4. 新增 `src/renderer/utils/sessionConfigId.ts`（纯函数，49 行）

`isTempSessionId(sid)` + `resolveConfigSessionId(sid, aliases)`。见下一节。

### 5. `src/renderer/hooks/useClaude.ts`

- `:6` `import { resolveConfigSessionId } from '../utils/sessionConfigId'`
- `:22-26` `Window['claude']` 类型声明：四个 setter 加 `sessionId?: string`
  （`setCwd: (cwd: string)` 保持原样）
- `:792-805` 新增 `resolveConfigSessionIdForActiveWorkspace()`，把当前工作区会话 id 交给纯函数
- `:807-817` `updateConfig()` 先算一次 `sid`，再分别传给 model / provider / effort /
  permissionMode；`setCwd` 仍然不带 id

### 6. `src/main/gateway/gateway.ts:607-614`（注释修正）

原来那段注释写着"ConfigSetRequestSchema 目前没有 sessionId 字段（zod 会把它剥掉）……在那之前
行为与今天一致"——即把 bug 记录成了设计。改为说明字段已透传、该 bug 已修。**无逻辑改动**（该处
本就已把 `params.sessionId` 传下去，缺的只是协议字段）。

### 7. diff 范围说明

允许清单是 `protocol.ts` / `preload/index.ts` / `ipc.ts` / `useClaude.ts` / 测试文件。
实际 diff 里多出三项，均为**零逻辑**增量：

- `src/renderer/utils/sessionConfigId.ts`（新文件）—— 任务本身要求"优先抽成纯函数
  `resolveConfigSessionId`"，这是它的落点。
- `src/renderer/utils/__tests__/sessionConfigId.test.ts`（新文件）—— 上述纯函数的测试。
- `src/main/gateway/gateway.ts:607-614` —— **仅注释**。原注释把"zod 会剥掉 sessionId"这个
  bug 写成"在那之前行为与今天一致"的既定设计，留着会误导下一个人。若要求严格零越界，
  这一处可单独 revert，不影响任何行为与测试。

---

## 三、id 解析规则（本次的核心细节）

**位置：`src/renderer/utils/sessionConfigId.ts`（纯函数）+ `useClaude.ts:800-805`（接线）**

渲染层给新会话造的临时 id 是 `session-<ts>`，只存在于渲染层；后端真实 id 是 uuid（首轮跑完由
`agent-core.ts:295` 的 `randomUUID()` 分配，经 onDone / flow meta 回到渲染层）。

把临时 id 当 sessionId 发给主进程是**静默失败**：`writeSessionConfig` 会 `getOrCreate` 一个以
临时 id 为键的上下文，没有任何 run 会读到它 —— 选择器上显示新模型，实际跑的仍是旧模型。

实现的规则（判定顺序即代码顺序）：

| 输入 | 输出 | 理由 |
| --- | --- | --- |
| `null` / `undefined` / `''` | `undefined` | 没有会话 → 写全局，向后兼容 |
| 真实 id（非 `session-` 前缀） | 原样返回 | 直接按会话写 |
| 临时 id，aliases 里**有**映射 | 映射到的后端 id | 首轮已返回后端 id，按会话写 |
| 临时 id，aliases 里**没有**映射 | `undefined` | 首轮还没回来 → 写全局；新会话随后从全局默认继承，这轮之后读到的就是正确配置 |
| 临时 id，别名本身又是临时 id | `undefined` | 防二次泄漏，宁可写全局也不写进没人读的上下文 |

**复用而非另造**：`send()` 里的 sid 解析（`useClaude.ts:665-667`）用的是
`!sid.startsWith('session-')` 判断"是否真实会话"，`isTempSessionId` 就是把这同一个前缀判断抽出来。
别名映射用的是**已有的** `useTodoStore.aliases`（`todoStore.ts:15`，`recordAlias` 在
`useClaude.ts:606` 首轮流式期间登记、`releaseAlias` 在 `:539` onDone 交换时清理），没有新增别名机制。

工作区归属沿用 `getWorkspaceSessionId(useStageStore.getState().viewMode)` —— 与 `send()` / `cancel()`
完全一致（顶部模型岛是 chat / stage 共用的控件，必须改"当前正在看的那个会话"）。

---

## 四、TDD 证据

### RED

新增三个测试文件，先写后实现。第一次运行（实现前）：

```
$ ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run \
    src/main/__tests__/gateway/config-set-session.test.ts src/renderer/utils/__tests__/sessionConfigId.test.ts

 × 保留 params.sessionId（zod 不能把它剥掉）            AssertionError: expected undefined to be 'sess-123'
 × provider / effort 与 sessionId 可同时携带            AssertionError: expected { provider: 'p1', effort: 'high' } to match object {...}
 ✓ 不带 sessionId 时保持 undefined（向后兼容路径）
 × sessionId 非字符串时拒绝请求                          AssertionError: expected true to be false
 × RequestSchema 判别联合体同样保留 sessionId            AssertionError: expected undefined to be 'sess-abc'
 FAIL src/renderer/utils/__tests__/sessionConfigId.test.ts
      Error: Cannot find module '../sessionConfigId'
 Test Files  2 failed (2)        Tests  4 failed | 1 passed (5)
```

（第 3 条在 RED 阶段就是绿的 —— 它钉的是"向后兼容"，本来今天就是这个行为；保留它是防止修复
过程中顺手把无 sessionId 的路径改坏。）

IPC 测试的 RED 用另一种方式证明：写好后把 `src/main/ipc.ts` 临时还原成 `HEAD` 版本再跑：

```
 × SET_MODEL 把 sessionId 透传给 claude.setModel
 × SET_PROVIDER 把 sessionId 透传给 claude.setProvider
 × SET_EFFORT 把 sessionId 透传给 claude.setEffort
 × SET_PERMISSION_MODE 把 sessionId 透传给 claude.setPermissionMode
 × 不传 sessionId 时仍是 undefined（旧的全局写入行为）
 Test Files  1 failed (1)        Tests  5 failed (5)
```

（然后恢复实现版。末条在旧代码上失败是因为旧 handler 只有一个参数，断言 `toHaveBeenCalledWith
('sonnet', undefined)` 与实际 `('sonnet')` 不匹配 —— 即它同时也钉住了"调用形状"。）

### GREEN

```
$ ... vitest run src/main/__tests__/gateway/config-set-session.test.ts \
                 src/renderer/utils/__tests__/sessionConfigId.test.ts
 ✓ src/renderer/utils/__tests__/sessionConfigId.test.ts (8 tests) 4ms
 ✓ src/main/__tests__/gateway/config-set-session.test.ts (5 tests) 6ms
 Test Files  2 passed (2)        Tests  13 passed (13)

$ ... vitest run src/main/__tests__/ipc-config-session.test.ts
 ✓ src/main/__tests__/ipc-config-session.test.ts (5 tests) 7ms
```

### IPC 可测性说明

任务允许在 `ipcMain` 太绕时放弃 IPC 测试，但实测**不绕**：`ipc.ts` 顶层只 import 了 electron 的
`ipcMain / dialog / BrowserWindow / shell`，其余依赖都在 handler 内部惰性使用。所以
`vi.mock('electron', ...)` 截获 `ipcMain.handle` 收下真实 handler 再直接调用即可，测的是**生产代码**
而不是复制品。因此按"能测就测"写了真测试（`src/main/__tests__/ipc-config-session.test.ts`，5 条）。

### 测试清单

| 文件 | 条数 | 钉住什么 |
| --- | --- | --- |
| `src/main/__tests__/gateway/config-set-session.test.ts` | 5 | zod 不再剥掉 `params.sessionId`；与 provider/effort 共存；缺省为 undefined；非字符串被拒；判别联合体同样保留 |
| `src/main/__tests__/ipc-config-session.test.ts` | 5 | 四个 handler 把 sessionId 透传到 `claude.setXxx`；不传时是 `undefined` |
| `src/renderer/utils/__tests__/sessionConfigId.test.ts` | 8 | `isTempSessionId` 3 条；`resolveConfigSessionId` 5 条（含临时 id 无别名→undefined、别名链断→undefined） |

没有断言任何"必然成立"的空话；每条都对应一条具体的失败模式。

---

## 五、类型检查（before / after）

命令（两端统一）：

```
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json 2>&1 | grep "error TS" \
  | sed 's/([0-9]*,[0-9]*)//' | sort -u
# web 同理 -p tsconfig.web.json
```

| 配置 | before | after | 新增 |
| --- | --- | --- | --- |
| `tsconfig.node.json` | 46 行 | 46 行 | **0** |
| `tsconfig.web.json` | 31 行 | 31 行 | **0** |

说明：`sort -u` 对 web 的 3 行会产生**假差异** —— tsc 输出的联合类型成员顺序不稳定
（`'diff' | 'flow' | 'folder' | 'git'` vs `'flow' | 'folder' | 'git' | 'diff'`、
`ConvEntry | MemoryAtom | SceneBlock | PersonaCard` vs 另一种顺序）。按"文件+错误码+规范化
（排序引号内联合成员）"重新比对后：node `before 46 / after 46 / NEW 0 / GONE 0`，
web `before 31 / after 31 / NEW 0 / GONE 0`。**零新增错误**，且同行数纯属巧合（集合完全相同）。

---

## 六、全量回归

```
$ ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
    node_modules/vitest/vitest.mjs run
 Test Files  42 passed (42)
      Tests  321 passed (321)
```

- 基线：**39 files / 303 tests** 全绿
- 现在：**42 files / 321 tests** 全绿（+3 文件 / +18 测试，即本次新增的三个文件）
- 无回归。

---

## 七、无法在没有 GUI 的情况下验证的部分

1. **端到端真实行为**：在模型选择器里给会话 A 选 opus、切到会话 B 仍显示旧模型、A 的下一次
   `sendMessage` 真的用 opus 跑 —— 这需要起 Electron 界面。已用纯函数单测 + 四环透传测试把这
   条路径的每一环分别钉住，但"环与环之间的接线"（`updateConfig` 里 `sid` 真的被传给
   `window.claude`，以及 preload 的 `invoke` 参数顺序与 ipc handler 形参顺序真的对齐）只有
   类型检查 + 代码阅读保证，没有集成测试。
2. **preload → main 的真实 IPC 序列化**：单测里 preload 与 ipc 是被分别验证的（ipc 用 mock
   electron 直接调 handler；preload 只做了类型检查）。参数顺序错位在类型层面是查不出来的
   （`invoke(channel, model, sessionId)` 与 `handle((_e, model, sessionId))` 靠人工核对，
   已核对）。
3. **首轮竞态**：用户在**发第一条消息的流式过程中**改模型。此时临时 id 可能已经有别名（flow
   meta 先到）也可能还没有（onDone 才到），行为取决于时序 —— 有别名就写对的会话，没有就写
   全局（下一轮生效）。这是刻意选择的保守行为，但真实时序无法在无 GUI 下复现。
4. **Stage 工作区的模型岛**（`App.tsx:236`）：`viewMode === 'stage'` 时模型岛用的是
   `stageStore.stageSessionId`，同样走这套解析；这条路径只有类型检查和纯函数单测覆盖。

---

## 八、顾虑

1. **`updateConfig` 只改当前会话，但 `setConfig(partial)` 写的是全局 store 视图。**
   渲染层的 `config` 是单一对象，因此"会话 A 选了 opus"会让 UI 在切到会话 B 时**仍显示 opus**，
   直到 B 自己跑一轮（`send` 之后 `getConfig` 拉回全局值）或用户重新选择。本任务的验收口径是
   "选择器不再改掉所有会话的模型"，这一点达成了；但**界面上显示的是最后选择的模型，不是每个
   会话各自的模型**。真正的每会话显示需要渲染层按会话缓存 config 快照（属于另一块工作，超出
   本次允许的 diff 范围：`protocol.ts` / `preload` / `ipc.ts` / `useClaude.ts` / 测试）。
   记为**已知残留**，建议作为后续 phase-3 条目。
2. **`config.set` 的 `sessionId` 现在能改会话级配置了 —— 能力面扩大。**
   这本来就是 phase 0-2 的意图，本次只是把协议补齐。但要注意：gateway 的 `sessionId` 来自外部
   agent 自己填的字符串，`writeSessionConfig` 会 `getOrCreate` —— 一个恶意/出错的客户端可以用
   任意 id 在内存里堆积 `SessionContext`（无鉴权、无上限）。这是**既有**的设计（phase 0-2 已定），
   本次让它真正可达。已确认 `permissionMode` 仍然在 gateway 侧被显式拦截（`gateway.ts:618-621`，
   防提权），没有放开。
3. **`setCwd` 没有 sessionId** —— 刻意。cwd 是"跑在哪"，`AgentCore.setCwd` 只接受一个参数且会
   落盘 + 改最近项目列表，把它做成会话级是另一个（更大的）改动。
4. **别名来源是 `todoStore.aliases`**，语义上它属于 todo 模块。复用它是为了不新增第三套别名机制，
   但耦合值得注意：如果将来 todoStore 的 alias 生命周期变了（比如首轮就 release），配置写入会
   退回全局行为而没有任何测试会红。已在 `sessionConfigId.ts` 顶部注释写明这个依赖；
   如果要解耦，正确做法是把别名提升成独立的 `sessionAliasStore`，但那超本次 diff 范围。
