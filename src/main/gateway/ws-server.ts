/**
 * WebSocket 服务
 *
 * 职责：
 * - 管理 WebSocket 连接
 * - 帧解析和校验（Zod）
 * - 连接认证
 * - 消息路由到 Gateway
 */

import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import { MessageSchema, createResponse, createEvent } from './protocol'
import type { GatewayRequest, GatewayResponse, GatewayEvent } from './protocol'

export interface WSClient {
  id: string
  ws: WebSocket
  role: 'client' | 'node'
  deviceId?: string
  connectedAt: number
}

export interface WSServerConfig {
  port: number
  auth?: {
    mode: 'token' | 'none'
    secret?: string
  }
}

export type MessageHandler = (client: WSClient, request: GatewayRequest) => Promise<void>

export class GatewayWSServer {
  private wss: WebSocketServer | null = null
  private clients = new Map<string, WSClient>()
  private messageHandler: MessageHandler | null = null
  private seqCounter = 0

  constructor(private config: WSServerConfig) {}

  /**
   * 启动 WebSocket 服务
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: this.config.port,
        host: '127.0.0.1', // 只监听本地
      })

      this.wss.on('listening', () => {
        console.log(`[GatewayWS] Listening on 127.0.0.1:${this.config.port}`)
        resolve()
      })

      this.wss.on('error', (err) => {
        console.error('[GatewayWS] Server error:', err)
        reject(err)
      })

      this.wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req)
      })
    })
  }

  /**
   * 停止 WebSocket 服务
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve()
        return
      }

      // 关闭所有客户端连接
      for (const client of this.clients.values()) {
        client.ws.close(1000, 'Gateway shutting down')
      }
      this.clients.clear()

      this.wss.close(() => {
        console.log('[GatewayWS] Server stopped')
        this.wss = null
        resolve()
      })
    })
  }

  /**
   * 设置消息处理器
   */
  onMessage(handler: MessageHandler) {
    this.messageHandler = handler
  }

  /**
   * 发送响应给客户端
   */
  sendResponse(clientId: string, response: GatewayResponse) {
    const client = this.clients.get(clientId)
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(response))
    }
  }

  /**
   * 发送事件给客户端
   */
  sendEvent(clientId: string, event: GatewayEvent) {
    const client = this.clients.get(clientId)
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(event))
    }
  }

  /**
   * 广播事件给所有客户端
   */
  broadcastEvent(event: GatewayEvent) {
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(event))
      }
    }
  }

  /**
   * 获取连接数
   */
  get clientCount(): number {
    return this.clients.size
  }

  /**
   * 获取所有客户端
   */
  getClients(): WSClient[] {
    return Array.from(this.clients.values())
  }

  /**
   * 生成下一个序列号
   */
  nextSeq(): number {
    return ++this.seqCounter
  }

  private handleConnection(ws: WebSocket, req: any) {
    const clientId = randomUUID()
    const client: WSClient = {
      id: clientId,
      ws,
      role: 'client',
      connectedAt: Date.now(),
    }

    console.log(`[GatewayWS] Client connected: ${clientId}`)

    // 设置超时：10 秒内必须完成 connect 握手
    const handshakeTimeout = setTimeout(() => {
      if (!this.clients.has(clientId)) {
        ws.close(4001, 'Handshake timeout')
      }
    }, 10000)

    ws.on('message', (data) => {
      try {
        const raw = JSON.parse(data.toString())

        // 第一个帧必须是 connect
        if (!this.clients.has(clientId)) {
          if (raw.method !== 'connect') {
            ws.close(4002, 'First frame must be connect')
            return
          }

          // 认证检查
          if (this.config.auth?.mode === 'token') {
            const token = raw.params?.auth?.token
            if (token !== this.config.auth.secret) {
              ws.close(4003, 'Authentication failed')
              return
            }
          }

          // 注册客户端
          clearTimeout(handshakeTimeout)
          client.role = raw.params?.role || 'client'
          client.deviceId = raw.params?.deviceId
          this.clients.set(clientId, client)

          // 发送连接成功响应
          this.sendResponse(clientId, createResponse(raw.id, true, {
            sessionId: clientId,
            features: {
              methods: ['agent', 'sessions.list', 'sessions.delete', 'config.set', 'config.get', 'cancel', 'health'],
              events: ['stream', 'tool', 'lifecycle', 'error'],
            },
          }))

          console.log(`[GatewayWS] Client authenticated: ${clientId} (role: ${client.role})`)
          return
        }

        // 解析和校验消息
        const parsed = MessageSchema.safeParse(raw)
        if (!parsed.success) {
          this.sendResponse(clientId, createResponse(
            raw.id || 'unknown',
            false,
            undefined,
            `Invalid message: ${parsed.error.message}`
          ))
          return
        }

        // 路由到处理器
        if (this.messageHandler && parsed.data.type === 'req') {
          this.messageHandler(client, parsed.data as GatewayRequest).catch((err) => {
            console.error('[GatewayWS] Message handler error:', err)
            this.sendResponse(clientId, createResponse(
              raw.id,
              false,
              undefined,
              err.message || 'Internal error'
            ))
          })
        }
      } catch (err) {
        console.error('[GatewayWS] Message parse error:', err)
        this.sendResponse(clientId, createResponse(
          'unknown',
          false,
          undefined,
          'Invalid JSON'
        ))
      }
    })

    ws.on('close', (code, reason) => {
      clearTimeout(handshakeTimeout)
      this.clients.delete(clientId)
      console.log(`[GatewayWS] Client disconnected: ${clientId} (code: ${code})`)
    })

    ws.on('error', (err) => {
      console.error(`[GatewayWS] Client error ${clientId}:`, err)
    })
  }
}
