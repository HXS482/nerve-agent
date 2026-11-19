/**
 * Bot 交接的执行侧：认领队列里的跳，跑目标 Bot，把答复写回发起方的会话。
 *
 * 与 bot-handoff.ts 分工：那边只做「决定」—— 解析谁、判闸、入队，必须在发起方那一轮里
 * 快速返回并且 fail closed；这边做「投递」—— 那是一整轮 agent，可能跑几分钟，
 * 必须扛过发起方那一轮已经结束、甚至进程重启。
 *
 * 答复的落点由 work.deliver 决定（见 bot-handoff.ts 的 DeliverMode）：
 * 问答回发起方会话，主动发消息落到目标 Bot 自己的会话。
 *
 * 三种行共用一条队列，靠 kind 区分：
 *   hop   —— 真正跑目标 Bot 一轮，跑完把答复入队一条 relay
 *   relay —— 不跑模型，只把答复作为**目标 Bot 自己的消息**追加进发起方会话
 *   notice—— 不跑模型，跳彻底失败时去发起方会话里说一句「没回来」
 *
 * 为什么 relay 也要排队而不是在 hop 里直接写：hop 跑完那一刻，发起方会话可能正被
 * 另一轮写入（用户在继续聊）。交给队列能让写入串行化，也顺便让「进程重启」这件事
 * 不丢答复 —— 答复已经在队列里了。
 */
import type { HopQueue, HopRow } from '../store/hop-queue'
import { handoffPrompt, clipAnswer, type HandoffEnvelope } from './bot-handoff'

export type HopKind = 'hop' | 'relay' | 'notice'

/** 一跳携带的东西。入队时由 desk 写，runner 只读。 */
export interface HandoffWork {
  kind: HopKind
  /** 发起方所在会话：答复最终要落回这里。 */
  threadId: string
  /** 发起方 Bot。notice 用它落款，因为「没回来」这句话是它该说的。 */
  fromBotId: string
  fromName?: string
  /** 目标 Bot。relay 用它落款，因为这些话是它说的。 */
  toBotId: string
  toName?: string
  envelope: HandoffEnvelope
  /**
   * 目标 Bot 该在哪个目录里干活。
   *
   * 跟着发起方走，而不是用全局目录：用户在这个会话里设了项目目录，
   * 被派去查东西的 Bot 跑到别的仓库里翻，查出来的结果就是另一件事了。
   */
  cwd?: string
  /** 已经走了几跳（发起方是 0，这一跳是 1）。 */
  depth: number
  chain: string[]
  /** relay 专用：要搬的原话。 */
  answer?: string
  /**
   * 答复落在哪。缺省（老行）当作 'reply'：那是更常见、也更安全的意图。
   * 见 bot-handoff.ts 的 DeliverMode。
   */
  deliver?: 'reply' | 'message'
  /** message 模式下答复的目标会话（relay 入队时算好，别让 runner 再查一遍）。 */
  deliverTo?: string
  /** notice 专用：要说给用户听的那句话。 */
  notice?: string
}

export interface HandoffDelivery {
  /** 以目标 Bot 的身份跑一轮，返回它说的话。 */
  run: (input: {
    work: HandoffWork
    prompt: string
    depth: number
    chain: string[]
  }) => Promise<string>
  /**
   * 把一段文本作为某个 Bot 说的话追加进会话（不跑模型）。
   *
   * 带 answeredBy，渲染层据此把气泡画成那个 Bot 的头像和名字 ——
   * 这就是「看起来像 Grok Bot」的那一半。
   */
  appendBotMessage: (input: {
    sessionId: string
    botId: string
    botName?: string
    text: string
    /** true = 这段话是「发起方在说」（notice），false = 目标 Bot 在说（relay）。 */
    speakerIsAsker: boolean
  }) => Promise<void>
  /**
   * 这个 Bot 自己的会话 —— 'message' 模式要把答复落到那里。
   *
   * 由上层决定（AgentCore 知道 homeSessionId 与侧栏会话），runner 不猜。
   * 返回空串表示没有可用的会话，那种情况退回发起方会话 —— 答错地方也比丢掉好。
   */
  resolveBotSession: (botId: string, fallback: string) => Promise<string>
}

export interface HandoffRunnerOptions {
  queue: HopQueue
  delivery: HandoffDelivery
  /** 这一轮 sweep 的 worker 身份，写进队列的 owner 列。 */
  owner: string
  /** 一行处理完（成功或失败）后的回调，供上层推送会话变化。 */
  onSettled?: (work: HandoffWork) => void
  /** 重试退避基数，测试里可以调小。 */
  retryBaseMs?: number
  /**
   * 执行中续租的间隔。一跳是完整的一轮 agent（可能几分钟），而租约只有 120s ——
   * 不续租的话行会在跑到一半时被别的 worker（重启后的队列 / 另一个 AgentCore）重新认领，
   * 同一跳跑两遍、账单翻倍。必须小于租约。
   */
  renewEveryMs?: number
}

const DEFAULT_RETRY_BASE_MS = 5_000
const DEFAULT_RENEW_EVERY_MS = 45_000

export interface HandoffSweep {
  delivered: number
  retried: number
  failed: number
}

function parseWork(raw: string): HandoffWork | null {
  try {
    const w = JSON.parse(raw) as HandoffWork
    if (!w || typeof w !== 'object') return null
    if (w.kind !== 'hop' && w.kind !== 'relay' && w.kind !== 'notice') return null
    if (!w.threadId || !w.fromBotId || !w.toBotId) return null
    return w
  } catch {
    return null
  }
}

export function createHandoffRunner(options: HandoffRunnerOptions) {
  const { queue, delivery, owner, onSettled } = options
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
  const renewEveryMs = options.renewEveryMs ?? DEFAULT_RENEW_EVERY_MS

  /**
   * 把答复搬到位。
   *
   * 落点由 deliver 决定，而不是固定写回发起方会话：
   *   reply   → 发起方会话（用户问的是 A，答案就该在 A 里）
   *   message → 目标 Bot 自己的会话（用户要的是「B 发消息给我」，B 说话的地方才是 B 那儿）
   *
   * 落点会话在**执行 relay 时**才解析，不是 hop 入队时：hop 可能跑几分钟，
   * 期间用户可能新建/切换了 B 的会话，用最新那个才符合预期。
   */
  async function deliverRelay(work: HandoffWork): Promise<string> {
    const target =
      work.deliver === 'message'
        ? work.deliverTo || (await delivery.resolveBotSession(work.toBotId, work.threadId))
        : work.threadId
    const sessionId = target || work.threadId
    await delivery.appendBotMessage({
      sessionId,
      botId: work.toBotId,
      botName: work.toName,
      text: clipAnswer(work.answer ?? ''),
      speakerIsAsker: false,
    })
    return sessionId
  }

  /** 跳彻底失败：用发起方的身份说一句，否则用户看到的只是「Bot 说完就没了」。 */
  async function deliverNotice(work: HandoffWork): Promise<string> {
    const who = work.toName ?? work.toBotId
    await delivery.appendBotMessage({
      sessionId: work.threadId,
      botId: work.fromBotId,
      botName: work.fromName,
      text: work.notice || `${who} 没有回应，我去问的这一趟没结果。`,
      speakerIsAsker: true,
    })
    return work.threadId
  }

  async function executeHop(row: HopRow, work: HandoffWork): Promise<void> {
    const answer = await delivery.run({
      work,
      prompt: handoffPrompt({
        fromName: work.fromName ?? work.fromBotId,
        envelope: work.envelope,
        chain: work.chain,
      }),
      depth: work.depth,
      chain: [...work.chain, work.toName ?? work.toBotId],
    })

    // 跳本身到这里就算跑过了：B 说了「我找不到」也是回答，重试只会再问一遍再收一次费。
    queue.finish(row.key)

    queue.offer('relay:' + row.key, {
      ...work,
      kind: 'relay',
      // answer 是要搬的东西；deliver / deliverTo 已经在 work 里（executeHop 收到什么就传什么），
      // 这里显式再写一遍是因为它决定了「搬到哪」，读代码的人不该去猜 ...work 里有什么。
      deliver: work.deliver,
      answer,
    } satisfies HandoffWork)
  }

  /**
   * 跑一行期间周期性续租：租约只有 120s，而一跳可能跑几分钟。
   * 不续租的话，别的 worker 会把这一行当成「上一个跑的人死了」重新认领。
   */
  async function withLease<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const timer = setInterval(() => {
      try {
        queue.renew(key, owner)
      } catch (err) {
        console.warn('[HandoffRunner] 续租失败:', err)
      }
    }, renewEveryMs)
    timer.unref?.()
    try {
      return await fn()
    } finally {
      clearInterval(timer)
    }
  }

  async function runOne(row: HopRow): Promise<'delivered' | 'retried' | 'failed'> {
    const work = parseWork(row.payload)
    if (!work) {
      // 载荷坏了没法修：直接判终态。走 release 的话它会因为 attempts 还没到上限而被重排，
      // 然后每轮 sweep 都要重试一条永远读不出来的行。
      queue.fail(row.key, 'payload 无法解析')
      return 'failed'
    }

    try {
      /*
       * 落地会话与发起方会话可能不是同一个：deliver=message 时答复进的是 B 自己的对话。
       * 通知必须指向**真正变了**的那个会话 —— 否则界面要么去重载一个没变的会话，
       * 要么（更糟）在 A 正在流式输出时把它整段重载、把临时文字冲掉。
       */
      let landedIn = work.threadId
      if (work.kind === 'relay') landedIn = await withLease(row.key, () => deliverRelay(work))
      else if (work.kind === 'notice') landedIn = await withLease(row.key, () => deliverNotice(work))
      else await withLease(row.key, () => executeHop(row, work))

      if (work.kind !== 'hop') {
        queue.finish(row.key)
        onSettled?.(landedIn === work.threadId ? work : { ...work, threadId: landedIn })
      }
      return 'delivered'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const backoff = retryBaseMs * Math.pow(2, Math.max(0, row.attempts - 1))
      const outcome = queue.release(row.key, msg, backoff)
      if (outcome === 'failed') {
        /*
         * 终态失败要说出来。一跳静默消失和一跳很慢在用户眼里无法区分，
         * 而「问了然后什么都没有」是最糟的结局 —— 用户会以为 Bot 把它忘了。
         * 只有 hop 需要这条通知；relay/notice 自己失败再说一遍就成了套娃。
         */
        if (work.kind === 'hop') {
          queue.offer('notice:' + row.key, {
            ...work,
            kind: 'notice',
            notice: `${work.toName ?? work.toBotId} 没有回应（${msg.slice(0, 200)}），我去问的这一趟没结果。`,
          } satisfies HandoffWork)
        }
        onSettled?.(work)
        return 'failed'
      }
      return 'retried'
    }
  }

  return {
    /** 扫一轮：认领若干跳并逐条执行。 */
    async sweep(): Promise<HandoffSweep> {
      const rows = queue.claim(owner)
      const out: HandoffSweep = { delivered: 0, retried: 0, failed: 0 }
      for (const row of rows) {
        const outcome = await runOne(row)
        out[outcome] += 1
      }
      return out
    },
    runOne,
  }
}