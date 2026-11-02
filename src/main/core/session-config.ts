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
