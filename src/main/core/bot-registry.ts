/**
 * Bot 实体注册表（设计文档 §1）。一个 JSON 文件一个 Bot，存 NERVE_DIR/bots/。
 * session 是 Bot 的会话实例，通过 session 元数据的 botId 字段关联（Task 6）。
 */
import { mkdir, readdir, readFile, writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'

export interface BotInfo {
  id: string
  name: string
  /** 侧栏分组名（研发 / 调研 / 闲聊…）。空 = 归到默认分组。 */
  group: string
  /** 头像：单字 emoji。空 = 用名字首字。 */
  emoji: string
  instructions: string
  isDefault: boolean
  homeSessionId: string
  boundSkills: string[]
  boundMcp: string[]
  createdAt: number
  updatedAt: number
}

export class BotRegistry {
  private constructor(private baseDir: string) {}

  static async create(baseDir: string): Promise<BotRegistry> {
    await mkdir(baseDir, { recursive: true })
    const registry = new BotRegistry(baseDir)
    // 空目录 = 老用户首次启动，直接落一个默认 Bot（设计文档 §1 启动迁移）。
    // 放在构造时而非只靠 getDefault()，让 list() 等只读入口也能看到默认 Bot。
    if ((await registry.list()).length === 0) {
      await registry.create({ name: 'Assistant', isDefault: true })
    }
    return registry
  }

  private path(id: string): string {
    return join(this.baseDir, `${id}.json`)
  }

  private async read(id: string): Promise<BotInfo | null> {
    try {
      const raw = JSON.parse(await readFile(this.path(id), 'utf-8')) as BotInfo
      // 兼容改造前落盘的 Bot 文件（没有 group / emoji 字段）
      return { ...raw, group: raw.group ?? '', emoji: raw.emoji ?? '' }
    } catch {
      return null // 不存在或损坏都当没有
    }
  }

  async list(): Promise<BotInfo[]> {
    let names: string[] = []
    try {
      names = await readdir(this.baseDir)
    } catch {
      return []
    }
    const bots: BotInfo[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const raw = JSON.parse(await readFile(join(this.baseDir, name), 'utf-8')) as BotInfo
        bots.push({ ...raw, group: raw.group ?? '', emoji: raw.emoji ?? '' })
      } catch {
        // 损坏文件跳过，不炸整体
      }
    }
    return bots
  }

  async get(id: string): Promise<BotInfo | null> {
    return this.read(id)
  }

  /** 取默认 Bot；一个都没有时自动创建（老用户零迁移）。 */
  async getDefault(): Promise<BotInfo> {
    const bots = await this.list()
    const existingDefault = bots.find((b) => b.isDefault)
    if (existingDefault) return existingDefault
    return this.create({ name: 'Assistant', isDefault: true })
  }

  async create(input: { name: string; group?: string; emoji?: string; instructions?: string; homeSessionId?: string; isDefault?: boolean }): Promise<BotInfo> {
    const now = Date.now()
    const bot: BotInfo = {
      id: `bot_${randomUUID()}`,
      name: input.name,
      group: input.group ?? '',
      emoji: input.emoji ?? '',
      instructions: input.instructions ?? '',
      isDefault: input.isDefault ?? false,
      homeSessionId: input.homeSessionId ?? '',
      boundSkills: [],
      boundMcp: [],
      createdAt: now,
      updatedAt: now,
    }
    await writeFile(this.path(bot.id), JSON.stringify(bot, null, 2), 'utf-8')
    return bot
  }

  async update(id: string, patch: Partial<Pick<BotInfo, 'name' | 'group' | 'emoji' | 'instructions' | 'homeSessionId' | 'boundSkills' | 'boundMcp'>>): Promise<BotInfo> {
    const bot = await this.read(id)
    if (!bot) throw new Error(`Bot not found: ${id}`)
    const updated: BotInfo = { ...bot, ...patch, updatedAt: Date.now() }
    await writeFile(this.path(id), JSON.stringify(updated, null, 2), 'utf-8')
    return updated
  }

  async remove(id: string): Promise<boolean> {
    const bot = await this.read(id)
    if (!bot) return false
    if (bot.isDefault) throw new Error('不能删除默认 Bot')
    await unlink(this.path(id))
    return true
  }
}
