/**
 * SessionContext — 会话级状态隔离
 *
 * 解决 AgentCore 单例不支持多 session 并发的问题
 * 每个 session 拥有独立的 AbortController / pendingToolCalls / config
 */

import type { ClaudeConfig } from '../../shared/types'

export interface SessionContext {
  /** 会话 ID */
  sessionId: string
  /** 会话级 AbortController */
  abort: AbortController
  /** 会话级配置（可覆盖全局配置） */
  config: Partial<ClaudeConfig>
  /** 会话级待处理工具调用 */
  pendingToolCalls: Map<string, { name: string; input: any }>
  /** 会话级待处理审批 */
  pendingApprovals: Map<string, { resolve: (approved: boolean) => void }>
  /** 创建时间 */
  createdAt: number
  /** 最后活跃时间 */
  lastActiveAt: number
}

/**
 * 创建新的会话上下文
 */
export function createSessionContext(sessionId: string, config?: Partial<ClaudeConfig>): SessionContext {
  return {
    sessionId,
    abort: new AbortController(),
    config: config || {},
    pendingToolCalls: new Map(),
    pendingApprovals: new Map(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  }
}

/**
 * 会话上下文管理器
 */
export class SessionContextManager {
  private contexts = new Map<string, SessionContext>()

  /**
   * 获取或创建会话上下文
   */
  getOrCreate(sessionId: string, config?: Partial<ClaudeConfig>): SessionContext {
    if (!this.contexts.has(sessionId)) {
      this.contexts.set(sessionId, createSessionContext(sessionId, config))
    }
    const ctx = this.contexts.get(sessionId)!
    ctx.lastActiveAt = Date.now()
    return ctx
  }

  /**
   * 获取会话上下文
   */
  get(sessionId: string): SessionContext | undefined {
    return this.contexts.get(sessionId)
  }

  /**
   * 取消指定会话
   */
  cancel(sessionId: string): boolean {
    const ctx = this.contexts.get(sessionId)
    if (!ctx) return false

    ctx.abort.abort()
    ctx.pendingToolCalls.clear()
    for (const [, p] of ctx.pendingApprovals) p.resolve(false)
    ctx.pendingApprovals.clear()

    return true
  }

  /**
   * 删除会话上下文
   */
  delete(sessionId: string): boolean {
    this.cancel(sessionId)
    return this.contexts.delete(sessionId)
  }

  /**
   * 清理过期会话（默认 1 小时过期）
   */
  cleanup(maxAgeMs: number = 60 * 60 * 1000): number {
    const now = Date.now()
    let cleaned = 0

    for (const [sessionId, ctx] of this.contexts.entries()) {
      if (now - ctx.lastActiveAt > maxAgeMs) {
        this.contexts.delete(sessionId)
        cleaned++
      }
    }

    return cleaned
  }

  /**
   * 获取活跃会话数
   */
  get size(): number {
    return this.contexts.size
  }

  /**
   * 获取所有会话 ID
   */
  getSessionIds(): string[] {
    return Array.from(this.contexts.keys())
  }
}
