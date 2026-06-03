/**
 * Gateway 协议测试
 */

import { describe, it, expect } from 'vitest'
import {
  ConnectRequestSchema,
  AgentRequestSchema,
  HealthRequestSchema,
  StreamEventSchema,
  createResponse,
  createEvent,
} from '../../gateway/protocol'

describe('Gateway Protocol', () => {
  describe('ConnectRequestSchema', () => {
    it('should validate valid connect request', () => {
      const request = {
        type: 'req' as const,
        id: 'test-1',
        method: 'connect' as const,
        params: {
          auth: { token: 'test-token' },
          role: 'client' as const,
        },
      }

      const result = ConnectRequestSchema.safeParse(request)
      expect(result.success).toBe(true)
    })

    it('should reject invalid connect request', () => {
      const request = {
        type: 'req',
        id: 'test-1',
        method: 'connect',
        // missing params
      }

      const result = ConnectRequestSchema.safeParse(request)
      expect(result.success).toBe(false)
    })
  })

  describe('AgentRequestSchema', () => {
    it('should validate valid agent request', () => {
      const request = {
        type: 'req' as const,
        id: 'test-2',
        method: 'agent' as const,
        params: {
          message: 'Hello, world!',
        },
      }

      const result = AgentRequestSchema.safeParse(request)
      expect(result.success).toBe(true)
    })

    it('should validate agent request with files', () => {
      const request = {
        type: 'req' as const,
        id: 'test-3',
        method: 'agent' as const,
        params: {
          message: 'Analyze this file',
          files: [
            {
              name: 'test.txt',
              mimeType: 'text/plain',
              data: 'base64data',
              size: 100,
              isImage: false,
            },
          ],
        },
      }

      const result = AgentRequestSchema.safeParse(request)
      expect(result.success).toBe(true)
    })

    it('should validate agent request with timestamp', () => {
      const request = {
        type: 'req' as const,
        id: 'test-4',
        method: 'agent' as const,
        params: {
          message: 'Hello',
          timestamp: Date.now(),
        },
      }

      const result = AgentRequestSchema.safeParse(request)
      expect(result.success).toBe(true)
    })

    it('should reject agent request without message', () => {
      const request = {
        type: 'req',
        id: 'test-5',
        method: 'agent',
        params: {},
      }

      const result = AgentRequestSchema.safeParse(request)
      expect(result.success).toBe(false)
    })
  })

  describe('HealthRequestSchema', () => {
    it('should validate valid health request', () => {
      const request = {
        type: 'req' as const,
        id: 'test-6',
        method: 'health' as const,
      }

      const result = HealthRequestSchema.safeParse(request)
      expect(result.success).toBe(true)
    })
  })

  describe('StreamEventSchema', () => {
    it('should validate valid stream event', () => {
      const event = {
        type: 'event' as const,
        event: 'stream' as const,
        sessionId: 'session-1',
        payload: {
          delta: 'Hello',
        },
      }

      const result = StreamEventSchema.safeParse(event)
      expect(result.success).toBe(true)
    })

    it('should validate stream event with thinking', () => {
      const event = {
        type: 'event' as const,
        event: 'stream' as const,
        sessionId: 'session-1',
        payload: {
          thinking: 'Let me think...',
        },
      }

      const result = StreamEventSchema.safeParse(event)
      expect(result.success).toBe(true)
    })
  })

  describe('Helper functions', () => {
    it('should create response', () => {
      const response = createResponse('test-1', true, { data: 'test' })

      expect(response.type).toBe('res')
      expect(response.id).toBe('test-1')
      expect(response.ok).toBe(true)
      expect((response as any).payload).toEqual({ data: 'test' })
    })

    it('should create error response', () => {
      const response = createResponse('test-2', false, undefined, 'Something went wrong')

      expect(response.type).toBe('res')
      expect(response.id).toBe('test-2')
      expect(response.ok).toBe(false)
      expect((response as any).error).toBe('Something went wrong')
    })

    it('should create event', () => {
      const event = createEvent('stream', 'session-1', { delta: 'Hello' })

      expect(event.type).toBe('event')
      expect(event.event).toBe('stream')
      expect(event.sessionId).toBe('session-1')
      expect((event as any).payload).toEqual({ delta: 'Hello' })
    })
  })
})
