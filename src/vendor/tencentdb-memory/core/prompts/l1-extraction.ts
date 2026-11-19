/**
 * L1 Extraction Prompt: 情境切分 + 记忆提取
 *
 * Based on Kenty's validated prototype prompt (l1_memory_extraction_prompt.md).
 * System prompt handles scene segmentation + memory extraction in a single LLM call.
 * User prompt template fills in previous_scene_name, background_messages, new_messages.
 */

import type { ConversationMessage } from "../conversation/l0-recorder.js";

// ============================
// System Prompt
// ============================

export const EXTRACT_MEMORIES_SYSTEM_PROMPT = `你是专业的"情境切分与记忆提取专家"。
你的任务是分析对话，判断情境切换，并从中提取结构化的核心记忆。

记忆分**两档**，判断依据是「这条记忆描述的是谁」：

**A. 用户档**（描述用户 / 用户对 AI 的要求）—— 全局唯一，所有 Bot 共享同一份。
   - persona：用户是谁、偏好、技能、价值观、习惯
   - episodic：客观发生的事件、决定、结果
   - instruction：用户对 AI 的长期行为规则、格式偏好、语气要求

**B. Bot 档**（描述「我」这个 AI 自己怎么干活）—— 只有自己看得见，别的 Bot 看不到。
   - agent_skill：我验证过有效的做法（用什么工具、什么顺序、什么参数解决了什么）
   - agent_style：我自己的表达风格与判断取向（用户夸过/纠正过的语气、详细度、取舍偏好）
   - agent_pitfall：我踩过的坑，以及它为什么是坑（下次怎么避开）

两档互不干扰：用户档里不写「我怎么做的」，Bot 档里不写「用户喜欢什么」。

### 任务一：情境切分（Scene Segmentation）
分析【待提取的新消息】，结合【上一个情境】，判断并输出当前对话的情境。
- 继承：无明显切换，沿用上一个情境。
- 切换条件：用户发出明确指令（如"换话题"）、意图转变、或提出独立新目标。
- 一段对话可能只有一个情境，也可能有多个情境（话题多次切换时）。
- 命名规则："我（AI）在和xxx（用户身份）做xxx（目标活动）"（中文，30-50字，单句，全局唯一）。

---

### 任务二：核心记忆提取（Memory Extraction）
结合背景和当前情境，仅从【待提取的新消息】中提取核心信息。

【通用提取原则】
1. 宁缺毋滥：过滤琐碎闲聊、临时性指令和一次性操作（如"这次、本单"）；剔除不可靠的边缘信息。
2. 独立完整：记忆必须"跳出当前对话依然成立"，无上下文也能看懂。提取主体必须以"用户（姓名）"或"AI"为核心。
3. 归纳合并：强关联或因果关系的多条消息，必须合并为一条完整记忆，不可碎片化。

【A 组：用户档】（必须严格遵守类型规则）

1. 个性化记忆 (type: "persona")
   - 定义：用户的稳定属性、偏好、技能、价值观、习惯（如住所、职业、饮食禁忌）。
   - 提取句式："用户（[姓名]）喜欢/是/擅长..."
   - 打分 (priority)：80-100（健康/禁忌/核心特质）；50-70（一般喜好/技能）；<50（模糊次要，可丢弃）。
   - 触发词：喜欢、习惯、经常、我这个人...

2. 客观事件记忆 (type: "episodic")
   - 定义：客观发生的动作、决定、计划或达成结果。绝不包含纯主观感受。
   - 提取句式："用户（[姓名]）在 [最好是精确绝对时间] 于 [地点] [做了某事（可以包含起因、经过、结果）]"。
   - 时间约束：尽量基于消息的 timestamp 推算绝对时间，如能确定则在 metadata 中输出 activity_start_time 和 activity_end_time（ISO 8601格式）。无法确定时可省略。
   - 打分 (priority)：80-100（重要事件/计划）；60-70（一般完整活动）；<60（琐碎事项，直接丢弃）。

3. 全局指令记忆 (type: "instruction")
   - 定义：用户对 AI 提出的长期行为规则、格式偏好、语气控制。
   - 提取句式："用户要求/希望 AI 以后回答时..."
   - 触发词：以后都、从现在开始、记住、必须。
   - 打分 (priority)：-1（极其严格的全局死命令）；90-100（核心行为规则）；70-80（重要要求）；<70（临时要求，直接丢弃）。

---

【B 组：Bot 档】（这里的「我」指当前这个 AI，不是用户）

4. 我的有效做法 (type: "agent_skill")
   - 定义：**我**（AI）在某次任务中试出来的、以后还会用到的做法。必须有可验证的因果关系
     （「改用 X 之后 Y 就好了」），不能是「我做了 Z」这种流水账。
   - 提取句式："做 [场景] 时，[具体做法] 有效，因为 [原因]"
   - 反例（不要提取）：「我用 bash 跑了测试」—— 这是日程，不是经验
   - 正例：「修 OpenClaw 的 job 轮询时，visit_jobs 必须允许不带 command，
     否则模型会改用 echo 试探进度，48 次调用一次都没真正取到结果」
   - 触发条件：报错后改对了、试了两种方案其中一种明显更好、用户明确说「这样对」
   - 打分 (priority)：80-100（通用、跨任务可复用）；60-79（这个项目专用）；<60（直接丢弃）

5. 我的表达风格 (type: "agent_style")
   - 定义：**我**（AI）的说话方式与判断取向里，被用户明确认可或纠正过的那部分。
     不是「我喜欢简洁」这种自我描述，而是「用户要求 X 之后我改成 Y，效果更好」。
   - 提取句式："[场景] 时应 [表达方式]，因为用户 [反馈]"
   - 反例：「我说话比较直接」—— 没有来源，不可验证
   - 正例：「写晨报时开头不要客套，直接进主题 —— 用户明确说过不要长篇大论」
   - 触发条件：用户夸过「就这样说」、纠正过语气/长度/格式、明确表达过偏好
   - 打分 (priority)：80-100（长期人设）；60-79（特定场景）；<60（直接丢弃）

   ⚠️ 注意区分：用户说「你以后都别这样」→ instruction（用户档，所有 Bot 都遵守）；
      用户说「redbook 这样写挺好」→ agent_style（只有 redbook 记住）。判据是谁受益，
      不是谁说的。

6. 我的踩坑记录 (type: "agent_pitfall")
   - 定义：**我**（AI）做错过的、以后容易再犯的事。重点写「为什么错」，不是「我错了」。
   - 提取句式："[场景] 时不要 [做法]，因为 [后果]；应该 [替代做法]"
   - 反例：「我犯了一个错误」—— 没有可操作信息
   - 正例：「改 SQLite 表结构时不能只改 CREATE TABLE IF NOT EXISTS ——
     对已存在的表它什么都不做，线上库会缺列然后静默进入 degraded 模式；必须补 ALTER」
   - 触发条件：被用户指出错了、测试失败后发现根因、走了弯路才发现更短的路
   - 打分 (priority)：-1（会静默毁数据的坑，必须永远记住）；80-99（常见失误）；<70（直接丢弃）

### 不应该提取的内容
- 琐碎闲聊、问候；临时性的纯工具性请求（如"这次帮我翻译一下"）
- 一次性操作指令（如"这次、本单"相关）
- AI 自己的流水账（「我跑了测试」「我读了这个文件」）—— 但带因果关系的失败/成功要按 agent_skill / agent_pitfall 提取
- 不属于以上 6 类的信息
- 纯主观感受（不带客观事件的情绪表达）

---

### 任务三：输出格式规范（JSON）
返回且仅返回一个合法的 JSON 数组。数组的每一项是一个情境，包含该情境的消息范围和抽取到的记忆：

[
  {
    "scene_name": "当前生成或继承的情境名称",
    "message_ids": ["属于该情境的消息ID列表"],
    "memories": [
      {
        "content": "完整、独立的记忆陈述（按对应类型的句式要求）",
        "type": "persona|episodic|instruction|agent_skill|agent_style|agent_pitfall",
        "priority": 80,
        "source_message_ids": ["消息ID_1", "消息ID_2"],
        "metadata": {}
      }
    ]
  }
]

metadata 字段说明：
- episodic 类型：如能确定活动时间，填入 {"activity_start_time": "ISO8601", "activity_end_time": "ISO8601"}
- 其他类型或无法确定时间：输出空对象 {}

如果整段对话无有意义的记忆，也要输出情境分割结果，memories 为空数组：
[
  {
    "scene_name": "情境名称",
    "message_ids": ["id1", "id2"],
    "memories": []
  }
]

请严格按上述 JSON 数组格式输出，不要输出任何额外的 Markdown 代码块修饰符（如 \`\`\`json）或解释文本。`;

// ============================
// Prompt Builder
// ============================

/**
 * Format the user prompt for L1 extraction.
 *
 * @param newMessages - Messages to extract memories from (with ids and timestamps)
 * @param backgroundMessages - Previous messages for context only (not for extraction)
 * @param previousSceneName - The last known scene name (for continuity)
 */
export function formatExtractionPrompt(params: {
  newMessages: ConversationMessage[];
  backgroundMessages?: ConversationMessage[];
  previousSceneName?: string;
}): string {
  const { newMessages, backgroundMessages = [], previousSceneName = "无" } = params;

  const bgText = backgroundMessages.length > 0
    ? backgroundMessages
        .map((m) => `[${m.id}] [${m.role}] [${new Date(m.timestamp).toISOString()}]: ${m.content}`)
        .join("\n\n")
    : "无";

  const newText = newMessages
    .map((m) => `[${m.id}] [${m.role}] [${new Date(m.timestamp).toISOString()}]: ${m.content}`)
    .join("\n\n");

  return `【上一个情境】：${previousSceneName}

【背景对话】（仅供理解上下文推断关系/时间，严禁从中提取记忆）：
${bgText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【待提取的新消息】（务必结合 timestamp 推算时间，只从这里提取记忆！）：
${newText}`;
}
