import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'
import { EffectRunner } from '../../store/effect-runner'
import { SessionRouter } from '../../gateway/session-router'

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
    expect(core.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'resumed', sessionId: 's1' }),
      expect.anything(),
      expect.anything(),
    )
  })
})
