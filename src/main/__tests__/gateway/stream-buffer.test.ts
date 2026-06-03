/**
 * StreamBuffer 测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StreamBufferManager } from '../../gateway/stream-buffer'

describe('StreamBufferManager', () => {
  let manager: StreamBufferManager
  let sendTextMock: ReturnType<typeof vi.fn>
  let editMessageMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()

    sendTextMock = vi.fn().mockResolvedValue('msg-1')
    editMessageMock = vi.fn().mockResolvedValue(undefined)

    manager = new StreamBufferManager(
      { updateInterval: 1000 },
      sendTextMock,
      editMessageMock,
    )
  })

  afterEach(() => {
    manager.destroy()
    vi.useRealTimers()
  })

  describe('create', () => {
    it('should create a new stream buffer', () => {
      const key = manager.create('chat-1')
      expect(key).toContain('chat-1:')
      expect(manager.size).toBe(1)
    })

    it('should send initial text immediately', () => {
      manager.create('chat-1', 'Hello')

      expect(sendTextMock).toHaveBeenCalledWith('chat-1', 'Hello')
    })

    it('should not send empty initial text', () => {
      manager.create('chat-1', '')

      expect(sendTextMock).not.toHaveBeenCalled()
    })
  })

  describe('append', () => {
    it('should append delta to buffer', async () => {
      sendTextMock.mockResolvedValue('msg-1')
      const key = manager.create('chat-1', 'Hello')

      // Wait for sendText to resolve
      await vi.advanceTimersByTimeAsync(100)

      manager.append(key, ' World')

      // Should not trigger another sendText (already has messageId)
      expect(sendTextMock).toHaveBeenCalledTimes(1)
    })

    it('should send first message if no messageId', async () => {
      sendTextMock.mockResolvedValue('msg-1')
      const key = manager.create('chat-1')

      manager.append(key, 'Hello')

      expect(sendTextMock).toHaveBeenCalledWith('chat-1', 'Hello')
    })

    it('should not send duplicate messages while sending', async () => {
      sendTextMock.mockImplementation(() => new Promise(() => {})) // Never resolves
      const key = manager.create('chat-1')

      manager.append(key, 'Hello')
      manager.append(key, ' World')

      // Should only call sendText once (second append should be skipped)
      expect(sendTextMock).toHaveBeenCalledTimes(1)
    })

    it('should schedule flush after messageId is set', async () => {
      sendTextMock.mockResolvedValue('msg-1')
      const key = manager.create('chat-1', 'Hello')

      // Wait for sendText to resolve
      await vi.advanceTimersByTimeAsync(100)

      manager.append(key, ' World')

      // Advance timer to trigger flush
      await vi.advanceTimersByTimeAsync(1000)

      expect(editMessageMock).toHaveBeenCalledWith('chat-1', 'msg-1', 'Hello World')
    })

    it('should not append to non-existent buffer', () => {
      // Should not throw
      manager.append('non-existent', 'Hello')
    })
  })

  describe('finish', () => {
    it('should finish stream and send final message', async () => {
      sendTextMock.mockResolvedValue('msg-1')
      const key = manager.create('chat-1', 'Hello')

      // Wait for sendText to resolve
      await vi.advanceTimersByTimeAsync(100)

      manager.append(key, ' World')
      await manager.finish(key)

      expect(editMessageMock).toHaveBeenCalledWith('chat-1', 'msg-1', 'Hello World')
      expect(manager.size).toBe(0)
    })

    it('should send final message if no messageId', async () => {
      sendTextMock.mockResolvedValue('msg-1')
      const key = manager.create('chat-1')

      manager.append(key, 'Hello')
      await manager.finish(key)

      expect(sendTextMock).toHaveBeenCalledWith('chat-1', 'Hello')
      expect(manager.size).toBe(0)
    })

    it('should not finish non-existent buffer', async () => {
      // Should not throw
      await manager.finish('non-existent')
    })
  })

  describe('cleanup', () => {
    it('should cleanup expired buffers', async () => {
      const key = manager.create('chat-1')
      expect(manager.size).toBe(1)

      // Advance time past max age (5 minutes)
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000)

      // Trigger cleanup (runs every 60 seconds)
      await vi.advanceTimersByTimeAsync(60 * 1000)

      expect(manager.size).toBe(0)
    })

    it('should not cleanup active buffers', async () => {
      const key = manager.create('chat-1')
      expect(manager.size).toBe(1)

      // Advance time but not past max age
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      // Trigger cleanup
      await vi.advanceTimersByTimeAsync(60 * 1000)

      expect(manager.size).toBe(1)
    })
  })

  describe('destroy', () => {
    it('should cleanup all buffers', () => {
      manager.create('chat-1')
      manager.create('chat-2')
      manager.create('chat-3')

      expect(manager.size).toBe(3)

      manager.destroy()
      expect(manager.size).toBe(0)
    })
  })
})
