# MCP Bridge 设计规格

> 2026-06-11 | Issue #13

## 目标

让 Nerve 成为 MCP Server，通过标准 MCP 协议暴露自身工具（Bash、Read、Write、Edit、Glob、Grep、Git 等），供外部 MCP Client（Claude Desktop、Cursor、其他 Agent 框架）调用。

## 架构

```
Electron Main Process
┌──────────────────────────────────────────────────┐
│  app.whenReady()                                 │
│    ├─ Gateway (WS:18789, IPC 按需启动)           │
│    └─ MCPBridge (HTTP:18800, enabled 时自动启动) │
│                                                  │
│  ┌──────────────────────────────────┐            │
│  │ MCPBridgeServer                  │            │
│  │  ├─ Server (底层 MCP SDK)        │            │
│  │  ├─ http.createServer (原生)     │            │
│  │  └─ tool-registry.ts             │            │
│  │      ├─ getBuiltinTools(cwd,...) │            │
│  │      ├─ filterTools(config)      │            │
│  │      └─ serializeResult(any)     │            │
│  └──────────────────────────────────┘            │
│                    │                              │
│              ┌─────▼──────┐                      │
│              │  AgentCore  │                      │
│              └────────────┘                      │
└──────────────────────────────────────────────────┘
                   │
             HTTP :18800
                   ▲
         MCP Clients (Claude Desktop, Cursor, etc.)
```

MCP Bridge 与 Gateway 是两个独立服务，共享同一个 AgentCore 实例。Gateway 提供完整的 Agent 交互（消息、流式对话、会话），MCP Bridge 只暴露工具定义和执行。

## 文件结构

```
src/main/mcp-bridge/
├── mcp-server.ts    # McpBridgeServer 类 + HTTP 路由 + 认证
├── tool-registry.ts # getToolsForMCP() + filterTools() + serializeResult()
└── types.ts         # McpBridgeConfig, MCPToolEntry 等类型定义
```

## 技术选型

| 决策 | 选择 | 理由 |
|------|------|------|
| MCP API 层级 | 底层 `Server` API | `McpServer.registerTool()` 运行时强制要求 Zod schema，而 `getBuiltinTools()` 返回 JSON Schema；底层 API 无此限制 |
| 传输协议 | StreamableHTTP（stateless） | MCP 最新标准；MCP Bridge 无会话级状态，stateless 模式无需 session map |
| HTTP 框架 | Node.js 原生 `http` | 只有 3 条路由（`/mcp` POST/GET/DELETE + `/health`），不引入 Express |
| 认证 | Bearer Token + `timingSafeEqual` | 复用 Gateway 认证模式 |
| 启动策略 | `enabled: true` 时 `app.whenReady()` 自动启动 | MCP Bridge 是 always-on 服务，不依赖 UI 交互 |

依赖：仅 `@modelcontextprotocol/sdk@1.29.0`（已安装），无新增依赖。

## 核心实现

### McpBridgeServer（mcp-server.ts）

```typescript
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { getBuiltinTools } from '../tools'
import { filterTools, serializeResult } from './tool-registry'
import type { McpBridgeConfig } from './types'

export class McpBridgeServer {
  private server: Server
  private transport: StreamableHTTPServerTransport
  private httpServer: ReturnType<typeof createServer> | null = null
  private tools: Record<string, { description: string; input_schema: Record<string, unknown>; execute: (args: any) => Promise<any> }>

  constructor(private config: McpBridgeConfig) {
    // 1. 获取并过滤工具
    const allTools = getBuiltinTools(config.cwd, undefined, config.projectDir)
    this.tools = filterTools(allTools, config.tools)

    // 2. 创建 MCP Server（底层 API，自动处理 initialize 握手）
    this.server = new Server(
      { name: 'nerve-agent', version: '1.0.0' },
      { capabilities: { tools: { listChanged: true } } }
    )

    // 3. 创建 stateless transport（无会话管理，每次请求独立处理）
    this.transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

    // 4. 注册 handlers
    this.registerHandlers()
  }

  private registerHandlers(): void {
    // tools/list — 直接返回 JSON Schema，无需 Zod 转换
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: Object.entries(this.tools).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.input_schema,
        annotations: this.getAnnotations(name),
      }))
    }))

    // tools/call — 执行工具 + 序列化返回值
    this.server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
      try {
        const name = request.params.name
        const tool = this.tools[name]
        if (!tool) throw new Error(`Tool not found: ${name}`)
        const result = await tool.execute(request.params.arguments ?? {})
        return { content: [{ type: 'text', text: serializeResult(result) }] }
      } catch (err: any) {
        return { content: [{ type: 'text', text: err.message }], isError: true }
      }
    })
  }

  async start(): Promise<void> {
    await this.server.connect(this.transport)

    this.httpServer = createServer(async (req, res) => {
      // 认证
      if (!this.verifyAuth(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      const url = new URL(req.url!, `http://${req.headers.host}`)

      if (url.pathname === '/mcp' && req.method === 'POST') {
        const body = await this.readBody(req)
        await this.transport.handleRequest(req, res, JSON.parse(body))
      } else if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', tools: Object.keys(this.tools).length }))
      } else {
        res.writeHead(404).end('Not Found')
      }
    })

    this.httpServer.listen(this.config.port, this.config.host)
  }

  async stop(): Promise<void> {
    await this.server.close()
    this.httpServer?.close()
  }

  getHealth(): { status: string; toolCount: number; port: number } {
    return { status: 'ok', toolCount: Object.keys(this.tools).length, port: this.config.port }
  }

  private verifyAuth(req: IncomingMessage): boolean {
    if (this.config.auth.mode === 'none') return true
    const bearer = req.headers.authorization?.slice(7)
    if (!bearer || !this.config.auth.token) return false
    const expected = Buffer.from(this.config.auth.token)
    const actual = Buffer.from(bearer)
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString()))
      req.on('error', reject)
    })
  }

  private getAnnotations(name: string) {
    const readOnly = new Set(['Read', 'Glob', 'Grep'])
    const destructive = new Set(['Bash', 'Write', 'Edit', 'GitStageAll', 'GitCommit', 'GitPull', 'GitInit'])
    return {
      readOnlyHint: readOnly.has(name) || undefined,
      destructiveHint: destructive.has(name) || undefined,
      openWorldHint: name === 'Bash' || undefined,
    }
  }
}
```

### 工具映射（tool-registry.ts）

```typescript
import type { McpBridgeConfig } from './types'

interface NerveTool {
  description: string
  input_schema: Record<string, unknown>
  execute: (args: any) => Promise<any>
}

// 从 getBuiltinTools 结果中过滤出配置允许的工具
export function filterTools(
  allTools: Record<string, NerveTool>,
  config: { include: string[]; exclude: string[] }
): Record<string, NerveTool> {
  const result: Record<string, NerveTool> = {}
  for (const [name, tool] of Object.entries(allTools)) {
    if (config.exclude.includes(name)) continue
    if (config.include.length > 0 && !config.include.includes(name)) continue
    result[name] = tool
  }
  return result
}

// execute 返回值 → 可读字符串（适配所有工具返回格式）
export function serializeResult(result: any): string {
  if (result === null || result === undefined) return ''
  if (typeof result !== 'object') return String(result)

  // Fatal error: success explicitly false, or only error field present
  if (result.success === false || (result.error && !result.output && !result.message && !result.content)) {
    return `Error: ${result.error}`
  }

  // Bash: { output, error? } — error here is stderr (non-fatal)
  if (result.output) {
    let text = String(result.output)
    if (result.error) text += `\n[stderr] ${result.error}`
    if (result.savedImages?.length) text += `\n[images saved: ${result.savedImages.join(', ')}]`
    if (result.savedArtifacts?.length) text += `\n[artifacts saved: ${result.savedArtifacts.join(', ')}]`
    return text
  }

  // Read: { content }
  if (result.content && typeof result.content === 'string') return result.content

  // Grep: { results: Array<{file, line, text}> }
  if (Array.isArray(result.results)) {
    return result.results.map((r: any) => `${r.file}:${r.line}: ${r.text}`).join('\n')
  }

  // Glob: { files }
  if (Array.isArray(result.files)) return result.files.join('\n')

  // Write/Edit + Git: { success, message? }
  if (result.success !== undefined) {
    if (result.message) return result.message
    if (result.file_path) return `${result.warnings ? 'Edited' : 'Written'}: ${result.file_path}`
    return 'OK'
  }

  return JSON.stringify(result, null, 2)
}
```

### 类型定义（types.ts）

```typescript
export interface McpBridgeConfig {
  enabled: boolean
  port: number
  host: string
  cwd: string
  projectDir: string
  tools: {
    include: string[]
    exclude: string[]
  }
  auth: {
    mode: 'token' | 'none'
    token: string
  }
}
```

## 工具暴露策略

| 工具 | 暴露 | annotations |
|------|------|-------------|
| Read | ✅ | readOnlyHint |
| Glob | ✅ | readOnlyHint |
| Grep | ✅ | readOnlyHint |
| Write | ✅ | destructiveHint |
| Edit | ✅ | destructiveHint |
| Bash | ✅ | destructiveHint, openWorldHint |
| GitStageAll | ✅ | destructiveHint |
| GitCommit | ✅ | destructiveHint |
| GitPull | ✅ | destructiveHint |
| GitInit | ✅ | destructiveHint |
| GenerateImage | 可选 | openWorldHint |
| moveImageToGallery | ❌ | 内部工具 |
| load_skill | ❌ | 内部工具 |

通过配置文件 `include`/`exclude` 控制。

## 配置格式

`~/.nerve/mcp-bridge.json`：

```json
{
  "enabled": false,
  "port": 18800,
  "host": "127.0.0.1",
  "tools": {
    "include": [
      "Read", "Write", "Edit", "Glob", "Grep",
      "Bash", "GitStageAll", "GitCommit", "GitPull", "GitInit"
    ],
    "exclude": []
  },
  "auth": {
    "mode": "token",
    "token": ""
  }
}
```

Token 首次启动时自动生成（`randomBytes(32).toString('hex')`），写入配置文件。

## HTTP 路由

| 路由 | 方法 | 处理 |
|------|------|------|
| `/mcp` | POST | StreamableHTTP JSON-RPC 请求 |
| `/health` | GET | 状态检查（无需认证） |

stateless 模式下不需要 GET（SSE 流）和 DELETE（会话终止）路由。

## 认证

所有 `/mcp` 请求需要 `Authorization: Bearer <token>` 头。使用 `timingSafeEqual` 防止时序攻击。`/health` 无需认证。

## 集成点

### src/main/index.ts

```typescript
// L396 — setupIPC 调用之前，Gateway 构造之后
const mcpBridge = new McpBridgeServer({
  enabled: mcpBridgeConfig.enabled,
  port: mcpBridgeConfig.port,
  host: mcpBridgeConfig.host,
  cwd: app.getPath('home'),
  projectDir,
  tools: mcpBridgeConfig.tools,
  auth: mcpBridgeConfig.auth,
})

if (mcpBridgeConfig.enabled) {
  mcpBridge.start().catch(err => console.error('[Nerve] MCP Bridge start failed:', err))
}

// L397 — 传入 setupIPC
setupIPC(mainWindow, claude, skinManager, gitService, gateway, mcpBridge)

// L451 — window-all-closed 内的 before-quit
app.on('before-quit', async () => {
  await mcpBridge.stop().catch(() => {})
  await memoryCore.destroy().catch(() => {})
  await claude.close()
})
```

### src/main/ipc.ts

```typescript
// L13 — 函数签名扩展
export function setupIPC(
  window: BrowserWindow,
  claude: ClaudeService,
  skinManager: PetSkinManager,
  gitService: GitService,
  gateway?: NerveGateway,
  mcpBridge?: McpBridgeServer  // 新增
) {
  // ... 现有代码 ...

  // 新增：MCP Bridge IPC handlers（与 gateway 同级 guard 模式）
  if (mcpBridge) {
    ipcMain.handle('mcp-bridge:status', async () => mcpBridge.getHealth())
  }
}
```

### src/main/settings.ts

```typescript
// 新增：MCP Bridge 配置加载/保存
const MCP_BRIDGE_CONFIG_PATH = join(NERVE_DIR, 'mcp-bridge.json')

export async function loadMcpBridgeConfig(): Promise<McpBridgeConfig> {
  try {
    const raw = await readFile(MCP_BRIDGE_CONFIG_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { enabled: false, port: 18800, host: '127.0.0.1', tools: { include: [...], exclude: [] }, auth: { mode: 'token', token: '' } }
  }
}

export async function saveMcpBridgeConfig(config: McpBridgeConfig): Promise<void> {
  await atomicWriteFile(MCP_BRIDGE_CONFIG_PATH, JSON.stringify(config, null, 2))
}
```

### src/shared/types.ts

```typescript
// 新增 IPC channel 常量（与 gateway: 同级）
MCP_BRIDGE_STATUS: 'mcp-bridge:status',
```

## 不改动的文件

`tools.ts`、`agent-core.ts`、`mcp-pool.ts`、`gateway/*` 均不变。

## 安全

| 措施 | 说明 |
|------|------|
| 默认绑定 `127.0.0.1` | 仅本地访问 |
| Bearer Token + `timingSafeEqual` | 防时序攻击 |
| 工具过滤 | 默认只暴露安全工具，Bash 等需在 include 中显式列出 |
| annotations | `readOnlyHint`/`destructiveHint` 供客户端决策 |
| Host 头验证 | 防 DNS 重绑定（HTTP server 默认验证） |
| 错误隔离 | `isError: true` 返回，不泄露堆栈 |

## Windows 注意事项

- `cwd` 使用 `app.getPath('home')`，路径分隔符由 `tools.ts` 内部处理
- EPIPE 错误由进程级 `uncaughtException` handler 过滤
- 端口占用（`EADDRINUSE`）在 `start()` 中 catch，通过 IPC 返回错误给 renderer
- `before-quit` 在 `window-all-closed` 内注册，清理逻辑需在此处添加

## MCP 客户端配置示例

**Claude Desktop** (`claude_desktop_config.json`)：
```json
{
  "mcpServers": {
    "nerve-agent": {
      "url": "http://127.0.0.1:18800/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

## Cloudflare Tunnel（可选，后续 Sprint）

不内嵌 cloudflared，提供配置指引：
```
1. npm i -g cloudflared
2. cloudflared tunnel --url http://127.0.0.1:18800
3. MCP 客户端连接: https://xxx.trycloudflare.com/mcp
```
