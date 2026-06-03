/**
 * 会话路由器
 *
 * 职责：
 * - 平台用户ID → Nerve 会话ID 映射
 * - per-session 串行队列（防止并发写入）
 * - 会话状态管理
 */

import { randomUUID } from 'crypto'
import { join } from 'path'
import type { AgentCore } from '../core/agent-core'
import type { OutputChannel } from '../core/output-channel'
import type { SessionContext } from '../core/session-context'

interface SessionMapping {
  sessionId: string
  platform: string
  userId: string
  chatId: string
  createdAt: number
  lastActive: number
}

interface QueuedTask {
  id: string
  sessionId: string
  message: string
  files?: Array<{
    name: string
    mimeType: string
    data: string
    size: number
    isImage: boolean
  }>
  channel: OutputChannel
  resolve: () => void
  reject: (err: Error) => void
}

export class SessionRouter {
  // 平台用户ID → 会话映射
  private mappings = new Map<string, SessionMapping>()

  // sessionId → 任务队列
  private queues = new Map<string, QueuedTask[]>()

  // sessionId → 是否正在处理
  private processing = new Set<string>()

  // 持久化文件路径
  private mappingsPath: string

  constructor(private agentCore: AgentCore, dataDir: string) {
    this.mappingsPath = join(dataDir, 'gateway-sessions.json')
    this.loadMappings()
  }

  /**
   * 解析或创建会话
   */
  resolve(platform: string, userId: string, chatId: string): string {
    const key = `${platform}:${userId}`

    if (!this.mappings.has(key)) {
      const sessionId = randomUUID()
      this.mappings.set(key, {
        sessionId,
        platform,
        userId,
        chatId,
        createdAt: Date.now(),
        lastActive: Date.now(),
      })
      this.saveMappings()
    }

    const mapping = this.mappings.get(key)!
    mapping.lastActive = Date.now()
    return mapping.sessionId
  }

  /**
   * 获取会话映射
   */
  getMapping(platform: string, userId: string): SessionMapping | undefined {
    return this.mappings.get(`${platform}:${userId}`)
  }

  /**
   * 提交任务到会话队列
   */
  async submit(
    sessionId: string,
    message: string,
    channel: OutputChannel,
    files?: Array<{ name: string; mimeType: string; data: string; size: number; isImage: boolean }>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const task: QueuedTask = {
        id: randomUUID(),
        sessionId,
        message,
        files,
        channel,
        resolve,
        reject,
      }

      if (!this.queues.has(sessionId)) {
        this.queues.set(sessionId, [])
      }

      this.queues.get(sessionId)!.push(task)

      // 尝试处理队列
      this.processQueue(sessionId)
    })
  }

  /**
   * 取消指定 session 的当前任务
   */
  cancel(sessionId: string) {
    // 清空该 session 的队列
    const queue = this.queues.get(sessionId)
    if (queue) {
      // 拒绝所有排队的任务
      for (const task of queue) {
        task.reject(new Error('Cancelled'))
      }
      queue.length = 0
    }

    // 如果该 session 正在处理，取消 AgentCore
    // 注意：这会取消所有正在进行的任务，因为 AgentCore 是单例
    // TODO: P0-1 修复后，这里应该只取消特定 session 的任务
    if (this.processing.has(sessionId)) {
      this.agentCore.cancel()
    }
  }

  /**
   * 获取活跃会话数
   */
  get activeSessionCount(): number {
    return this.processing.size
  }

  /**
   * 获取所有会话映射
   */
  getAllMappings(): SessionMapping[] {
    return Array.from(this.mappings.values())
  }

  /**
   * 删除会话映射
   */
  deleteMapping(platform: string, userId: string) {
    const key = `${platform}:${userId}`
    this.mappings.delete(key)
    this.saveMappings()
  }

  /**
   * 清理过期会话（超过 7 天未活跃）
   */
  cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000) {
    const now = Date.now()
    for (const [key, mapping] of this.mappings.entries()) {
      if (now - mapping.lastActive > maxAgeMs) {
        this.mappings.delete(key)
      }
    }
    this.saveMappings()
  }

  private async processQueue(sessionId: string) {
    // 如果正在处理，跳过
    if (this.processing.has(sessionId)) return

    const queue = this.queues.get(sessionId)
    if (!queue || queue.length === 0) return

    // 标记为正在处理
    this.processing.add(sessionId)

    // 获取或创建会话上下文（用于多 session 并发隔离）
    const sessionContextManager = this.agentCore.getSessionContextManager()
    const ctx = sessionContextManager.getOrCreate(sessionId)

    while (queue.length > 0) {
      const task = queue.shift()!

      try {
        await this.agentCore.sendMessage(
          {
            prompt: task.message,
            sessionId: task.sessionId,
            files: task.files,
          },
          task.channel,
          ctx,  // 传递会话上下文
        )
        task.resolve()
      } catch (err) {
        task.reject(err instanceof Error ? err : new Error(String(err)))
      }
    }

    // 标记为处理完成
    this.processing.delete(sessionId)
  }

  private loadMappings() {
    try {
      const { existsSync, readFileSync } = require('fs')
      if (existsSync(this.mappingsPath)) {
        const data = JSON.parse(readFileSync(this.mappingsPath, 'utf-8'))
        for (const [key, value] of Object.entries(data)) {
          this.mappings.set(key, value as SessionMapping)
        }
        console.log(`[SessionRouter] Loaded ${this.mappings.size} session mappings`)
      }
    } catch (err) {
      console.warn('[SessionRouter] Failed to load mappings:', err)
    }
  }

  private saveMappings() {
    try {
      const { writeFileSync } = require('fs')
      const data: Record<string, SessionMapping> = {}
      for (const [key, value] of this.mappings.entries()) {
        data[key] = value
      }
      writeFileSync(this.mappingsPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[SessionRouter] Failed to save mappings:', err)
    }
  }
}
