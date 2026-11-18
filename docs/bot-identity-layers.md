# Bot 差异化方案 v2

> 状态：待确认
> 日期：2026-11-16
> 上一版：本文件原名 `bot-identity-layers.md`，v1 提「五层提示词」，被代码勘察和产品评审否掉一半。这一版基于实测事实重写，原 v1 内容见文末附录。

## 0. 先说 v1 错在哪

不是为了让步，是为了避免再走一遍同样的弯路。

| v1 的判断 | 代码事实 | 结论 |
|---|---|---|
| `instructions` 只有一行角色描述，压不住 soul | `agent-core.ts:668` 把**整段** instructions 完整注入 `<bot>` 层 | 机制是完整的，误判 |
| 需要新增 base 层装产品约束 | 你的 soul（175 字）里**根本没有**「不暴露技术实现、跟随语言」这些句子 | 那不是搬家，是凭空新增用户改不了、无法排查的行为约束 |
| 需要把 instructions 拆成 role + style | 4 个 Bot 里 **3 个 instructions 是空字符串**，第 4 个是 `"15556"` | 字段是空的，不是不够 |
| 记忆层已按 sessionId 分区 | 召回 SQL 无任何 session/bot 过滤（`store/sqlite.ts` 的 `l1_fts` 查询），persona 是全局单文件 | 事实错误 |

**根因**：我在看一个「角色设定全空」的系统，却得出了「提示词架构需要重构」的结论。这是把「内容没填」误诊成「机制不好」。

## 1. 事实基线（2026-11-16 实测你这台机器）

```
soul        175 字   第一句：「你叫咕嘎，敬厚萍（ARCH）给你取的名字」
persona    2938 字   注入位置在 bot 层**之后**（顺序 persona 压 bot）
skills     ~3000 字  索引文本，无差别注入给每个 Bot
bots       change&review: ""   nerve: ""   chovey: "15556"   Assistant: ""
```

代码事实：

- `bot.name` 在系统提示里出现 **0 次**（只在建会话标题时用过一次，`agent-core.ts:1143`）
- `boundSkills` / `boundMcp` 全仓 **0 处运行时读取**——只有类型定义、`create()` 时写 `[]`、`update()` 的签名里带着
- skill 过滤走的是全局 `settings.disabledSkills`，与 Bot 无关
- assistant 气泡**没有归属**——只有 `answeredBy`（交接答复）才画头像和名字
- 每个 Bot 每轮注入的 persona 和召回记忆**完全相同**

## 2. 这是一个产品定位问题，先选一条路

用户的困惑不是技术问题，是**三处表达互相矛盾**：

1. 侧栏一排带脸的球，各自有名字
2. 系统提示硬写着「他们都是**独立的同事**，不是你」
3. 底下是同一份 175 字的灵魂，每个都自称咕嘎

两条路，必须选一条，停在中间就是现在这个「两不像」：

### 路线一：一个咕嘎，多个岗位

- Bot = 岗位 / 工作台，不是人格
- 共享 soul、记忆、模型
- 差异来自：**名字、职责、可用技能、UI 归属**
- 成本低，失忆感为零
- UI 口径统一到「岗位」：「咕嘎 · 研发岗」

### 路线二：多个独立个体

- 每个 Bot 独立 soul、独立记忆 scope、独立模型、独立技能
- 成本高一个数量级
- 要回答一堆没法回答的问题：两个 Bot 记岔了听谁的？跨 Bot 记忆怎么合并？

### 建议走路线一

理由三条：

1. **今天已有的机制在路线一下全都成立**：routine（定时任务）、`canAskBots`（授权）、独立 session、交接落款。这些都不需要「独立人格」这个前提。
2. **用户要的是「说得清」，不是「真的独立」**。「我刚跟咕嘎的研发岗聊完」是自洽的；「我有五个 Bot 但它们说话一样」才是不自洽的。
3. **路线二的前提条件当前一个都不具备**（独立记忆需要 scope 设计、独立模型需要按 Bot 路由、独立技能需要接死字段），先做路线一不会挡住以后转路线二，反过来会。

路线一的代价是：**必须在 UI 和提示词里把这件事说出来**，不能靠暗示。

## 3. 方案：四条改动，按性价比排序

原则：**每一条都要能在 UI 上被看见**。提示词里改了但屏幕上没变化，就等于没改。

### 3.1 P0 —— Bot 知道自己叫什么

**现状**：`bot.name` 进系统提示 0 次。所有 Bot 靠 soul 第一句自称咕嘎。

**改动**：

`src/main/core/system-prompt.ts` 的 `<bot>` 层前面加一行自我认知：

```ts
const botText = bot?.trim()
if (botText || botName) {
  const selfLine = botName
    ? `你在这个工作台里的名字是「${botName}」。用户用这个名字叫你，就是在叫你。`
    : ''
  layers.push(`<bot>\n${[selfLine, botText].filter(Boolean).join('\n\n')}\n</bot>`)
}
```

`agent-core.ts:666` 多传一个 `botName: bot.name`。

**同时必须改 soul**（关键，否则前功尽弃）：

```diff
- 你叫咕嘎，敬厚萍（ARCH）给你取的名字。
+ 用户把这个工作台叫「咕嘎」——那是整个工作台的名字，不是你的名字。
+ 你自己叫什么，见下面 <bot> 层。
```

**验收**：新建两个 Bot，分别问「你是谁」，报出不同名字。

**为什么排第一**：不做这条，后面所有改动都会被 soul 第一句覆盖。

---

### 3.2 P0 —— 每个气泡有归属

**现状**：`MessageBubble` 只有 `answeredBy`（交接答复）才画头像和名字。你自己在某个 Bot 窗口里聊天，气泡是**匿名的**——全程只有一个顶栏小球换颜色。

这是「分不清在跟谁说话」的**最大单一来源**，而且和提示词完全无关。

**改动**：

`MessageBubble.tsx` 的普通 assistant 分支加一个轻量落款（不是头像气泡，那太重）：

```
● nerve · 研发                              18:42
```

小圆点用 Bot 的 `avatarColor`。只在 `role === 'assistant'` 且不是交接答复时显示。

`InputBar` 输入框上方左侧加当前 Bot 标识（同样是小圆点 + 名字 + 岗位），点一下能切。

**验收**：截一张图，不读文字也能看出「在跟谁说话」。

**为什么排第二**：纯 UI，风险零，感知最大。

---

### 3.3 P1 —— 技能按 Bot 分配（技能白名单）

**现状：**

- nerve 实际只扫描 `<dir>/.agents/skills/`，**不是** Alma 的 `~/.config/alma/skills/`
- 你这台机器上只有 **2 个**技能：`image-generator`、`svg-animated-diagram`
- `BotInfo.boundSkills` 全仓 **0 处运行时读取**——字段是死的
- 技能开关是全局的（`settings.disabledSkills`），设置页有一个 Skills 页签能切，但那是**全局**开关

**目标**：创建 Bot 时从技能目录里选「Base + 特定技能」，之后还能自由增删。

#### 3.3.1 语义：白名单，不是权限

先说一个容易踩的坑。技能不是能力，技能是**「怎么用能力」的说明书**：

```
image-generator        → powershell + Invoke-RestMethod   （需要 Bash）
svg-animated-diagram   → 直接写 SVG 字符串                  （需要 Write）
```

所以 `boundSkills` 的语义必须是 **「索引过滤」**，不是「权限」：

| 语义 | 行为 | 会不会破坏东西 |
|---|---|---|
| 索引过滤（采用） | 不在白名单的技能**不出现在系统提示的技能索引里**，也不能被 `load_skill` 加载 | 不会。加了新技能，老 Bot 行为不变 |
| 权限（不采用） | 技能能加载，但因为缺工具执行失败 | 会。用户看到「它说它会画，画出来报错」，比没有更糟 |

**推论**：`boundSkills` 不能承诺「加载了就能用」。能不能用取决于工具。这一版不解决工具边界，但要在 UI 里提示。

#### 3.3.2 数据

`BotInfo` 已有 `boundSkills: string[]`，复用，不新增字段。

三个状态的语义：

```jsonc
{
  "boundSkills": []            // 空 = 不过滤，看得到全部（默认，老 Bot 不受影响）
  "boundSkills": ["a", "b"]    // 只看得到 a 和 b
}
```

为什么空是「全部」而不是「一个都没有」：现在 4 个 Bot 的 `boundSkills` 都是 `[]`，
如果把空解释成「一个都不给」，升级完所有 Bot 立刻失去全部技能。

#### 3.3.3 三个改动点

**① registry 归一化（两处，必须都改）**

`bot-registry.ts` 的 `read()` 和 `list()` 各写了一遍字段归一化。
只改一处会导致「自己眼里」和「同事眼里」的 Bot 不一致——系统提示用 `get()`→`read()`，coworkers 名单用 `list()`。

```ts
boundSkills: raw.boundSkills ?? [],
```

**② 索引过滤**（`agent-core.ts:721` 附近）

```ts
const allSkills = this.skillRegistry.getEnabled()
// Bot 有白名单就只看白名单里的；空 = 全部
const botSkills = bot?.boundSkills ?? []
const visible = botSkills.length > 0
  ? allSkills.filter(s => botSkills.includes(s.id))
  : allSkills
```

eager 和 lazy 两条分支都要用 `visible`。

**③ `load_skill` 加白名单检查**（`tools.ts:866`）

顺便补一个已存在的洞：

```ts
// 现状：get() 不看 disabled 集合，被禁用的技能猜中名字还是能加载
const skill = skillRegistry.get(args.skill_name)
if (!skill) return { error: 'not found' }
```

改成：

```ts
const skill = skillRegistry.get(args.skill_name)
if (!skill || !skillRegistry.isAvailable(args.skill_name, allowedSkills)) {
  return { error: `技能 "..." 在这个 Bot 上不可用。可用：...` }
}
```

`isAvailable` 需要新增，同时检查 disabled 和 Bot 白名单。

#### 3.3.4 UI：创建时选「Base + 特定技能」

**创建 Bot 的流程改成三步**（现在是只有名字一个输入框）：

```
① 名字        [ nerve          ]
② 岗位模板     [ 研发 | 调研 | 文案 | 生活 | 空白 ]
③ 技能         Base（始终包含）        ✓ websearch 类
              特定技能                 ☑ image-generator
                                      ☐ svg-animated-diagram
```

**「Base」是什么**：一组始终包含的通用技能（搜索、发文件这类）。现在 nerve 只有 2 个技能，
而且两个都是「画东西」，所以 **Base 暂时为空** —— 这一版不做 Base 概念，只做「勾选」。

代码里预留一个常量，将来技能多了再填：

```ts
// 所有 Bot 都该有的技能。现在为空，因为现有的 2 个技能都是专用技能。
const BASE_SKILLS: string[] = []
```

**自定义时自由取消**：外观页签 → 新增「技能」分区：

```
技能
┌────────────────────────────────┐
│ ☑ image-generator   生成图片   │
│ ☐ svg-animated-diagram  画SVG  │
│                                │
│ 一个都不勾 = 继承全局（全部）    │
└────────────────────────────────┘
```

**注意**：一个都不勾等于 `[]`，也就是「全部」——这一点要在 UI 上写明，否则用户会以为「不勾 = 没有」。

#### 3.3.5 新增 IPC

```ts
GET_BOT_SKILLS: 'bot:skills'   // 列出所有已发现的技能（id + name + description）
```

现有 `GET_SKILLS`（`ipc.ts:262`）返回的是 `Skill[]`，包含 `enabled`，够用。直接复用：
渲染层已经有 `window.claude.getSkills()`，`SkillsTab` 在用。

所以**不需要新 IPC**，直接把 `getSkills()` 接到 RoutinesView 里。

#### 3.3.6 验收

| 场景 | 期望 |
|---|---|
| 新建 Bot 只勾 `image-generator` | 它的系统提示索引里只有这一个技能 |
| 让它画 SVG | 它说看不到这个技能的能力（`load_skill` 拒绝） |
| 老 Bot（`boundSkills: []`） | 行为完全不变，两个技能都在 |
| 设置页把某个技能全局关掉 | 所有 Bot 都看不到（全局 disabled 优先） |

**优先级**：这一版做。它是「自定义 Bot」的最小可用形态——不能选技能，自定义就只是改个名字。


### 3.4 P2 —— 岗位模板（降低填写门槛）

**现状**：4 个 Bot 里 3 个 instructions 是空的，第 4 个是「15556」。已有的 4 行 textarea 没人填。

**改动**：

新建 Bot 时不再是空白表单，而是选一个模板：

| 模板 | 预填的 instructions | 默认勾选的技能 |
|---|---|---|
| 研发 | 「你是这个工作区的工程负责人。看代码先读再改，改完说清为什么。」 | 全部（现在只有 2 个） |
| 调研 | 「你负责查资料、比方案、给结论。结论要有出处。」 | 全部 |
| 文案 | 「你负责写。先问清给谁看，再动笔。」 | 全部 |
| 生活 | 「你负责日程、提醒、杂事。」 | 全部 |
| 空白 | 不填，自己写 | 全部 |

**为什么模板不预填技能**：nerve 现在只有 2 个技能，而且都是「画东西」——
按岗位分配会变成「研发不给画图、文案给画图」这种没有依据的划分。
等技能变多（尤其出现「查资料」「发文件」这类通用技能）之后再让模板预填。
这一版模板只预填 instructions。

选完可以改。**默认就有内容，不再是空框。**

**为什么这条排最后**：它是 P1 的配套——模板的真正价值是「顺便把 boundSkills 填上」，没有 P1 它只是个 placeholder。

## 4. v1 里被砍掉的，以及为什么

| v1 提议 | 砍掉的理由 |
|---|---|
| 新增 `base` 硬编码层 | 你的 soul 里没有那些句子，那不是搬家是幽入。用户改不了、出问题无法排查。**如果以后真需要**（比如发现模型会念 API key），再单独加，一次只加一条 |
| `identity.role` + `identity.style` 两个新字段 | role 复用现有 `instructions` 就够；style 已有 4 行 textarea 都空着，再加一个空框只会得到「简洁、专业、友好」——一句对所有模型等于什么都不说的话，甚至会把所有 Bot 推向同一个中位数 |
| 五层提示词框架 | 4 层变 5 层不产生任何用户可感知的差异，只增加维护成本和 token |
| `<layer-order>` 段 | 写给维护者看的注释，占了每轮 token。优先级靠位置和措辞实现，不靠自我说明 |
| 每 Bot 独立记忆 scope | 会引出「两个 Bot 记岔了听谁的」这类没法回答的问题。当前真正的问题是**共享的部分太吵**（persona 2938 字），不是「不够独立」 |
| 每 Bot 不同模型 | 长期值得做（快/深两档，暴露为档位不暴露模型名），但不是这一版。它需要按 Bot 路由模型，牵动 provider 层 |

## 5. 落地顺序与验收

| # | 改动 | 涉及文件 | 风险 | 验收标准 |
|---|---|---|---|---|
| 1 | `bot.name` 进提示 + 改 soul 第一句 | `system-prompt.ts`、`agent-core.ts`、`soul` 配置 | 低 | 问「你是谁」，两个 Bot 报不同名字 |
| 2 | 气泡 + 输入框显示归属 | `MessageBubble.tsx`、`InputBar.tsx` | 零 | 截图可辨 |
| 3 | 技能按 Bot 分配 | `bot-registry.ts`（两处归一化）、`agent-core.ts`（索引过滤）、`tools.ts`（load_skill 校验）、`RoutinesView.tsx`（勾选 UI） | 中 | 只勾一个技能的 Bot，索引里只有那一个；让它用另一个技能会被拒 |
| 4 | 岗位模板 | `RoutinesView.tsx`、`bot-registry.ts` | 低 | 新建 Bot 不用写一个字 |

前两步约半天到一天；3、4 各半天。

## 6. 已知风险，写在这里免得踩

### 6.1 两个 AgentCore 能力不对等

`gateway.ts:74` 另建了一个 core，不传 settings、不挂 memoryCore、全仓无 `reloadProvider` 调用。

后果：gateway 进来的轮次**既没有 persona/记忆，也永远拿不到新 soul**。

这一版不修（超出范围），但要记着：所有关于「改了配置怎么生效」的判断都只对 IPC 路径成立，gateway 路径要重启。

### 6.2 gateway / routine 丢 botId

`session-router.ts:286`、`ticket-router.ts:232`、`agent-core.ts:182` 都不传 `botId`，靠 `resolveBot` 回落默认 Bot 或 session meta。

一旦「Bot 身份」成为区分的主要手段，这条回退会**静默把 Bot 换成默认 Bot**——不是「没有身份」，是「另一个人的身份」。

P0-1 落地后要观察：从 gateway 发起的对话，Bot 名字对不对。如果不对，得把 `botId` 补进那条链路。

### 6.3 soul 改动需要触发 reload

`AgentCore` 在构造时缓存整份 settings（`agent-core.ts:221`），`prepareMessages` 读 `this.settings.soul`。改 soul 必须走 `reloadProvider()`。

好消息：`index.ts:364` 有 chokidar 监听 `~/.nerve/settings.json`，300ms debounce 后自动调 `claude.reloadProvider()`。所以**编辑文件是热生效的**（IPC 路径）。

坏消息：gateway 那个实例碰不到这个 watcher（见 6.1）。

### 6.4 Bot 配置是热生效的

`BotRegistry.read()` 每次都读盘，`prepareMessages` 每轮重新算提示词，无缓存、无 diff。**改 Bot 的 instructions / boundSkills 下一轮就生效**，不用重启。

### 6.5 `load_skill` 不检查 disabled（已存在的洞）

`tools.ts:866`：

```ts
const skill = skillRegistry.get(args.skill_name)   // get() 不看 disabled 集合
if (!skill) return { error: 'not found' }
```

`get()` 是 `this.skills.get(name)`，不过滤。只有 `getEnabled()` / `listIndex()` 过滤。
所以现在：**被全局禁用的技能，模型猜中名字还是能加载。**

现在影响很小（就 2 个技能，名字都在描述里露着）。但 §3.3 要把 boundSkills 当白名单用，
这个洞就成了绕过白名单的后门，必须一起补。

### 6.6 persona 会压掉 bot 层

`composeSystemPrompt` 的顺序是 soul → bot → persona → memory。persona 2938 字，明确写着「朋友式语气」，排在 bot 层之后。

模型对后出现的指令更听话。**这就是为什么只靠提示词改不出差异。**

P0-1 的 `botName` 自我认知能部分对冲（因为它是「你是谁」级别的事实，不是语气偏好），但真要改语气，得动 persona 或调整层序。**这一版不动 persona**——它是记忆层生成的文件，改它要连带改生成逻辑。

## 7. 三件事需要你定

### ① chovey 的 instructions 是「15556」

按键误触存进去的。要不要清掉？

### ② soul 第一句怎么改

我提议：

```
用户把这个工作台叫「咕嘎」——那是整个工作台的名字，不是你的名字。
```

但这会让 soul 变长，而且「咕嘎」这个称呼在 persona 里也有（「AI 伙伴：定名咕嘎」）。要改就得三处一起改（soul / persona 生成逻辑 / UI 文案）。

**或者**：不改 soul，改 `<bot>` 层的措辞——加一句「用户管整个工作台叫咕嘎，但你在工作台里的名字是 X」。这样只动代码不动配置。

我倾向后者：改动小、不用改 persona、老用户零迁移。

### ③ 技能要不要「Base」概念

你说的机制是「Base + 特定技能」。但 nerve 现在只有 2 个技能（`image-generator`、`svg-animated-diagram`），
而且两个都是「画东西」——没有哪个算 Base。

两个选择：

- **先不做 Base**，只做「勾选列表」，空 = 全部。等技能变多再抽 Base（推荐）
- **现在就定义 Base**，先写成一个空常量 `BASE_SKILLS = []`，占位

我倾向第一个：`BASE_SKILLS = []` 现在是个空数组，
它和「不做 Base」在代码上是同一件事，但在文档里多了一个概念，读者要花力气理解一个还没生效的东西。


## 附录：v1 为什么被否

保留这段是为了记住判断依据，不是自罚。

v1 的核心错误是：**把「内容没填」误诊成「机制不好」**。

诊断时我看到的是「所有 Bot 说话一样」，于是去翻架构，发现「soul 只有一份」。但漏掉了一个更基础的事实——4 个 Bot 里 3 个的 instructions 是空的。

一个机制完整、但内容全空的系统，看起来和「机制不好」一模一样。区分它们的方法只有一个：**去读实际数据，而不是读类型定义**。

