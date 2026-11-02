/**
 * 会话路由器
 *
 * 职责：
 * - 平台用户ID → Nerve 会话ID 映射
 * - session 消息投递（队列落盘，由 EffectRunner 执行，保持串行语义）
 * - 会话状态管理
 */

import { randomUUID } from 'crypto'
import { join } from 'path'
import { NullOutputChannel, type OutputChannel } from '../core/output-channel'
import type { AgentCore } from '../core/agent-core'
import type { TicketStore } from '../store/ticket-store'
import type { EffectRunner } from '../store/effect-runner'

/** effect 表里会话消息的 kind。改动它等于丢掉重启前的未执行消息。 */
const MESSAGE_KIND = 'gateway.message'

interface SessionMapping {
  sessionId: string
  platform: string
  userId: string
  chatId: string
  createdAt: number
  lastActive: number
}

type MessageFile = {
  name: string
  mimeType: string
  data: string
  size: number
  isImage: boolean
}

/**
 * 落盘进 effect.payload 的内容。OutputChannel 不可序列化，所以不在其中。
 *
 * `cwd` 必须一起落盘：队列里的消息可能在崩溃后由另一次进程启动恢复执行，
 * 那时候调用方的上下文早没了。payload 里不带 cwd，恢复出来的消息就只能跑在全局目录里
 * ——发起它的那个会话当时在哪已经无从得知。`undefined` 表示「确实没有会话级目录」，
 * 由 `AgentCore.sendMessage` 经 `resolveCwd` 回落到项目目录（这是正确的默认）。
 */
interface MessagePayload {
  sessionId: string
  message: string
  files?: MessageFile[]
  cwd?: string
}

export class SessionRouter {
  // 平台用户ID → 会话映射
  private mappings = new Map<string, SessionMapping>()

  // sessionId → 输出通道。只能放在内存里：通道随进程生灭，重启后旧通道已失效。
  private channels = new Map<string, OutputChannel>()

  // 通道缺失时（重启后恢复队列里的消息）的兜底输出口，只为了让消息能跑完不丢。
  private readonly fallbackChannel = new NullOutputChannel()

  // sessionId → 该会话是否正有一条消息在跑（activeSessionCount 用）
  private readonly inFlightSessions = new Set<string>()

  // 持久化文件路径
  private mappingsPath: string

  // debounce 定时器
  private saveTimer: NodeJS.Timeout | null = null

  // start() 只做一次事
  private started = false

  constructor(
    private agentCore: AgentCore,
    dataDir: string,
    private store: TicketStore,
    private runner: EffectRunner,
  ) {
    this.mappingsPath = join(dataDir, 'gateway-sessions.json')
    this.loadMappings()
  }

  /**
   * 注册 queue handler 并启动 runner。
   *
   * 本阶段**保持串行语义**：`ordered: true` + `concurrency: 1`，同一 session 一次只跑一条，
   * 全局也只有一条在跑。并发执行留给后续阶段。
   */
  start(): void {
    // register 只做一次；runner.start() 幂等，但在 stop() 之后需要重新拉起来，
    // 所以不能跟着 started 一起短路（Gateway 允许 stop 后再 start）。
    if (!this.started) {
      this.started = true
      this.runner.register(
        MESSAGE_KIND,
        (payload, key) => this.handleMessage(payload, key),
        { ordered: true, concurrency: 1 },
      )
    }
    this.runner.start()
  }

  /**
   * 解析或创建会话
   */
  resolve(platform: string, userId: string, chatId: string): string {
    const key = `${platform}:${userId}`

    if (!this.mappings.has(key)) {
      const sessionId = randomUUID()
      this.mappings.set(key, {
        sessionId,
        platform,
        userId,
        chatId,
        createdAt: Date.now(),
        lastActive: Date.now(),
      })
      this.saveMappings()
    }

    const mapping = this.mappings.get(key)!
    mapping.lastActive = Date.now()
    return mapping.sessionId
  }

  /**
   * 获取会话映射
   */
  getMapping(platform: string, userId: string): SessionMapping | undefined {
    return this.mappings.get(`${platform}:${userId}`)
  }

  /**
   * 提交消息到会话队列
   *
   * 先落盘（`enqueueEffect`）再返回，由 runner 异步执行，所以这里**必须**保持 `Promise<void>`
   * —— 调用方（gateway）在返回值上挂了 `.catch(...)`。
   */
  async submit(
    sessionId: string,
    message: string,
    channel: OutputChannel,
    files?: MessageFile[],
    cwd?: string,
  ): Promise<void> {
    // 通道先记住：handler 从内存 Map 取它，SQLite 装不下。
    this.channels.set(sessionId, channel)

    // cwd 一起落盘：崩溃恢复时这是唯一还记得「这条消息该跑在哪」的地方。
    // 调用方确实没有会话级目录时传 undefined，交给 resolveCwd 回落项目目录。
    const payload: MessagePayload = { sessionId, message, files, cwd }
    this.store.enqueueEffect(MESSAGE_KIND, sessionId, payload)
  }

  /**
   * 取消指定 session 的排队任务与正在跑的任务
   */
  cancel(sessionId: string) {
    // 排队中的直接删掉，runner 之后 claim 不到它
    this.store.rawExec(
      `DELETE FROM effect WHERE kind = ? AND key = ?`,
      MESSAGE_KIND,
      sessionId,
    )

    // 正在跑的那次也停掉（abort 该 session 的 ctx）
    this.agentCore.cancelSession(sessionId)
  }

  /**
   * 丢掉所有内存里的通道，一条不留。
   *
   * 由 `NerveGateway.stop()` 在排空队列**之后**调用：那次 stop 之后通道全部随连接一起死了，
   * 留着它们只会让 stop→start 之后恢复出来的消息拿着一条死通道走"看起来正常"的路径——
   * 输出静默丢掉、还带着过期的 runId，比走下面 `handleMessage` 里会告警的兜底路径更糟。
   * 清空后恢复的消息会如期命中 `fallbackChannel` 并记录 warn。
   */
  resetChannels(): void {
    this.channels.clear()
  }

  /**
   * 获取活跃会话数：还有活没干完（排队中或正在跑）的会话数
   */
  get activeSessionCount(): number {
    const sessions = new Set<string>(this.inFlightSessions)
    const rows = this.store.rawQuery(
      `SELECT DISTINCT key FROM effect WHERE kind = ?`,
      MESSAGE_KIND,
    ) as Array<{ key: string }>
    for (const row of rows) sessions.add(row.key)
    return sessions.size
  }

  /**
   * 获取所有会话映射
   */
  getAllMappings(): SessionMapping[] {
    return Array.from(this.mappings.values())
  }

  /**
   * 删除会话映射
   */
  deleteMapping(platform: string, userId: string) {
    const key = `${platform}:${userId}`
    const mapping = this.mappings.get(key)
    this.mappings.delete(key)
    if (mapping) this.channels.delete(mapping.sessionId)
    this.saveMappings()
  }

  /**
   * 清理过期会话（超过 7 天未活跃）
   */
  cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000) {
    const now = Date.now()
    for (const [key, mapping] of this.mappings.entries()) {
      if (now - mapping.lastActive > maxAgeMs) {
        this.mappings.delete(key)
        // 只丢掉「没有待办」的会话通道：还有消息排在队里的会话，通道得留着才能把回复送出去。
        if (!this.hasPendingMessages(mapping.sessionId)) {
          this.channels.delete(mapping.sessionId)
        }
      }
    }
    this.saveMappings()
  }

  /**
   * effect handler：真正把一条消息交给 AgentCore 跑。
   *
   * 成功后由 EffectRunner 调 `deleteEffect` 删行；抛错则走 `bumpAttempt` 退避重试。
   */
  private async handleMessage(payload: unknown, key: string): Promise<void> {
    const data = payload as Partial<MessagePayload> | null
    if (!data || typeof data.sessionId !== 'string' || typeof data.message !== 'string') {
      // 认不出来的 payload 直接放过（不抛错 = 这一行会被删掉），否则它会一直堵在队头。
      console.warn(`[SessionRouter] dropping malformed ${MESSAGE_KIND} effect (key=${key})`)
      return
    }

    const sessionId = data.sessionId
    let channel = this.channels.get(sessionId)
    if (!channel) {
      // 预期行为：进程重启后，上一条消息的通道随旧进程一起死了，内存 Map 是空的。
      // 消息本身在库里，不能就这么扔掉（崩溃恢复靠它），所以用兜底通道跑完，
      // 只是这一轮的输出无处可送。用户需要的话得重发一次。
      console.warn(
        `[SessionRouter] no live output channel for session ${sessionId} (likely restored after a restart); ` +
        `running the message with a null channel so it is not lost — its output cannot be delivered, ` +
        `ask the user to resend if they need to see the reply`,
      )
      channel = this.fallbackChannel
    }

    // 会话上下文用于多 session 隔离
    const sessionContextManager = this.agentCore.getSessionContextManager()
    const ctx = sessionContextManager.getOrCreate(sessionId)

    this.inFlightSessions.add(sessionId)
    try {
      // cwd 原样交回去：submit 时落盘的那份，恢复执行时照样有效。
      // 缺省/空串由 AgentCore 内部的 resolveCwd 回落项目目录。
      await this.agentCore.sendMessage(
        { prompt: data.message, sessionId, files: data.files, cwd: data.cwd },
        channel,
        ctx,
      )
    } finally {
      this.inFlightSessions.delete(sessionId)
      // 这条消息一旦被消费掉，该会话的通道就没用了：留着它就是一份永远不释放的引用。
      this.evictChannelWhenConsumed(sessionId)
    }
  }

  /**
   * 本次执行彻底收尾后，若该会话在 effect 表里已经没有排队/在跑的消息，就丢掉它的通道。
   *
   * 时机：`EffectRunner.execute` 是在 handler **返回之后**才调 `deleteEffect` 的，所以在 handler
   * 里同步查库一定还能看到自己那一行，永远回收不掉。这里用两级 microtask 把检查排到
   * 「handler resolve → execute 的续体执行 deleteEffect」之后再跑。
   *
   * 退化行为是安全的：万一将来 runner 在 handler 与 deleteEffect 之间又 `await` 了别的东西，
   * 本回调就会早于删除执行——那时库里还有行，`hasPendingMessages` 为真，于是**不回收**，
   * 只是漏收一个通道，绝不会误删还有活要干的会话通道。
   */
  private evictChannelWhenConsumed(sessionId: string): void {
    queueMicrotask(() => {
      queueMicrotask(() => {
        // 期间又来了新消息（submit 会重新登记通道）就别动它。
        if (this.hasPendingMessages(sessionId)) return
        this.channels.delete(sessionId)
      })
    })
  }

  /** 该会话是否还有排队中（未执行）的消息 */
  private hasPendingMessages(sessionId: string): boolean {
    const rows = this.store.rawQuery(
      `SELECT 1 AS hit FROM effect WHERE kind = ? AND key = ? LIMIT 1`,
      MESSAGE_KIND,
      sessionId,
    )
    return rows.length > 0
  }

  private loadMappings() {
    try {
      const { existsSync, readFileSync } = require('fs')
      if (existsSync(this.mappingsPath)) {
        const data = JSON.parse(readFileSync(this.mappingsPath, 'utf-8'))
        for (const [key, value] of Object.entries(data)) {
          this.mappings.set(key, value as SessionMapping)
        }
        console.log(`[SessionRouter] Loaded ${this.mappings.size} session mappings`)
      }
    } catch (err) {
      console.warn('[SessionRouter] Failed to load mappings:', err)
    }
  }

  private saveMappings() {
    // 使用 debounce 合并短时间内的多次写入
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null

      try {
        const { writeFile } = require('fs')
        const data: Record<string, SessionMapping> = {}
        for (const [key, value] of this.mappings.entries()) {
          data[key] = value
        }
        writeFile(this.mappingsPath, JSON.stringify(data, null, 2), 'utf-8', (err: any) => {
          if (err) {
            console.warn('[SessionRouter] Failed to save mappings:', err)
          }
        })
      } catch (err) {
        console.warn('[SessionRouter] Failed to save mappings:', err)
      }
    }, 100) // 100ms debounce
  }
}
