/**
 * 记忆的 scope：一条记忆属于谁、谁能看见。
 *
 * ## 为什么不是「每个 Bot 一份 dataDir」
 *
 * 那样「用户是谁」会被蒸馏四遍（每份 persona.md 各写一次），四个 Bot 对老板的
 * 认知必然漂移；共享内容还得再搞一套跨库检索。隔离应该按**信息类型**分，
 * 不是按 Bot 分：
 *
 * - 用户档（他是谁、偏好、项目背景）→ 全局唯一，所有 Bot 看同一份
 * - Bot 档（我怎么干活、踩过什么坑）→ 每个 Bot 私有
 * - 共享板（团队共识）→ 所有人只读
 *
 * 所以这里只有**可见性**这一个概念，没有「所有权」。`agent_id` 是过滤器，
 * 不是主体 —— mem0 用 user_id 而不是 agent_id 作主体维度也是这个道理。
 *
 * ## 为什么把 botId 编进 sessionKey
 *
 * 同目录的 `tcvdb.ts` 里 `extractAgentId()` 本来就认 `agent:<id>:...` 这个前缀，
 * 而 nerve 一直传裸 UUID，于是那个字段永远是空字符串、按它建的索引从来没生效过。
 * 编码进 key 的好处是不用给 handleBeforeRecall / handleTurnCommitted /
 * CompletedTurn 一路加参数（那是 6 个签名 + 2 个接口 + gateway 那条独立路径）。
 *
 * 代价是格式有 4 个消费方（解析、JSONL 比对、pipeline 分组、工具过滤）——
 * 所以拼接和解析都必须走这里的函数，别在别处手写字符串。
 */

/** 老数据（升级前写入）没有 agent 维度，归这里：对所有 Bot 可见。 */
export const SHARED_SCOPE = "shared";

const PREFIX = "agent";

/**
 * 拼 scope key：`agent:<botId>:<sessionId>`
 *
 * botId 缺失时退化成 `agent:shared:<sessionId>` —— 宁可让它落到共享档，
 * 也不要写出 `agent::xxx` 这种解析出来是空串的畸形 key（那等于回到改造前）。
 */
export function buildScopeKey(botId: string | null | undefined, sessionId: string | null | undefined): string {
  const bot = (botId ?? "").trim() || SHARED_SCOPE;
  return `${PREFIX}:${bot}:${sessionId ?? ""}`;
}

/**
 * 从 scope key 里取 agent 维度。
 *
 * 兼容三种输入：
 * - `agent:<botId>:<sessionId>` → botId
 * - 裸 UUID（老数据、种子数据）→ SHARED_SCOPE
 * - 空串 → SHARED_SCOPE
 *
 * 返回值永远非空：调用方拿它做 `agent_id IN ($1, 'shared')` 的过滤，
 * 返回 '' 会让 IN 变成 `IN ('', 'shared')`，行为不可预期。
 */
export function parseAgentId(sessionKey: string | null | undefined): string {
  const key = (sessionKey ?? "").trim();
  if (!key) return SHARED_SCOPE;
  const parts = key.split(":");
  if (parts.length >= 2 && parts[0] === PREFIX) {
    return parts[1].trim() || SHARED_SCOPE;
  }
  return SHARED_SCOPE;
}

/**
 * 取 sessionId 部分（从 scope key 里剥掉 agent 前缀）。
 *
 * L0 的 session 分组、JSONL 比对都用得到 —— 它们关心的是「哪个会话」，
 * 不是「哪个 Bot」。拿 scope key 直接比对会把两个 Bot 里的同名会话当成不同会话。
 */
export function scopeSessionId(sessionKey: string | null | undefined): string {
  const key = (sessionKey ?? "").trim();
  const parts = key.split(":");
  if (parts.length >= 3 && parts[0] === PREFIX) {
    return parts.slice(2).join(":");
  }
  return key;
}

/**
 * 可见 scope 列表：自己的 + 公共的。
 *
 * 之所以不用 `agent_id = ? OR agent_id = ''`，是因为升级时会把老数据统一刷成
 * 'shared' 而不是留空 —— 留空时 FTS 的 MATCH 查询会意外命中一堆空串行。
 */
export function visibleAgentIds(botId: string | null | undefined): string[] {
  const bot = (botId ?? "").trim() || SHARED_SCOPE;
  return bot === SHARED_SCOPE ? [SHARED_SCOPE] : [bot, SHARED_SCOPE];
}
