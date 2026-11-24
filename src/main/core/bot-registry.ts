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
  /** 头像本体颜色，空 = 按 id 散列取默认色。 */
  avatarColor: string
  /**
   * 头像形状 id（见 renderer/lib/bot-shapes.ts 的 SHAPE_IDS），空 = 按 id 散列。
   *
   * 存 id 而不是存整条 SVG path：path 有几百字符，塞进每个 Bot 的 JSON 里既难读
   * 也没法在升级时统一换形状；id 是个稳定的短键，渲染层查表。
   */
  avatarShape: string
  /**
   * 头像材质：'flat' 平涂 / 'fluffy' 毛绒。
   *
   * 取代了原来的 `avatarOrb` 布尔量 —— 那个字段的 false 分支（emoji 方块）已删除，
   * 现在两个选项都是同一套形状，只是材质不同。
   */
  avatarMaterial: 'flat' | 'fluffy'
  /**
   * 老字段，只读兼容。
   *
   * 以前 false = emoji 文字方块，那条渲染路径已经删掉；现在只用来迁移
   * （false → fluffy）。新代码不要读写它，写操作会被 update() 主动清掉。
   *
   * @deprecated 用 avatarMaterial
   */
  avatarOrb?: boolean
  instructions: string
  isDefault: boolean
  homeSessionId: string
  boundSkills: string[]
  boundMcp: string[]
  /**
   * 这个 Bot 允许把活派给哪些 Bot（message_bot 的授权）。
   *
   * - null / undefined：所有其他 Bot 都能问（老 Bot 文件没有这个字段，落地成 null，保证开箱可用）
   * - []：谁都不能问，这时 message_bot 工具**根本不会出现在工具列表里**
   * - [id, ...]：只允许这些
   *
   * 为什么不给空数组当默认：默认拒绝会让「刚建好两个 Bot 想让他们协作」变成一个需要
   * 到处翻设置才能解决的空转问题；而默认全开的风险由深度闸和扇出闸兜住。
   */
  canAskBots: string[] | null
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

  /**
   * 字段归一化。read() 与 list() 共用同一份，别再各写一遍 ——
   * 只改一处会让「自己眼里」和「同事眼里」的同一个 Bot 长得不一样。
   *
   * canAskBots 必须在这里收窄类型：文件是手改得动的，写成字符串时
   * `grant.includes(id)` 会退化成子串匹配（能越权问到不该问的 Bot），
   * 写成数字/对象则让整轮抛错。非法值一律当 null（= 老 Bot 的默认，全开）。
   */
  private normalize(raw: BotInfo): BotInfo {
    const grant = raw.canAskBots
    return {
      ...raw,
      group: raw.group ?? '',
      emoji: raw.emoji ?? '',
      avatarColor: raw.avatarColor ?? '',
      avatarShape: raw.avatarShape ?? '',
      // 材质：新字段合法时以它为准（否则 update() 写下的值会被老字段顶掉）；
      // 否则回退到老字段迁移 —— avatarOrb === false 当年是「emoji 方块」，
      // 那条路已删，落到毛绒上（用户当初选的就是「不要平涂的球」）。
      avatarMaterial:
        raw.avatarMaterial === 'flat' || raw.avatarMaterial === 'fluffy'
          ? raw.avatarMaterial
          : raw.avatarOrb === false
            ? 'fluffy'
            : 'flat',
      canAskBots: Array.isArray(grant)
        ? grant.filter((id): id is string => typeof id === 'string')
        : null,
      boundSkills: Array.isArray(raw.boundSkills)
        ? raw.boundSkills.filter((id): id is string => typeof id === 'string')
        : [],
      boundMcp: Array.isArray(raw.boundMcp)
        ? raw.boundMcp.filter((id): id is string => typeof id === 'string')
        : [],
    }
  }

  private async read(id: string): Promise<BotInfo | null> {
    try {
      const raw = JSON.parse(await readFile(this.path(id), 'utf-8')) as BotInfo
      return this.normalize(raw)
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
        bots.push(this.normalize(raw))
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

  async create(input: { name: string; group?: string; emoji?: string; avatarColor?: string; avatarShape?: string; avatarMaterial?: 'flat' | 'fluffy'; avatarOrb?: boolean; instructions?: string; homeSessionId?: string; isDefault?: boolean; canAskBots?: string[] | null; boundSkills?: string[]; boundMcp?: string[] }): Promise<BotInfo> {
    const now = Date.now()
    const bot: BotInfo = {
      id: `bot_${randomUUID()}`,
      name: input.name,
      group: input.group ?? '',
      emoji: input.emoji ?? '',
      avatarColor: input.avatarColor ?? '',
      avatarShape: input.avatarShape ?? '',
      avatarMaterial: input.avatarMaterial ?? (input.avatarOrb === false ? 'fluffy' : 'flat'),
      instructions: input.instructions ?? '',
      isDefault: input.isDefault ?? false,
      homeSessionId: input.homeSessionId ?? '',
      boundSkills: input.boundSkills ?? [],
      boundMcp: input.boundMcp ?? [],
      canAskBots: input.canAskBots ?? null,
      createdAt: now,
      updatedAt: now,
    }
    await writeFile(this.path(bot.id), JSON.stringify(bot, null, 2), 'utf-8')
    return bot
  }

  async update(id: string, patch: Partial<Pick<BotInfo, 'name' | 'group' | 'emoji' | 'avatarColor' | 'avatarShape' | 'avatarMaterial' | 'instructions' | 'homeSessionId' | 'boundSkills' | 'boundMcp' | 'canAskBots'>>): Promise<BotInfo> {
    const bot = await this.read(id)
    if (!bot) throw new Error(`Bot not found: ${id}`)
    const merged: BotInfo = { ...bot, ...patch, updatedAt: Date.now() }
    // avatarOrb 只是迁移用的老字段。一旦写入了新字段，老字段留着就会在下次
    // normalize 时把 avatarMaterial 又拽回 fluffy —— 显式删掉它。
    delete (merged as { avatarOrb?: boolean }).avatarOrb
    const updated: BotInfo = merged
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
