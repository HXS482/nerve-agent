/**
 * 会话级配置合并
 *
 * AgentCore 只有一份全局 config；每个 session 可以带自己的 Partial<ClaudeConfig>
 * 覆盖其中若干字段（模型 / provider / effort …）。运行时读配置一律走这里，
 * 才能让 `ctx.config` 真正生效。
 */

import type { ClaudeConfig } from '../../shared/types'
import type { SessionContext } from './session-context'

/**
 * 合并全局配置与会话级覆盖，返回新的配置对象。
 *
 * 不修改 `base`：全局 config 是单例状态，任何就地写入都会污染其他会话。
 */
export function mergeConfig(base: ClaudeConfig, ctx: SessionContext): ClaudeConfig {
  return { ...base, ...ctx.config }
}

/**
 * 按 sessionId 查上下文并合并 —— 会话不存在（没有覆盖）时就是全局配置的副本。
 *
 * 抽成纯函数是为了能被单测直接钉住：`getSessionUsage` 之类的读取路径必须走它，
 * 否则会话覆盖了 model 的会话会按全局 model 的 context window 报给用量环。
 */
export function mergeConfigForSession(
  base: ClaudeConfig,
  ctx?: SessionContext | null,
): ClaudeConfig {
  return ctx ? mergeConfig(base, ctx) : { ...base }
}
