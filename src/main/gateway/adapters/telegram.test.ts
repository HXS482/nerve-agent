import { describe, it, expect, vi } from 'vitest'
import { TelegramAdapter } from './telegram'

describe('TelegramAdapter flood control', () => {
  it('should fallback to plain text after repeated Markdown failures', async () => {
    const adapter = new TelegramAdapter({
      enabled: true,
      token: 'test_token',
    })

    const mockClient = {
      editMessageText: vi.fn()
        .mockRejectedValueOnce(new Error('flood control'))
        .mockRejectedValueOnce(new Error('flood control'))
        .mockRejectedValueOnce(new Error('flood control'))
        .mockResolvedValue({}),
    }
    ;(adapter as any).client = mockClient
    ;(adapter as any).connected = true

    await adapter.editMessage('chat_1', '1', 'test')

    expect(mockClient.editMessageText).toHaveBeenCalledTimes(2)
    // First call: Markdown (fails with flood)
    expect(mockClient.editMessageText).toHaveBeenNthCalledWith(
      1, 'chat_1', 1, 'test', { parse_mode: 'Markdown' }
    )
    // Second call: plain text fallback
    expect(mockClient.editMessageText).toHaveBeenNthCalledWith(
      2, 'chat_1', 1, 'test'
    )
  })

  it('should silently ignore "message is not modified" error', async () => {
    const adapter = new TelegramAdapter({
      enabled: true,
      token: 'test_token',
    })

    const mockClient = {
      editMessageText: vi.fn().mockRejectedValue(new Error('Bad Request: message is not modified')),
    }
    ;(adapter as any).client = mockClient
    ;(adapter as any).connected = true

    await expect(adapter.editMessage('chat_1', '1', 'test')).resolves.toBeUndefined()
    expect(mockClient.editMessageText).toHaveBeenCalledTimes(1)
  })

  it('should not throw on edit failure', async () => {
    const adapter = new TelegramAdapter({
      enabled: true,
      token: 'test_token',
    })

    const mockClient = {
      editMessageText: vi.fn()
        .mockRejectedValueOnce(new Error('some error'))
        .mockRejectedValueOnce(new Error('some other error')),
    }
    ;(adapter as any).client = mockClient
    ;(adapter as any).connected = true

    await expect(adapter.editMessage('chat_1', '1', 'test')).resolves.toBeUndefined()
  })
})
