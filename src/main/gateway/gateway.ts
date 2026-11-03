/**
 * Nerve Gateway 主入口
 *
 * 职责：
 * - 管理 WebSocket 服务生命周期
 * - 管理 IM 适配器
 * - 处理消息路由
 * - 协调 AgentCore 和 SessionRouter
 * - 提供健康检查和状态查询
 */

import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { join } from 'path'
import { GatewayWSServer } from './ws-server'
import { SessionRouter } from './session-router'
import { TicketRouter } from './ticket-router'
import { SlotScheduler } from './slot-scheduler'
import { deriveThreadKey } from './thread-key'
import { WebSocketChannel } from './ws-channel'
import { AdapterChannel } from './adapter-channel'
import { AgentCore } from '../core/agent-core'
import { TicketStore } from '../store/ticket-store'
import { EffectRunner } from '../store/effect-runner'
import { BaseAdapter } from './adapters/base-adapter'
import { TelegramAdapter } from './adapters/telegram'
import { DiscordAdapter } from './adapters/discord'
import { createResponse, createEvent } from './protocol'
import type { WSClient } from './ws-server'
import type { GatewayRequest, IncomingMessage } from './protocol'
import type { GatewayChannel, GatewayProxy } from '../../shared/types'

export interface GatewayConfig {
  port: number
  /** 监听地址，默认 '127.0.0.1'，公网模式用 '0.0.0.0' */
  host?: string
  auth?: {
    mode: 'token' | 'none'
    secret?: string
  }
  dataDir: string
  projectDir: string
  sourceDir: string
}

export class NerveGateway extends EventEmitter {
  private server: GatewayWSServer
  /** 由 `ensureQueue()` 在 `start()` 里赋值；Gateway 未启动时为 null。 */
  private sessionRouter: SessionRouter | null = null
  private agentCore: AgentCore
  private adapters = new Map<string, BaseAdapter>()
  private startTime: number = 0
  private running = false
  private proxy: GatewayProxy | null = null

  // clientId → sessionId → WebSocketChannel
  private channels = new Map<string, Map<string, WebSocketChannel>>()

  // 持久化队列：消息先落 effect 表，再由 EffectRunner 执行。
  //
  // 刻意**不**在构造函数里打开：`TicketStore.open` 会 `require('better-sqlite3')`（原生模块），
  // 绑定坏掉/架构不匹配时会在模块初始化阶段就抛错，而 `new NerveGateway(...)`
  // （index.ts 里的构造点）外面没有任何 try/catch——那会把整个 app 启动一起带下去。
  // 改成 `start()` 里惰性打开：坏掉的绑定只会让 Gateway 这一路功能降级（IPC 把错误回给 UI），
  // 应用本身照常起来。三者要么一起存在、要么一起为 null。
  private ticketStore: TicketStore | null = null
  private effectRunner: EffectRunner | null = null
  /** threadKey → Ticket 的调度层。与 sessionRouter 并存：一个管"谁在说话"，一个管"在做什么活"。 */
  private ticketRouter: TicketRouter | null = null

  constructor(private config: GatewayConfig) {
    super()
    // 创建 AgentCore
    this.agentCore = new AgentCore({
      projectDir: config.projectDir,
      sourceDir: config.sourceDir,
    })

    // 创建 WebSocket 服务
    this.server = new GatewayWSServer({
      port: config.port,
      host: config.host,
      auth: config.auth,
    })

    // 设置消息处理器
    this.server.onMessage(this.handleMessage.bind(this))

    // 设置断开连接处理器（清理 channels Map）
    this.server.onDisconnect(this.handleDisconnect.bind(this))
  }

  /**
   * 惰性打开持久化队列（store + runner + router）。
   *
   * 幂等：已经开过就直接返回，这样 `stop()` → `start()` 不会重复打开同一个 SQLite 文件
   * （也保证内存里的 session 映射/channel 语义不会被第二轮重新加载覆盖）。
   *
   * 打开失败则 log + 抛错，由调用方（IPC / worker）决定怎么报给用户——Gateway 不进入 running。
   */
  private ensureQueue(): void {
    if (this.ticketStore && this.effectRunner && this.sessionRouter && this.ticketRouter) return

    // 先全部构造成功再赋值，避免留下"store 有、runner 没有"的半截状态。
    let store: TicketStore
    let runner: EffectRunner
    let router: SessionRouter
    let tickets: TicketRouter
    try {
      store = TicketStore.open(join(this.config.dataDir, 'tickets.db'))
      runner = new EffectRunner(store)
      router = new SessionRouter(this.agentCore, this.config.dataDir, store, runner)
      tickets = new TicketRouter({
        store,
        scheduler: new SlotScheduler({ concurrency: 3 }),
        agentCore: this.agentCore,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log('error', `Failed to open persistent queue at ${this.config.dataDir}: ${message}`)
      throw new Error(`Failed to open persistent queue: ${message}`)
    }

    this.ticketStore = store
    this.effectRunner = runner
    this.sessionRouter = router
    this.ticketRouter = tickets
  }

  /**
   * 取已打开的 SessionRouter。
   *
   * 队列只在 `start()` 里惰性打开，所以 Gateway 未启动时它是 null；调用点本来也都只在
   * 有流量时才走到（都是 `running === true` 之后），这里显式抛错而不是静默丢弃消息。
   */
  private requireTicketRouter(): TicketRouter {
    if (!this.ticketRouter) throw new Error('Gateway queue is not started')
    return this.ticketRouter
  }

  /** 给 IPC 用：取 TicketRouter（未启动时返回 null，不抛错）。 */
  getTicketRouter(): TicketRouter | null {
    return this.ticketRouter
  }

  /** 给 IPC 用：直接读 ticket 表（未启动时返回空数组，UI 不会崩）。 */
  listTickets(opts: { includeEnded?: boolean } = {}) {
    return this.ticketStore ? this.ticketStore.listTickets(opts) : []
  }

  getTicket(id: string) {
    return this.ticketStore ? this.ticketStore.getTicket(id) : undefined
  }

  private requireRouter(): SessionRouter {
    if (!this.sessionRouter) {
      throw new Error('Gateway is not started: persistent queue is not open')
    }
    return this.sessionRouter
  }

  private log(level: 'info' | 'warn' | 'error', message: string) {
    this.emit('log', { level, message, timestamp: Date.now() })
  }

  /**
   * 注册 IM 适配器
   */
  registerAdapter(adapter: BaseAdapter) {
    const name = adapter.name
    this.log('info', `Registering adapter: ${name}`)

    // 监听消息
    adapter.on('message', (msg: IncomingMessage) => {
      this.handleAdapterMessage(adapter, msg)
    })

    this.adapters.set(name, adapter)
  }

  /**
   * 设置代理
   */
  setProxy(proxy: GatewayProxy | null): void {
    this.proxy = proxy
    if (proxy && proxy.enabled && proxy.host && proxy.port) {
      this.log('info', `Proxy configured: ${proxy.protocol}://${proxy.host}:${proxy.port}`)
    } else {
      this.log('info', 'Proxy disabled')
    }
  }

  /**
   * 设置监听地址（需重启 Gateway 生效）
   */
  setHost(host: string): void {
    this.config.host = host
    this.log('info', `Host set to ${host} (restart required)`)
  }

  /**
   * 从 Channel 配置加载适配器
   * 读取 settings.json 中的 channels，创建并注册适配器实例
   */
  async loadAdapters(channels: GatewayChannel[]): Promise<void> {
    // 先断开并移除现有适配器
    for (const [name, adapter] of this.adapters.entries()) {
      try {
        if (adapter.isConnected) await adapter.disconnect()
      } catch (err) {
        this.log('error', `Failed to disconnect adapter ${name}: ${err}`)
      }
    }
    this.adapters.clear()

    // 构建代理 URL
    const proxyUrl = this.proxy?.enabled && this.proxy.host && this.proxy.port
      ? `${this.proxy.protocol}://${this.proxy.host}:${this.proxy.port}`
      : undefined

    // 根据配置创建新适配器
    for (const ch of channels) {
      if (!ch.enabled) continue
      if (!ch.config.token && ch.platform !== 'wechat-work') continue

      try {
        let adapter: BaseAdapter | null = null

        switch (ch.platform) {
          case 'telegram':
            adapter = new TelegramAdapter({
              enabled: true,
              token: ch.config.token,
              proxy: proxyUrl,
              allowedUsers: ch.config.allowedUsers
                ? ch.config.allowedUsers.split(',').map(s => s.trim()).filter(Boolean)
                : undefined,
            })
            break

          case 'discord':
            adapter = new DiscordAdapter({
              enabled: true,
              token: ch.config.token,
              allowedUsers: ch.config.allowedUsers
                ? ch.config.allowedUsers.split(',').map(s => s.trim()).filter(Boolean)
                : undefined,
            })
            break

          // 企业微信/飞书/钉钉 — 暂不支持，跳过
          default:
            this.log('info', `Adapter for ${ch.platform} not implemented yet, skipping`)
            continue
        }

        if (adapter) {
          this.registerAdapter(adapter)
          this.log('info', `Loaded adapter: ${ch.name} (${ch.platform})`)
        }
      } catch (err) {
        this.log('error', `Failed to create adapter ${ch.name}: ${err}`)
      }
    }
  }

  /**
   * 启动 Gateway
   */
  async start(): Promise<void> {
    if (this.running) {
      this.log('warn', 'Already running')
      return
    }

    this.log('info', 'Starting...')

    // 先开队列：惰性打开 SQLite（见 ensureQueue 里为什么不在构造函数里开）。
    // 失败会抛到这里，Gateway 不进入 running，调用方把错误报给 UI。
    this.ensureQueue()

    this.startTime = Date.now()

    // 启动会话队列（会先恢复重启前没跑完的消息）
    this.requireRouter().start()

    // Ticket 状态变化 → 抛给上层（ipc 会转成 webContents.send 给渲染层）。
    // 用事件而不是让 UI 轮询：任务阶段变化很频繁，轮询要么迟滞要么浪费。
    const ticketRouter = this.requireTicketRouter()
    ticketRouter.start()
    ticketRouter.onChanged((ticket) => {
      this.emit('ticket-changed', ticket)
    })

    // 启动 WebSocket 服务
    await this.server.start()

    // 启动所有适配器
    for (const [name, adapter] of this.adapters.entries()) {
      try {
        this.log('info', `Starting adapter: ${name}`)
        await adapter.connect()
        this.log('info', `Adapter ${name} started`)
      } catch (err) {
        this.log('error', `Failed to start adapter ${name}: ${err}`)
      }
    }

    this.running = true
    this.log('info', 'Started successfully')
  }

  /**
   * 停止 Gateway
   */
  async stop(): Promise<void> {
    if (!this.running) {
      this.log('warn', 'Not running')
      return
    }

    this.log('info', 'Stopping...')

    // 顺序很重要：先把队列排空，**再**拆传输层。
    // 反过来的话，正在跑的那条消息会在 server.stop()（关掉所有 WS 客户端）
    // 和 adapter.disconnect() 之后才继续执行——它写出去的 sendEvent/sendText
    // 全是静默空操作，handler 正常返回，runner 接着 deleteEffect 把这一行消费掉，
    // 于是这次停止就永久丢掉了消息的尾巴（既没送到、也不会重试）。
    // effectRunner.stop() 只等"已经发起的那一次执行"结束，不会长出新活。
    if (this.effectRunner) await this.effectRunner.stop()

    // 排空之后再丢通道：通道随着这次 stop 一起死了，留着它们只会让
    // stop→start 之后恢复出来的消息拿一条死通道走"看起来正常"的路径（输出静默丢弃、
    // runId 还是过期的），比走会话里会告警的 NullOutputChannel 兜底更糟。
    //
    // TicketRouter 持有自己的一份通道表，同样必须清：不清的话，停止 Gateway 之后
    // 已死适配器还被活着引用，而且下次 IM 消息会命中一条指向旧连接的通道。
    this.sessionRouter?.resetChannels()
    this.ticketRouter?.resetChannels()

    // 停止所有适配器
    for (const [name, adapter] of this.adapters.entries()) {
      try {
        this.log('info', `Stopping adapter: ${name}`)
        await adapter.disconnect()
      } catch (err) {
        this.log('error', `Failed to stop adapter ${name}: ${err}`)
      }
    }

    await this.server.stop()

    // 库（ticketStore）不关：stop → start 是支持的，关掉之后下一次 open 要重来一遍，
    // 而且已关闭的 better-sqlite3 句柄再用就抛错。进程级退出直接随进程释放。

    this.channels.clear()
    this.running = false

    this.log('info', 'Stopped')
  }

  /**
   * 获取运行状态
   */
  get isRunning(): boolean {
    return this.running
  }

  /**
   * 获取健康状态
   */
  getHealth() {
    const adapterStatus: Record<string, boolean> = {}
    for (const [name, adapter] of this.adapters.entries()) {
      adapterStatus[name] = adapter.isConnected
    }

    return {
      status: this.running ? 'healthy' as const : 'unhealthy' as const,
      uptime: this.running ? Date.now() - this.startTime : 0,
      activeSessions: this.sessionRouter?.activeSessionCount ?? 0,
      memoryUsage: process.memoryUsage(),
      clientCount: this.server.clientCount,
      adapters: adapterStatus,
    }
  }

  /**
   * 获取所有适配器
   */
  getAdapters(): BaseAdapter[] {
    return Array.from(this.adapters.values())
  }

  getSessionMappings() {
    return this.sessionRouter?.getAllMappings() ?? []
  }

  private async handleAdapterMessage(adapter: BaseAdapter, msg: IncomingMessage) {
    this.log('info', `Message from ${adapter.name} (user: ${msg.userId}, length: ${msg.content.length})`)

    // sessionId 现在由 Ticket 自己分配（Ticket 才是并发的单位），这里不再调
    // sessionRouter.resolve —— 那会登记一条永远不会有 Ticket 用它的映射，
    // 而渲染层靠 GATEWAY_SESSIONS 拿 platform 标注会话，指向错 id 等于标注丢失。
    const channel = new AdapterChannel(adapter, msg.chatId, msg.messageId)

    // 处理附件：下载图片并转为 FileAttachment[]
    let files: Array<{ name: string; mimeType: string; data: string; size: number; isImage: boolean }> | undefined
    if (msg.attachments && msg.attachments.length > 0) {
      const imageAttachments = msg.attachments.filter(a => a.type === 'image')
      if (imageAttachments.length > 0) {
        const downloaded = await Promise.allSettled(
          imageAttachments.map(att => this.downloadAttachment(adapter, att))
        )
        const results = downloaded
          .filter((r): r is PromiseFulfilledResult<{ name: string; mimeType: string; data: string; size: number; isImage: boolean }> => r.status === 'fulfilled')
          .map(r => r.value)
        if (results.length > 0) files = results

        // 下载失败的记录日志，不阻塞
        downloaded.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.warn(`[Gateway] Attachment download failed:`, r.reason)
            this.log('warn', `Attachment download failed: ${r.reason}`)
          }
        })
      }
    }

    // 走 TicketRouter：一条消息 = 一件活。
    //
    // 不再走 sessionRouter.submit —— 那条路是"每个用户一条串行队列"，
    // 同一个人办两件事时第二件必须等第一件跑完，正是这次要改掉的。
    // sessionId 由 Ticket 分配，建好后回填到 sessionRouter 的映射，供渲染层标注来源平台。
    const tickets = this.requireTicketRouter()
    try {
      const ticket = tickets.dispatch(
        {
          platform: adapter.platform,
          userId: msg.userId,
          chatId: msg.chatId,
          threadKey: deriveThreadKey({
            platform: adapter.platform,
            chatId: msg.chatId,
            topicId: msg.topicId,
            guildId: msg.guildId,
          }),
          text: msg.content,
          // IM 适配器没有会话级目录：显式给项目目录，避免落进 process.cwd()
          cwd: this.config.projectDir,
          files,
          kind: 'human',
        },
        channel,
      )
      // 登记 platform 映射：渲染层靠它把会话标成哪个平台来的。
      this.sessionRouter?.bind(ticket.sessionId, adapter.platform, msg.userId, msg.chatId)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log('error', `Adapter message error: ${errorMsg}`)
      adapter.send(msg.chatId, `❌ Error: ${errorMsg}`)
    }
  }

  private async downloadAttachment(
    adapter: BaseAdapter,
    attachment: { type: string; url?: string; mimeType?: string }
  ): Promise<{ name: string; mimeType: string; data: string; size: number; isImage: boolean }> {
    const url = attachment.url || ''

    // Telegram: telegram:photo:<file_id>
    const telegramPhotoMatch = url.match(/^telegram:photo:(.+)$/)
    if (telegramPhotoMatch) {
      const fileId = telegramPhotoMatch[1]
      if (!('downloadPhoto' in adapter) || typeof (adapter as any).downloadPhoto !== 'function') {
        throw new Error(`Adapter ${adapter.name} does not support downloadPhoto`)
      }
      const buffer = await (adapter as any).downloadPhoto(fileId)
      return {
        name: `photo_${fileId}.jpg`,
        mimeType: attachment.mimeType || 'image/jpeg',
        data: buffer.toString('base64'),
        size: buffer.length,
        isImage: true,
      }
    }

    // HTTP(S) URL (Discord, etc.)
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
      const arrayBuffer = await res.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const filename = url.split('/').pop()?.split('?')[0] || 'image.jpg'
      return {
        name: filename,
        mimeType: attachment.mimeType || 'image/jpeg',
        data: buffer.toString('base64'),
        size: buffer.length,
        isImage: true,
      }
    }

    throw new Error(`Unsupported attachment URL scheme: ${url}`)
  }

  private handleDisconnect(clientId: string) {
    // 清理该客户端的所有 channel 引用
    this.channels.delete(clientId)
    this.log('info', `Cleaned up channels for client: ${clientId}`)
  }

  private async handleMessage(client: WSClient, request: GatewayRequest): Promise<void> {
    const { id, method } = request

    try {
      switch (method) {
        case 'agent':
          await this.handleAgent(client, request as any)
          break

        case 'sessions.list':
          await this.handleSessionList(client, id)
          break

        case 'sessions.delete':
          await this.handleSessionDelete(client, request as any, id)
          break

        case 'config.set':
          await this.handleConfigSet(client, request as any, id)
          break

        case 'config.get':
          await this.handleConfigGet(client, id)
          break

        case 'cancel':
          await this.handleCancel(client, request as any, id)
          break

        case 'health':
          await this.handleHealth(client, id)
          break

        default:
          this.server.sendResponse(client.id, createResponse(id, false, undefined, `Unknown method: ${method}`))
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log('error', `Handler error (${method}): ${errorMsg}`)
      this.server.sendResponse(client.id, createResponse(id, false, undefined, errorMsg))
    }
  }

  private async handleAgent(client: WSClient, request: { id: string; params: { sessionId?: string; message: string; files?: any[]; idempotencyKey?: string } }) {
    const { id, params } = request

    // 校验请求体
    if (!params.message || typeof params.message !== 'string') {
      this.server.sendResponse(client.id, createResponse(id, false, undefined, 'Invalid request: message is required and must be a string'))
      return
    }

    // 校验消息长度
    if (params.message.length > 100_000) {
      this.server.sendResponse(client.id, createResponse(id, false, undefined, 'Invalid request: message too long (max 100,000 characters)'))
      return
    }

    // 校验文件
    if (params.files) {
      if (!Array.isArray(params.files)) {
        this.server.sendResponse(client.id, createResponse(id, false, undefined, 'Invalid request: files must be an array'))
        return
      }

      for (const file of params.files) {
        if (!file.name || !file.mimeType || !file.data) {
          this.server.sendResponse(client.id, createResponse(id, false, undefined, 'Invalid request: each file must have name, mimeType, and data'))
          return
        }

        // 校验文件大小（base64 编码后约 10MB）
        if (file.data.length > 13_000_000) {
          this.server.sendResponse(client.id, createResponse(id, false, undefined, 'Invalid request: file too large (max ~10MB)'))
          return
        }
      }
    }

    // 时间戳校验（防重放攻击，允许 30 秒误差）
    if (params.timestamp) {
      const now = Date.now()
      const diff = Math.abs(now - params.timestamp)
      if (diff > 30_000) {
        this.server.sendResponse(client.id, createResponse(id, false, undefined, 'Invalid request: timestamp expired (max 30 seconds)'))
        return
      }
    }

    // 解析或创建会话
    // Gateway 模式下，使用 client.deviceId 或 client.id 作为用户标识
    const userId = client.deviceId || client.id
    const chatId = `gateway:${client.id}`
    const router = this.requireRouter()
    const sessionId = params.sessionId || router.resolve('gateway', userId, chatId)

    // 创建 WebSocketChannel
    const channel = new WebSocketChannel(this.server, client.id, sessionId)

    // 存储 channel 引用
    if (!this.channels.has(client.id)) {
      this.channels.set(client.id, new Map())
    }
    this.channels.get(client.id)!.set(sessionId, channel)

    const runId = randomUUID()
    channel.setRunId(runId)

    // **先落盘，再回 accepted。** 顺序反过来的话，在这两步之间被 kill -9 掉，
    // 客户端已经被告知"消息受理了"，库里却没有这条消息 —— 消息就这么没了，
    // 而这正是整个持久化队列要解决的问题。enqueueEffect 是同步 SQLite 写，
    // 抛错则说明没写进去：这时必须回错误，绝不能回 accepted。
    try {
      // cwd 传 undefined：WS 协议（AgentRequestSchema.params）目前不携带会话级目录，
      // 这里确实没有。undefined 由 AgentCore 的 resolveCwd 回落到项目目录——正确默认。
      // （给协议加上 cwd 让它能真正带过来，是记录在案的后续项。）
      await router.submit(sessionId, params.message, channel, params.files, undefined)
    } catch (err) {
      // 没落盘就绝不能回 accepted。这里只撤掉本会话刚登记的通道引用，
      // 然后原样抛出：handleMessage 的 catch 会用同一个请求 id 回一条 ok:false 的响应。
      const forClient = this.channels.get(client.id)
      if (forClient) {
        forClient.delete(sessionId)
        if (forClient.size === 0) this.channels.delete(client.id)
      }
      throw err
    }

    // 已持久化，才可以回接受响应
    this.server.sendResponse(id, createResponse(id, true, {
      runId,
      sessionId,
      status: 'accepted',
    }))

    // 发送生命周期事件：started
    this.server.sendEvent(client.id, createEvent('lifecycle', sessionId, {
      state: 'started',
    }))
  }

  private async handleSessionList(client: WSClient, requestId: string) {
    // 只返回该客户端关联的会话
    const allSessions = await this.agentCore.listSessions()
    const clientSessions = allSessions.filter(session => {
      // 检查该会话是否与当前客户端关联
      const mappings = this.getSessionMappings()
      return mappings.some(m => m.sessionId === session.sessionId && m.platform === 'gateway' && m.userId === (client.deviceId || client.id))
    })
    this.server.sendResponse(client.id, createResponse(requestId, true, clientSessions))
  }

  private async handleSessionDelete(client: WSClient, request: { params: { sessionId: string } }, requestId: string) {
    // 检查该会话是否属于当前客户端
    const mappings = this.getSessionMappings()
    const sessionMapping = mappings.find(m => m.sessionId === request.params.sessionId)

    if (!sessionMapping || sessionMapping.userId !== (client.deviceId || client.id)) {
      this.server.sendResponse(client.id, createResponse(requestId, false, undefined, 'Permission denied: session does not belong to this client'))
      return
    }

    await this.agentCore.deleteSession(request.params.sessionId)
    this.server.sendResponse(client.id, createResponse(requestId, true))
  }

  private async handleConfigSet(client: WSClient, request: { params: { model?: string; provider?: string; effort?: string; permissionMode?: string; sessionId?: string } }, requestId: string) {
    const { params } = request

    // 带了 sessionId 就只改该会话（不污染其他客户端共用的全局配置）；没带则保持旧行为
    // 改全局。sessionId 由 ConfigSetRequestSchema 透传（早期协议里没有这个字段，zod 会
    // 静默剥掉，导致这里永远拿到 undefined、外部 agent 一律改到全局 —— 已修）。
    if (params.model) this.agentCore.setModel(params.model, params.sessionId)
    if (params.provider) this.agentCore.setProvider(params.provider, params.sessionId)
    if (params.effort) this.agentCore.setEffort(params.effort as any, params.sessionId)

    // 禁止通过 Gateway 修改 permissionMode（防止提权）
    // permissionMode 只能通过 Electron UI 或配置文件修改
    if (params.permissionMode) {
      this.log('warn', `Client ${client.id} attempted to set permissionMode (blocked)`)
    }

    this.server.sendResponse(client.id, createResponse(requestId, true))
  }

  private async handleConfigGet(client: WSClient, requestId: string) {
    const config = this.agentCore.getConfig()
    const settings = this.agentCore.getSettings()

    // 过滤敏感信息，不返回 token/key
    const safeSettings = {
      model: settings.model,
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      cwd: settings.cwd,
      // 不返回 providers 中的 authToken
      providers: Object.fromEntries(
        Object.entries(settings.providers || {}).map(([id, provider]) => [
          id,
          {
            type: provider.type,
            baseURL: provider.baseURL,
            models: provider.models,
            // authToken: '[REDACTED]'
          },
        ])
      ),
    }

    this.server.sendResponse(client.id, createResponse(requestId, true, { config, settings: safeSettings }))
  }

  private async handleCancel(client: WSClient, request: { params?: { sessionId?: string } }, requestId: string) {
    const sessionId = request.params?.sessionId
    if (sessionId) {
      this.requireRouter().cancel(sessionId)
    } else {
      // 无 sessionId 时取消所有会话（向后兼容）
      this.agentCore.cancel()
    }
    this.server.sendResponse(client.id, createResponse(requestId, true))
  }

  private async handleHealth(client: WSClient, requestId: string) {
    const health = this.getHealth()
    this.server.sendResponse(client.id, createResponse(requestId, true, health))
  }
}
