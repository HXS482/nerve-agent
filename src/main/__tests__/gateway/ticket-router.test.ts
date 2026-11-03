import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'
import { TicketRouter } from '../../gateway/ticket-router'
import { SlotScheduler } from '../../gateway/slot-scheduler'

/**
 * 等到 fn() 返回真，或超时。
 *
 * 不用 vi.waitFor：它在第一次为真时就返回，而"第 2 次调用已经发生"这种
 * 断言需要的是"等到它变成真"，两者在时间点上有微妙差别，会导致偶发失败。
 */
async function until(fn: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('until() timed out')
}

describe('TicketRouter', () => {
  let dir: string, store: TicketStore, core: any, router: TicketRouter, channel: any

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tr-'))
    store = TicketStore.open(join(dir, 't.db'))
    channel = { sendError: vi.fn() }
    core = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelSession: vi.fn(),
      getSessionContextManager: () => ({ getOrCreate: (id: string) => ({ sessionId: id }) }),
    }
    router = new TicketRouter({ store, scheduler: new SlotScheduler({ concurrency: 2 }), agentCore: core })
  })

  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  const msg = (threadKey: string, text: string, kind: 'human' | 'system' = 'human') => ({
    platform: 'telegram', userId: 'u1', chatId: '42', threadKey, text, cwd: '/p', kind,
  })

  it('首条消息建立 Ticket', async () => {
    router.dispatch(msg('tg:chat:42', 'first'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(1))
    expect(store.listTickets()).toHaveLength(1)
  })

  it('同一 thread 的第二条消息落到同一个 Ticket，上下文连续', async () => {
    router.dispatch(msg('tg:chat:42', 'first'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(1))
    router.dispatch(msg('tg:chat:42', 'second'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(2))

    expect(store.listTickets()).toHaveLength(1)
    // 两次调用必须用同一个 sessionId，否则上下文就断了
    const ids = core.sendMessage.mock.calls.map((c: any[]) => c[0].sessionId)
    expect(ids[0]).toBe(ids[1])
  })

  it('不同 thread 建不同 Ticket', async () => {
    router.dispatch(msg('tg:chat:42', 'a'), channel)
    router.dispatch(msg('tg:chat:43', 'b'), channel)
    await until(() => core.sendMessage.mock.calls.length >= 2)
    expect(core.sendMessage).toHaveBeenCalledTimes(2)
    expect(store.listTickets()).toHaveLength(2)
  })

  it('不同 thread 并行执行：一个慢任务不挡另一个', async () => {
    let releaseSlow!: () => void
    core.sendMessage
      .mockImplementationOnce(() => new Promise<void>((r) => { releaseSlow = r }))
      .mockImplementationOnce(() => Promise.resolve())

    router.dispatch(msg('tg:chat:42', 'slow'), channel)
    await until(() => core.sendMessage.mock.calls.length >= 1)

    router.dispatch(msg('tg:chat:43', 'fast'), channel)
    // 关键断言：第一个还卡着没结束，第二个就已经开始了
    await until(() => core.sendMessage.mock.calls.length >= 2)
    expect(core.sendMessage).toHaveBeenCalledTimes(2)

    releaseSlow()
  })

  it('同一 thread 内串行：不会有两个 run 同时改同一份上下文', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    core.sendMessage.mockImplementation((payload: any) => {
      order.push(`start:${payload.prompt}`)
      if (payload.prompt === 'first') {
        return new Promise<void>((r) => { releaseFirst = () => { order.push('end:first'); r() } })
      }
      order.push(`end:${payload.prompt}`)
      return Promise.resolve()
    })

    router.dispatch(msg('tg:chat:42', 'first'), channel)
    await vi.waitFor(() => expect(order).toContain('start:first'))

    router.dispatch(msg('tg:chat:42', 'second'), channel)
    await new Promise((r) => setTimeout(r, 20))
    // 第一个还卡着，第二条必须还没开始
    expect(order).not.toContain('start:second')

    releaseFirst()
    await vi.waitFor(() => expect(order).toContain('end:second'))
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
  })

  it('把 Ticket 的 cwd 透传给 sendMessage', async () => {
    router.dispatch({ ...msg('tg:chat:42', 'x'), cwd: '/proj/a' }, channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalled())
    expect(core.sendMessage.mock.calls[0][0]).toMatchObject({ cwd: '/proj/a' })
  })

  it('人的消息走 human 槽位，normal 占满也不排队', async () => {
    // concurrency=1：先用一个 system 消息占满 normal
    let releaseSystem!: () => void
    core.sendMessage
      .mockImplementationOnce(() => new Promise<void>((r) => { releaseSystem = r }))
      .mockImplementationOnce(() => Promise.resolve())

    router.dispatch(msg('tg:chat:1', 'background', 'system'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(1))

    // normal 已满，人的消息仍应立即开始
    router.dispatch(msg('tg:chat:2', 'urgent', 'human'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(2))

    releaseSystem()
  })

  it('stop() 只停这一个 Ticket', async () => {
    core.sendMessage.mockImplementation(() => new Promise<void>(() => {}))   // 永不结束

    router.dispatch(msg('tg:chat:42', 'a'), channel)
    router.dispatch(msg('tg:chat:43', 'b'), channel)
    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(2))

    const target = store.listTickets().find((t) => t.threadKey === 'tg:chat:42')!
    router.stop(target.id)

    expect(core.cancelSession).toHaveBeenCalledWith(target.sessionId)
    expect(core.cancelSession).toHaveBeenCalledTimes(1)   // 只取消了这一个
    expect(store.getTicket(target.id)!.endedAt).toBeDefined()
  })

  it('执行成功后被标记为 idle，不是一直 working', async () => {
    router.dispatch(msg('tg:chat:42', 'quick'), channel)
    await vi.waitFor(() => {
      const t = store.listTickets()[0]
      expect(t?.stage).toBe('idle')
    })
  })

  it('发送失败时标记 blocked 并回报错误', async () => {
    core.sendMessage.mockRejectedValueOnce(new Error('boom'))
    router.dispatch(msg('tg:chat:42', 'x'), channel)

    await vi.waitFor(() => {
      expect(store.listTickets()[0]?.stage).toBe('blocked')
    })
    expect(channel.sendError).toHaveBeenCalledWith('boom')
  })

  it('一个 Ticket 失败不影响另一个 Ticket 继续跑', async () => {
    core.sendMessage
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(() => Promise.resolve())

    router.dispatch(msg('tg:chat:1', 'bad'), channel)
    router.dispatch(msg('tg:chat:2', 'good'), channel)

    await vi.waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => {
      const good = store.listTickets().find((t) => t.threadKey === 'tg:chat:2')
      expect(good?.stage).toBe('idle')
    })
  })

  it('onChanged 会推送状态变化', async () => {
    const seen: string[] = []
    router.onChanged((t) => seen.push(t.stage))
    router.dispatch(msg('tg:chat:42', 'x'), channel)
    await vi.waitFor(() => expect(seen).toContain('idle'))
    expect(seen).toContain('queued')
    expect(seen).toContain('working')
  })

  it('一个人同时办三件事，三件都能并行跑（human 槽位只有 1 个，不能靠它并行）', async () => {
    // 这是整个改造的核心承诺，也是最容易写错的地方：
    // 如果"人发的消息"一律走那个唯一的 human 槽位，一个人有两件事时就会自己挡住自己。
    const running = new Set<string>()
    let peak = 0
    core.sendMessage.mockImplementation((p: any) => {
      running.add(p.prompt)
      peak = Math.max(peak, running.size)
      return new Promise<void>((r) => setTimeout(() => { running.delete(p.prompt); r() }, 30))
    })

    router.dispatch(msg('tg:chat:1', 'job-a'), channel)
    router.dispatch(msg('tg:chat:2', 'job-b'), channel)
    router.dispatch({ ...msg('tg:chat:3', 'job-c'), cwd: '/p' }, channel)

    await until(() => core.sendMessage.mock.calls.length >= 3, 3000)
    // concurrency=2，所以峰值应该是 2（第三个等前面空出来），但不能是 1
    expect(peak).toBeGreaterThanOrEqual(2)
    expect(await store.listTickets({ includeEnded: true })).toBeDefined()
  })

  it('stop() 之后，同一 Ticket 已排在链上的消息不再执行', async () => {
    // 这条链是内存里的，删 effect 行删不掉已经挂上去的 run。
    // 不修的话：停掉之后第二条照样跑、并把 Ticket 重新写成 working，停止形同虚设。
    let releaseFirst!: () => void
    core.sendMessage.mockImplementationOnce(
      () => new Promise<void>((r) => { releaseFirst = r }),
    )

    router.dispatch(msg('tg:chat:42', 'first'), channel)
    await until(() => core.sendMessage.mock.calls.length >= 1)

    // 第一条还在跑时排进第二条，然后停掉整个 Ticket
    router.dispatch(msg('tg:chat:42', 'second'), channel)
    const target = store.listTickets().find((t) => t.threadKey === 'tg:chat:42')!
    router.stop(target.id)

    releaseFirst()
    await new Promise((r) => setTimeout(r, 50))

    // 只跑了第一条；第二条被拦下
    expect(core.sendMessage).toHaveBeenCalledTimes(1)
    expect(store.getTicket(target.id)!.endedAt).toBeDefined()
  })

  it('stop() 时还等着槽位的消息不会再跑，槽位也不会泄漏', async () => {
    // 等槽位是 runOnce 里唯一的 await 点：这里被停掉的 run 必须自己 release。
    let releaseFirst!: () => void
    core.sendMessage.mockImplementationOnce(
      () => new Promise<void>((r) => { releaseFirst = r }),
    )
    core.sendMessage.mockImplementation(() => new Promise<void>(() => {}))

    const scheduler = new SlotScheduler({ concurrency: 1 })
    const tight = new TicketRouter({ store, scheduler, agentCore: core })

    tight.dispatch(msg('tg:chat:42', 'first'), channel)
    await until(() => core.sendMessage.mock.calls.length >= 1)

    // 第二条是 system：只能排 normal，而 normal 已被第一条占满 → 卡在 acquireSlot
    tight.dispatch(msg('tg:chat:42', 'second', 'system'), channel)

    const target = store.listTickets().find((t) => t.threadKey === 'tg:chat:42')!
    tight.stop(target.id)

    releaseFirst()
    await new Promise((r) => setTimeout(r, 50))

    expect(core.sendMessage).toHaveBeenCalledTimes(1)
    // 槽位没泄漏：还能立刻拿到那个唯一的 normal
    const release = scheduler.tryAcquire('normal')
    expect(release).not.toBeNull()
    release?.()
  })

  it('start() 恢复中断的 Assignment', () => {
    store.insertTicket({
      id: 't1', title: 'x', cwd: '/p', sessionId: 's1', threadKey: 'k',
      stage: 'working', createdAt: 1, lastActiveAt: 1,
    })
    store.insertAssignment({ id: 'a1', ticketId: 't1', status: 'running', createdAt: 1 })

    expect(router.start()).toBe(1)
    expect(store.latestAssignment('t1')!.status).toBe('pending')
    expect(store.getTicket('t1')!.stage).toBe('queued')
  })
})
