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
import { GatewayWSServer } from './ws-server'
import { SessionRouter } from './session-router'
import { WebSocketChannel } from './ws-channel'
import { AdapterChannel } from './adapter-channel'
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
  private sessionRouter: SessionRouter
  private agentCore: AgentCore
  private adapters = new Map<string, BaseAdapter>()
  private startTime: number = 0
  private running = false
  private proxy: GatewayProxy | null = null

  // clientId → sessionId → WebSocketChannel
  private channels = new Map<string, Map<string, WebSocketChannel>>()

  constructor(private config: GatewayConfig) {
    super()
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
      host: config.host,
      auth: config.auth,
    })

    // 设置消息处理器
    this.server.onMessage(this.handleMessage.bind(this))

    // 设置断开连接处理器（清理 channels Map）
    this.server.onDisconnect(this.handleDisconnect.bind(this))
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
    this.startTime = Date.now()

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

  getSessionMappings() {
    return this.sessionRouter.getAllMappings()
  }

  private async handleAdapterMessage(adapter: BaseAdapter, msg: IncomingMessage) {
    this.log('info', `Message from ${adapter.name} (user: ${msg.userId}, length: ${msg.content.length})`)

    const sessionId = this.sessionRouter.resolve(adapter.platform, msg.userId, msg.chatId)
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

    this.sessionRouter.submit(sessionId, msg.content, channel, files).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log('error', `Adapter message error: ${errorMsg}`)
      adapter.send(msg.chatId, `❌ Error: ${errorMsg}`)
    })
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
      this.log('error', `Agent error: ${errorMsg}`)
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
      this.sessionRouter.cancel(sessionId)
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
