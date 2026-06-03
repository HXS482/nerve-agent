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
import { createResponse, createEvent } from './protocol'
import type { WSClient } from './ws-server'
import type { GatewayRequest, IncomingMessage } from './protocol'

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
    console.log(`[Gateway] Message from ${adapter.name}: ${msg.content.slice(0, 50)}...`)

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
    const sessions = await this.agentCore.listSessions()
    this.server.sendResponse(client.id, createResponse(requestId, true, sessions))
  }

  private async handleSessionDelete(client: WSClient, request: { params: { sessionId: string } }, requestId: string) {
    await this.agentCore.deleteSession(request.params.sessionId)
    this.server.sendResponse(client.id, createResponse(requestId, true))
  }

  private async handleConfigSet(client: WSClient, request: { params: { model?: string; provider?: string; effort?: string; permissionMode?: string } }, requestId: string) {
    const { params } = request
    if (params.model) this.agentCore.setModel(params.model)
    if (params.provider) this.agentCore.setProvider(params.provider)
    if (params.effort) this.agentCore.setEffort(params.effort as any)
    if (params.permissionMode) this.agentCore.setPermissionMode(params.permissionMode as any)
    this.server.sendResponse(client.id, createResponse(requestId, true))
  }

  private async handleConfigGet(client: WSClient, requestId: string) {
    const config = this.agentCore.getConfig()
    const settings = this.agentCore.getSettings()
    this.server.sendResponse(client.id, createResponse(requestId, true, { config, settings }))
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
