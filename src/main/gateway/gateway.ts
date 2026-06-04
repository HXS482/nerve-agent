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
import { GatewayWSServer } from './ws-server'
import { SessionRouter } from './session-router'
import { WebSocketChannel } from './ws-channel'
import { AgentCore } from '../core/agent-core'
import { BaseAdapter } from './adapters/base-adapter'
import { TelegramAdapter } from './adapters/telegram'
import { DiscordAdapter } from './adapters/discord'
import { createResponse, createEvent } from './protocol'
import type { WSClient } from './ws-server'
import type { GatewayRequest, IncomingMessage } from './protocol'
import type { GatewayChannel, GatewayProxy } from '../../shared/types'

export interface GatewayConfig {
  port: number
  auth?: {
    mode: 'token' | 'none'
    secret?: string
  }
  dataDir: string
  projectDir: string
  sourceDir: string
}

export class NerveGateway {
  private server: GatewayWSServer
  private sessionRouter: SessionRouter
  private agentCore: AgentCore
  private adapters = new Map<string, BaseAdapter>()
  private startTime: number = 0
  private running = false
  private proxy: GatewayProxy | null = null

  // clientId → sessionId → WebSocketChannel
  private channels = new Map<string, Map<string, WebSocketChannel>>()

  constructor(private config: GatewayConfig) {
    // 创建 AgentCore
    this.agentCore = new AgentCore({
      projectDir: config.projectDir,
      sourceDir: config.sourceDir,
    })

    // 创建会话路由器
    this.sessionRouter = new SessionRouter(this.agentCore, config.dataDir)

    // 创建 WebSocket 服务
    this.server = new GatewayWSServer({
      port: config.port,
      auth: config.auth,
    })

    // 设置消息处理器
    this.server.onMessage(this.handleMessage.bind(this))

    // 设置断开连接处理器（清理 channels Map）
    this.server.onDisconnect(this.handleDisconnect.bind(this))
  }

  /**
   * 注册 IM 适配器
   */
  registerAdapter(adapter: BaseAdapter) {
    const name = adapter.name
    console.log(`[Gateway] Registering adapter: ${name}`)

    // 监听消息
    adapter.on('message', (msg: IncomingMessage) => {
      this.handleAdapterMessage(adapter, msg)
    })

    this.adapters.set(name, adapter)
  }

  /**
   * 设置代理
   * 设置 HTTPS_PROXY / HTTP_PROXY 环境变量，影响所有适配器的网络请求
   */
  setProxy(proxy: GatewayProxy | null): void {
    this.proxy = proxy
    if (proxy && proxy.enabled && proxy.host && proxy.port) {
      const url = `${proxy.protocol}://${proxy.host}:${proxy.port}`
      process.env.HTTPS_PROXY = url
      process.env.HTTP_PROXY = url
      console.log(`[Gateway] Proxy set: ${url}`)
    } else {
      delete process.env.HTTPS_PROXY
      delete process.env.HTTP_PROXY
      console.log('[Gateway] Proxy disabled')
    }
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
        console.error(`[Gateway] Failed to disconnect adapter ${name}:`, err)
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
            console.log(`[Gateway] Adapter for ${ch.platform} not implemented yet, skipping`)
            continue
        }

        if (adapter) {
          this.registerAdapter(adapter)
          console.log(`[Gateway] Loaded adapter: ${ch.name} (${ch.platform})`)
        }
      } catch (err) {
        console.error(`[Gateway] Failed to create adapter ${ch.name}:`, err)
      }
    }
  }

  /**
   * 启动 Gateway
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn('[Gateway] Already running')
      return
    }

    console.log('[Gateway] Starting...')
    this.startTime = Date.now()

    // 启动 WebSocket 服务
    await this.server.start()

    // 启动所有适配器
    for (const [name, adapter] of this.adapters.entries()) {
      try {
        console.log(`[Gateway] Starting adapter: ${name}`)
        await adapter.connect()
        console.log(`[Gateway] Adapter ${name} started`)
      } catch (err) {
        console.error(`[Gateway] Failed to start adapter ${name}:`, err)
      }
    }

    this.running = true
    console.log('[Gateway] Started successfully')
  }

  /**
   * 停止 Gateway
   */
  async stop(): Promise<void> {
    if (!this.running) {
      console.warn('[Gateway] Not running')
      return
    }

    console.log('[Gateway] Stopping...')

    // 停止所有适配器
    for (const [name, adapter] of this.adapters.entries()) {
      try {
        console.log(`[Gateway] Stopping adapter: ${name}`)
        await adapter.disconnect()
      } catch (err) {
        console.error(`[Gateway] Failed to stop adapter ${name}:`, err)
      }
    }

    await this.server.stop()
    this.channels.clear()
    this.running = false

    console.log('[Gateway] Stopped')
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
      activeSessions: this.sessionRouter.activeSessionCount,
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

  private async handleAdapterMessage(adapter: BaseAdapter, msg: IncomingMessage) {
    // 不记录消息内容（隐私保护）
    console.log(`[Gateway] Message from ${adapter.name} (user: ${msg.userId}, length: ${msg.content.length})`)

    // 解析或创建会话
    const sessionId = this.sessionRouter.resolve(adapter.platform, msg.userId, msg.chatId)

    // 创建适配器输出通道
    const channel = new AdapterChannel(adapter, msg.chatId, msg.messageId)

    // 提交到会话队列
    this.sessionRouter.submit(sessionId, msg.content, channel).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`[Gateway] Adapter message error:`, errorMsg)
      adapter.send(msg.chatId, `❌ Error: ${errorMsg}`)
    })
  }

  private handleDisconnect(clientId: string) {
    // 清理该客户端的所有 channel 引用
    this.channels.delete(clientId)
    console.log(`[Gateway] Cleaned up channels for client: ${clientId}`)
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
      console.error(`[Gateway] Handler error (${method}):`, errorMsg)
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
    const sessionId = params.sessionId || this.sessionRouter.resolve('gateway', userId, chatId)

    // 创建 WebSocketChannel
    const channel = new WebSocketChannel(this.server, client.id, sessionId)

    // 存储 channel 引用
    if (!this.channels.has(client.id)) {
      this.channels.set(client.id, new Map())
    }
    this.channels.get(client.id)!.set(sessionId, channel)

    // 发送接受响应
    const runId = randomUUID()
    channel.setRunId(runId)
    this.server.sendResponse(id, createResponse(id, true, {
      runId,
      sessionId,
      status: 'accepted',
    }))

    // 发送生命周期事件：started
    this.server.sendEvent(client.id, createEvent('lifecycle', sessionId, {
      state: 'started',
    }))

    // 提交到会话队列（串行处理）
    this.sessionRouter.submit(sessionId, params.message, channel, params.files).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[Gateway] Agent error:', errorMsg)
      channel.sendError(errorMsg)
    })
  }

  private async handleSessionList(client: WSClient, requestId: string) {
    // 只返回该客户端关联的会话
    const allSessions = await this.agentCore.listSessions()
    const clientSessions = allSessions.filter(session => {
      // 检查该会话是否与当前客户端关联
      const mappings = this.sessionRouter.getAllMappings()
      return mappings.some(m => m.sessionId === session.sessionId && m.platform === 'gateway' && m.userId === (client.deviceId || client.id))
    })
    this.server.sendResponse(client.id, createResponse(requestId, true, clientSessions))
  }

  private async handleSessionDelete(client: WSClient, request: { params: { sessionId: string } }, requestId: string) {
    // 检查该会话是否属于当前客户端
    const mappings = this.sessionRouter.getAllMappings()
    const sessionMapping = mappings.find(m => m.sessionId === request.params.sessionId)

    if (!sessionMapping || sessionMapping.userId !== (client.deviceId || client.id)) {
      this.server.sendResponse(client.id, createResponse(requestId, false, undefined, 'Permission denied: session does not belong to this client'))
      return
    }

    await this.agentCore.deleteSession(request.params.sessionId)
    this.server.sendResponse(client.id, createResponse(requestId, true))
  }

  private async handleConfigSet(client: WSClient, request: { params: { model?: string; provider?: string; effort?: string; permissionMode?: string } }, requestId: string) {
    const { params } = request

    // 只允许修改安全的配置项
    if (params.model) this.agentCore.setModel(params.model)
    if (params.provider) this.agentCore.setProvider(params.provider)
    if (params.effort) this.agentCore.setEffort(params.effort as any)

    // 禁止通过 Gateway 修改 permissionMode（防止提权）
    // permissionMode 只能通过 Electron UI 或配置文件修改
    if (params.permissionMode) {
      console.warn(`[Gateway] Client ${client.id} attempted to set permissionMode (blocked)`)
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
    this.agentCore.cancel()
    this.server.sendResponse(client.id, createResponse(requestId, true))
  }

  private async handleHealth(client: WSClient, requestId: string) {
    const health = this.getHealth()
    this.server.sendResponse(client.id, createResponse(requestId, true, health))
  }
}
