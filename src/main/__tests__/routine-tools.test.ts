import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RoutineStore } from '../store/routine-store'
import { buildRoutineTools } from '../routine-tools'

describe('routine tools', () => {
  let dir: string, store: RoutineStore, tools: Record<string, any>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rttools-'))
    store = RoutineStore.open(join(dir, 'r.db'))
    tools = buildRoutineTools({
      store,
      getSession: () => ({ sessionId: 'sess-1', botId: 'bot_1' }),
      // 测试里不接真实会话存储：请求什么就返回什么（空串 → 空，触发"没有可投递会话"分支）
      resolveSession: async (requested: string) => requested,
    })
  })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  it('create_routine 成功', async () => {
    const r = await tools['create_routine'].execute({ instruction: '每天站会前提醒', schedule: 'daily:08:50' })
    expect(r.error).toBeUndefined()
    expect(r.id).toMatch(/^rt_/)
    expect(store.get(r.id)!.botId).toBe('bot_1')
    expect(store.get(r.id)!.sessionId).toBe('sess-1')
    expect(store.get(r.id)!.createdBy).toBe('model')
  })

  it('create_routine schedule 非法返回 error 而非抛出', async () => {
    const r = await tools['create_routine'].execute({ instruction: 'x', schedule: 'every minute' })
    expect(typeof r.error).toBe('string')
  })

  it('session_hint 覆盖投递会话', async () => {
    const r = await tools['create_routine'].execute({ instruction: 'x', schedule: 'interval:15m', session_hint: 'other' })
    expect(store.get(r.id)!.sessionId).toBe('other')
  })

  it('list_routines 只见当前 Bot', async () => {
    store.create({ botId: 'bot_1', sessionId: 'sess-1', instruction: 'a', schedule: 'interval:15m', createdBy: 'user' })
    store.create({ botId: 'bot_2', sessionId: 'sess-9', instruction: 'b', schedule: 'interval:15m', createdBy: 'user' })
    const r = await tools['list_routines'].execute({})
    expect(r.routines).toHaveLength(1)
    expect(r.routines[0].instruction).toBe('a')
  })

  it('update / delete 限定当前 Bot', async () => {
    const mine = store.create({ botId: 'bot_1', sessionId: 'sess-1', instruction: 'a', schedule: 'interval:15m', createdBy: 'model' })
    const other = store.create({ botId: 'bot_2', sessionId: 'sess-9', instruction: 'b', schedule: 'interval:15m', createdBy: 'model' })

    const upd = await tools['update_routine'].execute({ id: mine.id, enabled: false })
    expect(upd.error).toBeUndefined()
    expect(store.get(mine.id)!.enabled).toBe(false)

    expect((await tools['update_routine'].execute({ id: other.id, enabled: false })).error).toBe('not found')

    expect((await tools['delete_routine'].execute({ id: mine.id })).error).toBeUndefined()
    expect(store.get(mine.id)).toBeNull()
    expect((await tools['delete_routine'].execute({ id: other.id })).error).toBe('not found')
  })
})
