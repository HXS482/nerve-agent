/**
 * Bot 间任务交接（message_bot）。
 *
 * 背景：Bot 在 nerve 里原本只是「人设配置」（bot-registry.ts，一 bot 一 JSON），
 * 会话通过 meta 的 botId 挂到某个 Bot 上，但没有**任何**让 A 去找 B 的通道 ——
 * 一个 Bot 想让另一个 Bot 做事，只能靠人当二传手：人读 A 的输出，判断该给谁，
 * 再复制粘贴过去。这个文件补的就是那一跳。
 *
 * 设计对标 OpenBot（CopilotKit/OpenBot）的 server/src/agents/handoff*.ts，
 * 四条硬规矩照着抄，因为它们都是踩出来的：
 *
 * 1. 参数是结构化的，不是一段自由文本。直觉写法是 message_bot(to, text)，但自由文本
 *    正是多 agent 系统「悄悄坏掉」最常见的方式：接收方要自己推断意图、自己重新推导约束、
 *    自己猜要什么形状的答案；猜错了它不会失败，它会自信地答一件别的事。
 *    让发起方多花点力气把三件事分开说，能去掉大部分这类错误。
 *
 * 2. 谁能问谁，是一次普通的授权。没被授权的 Bot 根本不该看到这个工具 ——
 *    不是「给了再拒绝」。模型看见一个永远用不了的工具，会花注意力在上面，
 *    还会对用户说「我试过了但失败了」，读起来像部署坏了。
 *
 * 3. 深度由部署决定，不是模型决定。A 问 B 问 C 问 A 是最典型的失控，而且真的花钱。
 *    depth 通过会话载荷一路传下去，发起方改不了它。
 *
 * 4. 每一次拒绝都是一句话，不是一个异常。发起方正处在一轮 run 的中间，用户在等。
 *    throw 出去会让整轮无声结束，用户看到的就是「Bot 无视了我」。
 *    拒绝必须是一句模型能直接说出口的话。
 */

import { randomUUID } from 'crypto'
import type { BotInfo } from './bot-registry'

/** 工具名。只此一个名字，方便在 transcript 里按名字找出每一次交接。 */
export const HANDOFF_TOOL = 'message_bot'

/** 默认上限：A→B→C 就到头了；一轮最多问三个 Bot。 */
export const DEFAULT_MAX_DEPTH = 2
export const DEFAULT_MAX_PER_RUN = 3

/**
 * 从环境变量读上限。
 *
 * 两个都允许为 0，且 0 的含义是「关掉」而不是「无限制」—— 这是唯一安全的读法：
 * 配错成 0 应该是能力消失，而不是闸门消失。
 */
export function readHandoffCaps(env: NodeJS.ProcessEnv = process.env): {
  maxDepth: number
  maxPerRun: number
} {
  const int = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw.trim() === '') return fallback
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  return {
    maxDepth: int(env.NERVE_BOT_HANDOFF_MAX_DEPTH, DEFAULT_MAX_DEPTH),
    maxPerRun: int(env.NERVE_BOT_HANDOFF_MAX_PER_RUN, DEFAULT_MAX_PER_RUN),
  }
}

/**
 * 把一个名字削成「用来比较的那部分」。
 *
 * 人会对着叫 Knowledge 的 Bot 说 the Knowledge Bot / @knowledge / knowledge-bot，
 * 模型被要求去问它时原样把这些词传过来。如果这些都被判成「没有这个 Bot」，
 * 用户看到的是一个红色的失败步骤和一次重试。
 *
 * 所以：不分大小写、去掉前导 @、把 _ 和连续的空白或短横归一成一个空格、
 * 去掉开头的 the、去掉结尾独立的 bot。注意 Chatbot 保留它的 bot ——
 * 那是名字的一部分，不是一个独立的词。
 */
export function addressKey(said: string): string {
  return said
    .toLowerCase()
    .trim()
    .replace(/^@+/, '')
    .replace(/[\s_-]+/g, ' ')
    .trim()
    .replace(/^the /, '')
    .replace(/ bot$/, '')
    .trim()
}

export type AddressedBot =
  | { kind: 'found'; bot: BotInfo }
  | { kind: 'ambiguous'; candidates: BotInfo[] }
  | { kind: 'none' }

/**
 * 解析「模型说的这个名字」到底是哪个 Bot。
 *
 * 精确优先，且精确命中一定赢：先 id（id 是精确的，名字不是），再显示名，且必须只有一个同名。
 * 只有在什么都没精确命中时才用宽松读法，而且也必须恰好落到一个 Bot 上。
 * 两个读起来一样的 Bot 一律判 ambiguous 而不是挑一个 —— 挑错了就是活干到了
 * 没人想给的 Bot 上，而拒绝时把两个 id 都报出来，发起方就能说清是哪一个。
 */
export function resolveAddressedBot(roster: readonly BotInfo[], target: string): AddressedBot {
  const wanted = target.trim().toLowerCase()
  if (!wanted) return { kind: 'none' }

  const byId = roster.find((b) => b.id.toLowerCase() === wanted)
  if (byId) return { kind: 'found', bot: byId }

  const byName = roster.filter((b) => b.name.toLowerCase() === wanted)
  if (byName.length > 1) return { kind: 'ambiguous', candidates: byName }
  if (byName.length === 1) return { kind: 'found', bot: byName[0] }

  const key = addressKey(target)
  if (!key) return { kind: 'none' }
  const loose = roster.filter((b) => addressKey(b.name) === key || addressKey(b.id) === key)
  if (loose.length > 1) return { kind: 'ambiguous', candidates: loose }
  if (loose.length === 1) return { kind: 'found', bot: loose[0] }
  return { kind: 'none' }
}

/** 一个 Bot 试图把活派给自己。它不是「不允许」，它要问的那个 Bot 就是它自己。 */
export function selfRefusal(name: string): string {
  return (
    'Nothing was sent: you are ' +
    name +
    ', so a request for ' +
    name +
    ' is a request to you. Do the work yourself and answer the person.'
  )
}


/**
 * 一次交接的载荷。三段的划分不是装饰，它决定了目标 Bot 拿到什么：
 *
 * - `task` 是「做什么」，必填；
 * - `constraints` 是「不能越过的边界」（别改生产配置、只用只读命令）；
 * - `expecting` 是「什么算答完」（给个方案还是给个文件路径）。
 *
 * 后两个可选：绝大多数交接只说明任务就够了，强行要求填只会让模型为了交差瞎编。
 */
export interface HandoffEnvelope {
  task: string
  constraints?: string
  expecting?: string
}

/**
 * 工具上下文。由 AgentCore 在组装工具时钉好，一次 run 一份。
 *
 * 扇出计数器是闭包级的：一次 run 一份上下文，所以「一轮最多问几个 Bot」
 * 天然就是 per-run 的，不需要额外的 runId 也能算对。
 */
export interface HandoffCtx {
  /** 这一轮是谁在跑。 */
  fromBotId: string
  /** 这一轮在哪个会话里跑 —— 解析不出来就没有地方让对方的答案落脚。 */
  sessionId: string
  /**
   * 答复最终该落回的会话（这条链的起点）。
   *
   * 第一跳时等于 sessionId；被派起来的一轮跑在一次性 scratch 会话里，此时必须用
   * 起点会话，否则传给下一跳的 threadId 是个马上会被删掉的会话，答复就永久丢在那。
   */
  threadId?: string
  /** 这一轮的工作目录：派出去的活应该在同一片地方干。 */
  cwd: string

  /** 当前深度与链路（来自载荷，不是模型给的）。 */
  depth: number
  chain: string[]
  caps: { maxDepth: number; maxPerRun: number }
  /**
   * 组工具那一刻「能被问的 Bot」快照，只用来生成 schema（枚举 + 名单）。
   *
   * 为什么要快照：模型看到一段自由字符串的 bot 字段时会去猜名字，猜错被拒之后
   * 还会翻名单重试，用户看到的就是一个红色失败步骤。给成枚举就不用猜了。
   * 这是 openbot 在注释里写明的踩坑，我第一版漏了。
   *
   * 快照**不参与权限判断**：真正派发时仍然走 listReachable() 现读，
   * 所以刚被收回的授权下一次交接就失效，而不是等下次建工具。
   */
  reachable: BotInfo[]
  /** 当前 Bot 被授权可问的 Bot（已过滤掉自己、不可见、已删除）。 */
  listReachable: () => Promise<BotInfo[]>
  /** 查一个 Bot 的完整信息（取名字用）。 */
  getBot: (id: string) => Promise<BotInfo | null>
  /**
   * 把这一跳入队，然后立刻返回。
   *
   * 刻意**不**在这里等目标 Bot 跑完：那是完整的一轮 agent，可能几分钟。
   * 让它阻塞等于「A 聊到一半不动了」，而这正是要避免的观感。
   * 目标 Bot 的答复稍后作为会话里一条独立消息出现，落款是它自己。
   */
  enqueue: (work: {
    fromBotId: string
    fromName?: string
    toBotId: string
    toName?: string
    threadId: string
    /** 目标 Bot 的工作目录（沿用发起方会话的，别让它跑到别的项目里） */
    cwd?: string
    envelope: HandoffEnvelope
    depth: number
    chain: string[]
    /** 答复落在哪里，见 DeliverMode。缺省当作 'reply'。 */
    deliver?: DeliverMode
  }) => Promise<'queued' | 'already' | void>
}

type ToolDef = {
  description: string
  input_schema: Record<string, unknown>
  execute: (args: any) => Promise<any>
}

/**
 * 答复落在哪个会话。
 *
 * 这是两种**不同的事**，只是共用同一个工具：
 *
 * - 'reply'（默认）：一次问答。用户在 A 的会话里问，答案就该出现在 A 的会话里，
 *   否则他得自己跑去 B 那边找。
 * - 'message'：用户要的是「让 B 给我发条消息」。他要看的是 **B 说话**，
 *   所以答案落在 B 自己的会话里 —— 切到 B 的窗口就能看到，这才像收到一条消息。
 *   落在 A 的会话里会变成「A 转述了 B 的话」，用户的观感是「我的 A 窗口里混进了别人的声音」。
 *
 * 判断依据是用户的原话，由模型填：说「让 X 查/做/看看」是 reply，
 * 说「让 X 给我发条消息/跟我说句话/告诉我」是 message。
 */
export type DeliverMode = 'reply' | 'message'
/**
 * \u4ECE\u4EFB\u52A1\u63CF\u8FF0\u91CC\u8BFB\u300C\u8FD9\u662F\u8981\u6211\u8F6C\u8FBE\uFF0C\u8FD8\u662F\u8981\u5B83\u8054\u7CFB\u7528\u6237\u300D\u3002
 *
 * \u4E3A\u4EC0\u4E48\u4E0D\u80FD\u53EA\u9760\u6A21\u578B\u586B deliver\uFF1A\u8FD9\u4E2A\u53C2\u6570\u5B83\u7ECF\u5E38\u4E0D\u586B \u2014\u2014 \u5C11\u586B\u4E00\u4E2A\u53EF\u9009\u5B57\u6BB5\u4E0D\u5F71\u54CD\u5B83
 * \u628A\u4EFB\u52A1\u4EA4\u51FA\u53BB\uFF0C\u4E8E\u662F\u9ED8\u8BA4\u843D\u5230 reply\uFF0C\u300C\u8BA9 X \u7ED9\u6211\u53D1\u6761\u6D88\u606F\u300D\u5C31\u53D8\u6210 X \u5728 A \u7684\u7A97\u53E3\u91CC\u8BF4\u8BDD\uFF0C
 * \u800C\u90A3\u6B63\u662F\u7528\u6237\u62B1\u6028\u7684\u90A3\u4E00\u5E55\u3002\u610F\u56FE\u5199\u5728\u4EFB\u52A1\u6587\u672C\u91CC\u662F\u66F4\u53EF\u9760\u7684\u4FE1\u53F7\uFF0C\u7528\u5B83\u515C\u5E95\u6BD4\u76F8\u4FE1\u4E00\u4E2A
 * \u53EF\u6709\u53EF\u65E0\u7684\u5B57\u6BB5\u9760\u8C31\u3002\u6A21\u578B\u660E\u786E\u586B\u4E86\u5C31\u4EE5\u5B83\u4E3A\u51C6\uFF08\u663E\u5F0F\u80DC\u8FC7\u63A8\u65AD\uFF09\u3002
 *
 * \u53EA\u8BA4\u300C\u5BF9\u7740\u7528\u6237\u8BF4\u300D\u7684\u5F3A\u4FE1\u53F7\uFF1A\u53D1\u6D88\u606F / \u8DDF\u6211\u8BF4 / \u544A\u8BC9\u6211 / \u8054\u7CFB\u6211 / \u56DE\u6211\u3002
 * \u300C\u67E5\u4E00\u4E0B\u300D\u300C\u6574\u7406\u4E00\u4E0B\u300D\u8FD9\u7C7B\u90FD\u4E0D\u7B97 \u2014\u2014 \u90A3\u4E9B\u8BE5\u843D\u5728\u63D0\u95EE\u7684\u5730\u65B9\u3002
 */
export function inferDeliver(text: string): DeliverMode {
  if (!text) return 'reply'
  const t = text.toLowerCase()
  const patterns = [
    // 发条消息 / 发个信息 / 留句话
    /(发|送|留)\s*(条|个|一个)?\s*(消息|信息|信|话)/,
    // 跟我说句话 / 和我聊聊 / 对我汇报
    /(跟|和|同|对)\s*(我|我们|me|us)\s*(说|讲|聊|沟通|汇报|反馈)/,
    // 告诉我 / 通知我 / 联系我 / 回我
    /(告诉|通知|联系|回复|回)\s*(我|我们|me|us)/,
    // 英文说法
    /(send|drop|leave)\s+(me|us)\s+(a\s+)?(message|note|line)/,
    /(message|contact|notify|tell|ping|dm)\s+(me|us)\b/,
    /(talk|speak|chat)\s+to\s+(me|us)\b/,
  ]
  for (const re of patterns) {
    if (re.test(t)) return 'message'
  }
  return 'reply'
}


/**
 * 构造交给目标 Bot 的第一条消息。
 *
 * 三件事必须在里面说清，否则目标 Bot 会按自己的人设猜：
 * 谁在问（不是用户本人）、边界是什么、什么算答完。
 * 最后一句是防跑偏：它是为这一次交接单独作答的，不要反过来追问发起方。
 */
export function handoffPrompt(input: {
  fromName: string
  envelope: HandoffEnvelope
  chain: string[]
}): string {
  const lines = [
    '[Bot handoff] This came from ' +
      input.fromName +
      ', another Bot in this workspace, not from the person.',
    '',
    'Task: ' + input.envelope.task,
  ]
  if (input.envelope.constraints) lines.push('Constraints: ' + input.envelope.constraints)
  if (input.envelope.expecting) {
    lines.push('What a good answer looks like: ' + input.envelope.expecting)
  }
  if (input.chain.length > 0) {
    lines.push('', 'This work has already passed through: ' + input.chain.join(' -> ') + '.')
  }
  lines.push(
    '',
    'Answer for this handoff only: do the work, say what you found, and finish. Do not ask ' +
      'the asking Bot a follow-up question; if something is genuinely missing, say what is ' +
      'missing and what you could still conclude.',
  )
  return lines.join('\n')
}

/** 答复回传给发起方时的截断长度。整本书塞回 tool result 没有意义。 */
const ANSWER_CLIP = 8000

export function clipAnswer(text: string): string {
  const t = text.trim()
  if (t.length <= ANSWER_CLIP) return t
  return t.slice(0, ANSWER_CLIP) + '\n\n[... answer truncated at ' + ANSWER_CLIP + ' characters]'
}

/**
 * 构建 message_bot 工具。
 *
 * 返回空对象 == 这个 Bot 谁都问不了：能力被关掉（上限为 0），或者深度已经到顶。
 * 工具根本不出现，而不是出现了每次都被拒 —— 后者会让用户读到「我试了但失败了」。
 * 授权为空（谁都不能问）由调用方决定不传 ctx 来表达，同样不出现在工具列表里。
 */
export function buildBotHandoffTools(ctx: HandoffCtx): Record<string, ToolDef> {
  const caps = ctx.caps
  if (caps.maxDepth <= 0 || caps.maxPerRun <= 0) return {}
  if (ctx.depth >= caps.maxDepth) return {}

  // per-run 扇出计数：这个上下文就是这一轮的，闭包变量天然不会跨 run 串味。
  let asked = 0

  /*
   * bot 字段能填什么：给成枚举，模型不用猜名字。
   *
   * 同名按 id 区分 —— 两个都叫 Knowledge 时，名字这个值本身就有歧义，
   * 给模型两个一样的选择等于让它掷骰子。
   */
  const nameCounts = new Map<string, number>()
  for (const b of ctx.reachable) {
    const k = b.name.toLowerCase()
    nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1)
  }
  const choices = ctx.reachable.map((b) =>
    (nameCounts.get(b.name.toLowerCase()) ?? 0) > 1 ? b.id : b.name,
  )
  const rosterLine = ctx.reachable
    .map((b) => (b.instructions ? b.name + '（' + b.instructions.slice(0, 60) + '）' : b.name))
    .join('、')

  const tool: ToolDef = {
    description:
      'Hand a piece of work to another Bot in this workspace and let it answer for itself. ' +
      (rosterLine ? 'The Bots here are: ' + rosterLine + '. ' : '') +
      'Two different things share this tool. Asking one of them for an answer (「让 X 查/做…」) ' +
      'is a reply: say deliver=reply and the answer lands here. Asking one of them to contact ' +
      'the person (「让 X 给我发条消息/跟我说句话」) is a message: say deliver=message and the ' +
      'answer lands in that Bot\'s own conversation, because what they want is to see it speak. ' +
      'WHEN THE PERSON NAMES ONE OF THEM that is an instruction, not a suggestion: ' +
      '「让 X 做…」 / "ask X to…" / "叫 X 帮我…" means ' +
      'hand the work to X even if you could do it yourself. Doing it yourself instead is the ' +
      'wrong answer — the person chose which Bot does the work. ' +
      'Use it when the work needs a role you do not have. Do not use it to pass along work you ' +
      'could do yourself, and do not use it when what is missing is a person\'s judgement ' +
      '(ask the person instead). Fill in task / constraints / expecting separately rather than ' +
      'writing one paragraph: the other Bot cannot ask you what you meant.',
    input_schema: {
      type: 'object',
      properties: {
        bot:
          choices.length > 0
            ? {
                type: 'string',
                enum: choices,
                description:
                  'The Bot to hand this to. The ones you can ask: ' +
                  choices.join(', ') +
                  '. When the person names one of them, hand the work to that one instead of ' +
                  'doing it yourself.',
              }
            : {
                type: 'string',
                description: 'The name or id of the Bot to hand this to.',
              },
        task: {
          type: 'string',
          description: 'What you are asking that Bot to do, in a sentence or two.',
        },
        deliver: {
          type: 'string',
          enum: ['reply', 'message'],
          description:
            "Where its answer should land. 'reply' (default) when the person asked YOU something and " +
            "named a Bot as the one who knows: the answer belongs in this conversation. " +
            "'message' when the person asked that Bot to send THEM a message / talk to them " +
            '(「让 X 给我发条消息」「叫 X 跟我说句话」): the answer belongs in that Bot\'s own ' +
            'conversation, because what they want is to see that Bot speaking.',
        },
        constraints: {
          type: 'string',
          description:
            'Anything that bounds the work: a date range, a system to look in, a rule it must not break.',
        },
        expecting: {
          type: 'string',
          description:
            'What a good answer looks like coming back: a list, a number, a recommendation with reasons.',
        },
      },
      required: ['bot', 'task'],
    },
    execute: async (args: any) => {
      const target = String(args?.bot ?? '').trim()
      const task = String(args?.task ?? '').trim()
      if (!target || !task) {
        return 'That handoff was not sent: name the Bot and say what you are asking it to do.'
      }

      // 深度闸排在最前面：它是唯一能真的止住环的那个。计数来自载荷而不是模型。
      if (ctx.depth >= caps.maxDepth) {
        return (
          'That handoff was not sent: this is already ' +
          ctx.depth +
          (ctx.depth === 1 ? ' Bot' : ' Bots') +
          ' deep, which is as far as this workspace allows. Answer with what you have, or ask the person.'
        )
      }
      if (asked >= caps.maxPerRun) {
        return (
          'That handoff was not sent: this turn has already asked ' +
          caps.maxPerRun +
          (caps.maxPerRun === 1 ? ' Bot' : ' Bots') +
          ', which is as many as this workspace allows. Answer with what you have, or ask the person.'
        )
      }

      const reachable = await ctx.listReachable()
      const resolved = resolveAddressedBot(reachable, target)

      if (resolved.kind === 'ambiguous') {
        // 两个都报 id，这是这条拒绝在指的那条出路；报的都是这个人本来就看得见的 Bot，
        // 所以没有多说出任何 roster 信息。
        const names = resolved.candidates.map((b) => b.name + ' (' + b.id + ')').join(', ')
        return (
          'More than one Bot answers to "' +
          target.slice(0, 60) +
          '": ' +
          names +
          '. Ask again using the id of the one you mean.'
        )
      }

      if (resolved.kind === 'none') {
        // 「不存在」和「不是你能问的」必须是同一句话，否则这成了一个枚举 roster 的接口。
        // 附带的名单无论问什么都一样，同样不泄露。
        const names = reachable.map((b) => b.name)
        const suffix =
          names.length > 0
            ? ' The Bots you can ask are: ' + names.join(', ') + '.'
            : ' You have not been given any Bot to ask.'
        return 'There is no Bot called "' + target.slice(0, 60) + '" that you can reach.' + suffix
      }

      const found = resolved.bot
      if (found.id === ctx.fromBotId) return selfRefusal(found.name)
      if (!ctx.sessionId) {
        return (
          'That handoff was not sent: this run is not in a conversation, ' +
          'so there is nowhere for another Bot to answer.'
        )
      }

      asked += 1

      const envelope: HandoffEnvelope = {
        task,
        ...(args?.constraints ? { constraints: String(args.constraints) } : {}),
        ...(args?.expecting ? { expecting: String(args.expecting) } : {}),
      }
      /*
       * 模型填了就照它说的；没填（或填了不认识的值）就从任务文本里读意图。
       *
       * 这一层兜底不是「猜」：用户说「让 nerve 给我发条消息」，那句「给我发」
       * 就在 task 里，是可判定的文本信号。原先一律默认 reply，于是每次都得靠模型
       * 记得多填一个可选字段 —— 它经常不填，用户就看到消息落在了自己正在问的窗口里。
       */
      const deliver: DeliverMode =
        args?.deliver === 'message' || args?.deliver === 'reply'
          ? args.deliver
          : inferDeliver(String(args?.task ?? ''))
      const from = await ctx.getBot(ctx.fromBotId)

      let outcome: 'queued' | 'already' | void
      try {
        outcome = await ctx.enqueue({
          fromBotId: ctx.fromBotId,
          fromName: from?.name,
          toBotId: found.id,
          toName: found.name,
          threadId: ctx.threadId ?? ctx.sessionId,
          cwd: ctx.cwd,
          envelope,
          deliver,
          depth: ctx.depth + 1,
          chain: [...ctx.chain, from?.name ?? ctx.fromBotId],
        })
      } catch (err: any) {
        // 这里也不抛：发起方的用户在等，它得有话可说。
        const msg = err?.message ? String(err.message) : String(err)
        return (
          'That handoff was not sent: ' +
          msg.slice(0, 500) +
          '. Tell the person it could not be queued, and answer with what you have.'
        )
      }

      /*
       * 关键的一句：**告诉它不要代答**。
       *
       * 起手最自然的实现是「等 B 跑完、把结果作为 tool result 返回」，那样 A 会拿到答复、
       * 顺便用自己的话概述一遍。这看起来没毛病，实际有两处坏掉的地方：A 在等的时候整轮卡住，
       * 以及用户看到的是 A 的转述而不是 B 的原话 —— 那正是 openbot 明确不要的东西。
       * 所以这里只确认「已经问了」，并把「答案会自己出现，你不要替它说」写进返回值，
       * 因为模型唯一会读的东西就是这段文本。
       */
      const where =
        deliver === 'message'
          ? "in " + found.name + "'s own conversation — the person will see it there, under its name"
          : 'in this conversation, under its own name'
      if (outcome === 'already') {
        /*
         * 幂等键命中了同一份交接。以前这里是静默返回，工具照样回「已交给 B」——
         * 用户在同一会话里再说一次「让 B 做 X」时，得到的是一个不会发生的承诺。
         * 如实说出来，并允许模型自己决定要不要换个说法再派。
         */
        return (
          'That exact handoff to ' +
          found.name +
          ' was already sent earlier and has not answered yet — it will not run again. ' +
          'If the person wants something different, restate the task in different words ' +
          'so it is a new handoff. Do not tell them it was sent again.'
        )
      }
      return (
        'Handed over to ' +
        found.name +
        '. It has not replied yet: its answer will arrive later as a separate message ' +
        where +
        '. End your turn now with one short sentence telling the person who you asked and ' +
        'what for. Do not answer on its behalf — anything you say as its answer before then ' +
        'would be invented, even if you know it.'
      )
    },
  }

  return { [HANDOFF_TOOL]: tool }
}

/** 一次性会话 id：交接跑完就删，别在侧栏留垃圾会话。 */
export function scratchSessionId(): string {
  return 'handoff-' + randomUUID()
}
