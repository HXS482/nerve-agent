import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'
import { EffectRunner } from '../../store/effect-runner'
import { SessionRouter } from '../../gateway/session-router'
import { NullOutputChannel } from '../../core/output-channel'

/** 让排在队列里的 microtask / 定时器都跑完 */
const flush = () => new Promise(r => setTimeout(r, 0))

describe('SessionRouter durable queue', () => {
  let dir: string, store: TicketStore, runner: EffectRunner, core: any, channel: any
  // 让第一条消息卡住的闸门；用例结束前一定要放开，否则 runner.stop() 会永远等下去
  let release: () => void = () => {}

  beforeEach(() => {
    release = () => {}
    dir = mkdtempSync(join(tmpdir(), 'router-'))
    store = TicketStore.open(join(dir, 't.db'))
    runner = new EffectRunner(store, { pollMs: 5 })
    channel = { sendText: vi.fn(), sendDone: vi.fn(), sendError: vi.fn() }
    core = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelSession: vi.fn(),
      getSessionContextManager: () => ({ getOrCreate: (id: string) => ({ sessionId: id }) }),
    }
  })
  afterEach(async () => {
    release() // 避免上面把 handler 卡死后 stop() 永远吊着
    await runner.stop()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists a submitted message before running it', async () => {
    // 让 handler 卡住，断言此时数据库里还有这条记录
    core.sendMessage.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
    const router = new SessionRouter(core, dir, store, runner)
    router.start()
    void router.submit('s1', 'hello', channel)
    await new Promise(r => setTimeout(r, 30))
    // claimDueEffects 只读不删；行先落盘，只有 handler 成功返回后 deleteEffect 才把它删掉。
    // 所以「正在跑」的这一刻，库里必须还留着它——这正是崩溃恢复能成立的原因。
    const rows = store.rawQuery("SELECT COUNT(*) AS n FROM effect WHERE kind='gateway.message'")
    expect((rows[0] as { n: number }).n).toBe(1)
    expect(core.sendMessage).toHaveBeenCalledTimes(1)

    // 跑完之后才算消费掉
    release()
    await runner.idle('gateway.message')
    const after = store.rawQuery("SELECT COUNT(*) AS n FROM effect WHERE kind='gateway.message'")
    expect((after[0] as { n: number }).n).toBe(0)
  })

  it('resumes a message left in the database after a restart', async () => {
    store.enqueueEffect('gateway.message', 's1', {
      sessionId: 's1', message: 'resumed', files: undefined,
    })
    const router = new SessionRouter(core, dir, store, runner)
    router.start()
    await runner.idle('gateway.message')
    // 兜底路径必须真的传一个 NullOutputChannel 实例下去（不是随便什么东西）。
    // runner 跑完 msgA 之后还会继续 dispatch，所以用「哪一次调用」定位，而不是把
    // 全部调用都当成同一行。
    const resumedCall = core.sendMessage.mock.calls.find(
      ([msg]: [{ sessionId: string }]) => msg.sessionId === 's1',
    )
    expect(resumedCall).toBeDefined()
    expect(resumedCall[0]).toMatchObject({ prompt: 'resumed', sessionId: 's1' })
    expect(resumedCall[1]).toBeInstanceOf(NullOutputChannel)
    // 之前的写法：expect.anything() —— 把兜底通道换成直接丢弃也照样绿，等于没测。
  })

  it('runs a message on a NullOutputChannel after its live channel is gone', async () => {
    const router = new SessionRouter(core, dir, store, runner)

    // 先 submit 拿到一条活通道，但**不 start**：行只在库里躺着，还没人执行。
    await router.submit('s1', 'orphan', channel)
    expect(store.rawQuery(
      `SELECT 1 AS hit FROM effect WHERE kind = ? AND key = ?`,
      'gateway.message', 's1',
    )).toHaveLength(1)

    // 通道随连接/进程一起死掉（gateway.stop() 就是这么做的：排空后 resetChannels）
    router.resetChannels()

    // 现在才让 runner 去取它
    router.start()
    await runner.idle('gateway.message')

    expect(core.sendMessage).toHaveBeenCalledTimes(1)
    const [msg, usedChannel] = core.sendMessage.mock.calls[0]
    expect(msg).toMatchObject({ prompt: 'orphan', sessionId: 's1' })
    // 断言的是通道的**身份/类型**：兜底路径必须真的塞一个 NullOutputChannel 下去，
    // 而不是什么都不传、或者把消息直接丢掉。
    expect(usedChannel).toBeInstanceOf(NullOutputChannel)
    expect(usedChannel).not.toBe(channel)
  })

  it('evicts a session channel once its last queued message is consumed', async () => {
    const router = new SessionRouter(core, dir, store, runner)
    router.start()

    await router.submit('s1', 'first', channel)
    await runner.idle('gateway.message')
    await flush() // 让消费之后那两级 microtask 里的回收跑完

    // 直接往库里放一条（绕过 submit，所以不会重新登记通道）。
    // 通道若真被回收了，这条只能走兜底；没回收就会悄悄用上那条没人再用的旧通道。
    store.enqueueEffect('gateway.message', 's1', { sessionId: 's1', message: 'second' })
    await runner.idle('gateway.message')

    const calls = core.sendMessage.mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][1]).toBe(channel)                       // 第一条用的是真通道
    expect(calls[1][1]).toBeInstanceOf(NullOutputChannel)    // 第二条证明旧通道已被回收

    // 回收只发生在「已消费完」那一刻：会话继续说，就该用新登记的那条通道。
    const channel2: any = { sendText: vi.fn(), sendDone: vi.fn(), sendError: vi.fn() }
    await router.submit('s1', 'third', channel2)
    await runner.idle('gateway.message')
    expect(core.sendMessage.mock.calls[2][1]).toBe(channel2)
  })

  it('cancel removes only that session queued rows and aborts the session', async () => {
    // 排队中的两条：s1 要被取消，s2 必须毫发无损。
    store.enqueueEffect('gateway.message', 's1', { sessionId: 's1', message: 'drop-me' })
    store.enqueueEffect('gateway.message', 's2', { sessionId: 's2', message: 'keep-me' })
    // 同名 key、不同 kind：cancel 只能按 kind 精确删除，不能顺手清掉别的 kind。
    store.enqueueEffect('other.kind', 's1', { anything: true })

    const router = new SessionRouter(core, dir, store, runner)
    router.cancel('s1')

    const rows = store.rawQuery(`SELECT kind, key FROM effect ORDER BY key`) as Array<{ kind: string; key: string }>
    expect(rows).toEqual([
      { kind: 'other.kind', key: 's1' },
      { kind: 'gateway.message', key: 's2' },
    ])
    expect(core.cancelSession).toHaveBeenCalledTimes(1)
    expect(core.cancelSession).toHaveBeenCalledWith('s1')

    // 删行必须真的生效，而不只是"看起来删了"：跑一遍队列，只有 s2 被执行。
    router.start()
    await runner.idle('gateway.message')
    expect(core.sendMessage).toHaveBeenCalledTimes(1)
    expect(core.sendMessage.mock.calls[0][0]).toMatchObject({ sessionId: 's2', prompt: 'keep-me' })
  })
})
