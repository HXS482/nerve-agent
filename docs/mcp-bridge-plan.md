# MCP Bridge 实施方案

> Issue #13 — 为 Nerve Agent 实现 MCP Server 端点，将本地工具暴露为标准 MCP Tool

## 1. 背景与目标

### 当前状态

Nerve 当前作为 **MCP Client**，通过 `McpPool`（`src/main/mcp-pool.ts`）连接外部 MCP Server（stdio 传输），消费外部工具。

### 目标

反转角色：让 Nerve 成为 **MCP Server**，通过标准 MCP 协议暴露自身工具（Bash、Read、Write、Edit、Glob、Grep、Git 等），供外部 MCP Client（如 Claude Desktop、Cursor、其他 Agent 框架）调用。

### 核心需求（Issue #13）

1. MCP 端点（SSE/HTTP），支持标准生命周期（initialize、tools/list、tools/call）
2. 本地工具 → MCP Tool 映射（schema、输入参数、输出类型）
3. 安全路由 + Cloudflare Tunnel

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   Nerve Electron App                 │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Renderer │  │ Gateway  │  │   MCP Bridge      │  │
│  │ (React)  │  │ (WS+IM)  │  │   (NEW)           │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────────────┘  │
│       │              │              │                 │
│       └──────────────┼──────────────┘                 │
│                      │                                │
│              ┌───────▼────────┐                       │
│              │   AgentCore    │                       │
│              │  (无 UI 依赖)  │                       │
│              └───────┬────────┘                       │
│                      │                                │
│       ┌──────────────┼──────────────┐                 │
│       │              │              │                 │
│  ┌────▼────┐   ┌─────▼────┐  ┌─────▼──────┐         │
│  │ Tools   │   │ MCP Pool │  │ Plugin Bus │         │
│  │ (内置)  │   │ (Client) │  │ (插件)     │         │
│  └─────────┘   └──────────┘  └────────────┘         │
└─────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
   ┌──────────┐        ┌──────────────┐
   │ HTTP/SSE │        │ Cloudflare   │
   │ :18800   │        │ Tunnel       │
   └──────────┘        └──────────────┘
         ▲
         │  MCP Protocol (JSON-RPC over SSE/HTTP)
         │
   ┌─────────────┐
   │ MCP Clients │  (Claude Desktop, Cursor, etc.)
   └─────────────┘
```

### 2.2 MCP Bridge 组件拆分

```
src/main/mcp-bridge/
├── index.ts              # 模块导出
├── mcp-server.ts         # McpBridgeServer — 核心编排
├── tool-registry.ts      # 工具映射：Nerve Tool → MCP Tool
├── transport-http.ts     # StreamableHTTP 传输层（主推）
├── transport-sse.ts      # SSE 传输层（兼容旧客户端）
├── auth.ts               # Bearer Token 认证中间件
└── types.ts              # 类型定义
```

### 2.3 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 传输协议 | **StreamableHTTP 为主，SSE 为兼容** | StreamableHTTP 是 MCP 最新标准，SSE 已 deprecated 但部分旧客户端仍用 |
| HTTP 框架 | **Node.js 原生 `http` 模块** | 项目无 Express 依赖，不引入额外框架，保持轻量 |
| 工具注册方式 | **McpServer.registerTool()** | SDK 高级 API，自动处理 tools/list 和 tools/call |
| 认证方式 | **Bearer Token**（复用 Gateway 模式） | 与 Gateway WS 认证保持一致，用户只需管理一套 token |
| 会话管理 | **无状态模式** | MCP Bridge 只暴露工具，不需要会话级状态 |

---

## 3. 技术选型

### 3.1 依赖

| 包 | 版本 | 用途 | 状态 |
|----|------|------|------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP Server SDK（McpServer、StreamableHTTPServerTransport、SSEServerTransport） | ✅ 已安装 |
| `express` | ^4.x | HTTP 路由（SDK 的 `createMcpExpressApp` 需要） | ⚠️ 需安装，或用原生 http 替代 |

**决策：使用原生 `http` 模块**，手动路由，不引入 Express。原因：
- 项目当前无 Express 依赖，保持轻量
- MCP Bridge 只有 3 个路由（`/mcp` POST/GET/DELETE），不需要路由框架
- SDK 的 `StreamableHTTPServerTransport.handleRequest()` 直接接受 `IncomingMessage`/`ServerResponse`

### 3.2 MCP SDK 关键 API

```typescript
// 服务器端 — 已安装的 SDK 提供
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'

// McpServer 高级 API
const server = new McpServer({ name: 'nerve-agent', version: '1.0.0' })
server.registerTool('tool_name', { description, inputSchema }, handler)
server.connect(transport)
```

---

## 4. 详细设计

### 4.1 工具映射（tool-registry.ts）

#### 映射规则

Nerve 内置工具定义格式：
```typescript
// src/main/tools.ts 返回格式
{
  name: string
  description: string
  input_schema: Record<string, unknown>  // JSON Schema (OpenAPI 3)
  execute: (args: any) => Promise<string>
}
```

MCP Tool 格式：
```typescript
// @modelcontextprotocol/sdk
{
  name: string
  description: string
  inputSchema: ZodSchema | JSONSchema  // McpServer.registerTool 接受 Zod 或 JSON Schema
  annotations?: {
    title?: string
    readOnlyHint?: boolean    // 只读工具
    destructiveHint?: boolean // 破坏性工具
    openWorldHint?: boolean   // 是否访问外部世界
  }
}
```

#### 映射函数

```typescript
// src/main/mcp-bridge/tool-registry.ts

interface NerveToolForMCP {
  name: string
  description: string
  input_schema: Record<string, unknown>
  execute: (args: any) => Promise<string>
}

interface MCPToolRegistration {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
  }
  handler: (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
}

function mapNerveToolToMCP(tool: NerveToolForMCP): MCPToolRegistration {
  const readOnlyTools = new Set(['Read', 'Glob', 'Grep'])
  const destructiveTools = new Set(['Bash', 'Write', 'Edit', 'GitStageAll', 'GitCommit'])

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
    annotations: {
      readOnlyHint: readOnlyTools.has(tool.name),
      destructiveHint: destructiveTools.has(tool.name),
    },
    handler: async (args) => {
      const result = await tool.execute(args)
      return {
        content: [{ type: 'text' as const, text: result }]
      }
    }
  }
}
```

#### 工具过滤

并非所有 Nerve 工具都适合暴露为 MCP Tool：

| 工具 | 暴露 | 原因 |
|------|------|------|
| Read | ✅ | 只读，安全 |
| Write | ✅ | 文件写入，标注 destructive |
| Edit | ✅ | 文件编辑，标注 destructive |
| Glob | ✅ | 只读文件搜索 |
| Grep | ✅ | 只读内容搜索 |
| Bash | ✅ | Shell 执行，标注 destructive + openWorld |
| GitStageAll | ✅ | Git 操作 |
| GitCommit | ✅ | Git 操作 |
| GitPull | ✅ | Git 操作 |
| GitInit | ✅ | Git 操作 |
| GenerateImage | ⚠️ 可选 | 依赖外部 API |
| moveImageToGallery | ❌ | Nerve 内部工具 |
| load_skill | ❌ | Nerve 内部工具 |

通过配置文件 `~/.nerve/mcp-bridge.json` 控制暴露哪些工具：

```json
{
  "enabled": true,
  "port": 18800,
  "host": "127.0.0.1",
  "tools": {
    "include": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "GitStageAll", "GitCommit", "GitPull", "GitInit"],
    "exclude": []
  },
  "auth": {
    "mode": "token",
    "token": "<auto-generated>"
  }
}
```

### 4.2 MCP Server 核心（mcp-server.ts）

```typescript
// src/main/mcp-bridge/mcp-server.ts

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { getBuiltinTools } from '../tools'
import { mapNerveToolToMCP, filterTools } from './tool-registry'
import { verifyToken } from './auth'

export interface McpBridgeConfig {
  port: number
  host: string
  auth: { mode: 'token' | 'none'; token?: string }
  tools: { include: string[]; exclude: string[] }
  projectDir: string
  sourceDir: string
}

export class McpBridgeServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private mcpServer: McpServer | null = null
  private transports = new Map<string, StreamableHTTPServerTransport | SSEServerTransport>()

  constructor(private config: McpBridgeConfig) {}

  async start(): Promise<void> {
    // 1. 创建 McpServer 实例
    this.mcpServer = new McpServer({
      name: 'nerve-agent',
      version: '1.0.0'
    }, {
      capabilities: { tools: {} }
    })

    // 2. 注册工具
    this.registerTools()

    // 3. 启动 HTTP 服务器
    this.httpServer = createServer((req, res) => this.handleRequest(req, res))
    this.httpServer.listen(this.config.port, this.config.host)
  }

  private registerTools(): void {
    const builtinTools = getBuiltinTools(this.config.projectDir)
    const filtered = filterTools(builtinTools, this.config.tools)

    for (const [name, tool] of Object.entries(filtered)) {
      const mcpTool = mapNerveToolToMCP({ name, ...tool })
      this.mcpServer!.registerTool(name, {
        description: mcpTool.description,
        inputSchema: mcpTool.inputSchema,
        annotations: mcpTool.annotations,
      }, mcpTool.handler)
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 认证检查
    if (!verifyToken(req, this.config.auth)) {
      res.writeHead(401).end('Unauthorized')
      return
    }

    const url = new URL(req.url!, `http://${req.headers.host}`)

    if (url.pathname === '/mcp') {
      if (req.method === 'POST') {
        // StreamableHTTP: 处理 JSON-RPC 请求
        await this.handleStreamableHTTP(req, res)
      } else if (req.method === 'GET') {
        // SSE: 建立 SSE 流（兼容旧客户端）
        await this.handleSSE(req, res)
      } else if (req.method === 'DELETE') {
        // StreamableHTTP: 终止会话
        await this.handleSessionTerminate(req, res)
      } else {
        res.writeHead(405).end('Method Not Allowed')
      }
    } else if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ status: 'ok', tools: this.mcpServer?.isConnected() }))
    } else {
      res.writeHead(404).end('Not Found')
    }
  }

  private async handleStreamableHTTP(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 读取请求体
    const body = await this.readBody(req)

    // 检查是否已有会话
    const sessionId = req.headers['mcp-session-id'] as string
    let transport = sessionId ? this.transports.get(sessionId) : null

    if (!transport) {
      // 新会话：创建 StreamableHTTP 传输
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      })
      await this.mcpServer!.connect(transport)
      this.transports.set(transport.sessionId!, transport)

      transport.onclose = () => {
        this.transports.delete(transport!.sessionId!)
      }
    }

    await transport.handleRequest(req, res, JSON.parse(body))
  }

  private async handleSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 兼容旧 MCP 客户端的 SSE 传输
    const transport = new SSEServerTransport('/mcp', res)
    await this.mcpServer!.connect(transport)
    await transport.start()

    transport.onclose = () => {
      // 清理
    }
  }
}
```

### 4.3 认证方案（auth.ts）

```typescript
// src/main/mcp-bridge/auth.ts

import { IncomingMessage } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

export function verifyToken(
  req: IncomingMessage,
  config: { mode: 'token' | 'none'; token?: string }
): boolean {
  if (config.mode === 'none') return true

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return false

  const token = authHeader.slice(7)
  if (!config.token) return false

  const expected = Buffer.from(config.token)
  const actual = Buffer.from(token)

  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}
```

### 4.4 与现有 Gateway 的关系

MCP Bridge 和 Gateway 是**两个独立的服务**，共享同一个 AgentCore 实例：

```
                    ┌─────────────┐
                    │  AgentCore  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
     ┌────────▼──┐  ┌──────▼─────┐  ┌──▼──────────┐
     │  IPC      │  │  Gateway   │  │ MCP Bridge  │
     │ (Electron)│  │ (WS:18789) │  │ (HTTP:18800)│
     └───────────┘  └────────────┘  └─────────────┘
```

**关键区别**：
- **Gateway**：完整的 Agent 交互（发送消息、流式响应、会话管理）→ 面向 IM 和 WS 客户端
- **MCP Bridge**：纯工具暴露（tools/list + tools/call）→ 面向 MCP 客户端
- MCP Bridge **不暴露 Agent 能力**（不支持发送消息、流式对话），只暴露工具定义和执行

### 4.5 Cloudflare Tunnel 集成

Nerve 不内嵌 cloudflared，而是提供配置指引：

```
1. 安装 cloudflared: npm i -g cloudflared
2. 启动 tunnel: cloudflared tunnel --url http://127.0.0.1:18800
3. 获得公网 URL: https://xxx.trycloudflare.com
4. MCP 客户端连接: https://xxx.trycloudflare.com/mcp
```

在 Settings UI 中添加 Cloudflare Tunnel 配置区域：
- 显示当前 tunnel 状态
- 启动/停止 tunnel 按钮（通过 `child_process.spawn` 管理 cloudflared 进程）
- 显示公网 URL 和 token

---

## 5. 文件改动清单

### 5.1 新增文件

| 文件 | 职责 |
|------|------|
| `src/main/mcp-bridge/index.ts` | 模块导出 |
| `src/main/mcp-bridge/mcp-server.ts` | McpBridgeServer 核心类 |
| `src/main/mcp-bridge/tool-registry.ts` | Nerve Tool → MCP Tool 映射 |
| `src/main/mcp-bridge/auth.ts` | Bearer Token 认证 |
| `src/main/mcp-bridge/types.ts` | 类型定义 |
| `src/main/__tests__/mcp-bridge/tool-registry.test.ts` | 工具映射单元测试 |
| `src/main/__tests__/mcp-bridge/mcp-server.test.ts` | 服务器集成测试 |

### 5.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/main/index.ts` | 在 `app.whenReady()` 中启动 McpBridgeServer |
| `src/main/settings.ts` | 添加 `McpBridgeConfig` 类型和 `loadMcpBridgeConfig()` 函数 |
| `src/main/ipc.ts` | 添加 MCP Bridge 相关 IPC handlers（状态查询、配置保存） |
| `src/shared/types.ts` | 添加 MCP Bridge IPC channel 名称 |
| `src/renderer/components/SettingsPanel.tsx` | 添加 MCP Bridge 配置 UI（端口、工具选择、认证） |

### 5.3 不修改的文件

| 文件 | 原因 |
|------|------|
| `src/main/tools.ts` | 工具定义不变，MCP Bridge 通过 `getBuiltinTools()` 获取 |
| `src/main/core/agent-core.ts` | AgentCore 不变，MCP Bridge 直接调用工具 executor |
| `src/main/mcp-pool.ts` | MCP Client 逻辑不变，与 MCP Bridge 互不干扰 |
| `src/main/gateway/*` | Gateway 逻辑不变 |

---

## 6. 分阶段实施计划

### Sprint 1：基础 MCP Server（3 天）

**目标**：最小可用的 MCP Server，能响应 `initialize` 和 `tools/list`

**任务**：
1. 创建 `src/main/mcp-bridge/` 目录结构
2. 实现 `tool-registry.ts`：`mapNerveToolToMCP()` + `filterTools()`
3. 实现 `mcp-server.ts`：创建 McpServer 实例、注册工具
4. 实现原生 HTTP 路由（`/mcp` POST/GET/DELETE + `/health`）
5. 集成到 `src/main/index.ts`（启动/停止）
6. 基础配置加载（`~/.nerve/mcp-bridge.json`）

**验收标准**：
- `curl -X POST http://127.0.0.1:18800/mcp -d '{"jsonrpc":"2.0","method":"initialize",...}'` 返回正确响应
- `curl http://127.0.0.1:18800/mcp` 能建立 SSE 流
- MCP Inspector 能连接并看到工具列表

### Sprint 2：工具执行 + 认证（2 天）

**目标**：支持 `tools/call`，添加认证

**任务**：
1. 实现 `auth.ts`：Bearer Token 中间件
2. 实现工具执行回调：调用 Nerve 内置工具的 `execute` 方法
3. 错误处理：工具执行超时、异常捕获
4. 日志记录：工具调用日志

**验收标准**：
- `tools/call` 能正确执行 Read、Glob、Grep 等只读工具
- `tools/call` 能正确执行 Write、Bash 等写入工具
- 无 token 请求返回 401
- 错误工具有正确的 error content 返回

### Sprint 3：配置 UI + 稳定性（2 天）

**目标**：用户可配置，生产就绪

**任务**：
1. Settings UI：MCP Bridge 配置面板（端口、工具选择、认证开关）
2. IPC handlers：状态查询、配置保存、启停控制
3. StreamableHTTP 会话管理：会话清理、连接限制
4. 速率限制（复用 Gateway 的限流逻辑）
5. 单元测试

**验收标准**：
- Settings 中可以配置 MCP Bridge
- 可以选择暴露哪些工具
- 长时间运行无内存泄漏

### Sprint 4：Cloudflare Tunnel + 文档（1 天）

**目标**：支持公网访问，完成文档

**任务**：
1. Settings UI 添加 Cloudflare Tunnel 配置区域
2. cloudflared 进程管理（spawn/kill/状态检测）
3. 用户文档：如何配置 MCP 客户端连接 Nerve
4. README 更新

**验收标准**：
- 通过 Cloudflare Tunnel 可以从外部连接 MCP Bridge
- 文档清晰说明配置步骤

---

## 7. 安全方案

### 7.1 认证层

```
请求 → HTTP Server → auth.ts 中间件 → MCP Router
                  ↓
            Bearer Token 校验（timingSafeEqual）
            失败 → 401 Unauthorized
```

- Token 自动生成（首次启动时生成 32 字节随机 token，写入配置文件）
- 与 Gateway 共用 token 管理逻辑（但可独立配置）
- `timingSafeEqual` 防止时序攻击

### 7.2 工具级安全

| 安全措施 | 实现 |
|----------|------|
| 工具过滤 | 默认只暴露安全工具，Bash 等需显式启用 |
| 只读标注 | `readOnlyHint`/`destructiveHint` annotations，供客户端决策 |
| 执行超时 | 工具执行 120 秒超时（与 AgentCore 一致） |
| 输出截断 | 工具结果截断到 50KB（与 agentic-loop 一致） |

### 7.3 网络层安全

| 措施 | 说明 |
|------|------|
| 默认绑定 `127.0.0.1` | 仅本地访问 |
| 可选 `0.0.0.0` | 公网访问需配合 Cloudflare Tunnel |
| 速率限制 | 10 请求/秒/客户端 |
| 连接数限制 | 最多 20 并发连接 |
| Host 头验证 | 防 DNS 重绑定攻击 |

### 7.4 Cloudflare Tunnel 安全

- Cloudflare Tunnel 自动提供 HTTPS
- 隧道 URL 不可预测（随机子域名）
- 建议在 tunnel 前再加一层 Bearer Token 认证
- 可选：Cloudflare Access 策略（需要 Cloudflare 账号配置）

---

## 8. 配置格式

### `~/.nerve/mcp-bridge.json`

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
  },
  "cloudflare": {
    "enabled": false,
    "tunnelUrl": ""
  }
}
```

### MCP 客户端配置示例

**Claude Desktop** (`claude_desktop_config.json`):
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

**或通过 Cloudflare Tunnel**:
```json
{
  "mcpServers": {
    "nerve-agent": {
      "url": "https://xxx.trycloudflare.com/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

---

## 9. 依赖影响分析

### 新增依赖

| 包 | 是否需要 | 说明 |
|----|----------|------|
| `express` | ❌ 不需要 | 使用原生 `http` 模块 |
| `@modelcontextprotocol/sdk` | ✅ 已有 | ^1.29.0 已包含 Server 端 API |
| `cloudflared` | ❌ 不内嵌 | 用户自行安装，Nerve 通过 spawn 管理 |

### Bundle 大小影响

- MCP SDK Server 端代码：~50KB（已包含在现有依赖中，仅新增 import）
- 新增 MCP Bridge 代码：~10KB（轻量包装层）
- 总影响：**< 60KB**，可忽略

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| MCP SDK Server API 变更 | 低 — SDK 已有稳定版本 | 锁定 ^1.29.0，升级前测试 |
| 工具执行阻塞 Electron 主进程 | 高 — UI 卡顿 | 工具执行已有 120s 超时；可考虑后续移到 worker thread |
| Cloudflare Tunnel 连接不稳定 | 中 — 公网访问中断 | 心跳检测 + 自动重连 + UI 状态指示 |
| 与 MCP Client（mcp-pool）端口冲突 | 低 | MCP Bridge 使用独立端口 18800，与 Gateway 18789 不同 |
| 大量 MCP 客户端同时连接 | 中 — 资源耗尽 | 连接数限制（20）+ 速率限制 |

---

## 11. 未来扩展

- **Resources 暴露**：将 Nerve 的会话历史、memory 作为 MCP Resources 暴露
- **Prompts 暴露**：将 Nerve 的 Skills 作为 MCP Prompts 暴露
- **stdio 传输**：支持 `nerve --mcp-stdio` 模式，供本地 MCP 客户端直接连接
- **OAuth 2.0 认证**：替代 Bearer Token，支持更细粒度的权限控制
- **工具级 ACL**：按 MCP 客户端身份限制可调用的工具
