import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadMcpServerConfigs, isRemoteMcpConfig, McpServerConfig } from './settings'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface PooledClient {
  client: InstanceType<typeof Client>
  tools: Record<string, unknown>
  lastHealthCheck: number
  drainMode: boolean
  inflightCalls: number
  /** 连接时配置指纹，热重载时判断是否变更 */
  configJson: string
}

const HEALTH_CHECK_INTERVAL = 60_000
const MAX_RECONNECT_DELAY = 30_000
/**
 * 单个 server 的连接/握手超时。
 * 原来 5s 余量为零：实测 4 个 server 并发就要 2~4.5s（github 4499ms），
 * stdio 的 `npx -y` 首次还得下载包 —— 网络一抖动就全判失败。
 */
const CONNECT_TIMEOUT = 30_000
/** ensureConnected 单次等待连接结束的上限；连接正常时几秒内就返回 */
const CONNECT_WAIT_MAX = 30_000
const FAILED_RETRY_INTERVAL = 60_000

export interface McpServerStatus {
  status: 'connected' | 'connecting' | 'failed'
  toolCount: number
  error?: string
}

/** 带 server 归属的 MCP 工具条目（冲突解决前的原始形态） */
export interface McpToolEntry {
  serverName: string
  toolName: string
  tool: { description?: string; parameters?: unknown }
}

/**
 * MCP 工具名冲突解决：与保留名（内置工具）或其他 MCP 工具重名时，
 * 暴露为 serverName__toolName（仍冲突则追加序号），避免静默覆盖。
 */
export function resolveMcpToolNames<T extends { serverName: string; toolName: string }>(
  entries: T[],
  reserved: ReadonlySet<string> = new Set(),
  warn: (msg: string) => void = console.warn,
): Array<T & { finalName: string }> {
  const used = new Set(reserved)
  return entries.map((entry) => {
    let finalName = entry.toolName
    if (used.has(finalName)) {
      const base = `${entry.serverName}__${entry.toolName}`
      finalName = base
      let n = 2
      while (used.has(finalName)) finalName = `${base}__${n++}`
      warn(`[McpPool] MCP tool "${entry.toolName}" from server "${entry.serverName}" conflicts with an existing tool name; exposed as "${finalName}"`)
    }
    used.add(finalName)
    return { ...entry, finalName }
  })
}

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'USER', 'SHELL', 'TERM', 'TEMP', 'TMP', 'SystemRoot', 'windir']

function buildSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!
  }
  return env
}

/**
 * 池能接的服务器配置：远端（有 url）或本地 stdio。
 * connectAll / reconnect / syncWithConfig 三处共用这一个判定——原先三份重复的
 * `isRemoteMcpConfig(c) || c.type === 'stdio'` 漏改过两处：f4311e6 加了远端传输，
 * 但 reconnect 与 syncWithConfig 仍是 stdio 硬判定，远端 server 一保存设置就掉线。
 */
export function isPoolableConfig(config: McpServerConfig): boolean {
  return isRemoteMcpConfig(config) || config.type === 'stdio'
}

export class McpPool {
  private pool = new Map<string, PooledClient>()
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private connectPromise: Promise<void> | null = null
  private closed = false
  /** 连接失败的服务器：name → 错误信息（用于状态展示与节流重试） */
  private failed = new Map<string, string>()
  /** 正在连接中的服务器 */
  private connecting = new Set<string>()
  private lastFailRetry = 0

  async ensureConnected(): Promise<McpToolEntry[]> {
    const now = Date.now()
    // 有失败服务器且距上次尝试超过间隔 → 才重连（connectAll 会跳过已连接的）
    const shouldRetryFailed = this.failed.size > 0 && now - this.lastFailRetry > FAILED_RETRY_INTERVAL

    // 已有连接、且没有待重试的失败 → 直接返回
    if (this.pool.size > 0 && !shouldRetryFailed) return this.getDetailedTools()

    // 一个都没连上、又没到重试间隔 → 直接返回当前的（空）结果。
    // 否则每轮 agent 循环都会重新连一遍，每轮白等一次连接超时。
    if (this.pool.size === 0 && this.failed.size > 0 && !shouldRetryFailed) return this.getDetailedTools()

    if (!this.connectPromise) {
      this.lastFailRetry = now
      this.connectPromise = this.connectAll().finally(() => { this.connectPromise = null })
    }

    // 等连接真正结束再取工具：原来的 500ms 窗口比连接本身（2~4.5s）还短，
    // 等于当轮永远拿不到 MCP 工具。
    await Promise.race([this.connectPromise, sleep(CONNECT_WAIT_MAX)])
    return this.getDetailedTools()
  }

  private async connectAll(): Promise<void> {
    const configs = await loadMcpServerConfigs()
    const entries = Object.entries(configs).filter(([, c]) => isPoolableConfig(c))

    // Connect to all servers in parallel with per-server timeout
    await Promise.allSettled(
      entries.map(([name, config]) => this.connectWithTimeout(name, config))
    )

    this.startHealthCheck()
  }

  private async connectWithTimeout(name: string, config: McpServerConfig): Promise<void> {
    if (this.pool.has(name)) return

    this.connecting.add(name)
    try {
      this.pool.set(name, await this.buildClient(name, config))
      this.failed.delete(name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 失败的服务器跳过工具注入，但记录状态供 UI 展示与后续节流重试
      this.failed.set(name, msg)
      console.error(`[McpPool] "${name}" connect failed: ${msg}`)
    } finally {
      this.connecting.delete(name)
    }
  }

  /**
   * 建连 + 拉工具，返回可直接入池的 entry。connect 与 listTools 都带超时。
   * 失败时保证不留 client 与子进程 —— connectWithTimeout / reconnect / replaceServer 共用。
   */
  private async buildClient(name: string, config: McpServerConfig): Promise<PooledClient> {
    let client: InstanceType<typeof Client> | undefined
    let connecting: Promise<InstanceType<typeof Client>> | undefined
    try {
      connecting = this.connectServer(name, config).then((c) => {
        client = c
        return c
      })
      const connected = await Promise.race([
        connecting,
        sleep(CONNECT_TIMEOUT).then(() => { throw new Error(`connect timeout (>${CONNECT_TIMEOUT}ms)`) }),
      ])
      const { tools: toolList } = await Promise.race([
        connected.listTools(),
        sleep(CONNECT_TIMEOUT).then(() => { throw new Error(`tools timeout (>${CONNECT_TIMEOUT}ms)`) }),
      ])
      const tools: Record<string, unknown> = {}
      for (const tool of toolList) {
        tools[tool.name] = {
          description: tool.description,
          parameters: tool.inputSchema,
        }
      }
      return {
        client: connected,
        tools,
        lastHealthCheck: Date.now(),
        drainMode: false,
        inflightCalls: 0,
        configJson: JSON.stringify(config),
      }
    } catch (err) {
      // 超时/失败都要收尾：连接可能仍在后台跑，子进程已经 spawn 出来了。
      // 不关掉的话它会作为僵尸常驻（实测残留过 29 分钟）。
      if (client) {
        try { await client.close() } catch { /* ignore */ }
      } else {
        // 超时发生在 connectServer 返回之前 —— 等底层落定后立刻关掉
        void connecting?.then((c) => c.close().catch(() => {}), () => {})
      }
      throw err
    }
  }

  private async connectServer(name: string, config: McpServerConfig) {
    const client = new Client({ name: `nerve-${name}`, version: '1.0.0' })

    // 远端 MCP：直连 URL，不起本地进程；headers 里的凭证原样带走
    if (isRemoteMcpConfig(config)) {
      const transport = new StreamableHTTPClientTransport(new URL(config.url!), {
        requestInit: { headers: config.headers },
      })
      await client.connect(transport)
      return client
    }

    // 类型放宽后 command 变可选，这里补运行时守卫（也是给下面的类型收窄）
    if (!config.command) throw new Error('MCP 配置既没有 url 也没有 command')

    const isWin = process.platform === 'win32'
    const transport = new StdioClientTransport({
      command: isWin ? 'cmd' : config.command,
      args: isWin ? ['/c', config.command, ...(config.args || [])] : (config.args || []),
      env: {
        ...buildSafeEnv(),
        ...config.env,
      } as Record<string, string>,
    })
    await client.connect(transport)
    return client
  }

  getDetailedTools(): McpToolEntry[] {
    const out: McpToolEntry[] = []
    for (const [serverName, entry] of this.pool) {
      for (const [toolName, tool] of Object.entries(entry.tools)) {
        out.push({ serverName, toolName, tool: tool as McpToolEntry['tool'] })
      }
    }
    return out
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
    if (!config || !isPoolableConfig(config)) return

    try {
      this.pool.set(name, await this.buildClient(name, config))
      this.failed.delete(name)
    } catch (err) {
      if (attempt < 3 && !this.closed) {
        const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY)
        await new Promise((r) => setTimeout(r, delay))
        await this.reconnect(name, attempt + 1)
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        this.failed.set(name, `reconnect failed: ${msg}`)
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

  private pendingRollback = new Map<string, { oldEntry: PooledClient; deadline: ReturnType<typeof setTimeout> }>()

  async drainServer(name: string, timeoutMs = 30_000): Promise<void> {
    const entry = this.pool.get(name)
    if (!entry) return
    entry.drainMode = true
    const start = Date.now()
    while (entry.inflightCalls > 0 && Date.now() - start < timeoutMs) {
      await sleep(100)
    }
  }

  isDraining(name: string): boolean {
    return this.pool.get(name)?.drainMode ?? false
  }

  trackCallStart(name: string): void {
    const entry = this.pool.get(name)
    if (entry) entry.inflightCalls++
  }

  trackCallEnd(name: string): void {
    const entry = this.pool.get(name)
    if (entry) entry.inflightCalls--
  }

  async replaceServer(name: string, newConfig: McpServerConfig): Promise<void> {
    const old = this.pool.get(name)
    if (!old) {
      await this.connectWithTimeout(name, newConfig)
      return
    }

    await this.drainServer(name)

    const newEntry = await this.buildClient(name, newConfig)
    this.pool.set(name, newEntry)
    this.failed.delete(name)

    const deadline = setTimeout(() => {
      old.client.close().catch(() => {})
      this.pendingRollback.delete(name)
    }, 10_000)
    this.pendingRollback.set(name, { oldEntry: old, deadline })
  }

  async rollbackServer(name: string): Promise<boolean> {
    const pending = this.pendingRollback.get(name)
    if (!pending) return false

    clearTimeout(pending.deadline)
    const current = this.pool.get(name)
    this.pool.set(name, pending.oldEntry)
    pending.oldEntry.drainMode = false
    this.pendingRollback.delete(name)

    if (current) await current.client.close().catch(() => {})
    return true
  }

  async closeServer(name: string) {
    const entry = this.pool.get(name)
    if (entry) {
      try { await entry.client.close() } catch { /* ignore */ }
      this.pool.delete(name)
    }
  }

  /** 保存配置后热同步：连新增的、关已删的、配置变更的重连 */
  async syncWithConfig(): Promise<void> {
    if (this.closed) return
    const configs = await loadMcpServerConfigs()
    const wanted = Object.entries(configs).filter(([, c]) => isPoolableConfig(c))
    const wantedNames = new Set(wanted.map(([n]) => n))

    // 已删除的服务器：断开并清状态
    for (const name of [...this.pool.keys()]) {
      if (!wantedNames.has(name)) await this.closeServer(name)
    }
    for (const name of [...this.failed.keys()]) {
      if (!wantedNames.has(name)) this.failed.delete(name)
    }

    await Promise.allSettled(wanted.map(async ([name, config]) => {
      const configJson = JSON.stringify(config)
      const existing = this.pool.get(name)
      if (existing && existing.configJson === configJson) return // 没变，不动
      if (existing) await this.closeServer(name) // 配置变了，重连
      this.failed.delete(name)
      await this.connectWithTimeout(name, config)
    }))
  }

  /** 设置面板状态指示：已连接/连接中/失败 + 错误信息 */
  async getStatus(): Promise<Record<string, McpServerStatus>> {
    const configs = await loadMcpServerConfigs()
    const result: Record<string, McpServerStatus> = {}
    for (const name of Object.keys(configs)) {
      const entry = this.pool.get(name)
      if (entry) {
        result[name] = { status: 'connected', toolCount: Object.keys(entry.tools).length }
      } else if (this.connecting.has(name)) {
        result[name] = { status: 'connecting', toolCount: 0 }
      } else {
        result[name] = { status: 'failed', toolCount: 0, error: this.failed.get(name) ?? 'not connected' }
      }
    }
    return result
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const entry = this.pool.get(serverName)
    if (!entry) throw new Error(`MCP server "${serverName}" not connected`)
    const result = await entry.client.callTool({ name: toolName, arguments: args })
    const content = result.content as Array<{ type: string; text?: string }>
    return content.filter(c => c.type === 'text').map(c => c.text).join('\n')
  }

  getDetailedExecutors(): Array<{ serverName: string; toolName: string; execute: (args: Record<string, unknown>) => Promise<string> }> {
    const out: Array<{ serverName: string; toolName: string; execute: (args: Record<string, unknown>) => Promise<string> }> = []
    for (const [serverName, entry] of this.pool) {
      for (const toolName of Object.keys(entry.tools)) {
        out.push({ serverName, toolName, execute: (args) => this.callTool(serverName, toolName, args) })
      }
    }
    return out
  }
}
