import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { BotRegistry } from '../../core/bot-registry'

describe('BotRegistry', () => {
  let dir: string, reg: BotRegistry

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bots-'))
    reg = await BotRegistry.create(join(dir, 'bots'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('空目录 getDefault 自动创建默认 Bot', async () => {
    const bot = await reg.getDefault()
    expect(bot.isDefault).toBe(true)
    expect(bot.name).toBe('Assistant')
    expect(bot.id).toMatch(/^bot_/)
  })

  it('create 与 get', async () => {
    const bot = await reg.create({ name: 'coder', instructions: '写代码', homeSessionId: 's1' })
    expect(bot.instructions).toBe('写代码')
    const got = await reg.get(bot.id)
    expect(got?.name).toBe('coder')
    expect(await reg.list()).toHaveLength(2) // 默认 + coder
  })

  it('update 修改字段并刷新 updatedAt', async () => {
    const bot = await reg.create({ name: 'a' })
    await new Promise((r) => setTimeout(r, 5))
    const upd = await reg.update(bot.id, { instructions: 'new' })
    expect(upd.instructions).toBe('new')
    expect(upd.updatedAt).toBeGreaterThanOrEqual(bot.updatedAt)
  })

  it('remove 禁止删除默认 Bot', async () => {
    const def = await reg.getDefault()
    await expect(reg.remove(def.id)).rejects.toThrow()
  })

  it('remove 普通 Bot', async () => {
    const bot = await reg.create({ name: 'x' })
    expect(await reg.remove(bot.id)).toBe(true)
    expect(await reg.get(bot.id)).toBeNull()
  })

  it('损坏的 JSON 文件被跳过不炸整体', async () => {
    const bot = await reg.create({ name: 'ok' })
    writeFileSync(join(dir, 'bots', 'bot_broken.json'), '{oops')
    const list = await reg.list()
    expect(list.map((b) => b.id)).toContain(bot.id)
    expect(list).toHaveLength(2)
  })
})
