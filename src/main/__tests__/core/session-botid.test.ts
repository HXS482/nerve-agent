import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileSessionStore } from '../../session-store'

describe('session botId 元数据', () => {
  let dir: string, store: FileSessionStore

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sessbot-'))
    store = await FileSessionStore.create(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('setMeta/getMeta 往返', async () => {
    await store.setMeta('sess-1', { botId: 'bot_a' })
    expect(await store.getMeta('sess-1')).toEqual({ botId: 'bot_a' })
  })

  it('未设置过返回空对象', async () => {
    expect(await store.getMeta('nope')).toEqual({})
  })

  it('setMeta 合并而非覆盖', async () => {
    await store.setMeta('sess-2', { botId: 'bot_a' })
    await store.setMeta('sess-2', { customTitle: '我的会话' })
    expect(await store.getMeta('sess-2')).toEqual({ botId: 'bot_a', customTitle: '我的会话' })
  })
})
