import { describe, it, expect } from 'vitest'
import {
  addressKey,
  resolveAddressedBot,
  readHandoffCaps,
  clipAnswer,
  handoffPrompt,
  buildBotHandoffTools,
  HANDOFF_TOOL,
  type HandoffCtx,
  inferDeliver,
} from '../../core/bot-handoff'
import type { BotInfo } from '../../core/bot-registry'

/** 只造测试要用的字段，其余给稳定默认值。 */
function bot(id: string, name: string, canAskBots: string[] | null = null): BotInfo {
  return {
    id,
    name,
    group: '',
    emoji: '',
    avatarColor: '',
    avatarOrb: true,
    instructions: '',
    isDefault: false,
    homeSessionId: '',
    boundSkills: [],
    boundMcp: [],
    canAskBots,
    createdAt: 0,
    updatedAt: 0,
  }
}

const knowledge = bot('bot_knowledge', 'Knowledge')
const assistant = bot('bot_assistant', 'General Assistant')

/** 不真的跑模型的 ctx：enqueue 由测试决定入队了什么。 */
function ctxOf(over: Partial<HandoffCtx> = {}): HandoffCtx {
  return {
    fromBotId: 'bot_assistant',
    sessionId: 'sess-1',
    cwd: 'C:/work',
    depth: 0,
    chain: [],
    caps: { maxDepth: 2, maxPerRun: 3 },
    reachable: [knowledge, assistant],
    listReachable: async () => [knowledge, assistant],
    getBot: async (id: string) => [knowledge, assistant].find((b) => b.id === id) ?? null,
    enqueue: async () => {},
    ...over,
  }
}

describe('addressKey', () => {
  it('把人对 Bot 的几种叫法削成同一个 key', () => {
    const k = addressKey('Knowledge')
    expect(addressKey('the Knowledge Bot')).toBe(k)
    expect(addressKey('@knowledge')).toBe(k)
    expect(addressKey('knowledge-bot')).toBe(k)
    expect(addressKey('Knowledge_Bot')).toBe(k)
    expect(addressKey('  THE  knowledge   bot ')).toBe(k)
  })

  it('名字里的 bot 是词的一部分时不动它', () => {
    expect(addressKey('Chatbot')).toBe('chatbot')
    expect(addressKey('Chat Bot')).toBe('chat')
  })
})

describe('resolveAddressedBot', () => {
  it('精确名字命中', () => {
    const r = resolveAddressedBot([knowledge, assistant], 'Knowledge')
    expect(r.kind).toBe('found')
    if (r.kind === 'found') expect(r.bot.id).toBe('bot_knowledge')
  })

  it('id 也算精确命中', () => {
    expect(resolveAddressedBot([knowledge, assistant], 'bot_knowledge').kind).toBe('found')
  })

  it('宽松读法也能落到同一个 Bot', () => {
    for (const said of ['the Knowledge Bot', '@knowledge', 'knowledge-bot']) {
      const r = resolveAddressedBot([knowledge, assistant], said)
      expect(r.kind).toBe('found')
      if (r.kind === 'found') expect(r.bot.id).toBe('bot_knowledge')
    }
  })

  it('同名两个 Bot 判 ambiguous 而不是挑一个', () => {
    const twins = [bot('bot_a', 'Knowledge'), bot('bot_b', 'Knowledge')]
    const r = resolveAddressedBot(twins, 'Knowledge')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.candidates).toHaveLength(2)
  })

  it('查无此 Bot 是 none', () => {
    expect(resolveAddressedBot([knowledge], 'Expense Manager').kind).toBe('none')
    expect(resolveAddressedBot([knowledge], '   ').kind).toBe('none')
  })
})

describe('readHandoffCaps', () => {
  it('没配就是默认值', () => {
    expect(readHandoffCaps({})).toEqual({ maxDepth: 2, maxPerRun: 3 })
  })
  it('0 表示关掉，不是无限制', () => {
    expect(readHandoffCaps({ NERVE_BOT_HANDOFF_MAX_DEPTH: '0' })).toEqual({ maxDepth: 0, maxPerRun: 3 })
  })
  it('乱填回落默认值', () => {
    expect(readHandoffCaps({ NERVE_BOT_HANDOFF_MAX_PER_RUN: 'abc' }).maxPerRun).toBe(3)
    expect(readHandoffCaps({ NERVE_BOT_HANDOFF_MAX_PER_RUN: '-5' }).maxPerRun).toBe(3)
  })
})

describe('clipAnswer', () => {
  it('短答复原样返回', () => {
    expect(clipAnswer('  hi  ')).toBe('hi')
  })
  it('超长答复被截断并注明', () => {
    const long = 'x'.repeat(9000)
    const out = clipAnswer(long)
    expect(out.length).toBeLessThan(long.length)
    expect(out).toContain('truncated')
  })
})

describe('handoffPrompt', () => {
  it('三件事分开说，且说明来源不是用户本人', () => {
    const text = handoffPrompt({
      fromName: 'General Assistant',
      envelope: { task: '列出上周未合并的 PR', constraints: '只看 main 分支', expecting: '一个列表' },
      chain: [],
    })
    expect(text).toContain('General Assistant')
    expect(text).toContain('not from the person')
    expect(text).toContain('Task: 列出上周未合并的 PR')
    expect(text).toContain('Constraints: 只看 main 分支')
    expect(text).toContain('一个列表')
  })
})

describe('buildBotHandoffTools', () => {
  it('能力被关掉（上限 0）时工具根本不出现', () => {
    expect(buildBotHandoffTools(ctxOf({ caps: { maxDepth: 0, maxPerRun: 3 } }))).toEqual({})
    expect(buildBotHandoffTools(ctxOf({ caps: { maxDepth: 2, maxPerRun: 0 } }))).toEqual({})
  })

  it('深度已到顶时工具根本不出现', () => {
    expect(buildBotHandoffTools(ctxOf({ depth: 2 }))).toEqual({})
    expect(buildBotHandoffTools(ctxOf({ depth: 1, caps: { maxDepth: 1, maxPerRun: 3 } }))).toEqual({})
  })

  it('常开时提供 message_bot，参数是结构化的字段（含 deliver）', () => {
    const def = buildBotHandoffTools(ctxOf())[HANDOFF_TOOL]
    expect(def).toBeTruthy()
    const props = (def.input_schema as any).properties
    expect(Object.keys(props).sort()).toEqual(['bot', 'constraints', 'deliver', 'expecting', 'task'])
    expect((def.input_schema as any).required).toEqual(['bot', 'task'])
    // deliver 必须是可选的：必填会逼模型每次都表态，而大多数交接就是 reply
    expect((def.input_schema as any).required).not.toContain('deliver')
    expect(props.deliver.enum).toEqual(['reply', 'message'])
  })

  it('成功交接：入队一条 hop，并且明确叫模型不要代答', async () => {
    const seen: any[] = [];
    const tools = buildBotHandoffTools(
      ctxOf({
        enqueue: async (work) => {
          seen.push(work);
        },
      }),
    );
    const out = await tools[HANDOFF_TOOL].execute({
      bot: 'the Knowledge Bot',
      task: '数一下未合并的 PR',
      constraints: '只看 main 分支',
      expecting: '一个数字',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      fromBotId: 'bot_assistant',
      toBotId: 'bot_knowledge',
      threadId: 'sess-1',
      depth: 1,
      chain: ['General Assistant'],
      envelope: { task: '数一下未合并的 PR', constraints: '只看 main 分支', expecting: '一个数字' },
    });
    // 入队是异步的：返回值必须说清「它还没回，答复稍后自己出现，别替它说」
    expect(typeof out).toBe('string');
    expect(out).toContain('Knowledge');
    expect(out).toContain('has not replied yet');
    expect(out).toContain('Do not answer on its behalf');
  })

  it('入队失败：给一句话而不是抛异常', async () => {    const tools = buildBotHandoffTools(
      ctxOf({
        enqueue: async () => {
          throw new Error('hops.db 打不开');
        },
      }),
    );
    const out = await tools[HANDOFF_TOOL].execute({ bot: 'Knowledge', task: 'x' });
    expect(typeof out).toBe('string');
    expect(out).toContain('not sent');
    expect(out).toContain('hops.db');
  })

  it('入队返回 already：如实说「早就派过了」，不许再承诺一次', async () => {
    const tools = buildBotHandoffTools(
      ctxOf({
        enqueue: async () => 'already',
      }),
    );
    const out = await tools[HANDOFF_TOOL].execute({ bot: 'Knowledge', task: '数一下未合并的 PR' });
    expect(typeof out).toBe('string');
    expect(out).toContain('already sent');
    expect(out).toContain('will not run again');
    expect(out).not.toContain('has not replied yet');
  })

  it('多跳时 threadId 用链起点，而不是当前这一跳的 scratch 会话', async () => {
    const seen: any[] = [];
    const tools = buildBotHandoffTools(
      ctxOf({
        sessionId: 'handoff-scratch-1',
        threadId: 'sess-user',
        depth: 1,
        enqueue: async (work) => { seen.push(work); },
      }),
    );
    await tools[HANDOFF_TOOL].execute({ bot: 'Knowledge', task: 'x' });
    expect(seen[0].threadId).toBe('sess-user');
  })

  it('问不存在的 Bot：给一句话，不抛异常，并说出能问谁', async () => {
    const tools = buildBotHandoffTools(ctxOf());
    const out = await tools[HANDOFF_TOOL].execute({ bot: 'Expense Manager', task: 'x' });
    expect(typeof out).toBe('string');
    expect(out).toContain('no Bot called');
    expect(out).toContain('Knowledge');
  })

  it('问自己：明确指出它就是被问的那个，让它自己干', async () => {
    const tools = buildBotHandoffTools(ctxOf());
    const out = await tools[HANDOFF_TOOL].execute({ bot: 'General Assistant', task: 'x' });
    expect(typeof out).toBe('string');
    expect(out).toContain('you are General Assistant');
  })

  it('同名两个 Bot：拒绝并报出 id，而不是猜', async () => {
    const twins = [bot('bot_a', 'Knowledge'), bot('bot_b', 'Knowledge')];
    const tools = buildBotHandoffTools(ctxOf({ listReachable: async () => twins }));
    const out = await tools[HANDOFF_TOOL].execute({ bot: 'Knowledge', task: 'x' });
    expect(typeof out).toBe('string');
    expect(out).toContain('More than one Bot');
    expect(out).toContain('bot_a');
    expect(out).toContain('bot_b');
  })

  it('扇出闸：一轮问满上限后拒绝', async () => {
    let enqueued = 0;
    const tools = buildBotHandoffTools(
      ctxOf({
        caps: { maxDepth: 5, maxPerRun: 1 },
        enqueue: async () => {
          enqueued += 1;
        },
      }),
    );
    await tools[HANDOFF_TOOL].execute({ bot: 'Knowledge', task: 'a' });
    const second = await tools[HANDOFF_TOOL].execute({ bot: 'Knowledge', task: 'b' });
    expect(enqueued).toBe(1);
    expect(typeof second).toBe('string');
    expect(second).toContain('already asked 1 Bot');
  })

  it('缺 bot / task 时拒绝', async () => {
    const tools = buildBotHandoffTools(ctxOf());
    expect(await tools[HANDOFF_TOOL].execute({ bot: '', task: 'x' })).toContain('not sent');
    expect(await tools[HANDOFF_TOOL].execute({ bot: 'Knowledge', task: '' })).toContain('not sent');
  })

  it('bot 字段是枚举：可问的 Bot 被列成选项，不用猜名字', () => {
    const def = buildBotHandoffTools(ctxOf())[HANDOFF_TOOL]
    const bot = (def.input_schema as any).properties.bot
    expect(bot.enum).toEqual(['Knowledge', 'General Assistant'])
    expect(bot.description).toContain('Knowledge')
  })

  it('同名两个 Bot 时枚举用 id，避免两个一模一样的选项', () => {
    const twins = [bot('bot_a', 'Knowledge'), bot('bot_b', 'Knowledge')]
    const def = buildBotHandoffTools(ctxOf({ reachable: twins, listReachable: async () => twins }))[HANDOFF_TOOL]
    const b = (def.input_schema as any).properties.bot
    expect(b.enum).toEqual(['bot_a', 'bot_b'])
  })

  it('工具描述里点名「用户说让 X 做就是指派」', () => {
    const def = buildBotHandoffTools(ctxOf())[HANDOFF_TOOL]
    expect(def.description).toContain('WHEN THE PERSON NAMES ONE OF THEM')
    expect(def.description).toContain('Knowledge')
  })

  it('没有会话时拒绝（答复没地方落）', async () => {
    const tools = buildBotHandoffTools(ctxOf({ sessionId: '' }));
    const out = await tools[HANDOFF_TOOL].execute({ bot: 'Knowledge', task: 'x' });
    expect(typeof out).toBe('string');
    expect(out).toContain('not sent');
  })
})

describe('inferDeliver：模型没填 deliver 时，从任务文本里读意图', () => {
  const cases: Array<[string, 'reply' | 'message']> = [
    // 「让 nerve 给我发条消息」—— 就是这次报的那个 bug
    ['给用户发条消息，简单介绍一下自己', 'message'],
    ['发个信息给我', 'message'],
    ['让它跟我说句话', 'message'],
    ['完成后告诉我一声', 'message'],
    ['有结果了联系我', 'message'],
    ['send me a message when done', 'message'],
    ['please ping me', 'message'],
    ['talk to me about the schedule', 'message'],
    // 这些是「问一个问题」，答案该落在提问的会话里
    ['查一下这周合并了哪些 PR', 'reply'],
    ['整理一下这个模块的职责', 'reply'],
    ['帮我看看构建为什么失败', 'reply'],
    ['count open pull requests', 'reply'],
    ['', 'reply'],
  ]
  for (const [text, want] of cases) {
    it(`${JSON.stringify(text)} → ${want}`, () => {
      expect(inferDeliver(text)).toBe(want)
    })
  }
})
