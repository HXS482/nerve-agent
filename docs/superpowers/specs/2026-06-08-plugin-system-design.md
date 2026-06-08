# Nerve Plugin System Design Spec

**Date:** 2026-06-08
**Status:** Draft
**Scope:** 全量 Plugin Bus 架构 — Skills + Tools + MCP + Hooks + Agents + Components

---

## 1. Overview

### 1.1 动机

Nerve 当前的扩展机制是割裂的：
- Skills = 纯 SKILL.md 文件，全量注入 system prompt，无 tool 绑定能力
- Tools = 硬编码在 `tools.ts`，无法由外部扩展
- MCP = 独立配置，与 skill 无关联
- 前端 = 无插件注入点

这导致像 HyperFrames 这样的完整能力包（skill + CLI tool + MCP + UI）无法作为统一单元集成到 Nerve。

### 1.2 目标

- Plugin 作为统一的能力包，可携带 Skills、Tools、MCP、Hooks、Agents、Components
- 支持热重载：文件变化自动更新，不中断进行中的对话
- 安全隔离：Plugin 代码通过 PluginAPI 访问外部能力，不接触 Node.js globals
- 向后兼容：现有 `.agents/skills/` 继续工作
- 开发体验：SDK + CLI 工具 + 测试支持，最少 1 个文件即可起步

### 1.3 设计原则

- **能自动发现的不声明**：manifest 只放无法推断的信息
- **PluginAPI 是统一边界**：不管未来跑在主进程还是 Worker，接口不变
- **Snapshot 保证一致性**：进行中的对话不受热重载影响
- **分层信任**：本地信任 > 项目信任 > marketplace 隔离

---

## 2. 能力层级全景

```
┌─────────────────────────────────────────────────────────────┐
│                    Plugin（全量能力包）                        │
│  Skills + Tools + MCP + Hooks + Agents + Components         │
│                                                             │
│  User Plugin ~/.nerve/plugins/     全局生效                  │
│  Project Plugin .nerve/plugins/    仅当前项目                │
│  Marketplace Plugin ~/.nerve/marketplace/  第三方             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Skill（纯 prompt 指令）                    │
│  只有 SKILL.md，无 tool/MCP/hooks                           │
│                                                             │
│  User Skill ~/.nerve/skills/       全局生效                  │
│  Project Skill .agents/skills/     仅当前项目                │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 目录结构

```
~/.nerve/
├── plugins/                     ← User Plugins
│   └── hyperframes/
│       ├── plugin.json
│       ├── skills/
│       ├── tools/
│       ├── agents/
│       ├── hooks/
│       ├── lifecycle/
│       ├── components/
│       └── .mcp.json
├── skills/                      ← User Skills（纯 prompt）
│   └── code-review/
│       └── SKILL.md
├── marketplace/                 ← Marketplace Plugins
├── plugins-lock.json
└── settings.json

<projectDir>/.nerve/
├── plugins/                     ← Project Plugins
└── sessions/

<projectDir>/.agents/
└── skills/                      ← Project Skills（兼容现有路径）
    └── image-generator/
        └── SKILL.md
```

### 目录优先级（同名时前者覆盖）

1. `<projectDir>/.nerve/plugins/` — 项目级，最高优先
2. `~/.nerve/plugins/` — 用户级
3. `~/.nerve/marketplace/` — marketplace 级，最低优先

---

## 4. Plugin Manifest

### 4.1 设计原则

能自动发现的不声明。Manifest 只放运行时需要但无法从文件结构推断的信息。

### 4.2 自动发现 vs 必须声明

| 组件 | 必须声明？ | 原因 |
|---|---|---|
| `name`, `version`, `description` | 是 | 身份标识 |
| `permissions` | 是 | 安全边界 |
| `tools[].name` + `tools[].module` | 是 | tool 注册是运行时行为 |
| `hooks` | 是 | 事件→文件映射任意 |
| `lifecycle` | 是 | 生命周期回调路径无法推断 |
| `dependencies` / `conflicts` | 是 | 依赖图在加载时解析 |
| `shell.allowedCommands` | 是 | 安全约束 |
| ~~`skills`~~ | 自动发现 | 扫描 `skills/*/SKILL.md` |
| ~~`agents`~~ | 自动发现 | 扫描 `agents/*/AGENT.md` |
| ~~`mcp`~~ | 自动发现 | 检测 `.mcp.json` |
| ~~`components`~~ | 自动发现 | 扫描 `components/*.tsx` |

### 4.3 Manifest Schema

```json
{
  "name": "hyperframes",
  "version": "1.0.0",
  "description": "HTML video composition framework",
  "permissions": ["fs:read", "shell:execute"],
  "tools": [
    { "name": "render", "module": "./tools/render.ts" },
    { "name": "preview", "module": "./tools/preview.ts" }
  ],
  "hooks": {
    "onToolComplete": "./hooks/auto-format.ts"
  },
  "lifecycle": {
    "onLoad": "./lifecycle/load.ts",
    "onUnload": "./lifecycle/unload.ts"
  },
  "shell": {
    "allowedCommands": ["npx hyperframes", "ffmpeg"]
  },
  "dependencies": {},
  "conflicts": []
}
```

### 4.4 最少文件数

| 场景 | 最少文件 | 说明 |
|---|---|---|
| 纯 Skill | 1 | 只需 `skills/hello/SKILL.md`，无需 manifest |
| Tool plugin | 2 | `plugin.json` + `tools/hello.ts` |
| 完整 plugin | 2+ | `plugin.json` + 任意组合 |

---

## 5. PluginAPI 能力注入模型

Plugin 代码不接触 Node.js globals，所有外部能力通过 `ctx`（PluginContext）按权限注入。

### 5.1 权限 → 能力映射

| 权限 | 注入的能力 |
|---|---|
| `fs:read` | `ctx.fs.readFile()`, `ctx.fs.readDir()`, `ctx.fs.exists()` |
| `fs:write` | `ctx.fs.writeFile()`, `ctx.fs.mkdir()` |
| `shell:execute` | `ctx.shell.exec()` — 受白名单约束，超时强制 kill |
| `net:http` | `ctx.net.fetch()` — 可配域名白名单 |
| `nerve:mcp` | `ctx.nerve.callTool()` — 调用已注册的 MCP tool |
| `nerve:session` | `ctx.nerve.getSession()`, `ctx.nerve.sendMessage()` |
| `nerve:memory` | `ctx.nerve.memory.recall()` |
| `nerve:channel` | `ctx.nerve.sendImage()`, `ctx.nerve.sendStreamDelta()` |

### 5.2 PluginContext 接口

```ts
interface PluginContext {
  // 元信息
  readonly pluginId: string
  readonly pluginDir: string
  readonly sessionId: string

  // 来源决定作用域和信任级别
  readonly scope: 'user' | 'project'          // 插件目录来源
  readonly trust: 'builtin' | 'local' | 'project' | 'marketplace'  // 安全信任级别
  readonly projectDir?: string                 // 当前项目目录

  // 按权限注入的能力（未声明的权限 → 对应属性为 undefined）
  readonly fs?: PluginFs
  readonly shell?: PluginShell
  readonly net?: PluginNet
  readonly nerve?: PluginNerve

  // 生命周期管理
  addDisposable(fn: () => Promise<void>): void

  // 子能力注册（plugin 内部动态注册）
  registerTool(name: string, tool: PluginToolDef): void
  registerHook(event: string, fn: HookFn): void
}
```

**术语说明**：`scope` 指插件的安装位置（用户级 or 项目级），决定插件对哪些项目可见。`trust` 指安全信任级别，决定权限边界和隔离强度。两者关联但不等同：一个 `scope: 'user'` 的 plugin 信任级别为 `local`，一个从 marketplace 安装到 `~/.nerve/marketplace/` 的 plugin 信任级别为 `marketplace`。

interface PluginFs {
  readFile(path: string): Promise<string>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  writeFile(path: string, content: string): Promise<void>
  mkdir(path: string): Promise<void>
}

interface PluginShell {
  exec(command: string, opts?: {
    cwd?: string
    timeout?: number
    env?: Record<string, string>
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

interface PluginNet {
  fetch(url: string, opts?: RequestInit): Promise<Response>
}

interface PluginNerve {
  callTool(name: string, args: unknown): Promise<string>
  getSession(): Promise<SessionInfo>
  sendMessage(text: string): Promise<void>
  memory: { recall(query: string): Promise<MemoryResult[]> }
  channel: {
    sendImage(path: string): void
    sendStreamDelta(text: string): void
    sendError(message: string): void
  }
}
```

### 5.3 路径与命令约束

- `fs` 路径约束：
  - **User plugin**（`~/.nerve/plugins/`）：可读写 plugin 自身目录 + 当前项目目录。不能穿越到其他 plugin 目录或系统敏感目录（如 `~/.nerve/settings.json`）。
  - **Project plugin**（`.nerve/plugins/`）：可读写 plugin 自身目录 + 当前项目目录。
  - **Marketplace plugin**：只能读写 plugin 自身目录，访问项目目录需额外声明 `permissions: ["fs:project-read"]`。
- `shell` 命令约束：只能执行 manifest 中 `shell.allowedCommands` 声明的命令前缀。未声明则 `ctx.shell` 为 undefined。
- `net` 域名约束：可配置 `net.allowedDomains` 白名单，未配置时允许所有域名（Local/Project），Marketplace 默认拒绝所有需显式声明。

### 5.4 运行时隔离演进

- **Phase 1**：Plugin 代码跑在主进程，通过 Proxy 拦截 + PluginAPI 注入隔离
- **Phase 2**：Marketplace plugin 迁移到 Worker thread，PluginAPI 接口不变，内部实现从函数调用换成 postMessage

---

## 6. Plugin Bus — 注册、生命周期、热重载

### 6.1 核心接口

```ts
class PluginBus extends EventEmitter {
  private plugins = new Map<string, LoadedPlugin>()
  private toolReg: ToolRegistry
  private skillReg: SkillRegistry
  private hookReg: HookRegistry
  private mcpReg: McpRegistry
  private agentReg: AgentRegistry
  private componentReg: ComponentRegistry

  async discover(): Promise<void>
  async loadAll(): Promise<void>
  async load(dir: string): Promise<void>
  async unload(pluginId: string): Promise<void>
  async reload(pluginId: string): Promise<void>
  startWatching(): void

  getToolSnapshot(): ToolSnapshot
  getActiveSkills(): Skill[]
  getMcpServers(): McpServerConfig[]
  getAgents(): AgentDefinition[]
  getComponents(): ComponentEntry[]
}
```

### 6.2 生命周期状态机

```
Discovered → Validated → Active ⇄ Reloading → Active
                        ↓
                     Unloading → Unloaded → Discovered
```

每次状态转换触发 PluginBus 事件，供 UI 展示。

### 6.3 加载流程

1. `validateManifest()` — JSON Schema 校验 + 权限合法性检查
2. `checkDependencies()` / `checkConflicts()` — 依赖图解析
3. `createPluginContext()` — 按权限注入能力
4. 自动发现：skills、agents、mcp、components
5. `loadTools()` — dynamic import + Zod 校验 + executor 包装
6. `loadHooks()` — import hook 函数
7. `lifecycle.onLoad(ctx)` — plugin 初始化回调
8. 注册到各 Registry

### 6.4 热重载：FileWatcher

```ts
// chokidar + per-plugin debounce 300ms + global mutex
watcher.on('all', (event, filePath) => {
  const pluginId = resolvePlugin(filePath)
  clearTimeout(debounceTimers.get(pluginId))
  debounceTimers.set(pluginId, setTimeout(async () => {
    await reloadMutex.runExclusive(async () => {
      await pluginBus.reload(pluginId)
    })
  }, 300))
})
```

- 一个 plugin 改 10 个文件 → 1 次 reload
- git checkout → 串行 reload，不并发
- 批量操作不 thundering herd

### 6.5 增量 Reload

```ts
async reload(pluginId) {
  const changes = diffCapabilities(oldManifest, newManifest)
  if (changes.skillsChanged) skillReg.update(pluginId, newSkills)
  if (changes.toolsChanged) toolReg.update(pluginId, newTools, { policy: 'next-session' })
  if (changes.hooksChanged) hookReg.update(pluginId, newHooks)
  if (changes.mcpChanged) mcpReg.hotSwap(pluginId, newMcp)
  lifecycle?.onReload?.(ctx)
}
```

### 6.6 依赖图解析

```ts
// 1. 读取所有 manifest
// 2. 构建 DAG（dependencies 字段）
// 3. 拓扑排序
// 4. 冲突检测（conflicts 字段）
// 5. fail fast：循环依赖或缺失依赖直接报错
```

---

## 7. Tool 系统

### 7.1 Tool 模块规范

使用 Zod 定义 schema（复用现有 `zodToInputSchema`），不手写 JSON Schema：

```ts
// tools/render.ts
import { z } from '@nerve/plugin-sdk'
import type { PluginTool } from '@nerve/plugin-sdk'

export const description = 'Render a video composition'

export const schema = z.object({
  width: z.number().describe('Render width in pixels'),
  height: z.number().describe('Render height in pixels'),
  format: z.enum(['mp4', 'webm']).optional().default('mp4'),
})

export const execute: PluginTool<typeof schema> = async (args, ctx) => {
  const result = await ctx.shell.exec(`npx hyperframes render --width ${args.width}`)
  return { output: result.stdout }
}
```

PluginLoader 内部自动调用 `zodToInputSchema(schema)` 生成 LLM tool schema。

### 7.2 命名空间

所有 plugin tool 自动加 `pluginId:` 前缀：

```
plugin "hyperframes" 的 tool "render" → LLM 看到 "hyperframes:render"
```

- 内置 tool 不可覆盖
- 其他 plugin 的 tool 不可覆盖
- 冲突时报错，拒绝加载

### 7.3 Snapshot 机制

```ts
interface ToolSnapshot {
  readonly version: number
  readonly toolDefs: ToolDefinition[]
  readonly toolExecutors: Map<string, ToolExecutor>
  ref(): void
  unref(): void
}
```

`AgentCore.sendMessage()` 获取 pinned snapshot，整个 agent loop 使用同一份 tool 定义：

```ts
const snapshot = this.pluginBus.getToolSnapshot()
snapshot.ref()
try {
  // 整个 loop 使用 pinned snapshot
  // 中途 plugin 更新 → 新 snapshot → 不影响进行中的对话
} finally {
  snapshot.unref()
}
```

### 7.4 版本策略

| 组件 | 默认策略 | 原因 |
|---|---|---|
| Skills | `immediate` | 纯文本，无兼容性问题 |
| Tools | `next-session` | LLM tool schema 在对话开始时冻结 |
| Hooks | `immediate` | 无状态函数 |
| MCP | `next-session` | 进行中 tool call 可能依赖旧 server |
| Agents | `next-session` | system prompt 在对话开始时确定 |

`next-session` 实现：ToolReg 维护 active + pending 双 slot，`promotePending()` 在 `sendMessage` 开头调用。

---

## 8. Skill 系统

### 8.1 两层模型

- **Layer 1 Skill Index**：始终在 system prompt 中，只含 `name + description`（~100 字符/skill）
- **Layer 2 Skill Content**：LLM 通过 `load_skill` tool 按需加载完整 prompt

### 8.2 load_skill Tool

内置 tool，LLM 根据 skill index 判断是否需要加载：

```ts
const loadSkillTool = {
  name: 'load_skill',
  description: 'Load a skill by name. Available: ' + allSkills.map(s => s.name).join(', '),
  input_schema: { type: 'object', properties: { skill_name: { type: 'string' } }, required: ['skill_name'] },
  execute: async (args) => {
    const skill = allSkills.find(s => s.name === args.skill_name)
    if (!skill) return { error: `Skill "${args.skill_name}" not found` }
    // token budget 检查
    if (estimateTokens(skill.prompt) > remainingContext) {
      return { error: 'Skill too large for remaining context' }
    }
    return { skill_name: skill.name, content: resolveTemplateVars(skill.prompt) }
  }
}
```

### 8.3 兼容模式

`settings.skillLoading: 'eager'`（默认 `'lazy'`）时跳过 load_skill 机制，走现有全量注入。

### 8.4 Skill 加载优先级

```
project skill > user skill（同名时）
```

Settings 扩展：

```json
{
  "disabledSkills": [
    "image-generator",
    "user:writing-style",
    "project:code-review"
  ]
}
```

---

## 9. MCP 集成

### 9.1 McpRegistry

统一管理用户 MCP 和 plugin MCP：

```ts
class McpRegistry {
  private userServers: Map<string, McpEntry>
  private pluginServers: Map<string, McpEntry>
  private active: Map<string, McpConnection>
  private draining: Map<string, McpConnection>
  private pendingRollback: Map<string, RollbackHandle>
}
```

### 9.2 Drain-and-Replace

```
1. 标记旧连接 drainMode = true（拒绝新 tool call）
2. 等待 inflight 归零（30s 超时）
3. 启动新 server + health check
4. 原子切换
5. 旧连接保留 10s rollback 窗口
6. 超时后关闭旧连接
```

### 9.3 环境隔离

MCP 子进程不继承完整 `process.env`，只传安全 key（PATH, HOME, LANG 等）+ config 显式声明的 env。

### 9.4 Rollback

MCP 热替换后保留 10s rollback 窗口，UI 展示 rollback 按钮。

---

## 10. Hook 系统

### 10.1 事件类型

```
onMessageSend, onToolCall, onToolComplete, onStreamDelta,
onSessionStart, onSessionEnd, onPluginLoad, onPluginUnload
```

### 10.2 Hook Context

```ts
interface HookContext {
  readonly sessionId: string
  readonly pluginId: string
  readonly data: Readonly<HookData>
  readonly metadata: Map<string, unknown>
  readonly abort: AbortController
}

interface HookResult {
  handled: boolean
  modified?: Partial<HookData>
  error?: Error
}
```

### 10.3 执行保证

- 按 priority 排序（系统 hooks 0-99 → 安全 hooks 100-199 → 用户 200-299 → marketplace 300-399）
- 单个 hook 5s 超时，失败不中断 pipeline
- Hook 拿到 frozen copy，通过 `result.modified` 返回修改
- 安全 hook 始终在 marketplace hook 之前

---

## 11. 前端组件

### 11.1 Iframe 隔离

Plugin 组件通过 `<iframe sandbox="allow-scripts">` 渲染，天然与主窗口 CSS/JS 隔离。

### 11.2 受限 API Bridge

通过 `postMessage` + 白名单通信，不暴露 `window.claude`：

```ts
window.pluginBridge = {
  getSession: () => post('getSession'),
  sendNotification: (msg) => post('sendNotification', { msg }),
  onEvent: (event, cb) => registerListener(event, cb),
  // ❌ 不暴露 saveNerveSettings, saveMcpServers, gitPush 等
}
```

### 11.3 自动发现

扫描 `components/*.tsx`，按文件名注册。开发模式下文件变化自动刷新 iframe。

---

## 12. 安全模型

### 12.1 信任层级

信任层级决定两个独立维度：**执行上下文**（代码在哪跑）和**UI 隔离**（前端组件怎么渲染）。

| 层级 | 目录 | 执行上下文 | 前端渲染 |
|---|---|---|---|
| Builtin | 内置 | 主进程 | 主窗口 |
| Local | `~/.nerve/plugins/` | 主进程（Phase 1）/ Worker（Phase 2） | 主窗口（Phase 1）/ 按需 iframe |
| Project | `.nerve/plugins/` | 主进程（Phase 1）/ Worker（Phase 2） | iframe |
| Marketplace | `~/.nerve/marketplace/` | Worker（Phase 2+） | iframe |

Phase 1 所有 plugin 都在主进程执行，但 UI 隔离从一开始就按信任层级区分。Phase 2 开始，Marketplace plugin 迁移到 Worker 隔离执行。

### 12.2 Marketplace 签名验证

- Publisher ed25519 签名
- `plugins-lock.json` integrity hash
- 未知 publisher 拒绝加载
- 内容 hash 不匹配拒绝加载

### 12.3 Renderer 安全加固

- `sandbox: true`, `webSecurity: true`, `contextIsolation: true`
- 本地资源通过 `nerve-file://` protocol 加载（路径白名单）
- IPC handler 验证 `event.sender` 是主窗口

### 12.4 Tool 冲突防御

- Plugin tool 自动加 `pluginId:` 命名空间前缀
- 内置 tool 标记为 immutable，不可覆盖
- 同名 tool 冲突时报错拒绝加载

---

## 13. Plugin SDK

### 13.1 包结构

```
@nerve/plugin-sdk
├── src/index.ts       ← 类型导出
├── src/zod.ts         ← re-export zod + zodToInputSchema
├── src/testing.ts     ← createPluginTestHarness
├── templates/         ← 脚手架模板
└── schemas/manifest   ← plugin.json JSON Schema
```

### 13.2 CLI 工具

```bash
nerve plugin init <name>              # 脚手架
nerve plugin dev ./my-plugin          # watch + 热重载 + 日志
nerve plugin validate ./my-plugin     # manifest + schema 校验
nerve plugin test ./my-plugin         # tool 单元测试
nerve plugin pack ./my-plugin         # 打包发布
```

### 13.3 测试支持

```ts
import { createPluginTestHarness } from '@nerve/plugin-sdk/testing'

const harness = await createPluginTestHarness({
  pluginDir: '.',
  mocks: { shell: { exec: jest.fn() } }
})
const result = await harness.callTool('render', { width: 800 })
await harness.dispose()
```

### 13.4 错误反馈

- 加载失败 → Renderer toast 通知
- 热重载失败 → toast + 保留旧版本
- Tool 执行失败 → 错误信息含 plugin 名称前缀
- Plugin 状态面板展示所有 plugin 状态

---

## 14. 与现有系统集成

### 14.1 AgentCore

- `sendMessage()` 从 PluginBus 获取 pinned Tool Snapshot
- `prepareMessages()` 改为 Skill 两层模型（index + load_skill）
- `runAgentLoop()` 传入 HookRegistry，插件 hook 调用点

### 14.2 McpPool

- 改造为 McpRegistry 内部实现
- 新增环境过滤、drain 模式、rollback
- 保持 AgentCore 调用接口兼容

### 14.3 Renderer

- 新增 PluginPanel UI（plugin 状态、toggle、rollback）
- Plugin 组件通过 iframe host 注入
- IPC 新增 get-plugins、toggle-plugin、reload-plugin、rollback-mcp

### 14.4 向后兼容

- `.agents/skills/` 继续走现有加载逻辑
- 新功能（tool 绑定、MCP、热重载）只对 plugin 结构可用
- 用户不需要迁移即可保持现状

---

## 15. 分阶段实施

| Phase | 内容 | 产出 |
|---|---|---|
| Phase 1 | PluginAPI + PluginBus + Skill 两层模型 + Tool Snapshot | 核心框架可用，能加载 plugin 和独立 skill |
| Phase 2 | 热重载 + MCP drain-and-replace + Hook 系统 | 开发时即时生效 |
| Phase 3 | 前端组件 iframe 隔离 + Renderer Plugin Panel | UI 可见 |
| Phase 4 | Plugin SDK + CLI 工具 + Marketplace 签名 | 可分发 |
| Phase 5 | Worker thread 隔离（marketplace plugin） | 安全加固 |

---

## 16. 专家审查要点记录

以下为子代专家审查发现的关键问题及设计中的应对：

| # | 来源 | 问题 | 设计中的应对 |
|---|---|---|---|
| 1 | 架构 | Tool 热重载打断进行中对话 | Tool Snapshot + ref/unref + next-session 策略 |
| 2 | 架构 | MCP blue-green 摧毁有状态 server | Drain-and-Replace + rollback 窗口 |
| 3 | 架构 | Plugin crash 带崩主进程 | try/catch + timeout 包装；Phase 2 Worker 隔离 |
| 4 | 安全 | Native tool 零隔离 | PluginAPI 能力注入，不给 Node.js globals |
| 5 | 安全 | 权限声明无人执行 | PluginAPI 按权限注入，未声明的能力不挂载 |
| 6 | 安全 | Marketplace 无签名验证 | ed25519 签名 + lockfile integrity |
| 7 | 安全 | Renderer sandbox: false | 启用 sandbox + webSecurity + IPC sender 验证 |
| 8 | DX | 无 CLI 开发工具 | nerve plugin dev/test/validate/pack |
| 9 | DX | JSON Schema 手写 | Zod schema + zodToInputSchema 自动转换 |
| 10 | DX | 无测试路径 | @nerve/plugin-sdk/testing harness |
| 11 | 架构 | Hooks 需要 context 对象 | HookContext + frozen data + metadata |
| 12 | 架构 | Plugin 依赖图缺失 | manifest dependencies + 拓扑排序 + 冲突检测 |
| 13 | 架构 | 前端组件热重载破坏 React state | iframe 隔离 + location.reload() |
| 14 | 架构 | File watcher thundering herd | per-plugin debounce + global mutex |
| 15 | 架构 | Skill swap 影响 token budget | load_skill 内置 token 检查 |
| 16 | 架构 | 缺少 lifecycle hooks | manifest lifecycle.onLoad/onReload/onUnload |
| 17 | 安全 | MCP process.env 泄漏 | 环境变量白名单过滤 |
| 18 | 安全 | Tool 命名冲突 | pluginId: 命名空间 + 内置 tool immutable |
| 19 | 安全 | IPC 不验证 sender | event.sender === mainWindow.webContents |
| 20 | DX | Manifest 过度声明 | 自动发现 skills/agents/mcp/components |
