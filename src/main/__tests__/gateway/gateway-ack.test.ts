import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 只测 handleAgent 的「落盘 / 回 ack」顺序，AgentCore 在本用例里一次都不会被调用
// （runner 没 start）。mock 掉可以避免真去 loadSettings()（那会读写 ~/.nerve/settings.json）。
vi.mock('../../core/agent-core', () => ({
  AgentCore: class {
    constructor(_config: unknown) {}
  },
}))

import { NerveGateway } from '../../gateway/gateway'

describe('Gateway agent ack', () => {
  let dir: string, gateway: NerveGateway
  let sent: Array<{ id: string; ok: boolean; payload?: any; error?: string }>

  const client = { id: 'c1', deviceId: undefined } as any

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gw-ack-'))
    gateway = new NerveGateway({
      port: 0,
      host: '127.0.0.1',
      dataDir: dir,
      projectDir: dir,
      sourceDir: dir,
    })
    // 打开持久化队列（不开 WS server / adapter）
    ;(gateway as any).ensureQueue()

    sent = []
    ;(gateway as any).server = {
      clientCount: 0,
      sendResponse: (_clientId: string, res: { id: string; ok: boolean; payload?: any; error?: string }) => {
        sent.push(res)
      },
      sendEvent: () => {},
    }
  })

  afterEach(() => {
    ;(gateway as any).ticketStore?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const request = {
    type: 'req',
    id: 'r1',
    method: 'agent',
    params: { message: 'hello' },
  } as any

  // 这一条钉住的是顺序：accepted 发出去的那一刻，effect 表里必须已经有这条消息。
  it('persists the message before sending the accepted ack', async () => {
    const store = (gateway as any).ticketStore
    const rowsAtAck: number[] = []
    const realSend = (gateway as any).server.sendResponse
    ;(gateway as any).server.sendResponse = (clientId: string, res: any) => {
      if (res.ok) {
        const rows = store.rawQuery(
          `SELECT COUNT(*) AS n FROM effect WHERE kind = 'gateway.message'`,
        ) as Array<{ n: number }>
        rowsAtAck.push(rows[0].n)
      }
      realSend(clientId, res)
    }

    await (gateway as any).handleMessage(client, request)

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ id: 'r1', ok: true, payload: { status: 'accepted' } })
    // ack 那一刻必须已经落盘（1 行）；不是 0。
    expect(rowsAtAck).toEqual([1])
  })

  // 落盘失败就不许回 accepted：客户端必须看到错误，否则这条消息就凭空消失了。
  it('reports an error instead of an ack when the durable enqueue throws', async () => {
    const store = (gateway as any).ticketStore
    vi.spyOn(store, 'enqueueEffect').mockImplementation(() => {
      throw new Error('disk full')
    })

    await (gateway as any).handleMessage(client, request)

    expect(sent).toHaveLength(1)
    expect(sent[0].ok).toBe(false)
    expect(sent[0].id).toBe('r1') // 同一个请求 id：客户端看到的是这次请求失败
    expect(sent[0].error).toContain('disk full')
    // 没有任何「受理了」的痕迹
    expect(sent.some(r => r.ok && r.payload?.status === 'accepted')).toBe(false)
    // 也没在库里留下半截记录
    expect(store.rawQuery(`SELECT COUNT(*) AS n FROM effect`)).toEqual([{ n: 0 }])
    // 刚登记的内存通道引用被撤掉了
    expect((gateway as any).channels.has('c1')).toBe(false)
  })
})
