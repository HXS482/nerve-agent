import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AdapterChannel } from './adapter-channel'
import type { BaseAdapter } from './adapters/base-adapter'

function createMockAdapter(): BaseAdapter {
  return {
    isConnected: true,
    sendText: vi.fn().mockResolvedValue('msg_1'),
    editMessage: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  } as any
}

describe('AdapterChannel', () => {
  it('sendDone should not send duplicate message when sendText is pending', async () => {
    const adapter = createMockAdapter()
    let resolveSendText: (v: string) => void
    adapter.sendText = vi.fn().mockImplementation(() => new Promise(r => { resolveSendText = r }))

    const channel = new AdapterChannel(adapter, 'chat_123')
    channel.sendStreamDelta('您好')
    channel.sendDone('session_1', 0, 0)

    resolveSendText!('msg_1')
    await new Promise(r => setTimeout(r, 10))

    const sendCalls = (adapter.sendText as any).mock.calls.length
    const sendDirectCalls = (adapter.send as any).mock.calls.length
    expect(sendCalls + sendDirectCalls).toBeLessThanOrEqual(1)
  })

  it('should not flush before edit interval elapses', async () => {
    vi.useFakeTimers()
    const adapter = createMockAdapter()
    adapter.sendText = vi.fn().mockResolvedValue('msg_1')
    adapter.editMessage = vi.fn().mockResolvedValue(undefined)

    const channel = new AdapterChannel(adapter, 'chat_123')

    // First delta triggers sendText
    channel.sendStreamDelta('Hi')
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10) // sendText resolves

    // Delta schedules flush, but timer hasn't fired yet
    channel.sendStreamDelta(' there')
    await vi.advanceTimersByTimeAsync(400)
    expect(adapter.editMessage).not.toHaveBeenCalled()

    // 800ms reached — timer fires
    await vi.advanceTimersByTimeAsync(400)
    expect(adapter.editMessage).toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('should use 800ms stream update interval', async () => {
    vi.useFakeTimers()
    const adapter = createMockAdapter()
    adapter.sendText = vi.fn().mockResolvedValue('msg_1')
    adapter.editMessage = vi.fn().mockResolvedValue(undefined)

    const channel = new AdapterChannel(adapter, 'chat_123')

    channel.sendStreamDelta('Hello World this is a test message')
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)

    channel.sendStreamDelta(' more text here')
    await vi.advanceTimersByTimeAsync(500) // 500ms — not yet 800
    expect(adapter.editMessage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300) // 800ms reached
    expect(adapter.editMessage).toHaveBeenCalled()

    vi.useRealTimers()
  })
})
