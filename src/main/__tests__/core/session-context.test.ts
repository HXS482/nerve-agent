/**
 * SessionContext 测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SessionContextManager, createSessionContext } from '../../core/session-context'

describe('SessionContext', () => {
  describe('createSessionContext', () => {
    it('should create a new session context', () => {
      const ctx = createSessionContext('session-1')

      expect(ctx.sessionId).toBe('session-1')
      expect(ctx.abort).toBeDefined()
      expect(ctx.abort.signal.aborted).toBe(false)
      expect(ctx.config).toEqual({})
      expect(ctx.pendingToolCalls.size).toBe(0)
      expect(ctx.pendingApprovals.size).toBe(0)
      expect(ctx.createdAt).toBeGreaterThan(0)
      expect(ctx.lastActiveAt).toBeGreaterThan(0)
    })

    it('should create session context with config', () => {
      const config = { model: 'opus', effort: 'high' as const }
      const ctx = createSessionContext('session-2', config)

      expect(ctx.config).toEqual(config)
    })
  })

  describe('SessionContextManager', () => {
    let manager: SessionContextManager

    beforeEach(() => {
      manager = new SessionContextManager()
    })

    it('should create and retrieve session context', () => {
      const ctx = manager.getOrCreate('session-1')

      expect(ctx.sessionId).toBe('session-1')
      expect(manager.get('session-1')).toBe(ctx)
    })

    it('should return existing session context', () => {
      const ctx1 = manager.getOrCreate('session-1')
      const ctx2 = manager.getOrCreate('session-1')

      expect(ctx1).toBe(ctx2)
    })

    it('should update lastActiveAt on getOrCreate', () => {
      const ctx = manager.getOrCreate('session-1')
      const initialLastActive = ctx.lastActiveAt

      // Wait a bit
      const newCtx = manager.getOrCreate('session-1')
      expect(newCtx.lastActiveAt).toBeGreaterThanOrEqual(initialLastActive)
    })

    it('should cancel session', () => {
      const ctx = manager.getOrCreate('session-1')
      expect(ctx.abort.signal.aborted).toBe(false)

      manager.cancel('session-1')
      expect(ctx.abort.signal.aborted).toBe(true)
    })

    it('should delete session', () => {
      manager.getOrCreate('session-1')
      expect(manager.size).toBe(1)

      manager.delete('session-1')
      expect(manager.size).toBe(0)
      expect(manager.get('session-1')).toBeUndefined()
    })

    it('should return correct size', () => {
      expect(manager.size).toBe(0)

      manager.getOrCreate('session-1')
      expect(manager.size).toBe(1)

      manager.getOrCreate('session-2')
      expect(manager.size).toBe(2)

      manager.delete('session-1')
      expect(manager.size).toBe(1)
    })

    it('should return all session IDs', () => {
      manager.getOrCreate('session-1')
      manager.getOrCreate('session-2')
      manager.getOrCreate('session-3')

      const ids = manager.getSessionIds()
      expect(ids).toHaveLength(3)
      expect(ids).toContain('session-1')
      expect(ids).toContain('session-2')
      expect(ids).toContain('session-3')
    })

    it('should cleanup expired sessions', () => {
      const ctx = manager.getOrCreate('session-1')
      ctx.lastActiveAt = Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago

      manager.getOrCreate('session-2') // recent

      const cleaned = manager.cleanup(60 * 60 * 1000) // 1 hour max age
      expect(cleaned).toBe(1)
      expect(manager.size).toBe(1)
      expect(manager.get('session-1')).toBeUndefined()
      expect(manager.get('session-2')).toBeDefined()
    })

    it('should return false for non-existent session cancel', () => {
      const result = manager.cancel('non-existent')
      expect(result).toBe(false)
    })

    it('should return false for non-existent session delete', () => {
      const result = manager.delete('non-existent')
      expect(result).toBe(false)
    })
  })
})
