/**
 * 会话级工作目录解析。
 *
 * 工具曾经统一跑在 agent-core 的全局 `projectDir` 里，多会话并行时
 * 一个会话切的目录会串到别的会话。渲染层早已按会话保存 `cwd`，只是
 * 从未发给后端。这里做唯一的解析点：payload 带非空 `cwd` 就用它，
 * 否则（老会话没有该字段 / 传了空串）回落到全局目录，保持兼容。
 */
export function resolveCwd(fallback: string, payloadCwd?: string): string {
  // 判空用 trim：纯空白（' '）既不是有意义的目录，也不是老会话的 undefined。
  // 放它过去会让工具在一个不存在的路径上跑（getBuiltinTools 里 existsSync 失败
  // 会静默退回 $HOME）。返回的仍是原值，路径中间的空格/中文不动。
  return typeof payloadCwd === 'string' && payloadCwd.trim().length > 0 ? payloadCwd : fallback
}
