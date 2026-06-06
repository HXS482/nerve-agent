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
})
