import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { McpBridgeServer } from '../../mcp-bridge/mcp-server'

function post(port: number, path: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()), headers: res.headers })
        } catch {
          resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString(), headers: res.headers })
        }
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
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) })
        } catch {
          resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() })
        }
      })
    }).on('error', reject)
  })
}

describe('McpBridgeServer', () => {
  let server: McpBridgeServer
  let port: number
  let sessionId: string

  beforeAll(async () => {
    server = new McpBridgeServer({
      enabled: true,
      port: 0,
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
    const res = await post(port, '/mcp', {
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    })
    expect(res.status).toBe(401)
  })

  it('handles MCP initialize handshake', async () => {
    const res = await post(port, '/mcp', {
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    }, { Authorization: 'Bearer test-token-123' })
    expect(res.status).toBe(200)
    expect(res.body.result.serverInfo.name).toBe('nerve-agent')
    expect(res.body.result.capabilities.tools).toBeDefined()

    // Capture session ID for subsequent requests
    sessionId = res.headers['mcp-session-id'] as string
    expect(sessionId).toBeDefined()
  })

  it('lists tools via tools/list', async () => {
    const res = await post(port, '/mcp', {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 2,
    }, {
      Authorization: 'Bearer test-token-123',
      'mcp-session-id': sessionId,
    })
    expect(res.status).toBe(200)
    const toolNames = res.body.result.tools.map((t: any) => t.name)
    expect(toolNames).toContain('Read')
    expect(toolNames).toContain('Glob')
    expect(toolNames).not.toContain('Bash')
  })

  it('returns 401 for unauthenticated requests to unknown routes', async () => {
    const res = await get(port, '/unknown')
    expect(res.status).toBe(401)
  })

  it('returns 404 for unknown routes with valid auth', async () => {
    const res = await post(port, '/unknown', {}, { Authorization: 'Bearer test-token-123' })
    expect(res.status).toBe(404)
  })
})
