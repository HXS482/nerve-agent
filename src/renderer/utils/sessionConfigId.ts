/**
 * 会话级配置写入的 id 解析
 *
 * 渲染层给新会话建的临时 id 是 `session-<ts>`，只活在渲染层；主进程的真实
 * 会话 id 是 uuid（首轮消息之后才由后端分配，经 onDone / flow meta 回到渲染层）。
 *
 * 把临时 id 当 sessionId 传给主进程是**静默失败**：`AgentCore.setModel(model, sessionId)`
 * 会 getOrCreate 一个以该临时 id 为键的上下文，没有任何 run 会读到这份覆盖 ——
 * 用户点了模型选择器，界面上写着新模型，实际跑的却还是旧模型。
 *
 * 所以规则是：
 *   1) 没有会话                      → undefined（写全局，向后兼容）
 *   2) 临时 id 且有别名（后端 id）   → 返回别名
 *   3) 临时 id 且没有别名（首轮还没回后端 id）→ undefined（写全局；
 *      新会话本来就从全局默认继承，这一轮之后也读到正确配置）
 *   4) 真实 id                       → 原样返回
 */

/** 渲染层临时会话 id 的前缀（与 useClaude.send() 生成临时会话处保持一致） */
const TEMP_SESSION_PREFIX = 'session-'

/** 是否是渲染层自造的临时 id（后端不认识，绝不能发给主进程当会话 id） */
export function isTempSessionId(sid: string | null | undefined): boolean {
  return typeof sid === 'string' && sid.startsWith(TEMP_SESSION_PREFIX)
}

/**
 * 解析出可以安全发给主进程的会话级配置 id。
 *
 * `aliases` 是临时 id → 后端真实 id 的映射（渲染层 todoStore 的 aliases）。
 * 只在解析临时 id 时用得上；真实 id 直接透传。
 */
export function resolveConfigSessionId(
  sid: string | null | undefined,
  aliases: Record<string, string> = {},
): string | undefined {
  if (!sid) return undefined
  if (!isTempSessionId(sid)) return sid

  const real = aliases[sid]
  // 别名链路没接上，或别名自己又是临时 id → 宁可写全局，也不写进一个没人读的上下文
  if (!real || isTempSessionId(real)) return undefined
  return real
}
