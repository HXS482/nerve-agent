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
  it('avatarOrb=false 的老 Bot 迁移成毛绒（原来那条 emoji 方块路径已删）', async () => {
    const bot = await reg.create({ name: 'x' })
    // 真实的老板本文件里**根本没有** avatarMaterial 这个键，所以要把它删掉，
    // 而不是留着 create() 写进去的 'flat'（那会让「显式优先」这条规则先命中）
    patchRaw(bot.id, { avatarOrb: false, avatarMaterial: undefined })
    expect((await reg.get(bot.id))!.avatarMaterial).toBe('fluffy')
    expect((await reg.list()).find((b) => b.id === bot.id)!.avatarMaterial).toBe('fluffy')
  })

  it('avatarOrb=true / 缺省 的老 Bot 落到平涂', async () => {
    const a = await reg.create({ name: 'a' })
    patchRaw(a.id, { avatarOrb: true, avatarMaterial: undefined })
    expect((await reg.get(a.id))!.avatarMaterial).toBe('flat')
    const b = await reg.create({ name: 'b' })
    patchRaw(b.id, { avatarOrb: undefined, avatarMaterial: undefined })
    expect((await reg.get(b.id))!.avatarMaterial).toBe('flat')
  })

  it('avatarMaterial 显式值优先于老字段（老字段留在文件里也不会拽回去）', async () => {
    const bot = await reg.create({ name: 'x' })
    patchRaw(bot.id, { avatarMaterial: 'flat', avatarOrb: false })
    // 两个字段冲突时 material 是显式写入的，它说了算
    expect((await reg.get(bot.id))!.avatarMaterial).toBe('flat')
  })

  it('update 写材质后会清掉老字段，避免下次 normalize 又拽回毛绒', async () => {
    const bot = await reg.create({ name: 'x' })
    patchRaw(bot.id, { avatarOrb: false, avatarMaterial: undefined })
    await reg.update(bot.id, { avatarMaterial: 'flat' })
    // 直接从文件里读，确认 avatarOrb 真的被删了（不是只在内存归一化里盖掉）
    const raw = JSON.parse(readFileSync(join(dir, 'bots', bot.id + '.json'), 'utf-8'))
    expect(raw.avatarOrb).toBeUndefined()
    expect((await reg.get(bot.id))!.avatarMaterial).toBe('flat')
  })

  it('avatarMaterial 写成非法值时落到平涂', async () => {
    const bot = await reg.create({ name: 'x' })
    patchRaw(bot.id, { avatarMaterial: 'hairy' })
    expect((await reg.get(bot.id))!.avatarMaterial).toBe('flat')
  })
})
