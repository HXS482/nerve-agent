import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { BotRegistry } from '../../core/bot-registry'

/**
 * Bot 文件是手改得动的（用户直接编辑 ~/.nerve/bots/*.json），
 * 这些用例钉住「非法字段不能让越权或整轮崩掉」。
 */
describe('BotRegistry 字段归一化', () => {
  let dir: string, reg: BotRegistry

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bot-norm-'))
    reg = await BotRegistry.create(join(dir, 'bots'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function patchRaw(botId: string, patch: Record<string, unknown>) {
    const p = join(dir, 'bots', botId + '.json')
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf-8')), ...patch }), 'utf-8')
  }

  it('canAskBots 写成字符串时归一化成 null（否则 includes 退化成子串匹配）', async () => {
    const bot = await reg.create({ name: 'x', canAskBots: ['bot_a'] })
    patchRaw(bot.id, { canAskBots: 'bot_abc' })
    expect((await reg.get(bot.id))!.canAskBots).toBeNull()
    expect((await reg.list()).find((b) => b.id === bot.id)!.canAskBots).toBeNull()
  })

  it('canAskBots 写成数字/对象时不抛错', async () => {
    const bot = await reg.create({ name: 'x' })
    patchRaw(bot.id, { canAskBots: 42 })
    expect((await reg.get(bot.id))!.canAskBots).toBeNull()
    patchRaw(bot.id, { canAskBots: { a: 1 } })
    expect((await reg.get(bot.id))!.canAskBots).toBeNull()
  })

  it('数组里混入非字符串时只保留字符串', async () => {
    const bot = await reg.create({ name: 'x', canAskBots: ['bot_a'] })
    patchRaw(bot.id, { canAskBots: ['bot_a', 3, null, 'bot_b'] })
    expect((await reg.get(bot.id))!.canAskBots).toEqual(['bot_a', 'bot_b'])
  })

  it('boundSkills / boundMcp 非数组时归一化成空数组', async () => {
    const bot = await reg.create({ name: 'x' })
    patchRaw(bot.id, { boundSkills: 'nope', boundMcp: 7 })
    const got = (await reg.get(bot.id))!
    expect(got.boundSkills).toEqual([])
    expect(got.boundMcp).toEqual([])
  })

  it('read 与 list 归一化结果一致', async () => {
    const bot = await reg.create({ name: 'x' })
    patchRaw(bot.id, { canAskBots: ['bot_a', 1], boundSkills: ['s', 2] })
    const viaGet = (await reg.get(bot.id))!
    const viaList = (await reg.list()).find((b) => b.id === bot.id)!
    expect(viaList.canAskBots).toEqual(viaGet.canAskBots)
    expect(viaList.boundSkills).toEqual(viaGet.boundSkills)
  })
})
