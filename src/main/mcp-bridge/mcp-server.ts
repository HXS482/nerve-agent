// src/main/mcp-bridge/mcp-server.ts

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { getBuiltinTools } from '../tools'
import { filterTools, serializeResult } from './tool-registry'
import { TunnelManager } from './tunnel'
import type { McpBridgeConfig, NerveTool } from './types'

interface Session {
  server: Server
  transport: StreamableHTTPServerTransport
}

export class McpBridgeServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private tunnel: TunnelManager
  private tools: Record<string, NerveTool>
  private sessions = new Map<string, Session>()
  private actualPort: number = 0

  constructor(private config: McpBridgeConfig) {
    const allTools = getBuiltinTools(config.cwd, undefined, config.projectDir)
    this.tools = filterTools(allTools, config.tools)
    this.tunnel = new TunnelManager()
  }

  private createServerInstance(): Server {
    const mcpServer = new Server(
      { name: 'nerve-agent', version: '1.0.0' },
      { capabilities: { tools: { listChanged: true } } },
    )

    mcpServer.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: Object.entries(this.tools).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.input_schema,
        annotations: this.getAnnotations(name),
      })),
    }))

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
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

    return mcpServer
  }

  async start(): Promise<void> {
    this.httpServer = createServer(async (req, res) => {
      // Health endpoint — no auth required
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(this.getHealth()))
        return
      }

      // All other endpoints require auth
      if (!this.verifyAuth(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      // MCP endpoint
      if (req.url === '/mcp' && req.method === 'POST') {
        await this.handleMcpRequest(req, res)
        return
      }

      // 404 for everything else
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not Found' }))
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
      await this.tunnel.start(this.actualPort).catch((err) => {
        console.error('[MCP Bridge] Tunnel start failed:', err.message)
      })
    }
  }

  private async handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req)
      const parsed = JSON.parse(body)

      // Reuse existing session or create new one on initialize
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      let session = sessionId ? this.sessions.get(sessionId) : undefined

      if (!session) {
        // Only allow new sessions on initialize requests
        if (!isInitializeRequest(parsed)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID' }, id: null }))
          return
        }

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            this.sessions.set(sid, { server: mcpServer, transport })
          },
        })

        const mcpServer = this.createServerInstance()
        await mcpServer.connect(transport)
        session = { server: mcpServer, transport }
      }

      await session.transport.handleRequest(req, res, parsed)
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null }))
      }
    }
  }

  async stop(): Promise<void> {
    this.tunnel.stop()
    for (const [, session] of this.sessions) {
      await session.server.close()
    }
    this.sessions.clear()
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

  private getAnnotations(name: string): Record<string, boolean> {
    const readOnly = new Set(['Read', 'Glob', 'Grep'])
    const destructive = new Set(['Bash', 'Write', 'Edit', 'GitStageAll', 'GitCommit', 'GitPull', 'GitInit'])
    const annotations: Record<string, boolean> = {}
    if (readOnly.has(name)) annotations.readOnlyHint = true
    if (destructive.has(name)) annotations.destructiveHint = true
    if (name === 'Bash') annotations.openWorldHint = true
    return annotations
  }
}
