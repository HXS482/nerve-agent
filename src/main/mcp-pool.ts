import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { loadMcpServerConfigs, McpServerConfig } from './settings'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface PooledClient {
  client: InstanceType<typeof Client>
  tools: Record<string, unknown>
  lastHealthCheck: number
}

const HEALTH_CHECK_INTERVAL = 60_000
const MAX_RECONNECT_DELAY = 30_000
const CONNECT_TIMEOUT = 5_000

export class McpPool {
  private pool = new Map<string, PooledClient>()
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private connectPromise: Promise<void> | null = null
  private closed = false

  async ensureConnected(): Promise<Record<string, unknown>> {
    // Already have tools? Return them
    if (this.pool.size > 0) return this.getAllTools()

    // First call: fire off background connect, return empty immediately
    if (!this.connectPromise) {
      this.connectPromise = this.connectAll().finally(() => { this.connectPromise = null })
    }

    // Give it a brief window to grab fast servers, then return whatever we have
    await Promise.race([this.connectPromise, sleep(500)])
    return this.getAllTools()
  }

  private async connectAll(): Promise<void> {
    const configs = await loadMcpServerConfigs()
    const entries = Object.entries(configs).filter(([, c]) => c.type === 'stdio')

    // Connect to all servers in parallel with per-server timeout
    await Promise.allSettled(
      entries.map(([name, config]) => this.connectWithTimeout(name, config))
    )

    this.startHealthCheck()
  }

  private async connectWithTimeout(name: string, config: McpServerConfig): Promise<void> {
    if (this.pool.has(name)) return

    try {
      const client = await Promise.race([
        this.connectServer(name, config),
        sleep(CONNECT_TIMEOUT).then(() => { throw new Error('connect timeout') }),
      ])
      const { tools: toolList } = await Promise.race([
        client.listTools(),
        sleep(CONNECT_TIMEOUT).then(() => { throw new Error('tools timeout') }),
      ])
      const toolsMap: Record<string, unknown> = {}
      for (const tool of toolList) {
        toolsMap[tool.name] = {
          description: tool.description,
          parameters: tool.inputSchema,
        }
      }
      this.pool.set(name, {
        client,
        tools: toolsMap,
        lastHealthCheck: Date.now(),
      })
    } catch {
      // Failed servers are skipped silently — lazy connect means they'll be retried next call
    }
  }

  private async connectServer(name: string, config: McpServerConfig) {
    const isWin = process.platform === 'win32'
    const transport = new StdioClientTransport({
      command: isWin ? 'cmd' : config.command,
      args: isWin ? ['/c', config.command, ...(config.args || [])] : (config.args || []),
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([_, v]) => v !== undefined)),
        ...config.env,
      } as Record<string, string>,
    })
    const client = new Client({ name: `nerve-${name}`, version: '1.0.0' })
    await client.connect(transport)
    return client
  }

  getAllTools(): Record<string, unknown> {
    const tools: Record<string, unknown> = {}
    for (const entry of this.pool.values()) {
      Object.assign(tools, entry.tools)
    }
    return tools
  }

  private startHealthCheck() {
    if (this.healthTimer) return
    this.healthTimer = setInterval(() => this.healthCheck(), HEALTH_CHECK_INTERVAL)
  }

  private async healthCheck() {
    if (this.closed) return

    for (const [name, entry] of this.pool) {
      if (Date.now() - entry.lastHealthCheck < HEALTH_CHECK_INTERVAL) continue

      try {
        const { tools: toolList } = await entry.client.listTools()
        const toolsMap: Record<string, unknown> = {}
        for (const tool of toolList) {
          toolsMap[tool.name] = { description: tool.description, parameters: tool.inputSchema }
        }
        entry.tools = toolsMap
        entry.lastHealthCheck = Date.now()
      } catch {
        console.error(`[McpPool] "${name}" health check failed, reconnecting...`)
        // Close old client before reconnecting to prevent child process leak
        try { await entry.client.close() } catch { /* ignore */ }
        this.pool.delete(name)
        if (!this.closed) await this.reconnect(name)
      }
    }
  }

  private async reconnect(name: string, attempt = 0) {
    if (this.closed) return

    const configs = await loadMcpServerConfigs()
    const config = configs[name]
    if (!config || config.type !== 'stdio') return

    let client: InstanceType<typeof Client> | undefined
    try {
      client = await this.connectServer(name, config)
      const { tools: toolList } = await client.listTools()
      const tools: Record<string, unknown> = {}
      for (const tool of toolList) {
        tools[tool.name] = { description: tool.description, parameters: tool.inputSchema }
      }
      this.pool.set(name, {
        client,
        tools,
        lastHealthCheck: Date.now(),
      })
    } catch (err) {
      // Close client if it was created but tools() failed
      if (client) {
        try { await client.close() } catch { /* ignore */ }
      }
      if (attempt < 3 && !this.closed) {
        const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY)
        await new Promise((r) => setTimeout(r, delay))
        await this.reconnect(name, attempt + 1)
      } else {
        console.error(`[McpPool] "${name}" reconnect failed after ${attempt + 1} attempts`)
      }
    }
  }

  async close() {
    this.closed = true
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
    for (const [, entry] of this.pool) {
      try { await entry.client.close() } catch { /* ignore */ }
    }
    this.pool.clear()
  }

  async closeServer(name: string) {
    const entry = this.pool.get(name)
    if (entry) {
      try { await entry.client.close() } catch { /* ignore */ }
      this.pool.delete(name)
    }
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const entry = this.pool.get(serverName)
    if (!entry) throw new Error(`MCP server "${serverName}" not connected`)
    const result = await entry.client.callTool({ name: toolName, arguments: args })
    const content = result.content as Array<{ type: string; text?: string }>
    return content.filter(c => c.type === 'text').map(c => c.text).join('\n')
  }

  getAllToolExecutors(): Map<string, (args: Record<string, unknown>) => Promise<string>> {
    const executors = new Map<string, (args: Record<string, unknown>) => Promise<string>>()
    for (const [serverName, entry] of this.pool) {
      for (const toolName of Object.keys(entry.tools)) {
        executors.set(toolName, (args) => this.callTool(serverName, toolName, args))
      }
    }
    return executors
  }
}
