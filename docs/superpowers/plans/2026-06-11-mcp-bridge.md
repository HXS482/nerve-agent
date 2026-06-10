# MCP Bridge 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 MCP Bridge，让 Nerve 作为 MCP Server 通过 StreamableHTTP 暴露内置工具，并支持 Cloudflare Tunnel 公网访问。

**Architecture:** 使用 MCP SDK 底层 `Server` API（绕过 `McpServer.registerTool()` 的 Zod schema 限制），直接处理 `tools/list` 和 `tools/call`，JSON Schema 直出。原生 `http.createServer` 做 HTTP 路由，stateless 模式无会话管理。

**Tech Stack:** `@modelcontextprotocol/sdk@1.29.0`（已安装）、Node.js 原生 `http`、`child_process.spawn`（cloudflared）

**Spec:** `docs/superpowers/specs/2026-06-11-mcp-bridge-design.md`

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `src/main/mcp-bridge/types.ts` | McpBridgeConfig 接口 |
| Create | `src/main/mcp-bridge/tool-registry.ts` | filterTools + serializeResult |
| Create | `src/main/mcp-bridge/tunnel.ts` | TunnelManager（cloudflared 进程管理） |
| Create | `src/main/mcp-bridge/mcp-server.ts` | McpBridgeServer（核心编排） |
| Create | `src/main/mcp-bridge/index.ts` | 模块导出 |
| Create | `src/main/__tests__/mcp-bridge/tool-registry.test.ts` | filterTools + serializeResult 单元测试 |
| Create | `src/main/__tests__/mcp-bridge/mcp-server.test.ts` | MCP 协议集成测试 |
| Modify | `src/main/settings.ts` | 新增 loadMcpBridgeConfig / saveMcpBridgeConfig |
| Modify | `src/main/index.ts` | 构造 McpBridgeServer + before-quit 清理 |
| Modify | `src/main/ipc.ts` | setupIPC 新增 mcpBridge? 参数 |
| Modify | `src/shared/types.ts` | 新增 MCP_BRIDGE_* IPC channels |

---

## Task 1: types.ts — 类型定义

**Files:**
- Create: `src/main/mcp-bridge/types.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
// src/main/mcp-bridge/types.ts

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
  cloudflare: {
    enabled: boolean
  }
}

export interface NerveTool {
  description: string
  input_schema: Record<string, unknown>
  execute: (args: any) => Promise<any>
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit src/main/mcp-bridge/types.ts`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/main/mcp-bridge/types.ts
git commit -m "feat(mcp-bridge): add type definitions"
```

---

## Task 2: tool-registry.ts — 工具过滤 + 结果序列化

**Files:**
- Create: `src/main/mcp-bridge/tool-registry.ts`
- Create: `src/main/__tests__/mcp-bridge/tool-registry.test.ts`

- [ ] **Step 1: 写 serializeResult 测试**

```typescript
// src/main/__tests__/mcp-bridge/tool-registry.test.ts
import { describe, it, expect } from 'vitest'
import { filterTools, serializeResult } from '../../mcp-bridge/tool-registry'

describe('serializeResult', () => {
  it('handles null/undefined', () => {
    expect(serializeResult(null)).toBe('')
    expect(serializeResult(undefined)).toBe('')
  })

  it('handles primitive values', () => {
    expect(serializeResult('hello')).toBe('hello')
    expect(serializeResult(42)).toBe('42')
  })

  it('handles Bash success { output }', () => {
    expect(serializeResult({ output: 'file1.txt\nfile2.txt' })).toBe('file1.txt\nfile2.txt')
  })

  it('handles Bash with stderr { output, error }', () => {
    const result = serializeResult({ output: 'ok', error: 'warning: deprecated' })
    expect(result).toBe('ok\n[stderr] warning: deprecated')
  })

  it('handles Bash failure { error } only', () => {
    expect(serializeResult({ error: 'command not found' })).toBe('Error: command not found')
  })

  it('handles Read { content }', () => {
    expect(serializeResult({ content: 'file contents here' })).toBe('file contents here')
  })

  it('handles Write { success, file_path }', () => {
    expect(serializeResult({ success: true, file_path: '/tmp/test.ts' })).toBe('Written: /tmp/test.ts')
  })

  it('handles Edit { success, file_path, warnings }', () => {
    expect(serializeResult({ success: true, file_path: '/tmp/test.ts', warnings: ['warn'] })).toBe('Edited: /tmp/test.ts')
  })

  it('handles Glob { files }', () => {
    expect(serializeResult({ files: ['a.ts', 'b.ts'] })).toBe('a.ts\nb.ts')
  })

  it('handles Grep { results }', () => {
    const result = serializeResult({
      results: [
        { file: 'a.ts', line: 1, text: 'import foo' },
        { file: 'b.ts', line: 5, text: 'import bar' },
      ]
    })
    expect(result).toBe('a.ts:1: import foo\nb.ts:5: import bar')
  })

  it('handles Git { success, message }', () => {
    expect(serializeResult({ success: true, message: '3 files staged' })).toBe('3 files staged')
  })

  it('handles GitCommit { success, message, warnings, error }', () => {
    const result = serializeResult({
      success: true,
      message: '[main abc1234] commit msg',
      warnings: [],
      error: 'lint warning'
    })
    expect(result).toBe('[main abc1234] commit msg')
  })

  it('handles success=true with no message or file_path', () => {
    expect(serializeResult({ success: true })).toBe('OK')
  })

  it('handles success=false as fatal error', () => {
    expect(serializeResult({ success: false, error: 'disk full' })).toBe('Error: disk full')
  })

  it('handles unknown object shape', () => {
    const result = serializeResult({ foo: 'bar', count: 3 })
    expect(result).toContain('"foo"')
    expect(result).toContain('"count"')
  })

  it('handles Bash with savedImages', () => {
    const result = serializeResult({ output: 'done', savedImages: ['chart.png'] })
    expect(result).toContain('done')
    expect(result).toContain('[images saved: chart.png]')
  })
})

describe('filterTools', () => {
  const mockTools = {
    Read: { description: 'Read', input_schema: {}, execute: async () => ({}) },
    Write: { description: 'Write', input_schema: {}, execute: async () => ({}) },
    Bash: { description: 'Bash', input_schema: {}, execute: async () => ({}) },
    load_skill: { description: 'skill', input_schema: {}, execute: async () => ({}) },
  }

  it('includes only specified tools when include is non-empty', () => {
    const result = filterTools(mockTools, { include: ['Read', 'Write'], exclude: [] })
    expect(Object.keys(result)).toEqual(['Read', 'Write'])
  })

  it('excludes specified tools', () => {
    const result = filterTools(mockTools, { include: [], exclude: ['load_skill'] })
    expect(Object.keys(result)).toContain('Read')
    expect(Object.keys(result)).not.toContain('load_skill')
  })

  it('exclude takes precedence over include', () => {
    const result = filterTools(mockTools, { include: ['Read', 'Bash'], exclude: ['Bash'] })
    expect(Object.keys(result)).toEqual(['Read'])
  })

  it('returns all tools when include is empty and exclude is empty', () => {
    const result = filterTools(mockTools, { include: [], exclude: [] })
    expect(Object.keys(result)).toEqual(['Read', 'Write', 'Bash', 'load_skill'])
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run src/main/__tests__/mcp-bridge/tool-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 tool-registry.ts**

```typescript
// src/main/mcp-bridge/tool-registry.ts
import type { NerveTool } from './types'

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

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run src/main/__tests__/mcp-bridge/tool-registry.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-bridge/tool-registry.ts src/main/__tests__/mcp-bridge/tool-registry.test.ts
git commit -m "feat(mcp-bridge): add tool registry with filterTools and serializeResult"
```

---

## Task 3: tunnel.ts — Cloudflare Tunnel 管理

**Files:**
- Create: `src/main/mcp-bridge/tunnel.ts`

- [ ] **Step 1: 实现 TunnelManager**

```typescript
// src/main/mcp-bridge/tunnel.ts
import { spawn, type ChildProcess } from 'node:child_process'

export class TunnelManager {
  private process: ChildProcess | null = null
  private tunnelUrl: string | null = null
  private urlResolve: ((url: string) => void) | null = null

  async start(localPort: number): Promise<string> {
    if (this.process && this.tunnelUrl) return this.tunnelUrl

    return new Promise<string>((resolve, reject) => {
      this.urlResolve = resolve

      this.process = spawn('cloudflared', [
        'tunnel', '--url', `http://127.0.0.1:${localPort}`
      ], { stdio: ['ignore', 'pipe', 'pipe'] })

      this.process.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
        if (match && !this.tunnelUrl) {
          this.tunnelUrl = match[0]
          this.urlResolve?.(this.tunnelUrl)
          this.urlResolve = null
        }
      })

      this.process.on('error', (err) => {
        this.process = null
        if (this.urlResolve) {
          this.urlResolve = null
          reject(new Error('cloudflared not found. Install: npm i -g cloudflared'))
        }
      })

      this.process.on('exit', () => {
        this.process = null
        this.tunnelUrl = null
      })

      setTimeout(() => {
        if (this.urlResolve) {
          this.urlResolve = null
          this.process?.kill()
          this.process = null
          reject(new Error('Tunnel startup timed out'))
        }
      }, 30_000)
    })
  }

  stop(): void {
    this.process?.kill()
    this.process = null
    this.tunnelUrl = null
  }

  getUrl(): string | null {
    return this.tunnelUrl
  }

  isRunning(): boolean {
    return this.process !== null
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit src/main/mcp-bridge/tunnel.ts`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/main/mcp-bridge/tunnel.ts
git commit -m "feat(mcp-bridge): add TunnelManager for Cloudflare Tunnel"
```

---

## Task 4: mcp-server.ts — McpBridgeServer 核心

**Files:**
- Create: `src/main/mcp-bridge/mcp-server.ts`
- Create: `src/main/mcp-bridge/index.ts`
- Create: `src/main/__tests__/mcp-bridge/mcp-server.test.ts`

- [ ] **Step 1: 写集成测试**

```typescript
// src/main/__tests__/mcp-bridge/mcp-server.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { McpBridgeServer } from '../../mcp-bridge/mcp-server'

function post(port: number, path: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }) }
        catch { resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function get(port: number, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }) }
        catch { resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }) }
      })
    }).on('error', reject)
  })
}

describe('McpBridgeServer', () => {
  let server: McpBridgeServer
  let port: number

  beforeAll(async () => {
    server = new McpBridgeServer({
      enabled: true,
      port: 0, // random port
      host: '127.0.0.1',
      cwd: process.cwd(),
      projectDir: process.cwd(),
      tools: { include: ['Read', 'Glob'], exclude: [] },
      auth: { mode: 'token', token: 'test-token-123' },
      cloudflare: { enabled: false },
    })
    await server.start()
    port = server.getPort()
  })

  afterAll(async () => {
    await server.stop()
  })

  it('responds to /health', async () => {
    const res = await get(port, '/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.toolCount).toBe(2)
  })

  it('rejects unauthenticated requests to /mcp', async () => {
    const res = await post(port, '/mcp', { jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } })
    expect(res.status).toBe(401)
  })

  it('handles MCP initialize handshake', async () => {
    const res = await post(port, '/mcp', {
      jsonrpc: '2.0', method: 'initialize', id: 1,
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
    }, { Authorization: 'Bearer test-token-123' })
    expect(res.status).toBe(200)
    expect(res.body.result.serverInfo.name).toBe('nerve-agent')
    expect(res.body.result.capabilities.tools).toBeDefined()
  })

  it('lists tools via tools/list', async () => {
    const res = await post(port, '/mcp', {
      jsonrpc: '2.0', method: 'tools/list', id: 2
    }, { Authorization: 'Bearer test-token-123' })
    expect(res.status).toBe(200)
    const toolNames = res.body.result.tools.map((t: any) => t.name)
    expect(toolNames).toContain('Read')
    expect(toolNames).toContain('Glob')
    expect(toolNames).not.toContain('Bash')
  })

  it('returns 404 for unknown routes', async () => {
    const res = await get(port, '/unknown')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run src/main/__tests__/mcp-bridge/mcp-server.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 McpBridgeServer**

```typescript
// src/main/mcp-bridge/mcp-server.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { getBuiltinTools } from '../tools'
import { filterTools, serializeResult } from './tool-registry'
import { TunnelManager } from './tunnel'
import type { McpBridgeConfig, NerveTool } from './types'

export class McpBridgeServer {
  private mcpServer: Server
  private transport: StreamableHTTPServerTransport
  private httpServer: ReturnType<typeof createServer> | null = null
  private tunnel: TunnelManager
  private tools: Record<string, NerveTool>
  private actualPort: number = 0

  constructor(private config: McpBridgeConfig) {
    const allTools = getBuiltinTools(config.cwd, undefined, config.projectDir)
    this.tools = filterTools(allTools, config.tools)

    this.mcpServer = new Server(
      { name: 'nerve-agent', version: '1.0.0' },
      { capabilities: { tools: { listChanged: true } } }
    )

    this.transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

    this.tunnel = new TunnelManager()

    this.registerHandlers()
  }

  private registerHandlers(): void {
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: Object.entries(this.tools).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.input_schema,
        annotations: this.getAnnotations(name),
      }))
    }))

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
      try {
        const name = request.params.name
        const tool = this.tools[name]
        if (!tool) throw new Error(`Tool not found: ${name}`)
        const result = await tool.execute(request.params.arguments ?? {})
        return { content: [{ type: 'text' as const, text: serializeResult(result) }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: err.message }], isError: true }
      }
    })
  }

  async start(): Promise<void> {
    await this.mcpServer.connect(this.transport)

    this.httpServer = createServer(async (req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(this.getHealth()))
        return
      }

      if (!this.verifyAuth(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      if (req.url === '/mcp' && req.method === 'POST') {
        try {
          const body = await this.readBody(req)
          await this.transport.handleRequest(req, res, JSON.parse(body))
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      } else {
        res.writeHead(404).end('Not Found')
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on('error', reject)
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        const addr = this.httpServer!.address()
        this.actualPort = typeof addr === 'object' && addr ? addr.port : this.config.port
        resolve()
      })
    })

    if (this.config.cloudflare?.enabled) {
      await this.tunnel.start(this.actualPort).catch(err => {
        console.error('[MCP Bridge] Tunnel start failed:', err.message)
      })
    }
  }

  async stop(): Promise<void> {
    this.tunnel.stop()
    await this.mcpServer.close()
    await new Promise<void>((resolve) => {
      if (!this.httpServer) return resolve()
      this.httpServer.close(() => resolve())
    })
  }

  getHealth() {
    return {
      status: 'ok',
      toolCount: Object.keys(this.tools).length,
      port: this.actualPort,
      tunnelUrl: this.tunnel.getUrl(),
    }
  }

  getPort(): number {
    return this.actualPort
  }

  private verifyAuth(req: IncomingMessage): boolean {
    if (this.config.auth.mode === 'none') return true
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) return false
    const token = authHeader.slice(7)
    if (!this.config.auth.token) return false
    const expected = Buffer.from(this.config.auth.token)
    const actual = Buffer.from(token)
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  }

  private readBody(req: IncomingMessage): Promise<string> {
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
    const annotations: Record<string, boolean> = {}
    if (readOnly.has(name)) annotations.readOnlyHint = true
    if (destructive.has(name)) annotations.destructiveHint = true
    if (name === 'Bash') annotations.openWorldHint = true
    return annotations
  }
}
```

- [ ] **Step 4: 创建 index.ts 导出**

```typescript
// src/main/mcp-bridge/index.ts
export { McpBridgeServer } from './mcp-server'
export { TunnelManager } from './tunnel'
export type { McpBridgeConfig } from './types'
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `npx vitest run src/main/__tests__/mcp-bridge/mcp-server.test.ts`
Expected: 全部 PASS（initialize 握手、tools/list、认证拒绝、health check）

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp-bridge/mcp-server.ts src/main/mcp-bridge/index.ts src/main/__tests__/mcp-bridge/mcp-server.test.ts
git commit -m "feat(mcp-bridge): add McpBridgeServer with StreamableHTTP transport"
```

---

## Task 5: settings.ts — 配置加载

**Files:**
- Modify: `src/main/settings.ts`

- [ ] **Step 1: 在 settings.ts 末尾追加配置函数**

在 `src/main/settings.ts` 文件末尾追加：

```typescript
// MCP Bridge 配置
import type { McpBridgeConfig } from './mcp-bridge/types'

const MCP_BRIDGE_CONFIG_PATH = join(NERVE_DIR, 'mcp-bridge.json')

const DEFAULT_MCP_BRIDGE_CONFIG: McpBridgeConfig = {
  enabled: false,
  port: 18800,
  host: '127.0.0.1',
  cwd: homedir(),
  projectDir: homedir(),
  tools: {
    include: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'GitStageAll', 'GitCommit', 'GitPull', 'GitInit'],
    exclude: [],
  },
  auth: { mode: 'token', token: '' },
  cloudflare: { enabled: false },
}

export async function loadMcpBridgeConfig(): Promise<McpBridgeConfig> {
  try {
    const raw = await readFile(MCP_BRIDGE_CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_MCP_BRIDGE_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_MCP_BRIDGE_CONFIG }
  }
}

export async function saveMcpBridgeConfig(config: McpBridgeConfig): Promise<void> {
  await atomicWriteFile(MCP_BRIDGE_CONFIG_PATH, JSON.stringify(config, null, 2))
}
```

注意：`import type { McpBridgeConfig }` 需要放在文件顶部的 import 区域。`join`、`readFile`、`atomicWriteFile`、`NERVE_DIR`、`homedir` 已在 settings.ts 中导入/定义。

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit src/main/settings.ts`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/main/settings.ts
git commit -m "feat(mcp-bridge): add config loading to settings.ts"
```

---

## Task 6: index.ts — 启动集成

**Files:**
- Modify: `src/main/index.ts:377-397` (Gateway 构造之后，setupIPC 之前)
- Modify: `src/main/index.ts:451-454` (before-quit 清理)

- [ ] **Step 1: 在 index.ts 顶部添加 import**

在现有 import 区域追加：

```typescript
import { McpBridgeServer } from './mcp-bridge'
import { loadMcpBridgeConfig } from './settings'
```

- [ ] **Step 2: 在 L396（setupIPC 调用之前）插入 MCP Bridge 构造和启动**

在 `setupIPC(mainWindow, claude, skinManager, gitService, gateway)` 之前插入：

```typescript
  // MCP Bridge
  const mcpBridgeConfig = await loadMcpBridgeConfig()
  mcpBridgeConfig.cwd = app.getPath('home')
  mcpBridgeConfig.projectDir = projectDir

  const mcpBridge = new McpBridgeServer(mcpBridgeConfig)

  if (mcpBridgeConfig.enabled) {
    mcpBridge.start().catch(err => console.error('[Nerve] MCP Bridge start failed:', err.message))
  }
```

- [ ] **Step 3: 修改 setupIPC 调用，传入 mcpBridge**

将：
```typescript
  setupIPC(mainWindow, claude, skinManager, gitService, gateway)
```
改为：
```typescript
  setupIPC(mainWindow, claude, skinManager, gitService, gateway, mcpBridge)
```

- [ ] **Step 4: 在 before-quit 中添加 mcpBridge.stop()**

将 `before-quit` handler 中：
```typescript
  app.on('before-quit', async () => {
    await memoryCore.destroy().catch(() => {})
    await claude.close()
  })
```
改为：
```typescript
  app.on('before-quit', async () => {
    await mcpBridge.stop().catch(() => {})
    await memoryCore.destroy().catch(() => {})
    await claude.close()
  })
```

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit src/main/index.ts`
Expected: 无错误（此时 ipc.ts 尚未改，可能报类型错误，可忽略到 Task 7 一起修）

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(mcp-bridge): integrate McpBridgeServer into app lifecycle"
```

---

## Task 7: ipc.ts + shared/types.ts — IPC 扩展

**Files:**
- Modify: `src/shared/types.ts:106-119` (追加 MCP_BRIDGE_* channels)
- Modify: `src/main/ipc.ts:13` (setupIPC 签名)
- Modify: `src/main/ipc.ts:438` (追加 mcpBridge guard)

- [ ] **Step 1: 在 shared/types.ts 追加 IPC channels**

在 `GATEWAY_PUBLIC_ACCESS_SAVE` 之后追加：

```typescript
  MCP_BRIDGE_STATUS: 'mcp-bridge:status',
```

- [ ] **Step 2: 修改 ipc.ts setupIPC 签名**

将：
```typescript
export function setupIPC(window: BrowserWindow, claude: ClaudeService, skinManager: PetSkinManager, gitService: GitService, gateway?: NerveGateway) {
```
改为：
```typescript
export function setupIPC(window: BrowserWindow, claude: ClaudeService, skinManager: PetSkinManager, gitService: GitService, gateway?: NerveGateway, mcpBridge?: import('./mcp-bridge').McpBridgeServer) {
```

- [ ] **Step 3: 在 ipc.ts gateway guard 之后追加 mcpBridge guard**

在 `if (gateway) { ... }` 块结束后追加：

```typescript
  if (mcpBridge) {
    ipcMain.handle(IPC_CHANNELS.MCP_BRIDGE_STATUS, async () => mcpBridge.getHealth())
  }
```

- [ ] **Step 4: 验证全项目编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/ipc.ts
git commit -m "feat(mcp-bridge): add IPC channels and handlers"
```

---

## Task 8: 端到端验证

**Files:**
- None (verification only)

- [ ] **Step 1: 跑全部 MCP Bridge 测试**

Run: `npx vitest run src/main/__tests__/mcp-bridge/`
Expected: 全部 PASS

- [ ] **Step 2: 验证 build**

Run: `npm run build`
Expected: 无错误

- [ ] **Step 3: 手动验证 — 启动 app + curl 测试**

启动 Nerve，确保 `~/.nerve/mcp-bridge.json` 中 `enabled: true`，然后：

```bash
# Health check
curl http://127.0.0.1:18800/health

# MCP initialize
curl -X POST http://127.0.0.1:18800/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# tools/list
curl -X POST http://127.0.0.1:18800/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'
```

Expected: health 返回 `{"status":"ok","toolCount":10,...}`，initialize 返回 serverInfo，tools/list 返回工具列表

- [ ] **Step 4: Commit（如有修 bug）**

```bash
git add -A && git commit -m "fix(mcp-bridge): end-to-end verification fixes"
```
