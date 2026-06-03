/**
 * OutputChannel 测试
 */

import { describe, it, expect } from 'vitest'
import {
  NullOutputChannel,
  CollectingOutputChannel,
  isElectronChannel,
} from '../../core/output-channel'

describe('OutputChannel', () => {
  describe('NullOutputChannel', () => {
    it('should implement all methods', () => {
      const channel = new NullOutputChannel()

      expect(channel.isReady()).toBe(true)

      // Should not throw
      channel.sendStreamDelta('test')
      channel.sendThinkingDelta('thinking')
      channel.sendToolCall('id', 'name', {})
      channel.sendToolResult('id', 'content')
      channel.sendDone('session', 0.5, 200000)
      channel.sendError('error')
    })
  })

  describe('CollectingOutputChannel', () => {
    it('should collect stream deltas', () => {
      const channel = new CollectingOutputChannel()

      channel.sendStreamDelta('Hello')
      channel.sendStreamDelta(' ')
      channel.sendStreamDelta('World')

      expect(channel.deltas).toEqual(['Hello', ' ', 'World'])
      expect(channel.fullText).toBe('Hello World')
    })

    it('should collect thinking deltas', () => {
      const channel = new CollectingOutputChannel()

      channel.sendThinkingDelta('Let me think...')
      channel.sendThinkingDelta(' Done.')

      expect(channel.thinkingDeltas).toEqual(['Let me think...', ' Done.'])
      expect(channel.fullThinking).toBe('Let me think... Done.')
    })

    it('should collect tool calls', () => {
      const channel = new CollectingOutputChannel()

      channel.sendToolCall('1', 'Bash', { command: 'ls' })
      channel.sendToolCall('2', 'Read', { path: '/test' })

      expect(channel.toolCalls).toHaveLength(2)
      expect(channel.toolCalls[0]).toEqual({ id: '1', name: 'Bash', input: { command: 'ls' } })
      expect(channel.toolCalls[1]).toEqual({ id: '2', name: 'Read', input: { path: '/test' } })
    })

    it('should collect tool results', () => {
      const channel = new CollectingOutputChannel()

      channel.sendToolResult('1', 'output', false)
      channel.sendToolResult('2', 'error', true)

      expect(channel.toolResults).toHaveLength(2)
      expect(channel.toolResults[0]).toEqual({ id: '1', content: 'output', isError: false })
      expect(channel.toolResults[1]).toEqual({ id: '2', content: 'error', isError: true })
    })

    it('should collect done event', () => {
      const channel = new CollectingOutputChannel()

      channel.sendDone('session-1', 0.5, 200000)

      expect(channel.done).toEqual({
        sessionId: 'session-1',
        cost: 0.5,
        maxContextTokens: 200000,
      })
    })

    it('should collect error', () => {
      const channel = new CollectingOutputChannel()

      channel.sendError('Something went wrong')

      expect(channel.error).toBe('Something went wrong')
    })

    it('should always be ready', () => {
      const channel = new CollectingOutputChannel()
      expect(channel.isReady()).toBe(true)
    })
  })

  describe('isElectronChannel', () => {
    it('should return false for NullOutputChannel', () => {
      const channel = new NullOutputChannel()
      expect(isElectronChannel(channel)).toBe(false)
    })

    it('should return false for CollectingOutputChannel', () => {
      const channel = new CollectingOutputChannel()
      expect(isElectronChannel(channel)).toBe(false)
    })

    it('should return true for channel with sendPetState', () => {
      const channel = {
        sendStreamDelta: () => {},
        sendThinkingDelta: () => {},
        sendToolCall: () => {},
        sendToolResult: () => {},
        sendDone: () => {},
        sendError: () => {},
        isReady: () => true,
        sendPetState: () => {},
        sendFlowItem: () => {},
        sendGitRefresh: () => {},
        sendToolApprovalRequest: () => {},
      }

      expect(isElectronChannel(channel)).toBe(true)
    })
  })
})
