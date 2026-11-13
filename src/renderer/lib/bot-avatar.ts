/**
 * Bot 头像色板与取色。
 *
 * 单独抽出来是因为头像颜色要在两个地方保持一致：侧栏列表里的 Bot 行，
 * 以及顶部那颗跟随当前 Bot 的球。挂在组件里会导致 App 反向依赖列表组件。
 */

export const AVATAR_COLORS = ['#F5A524', '#5B8DEF', '#7C5CD6', '#2DBE8A', '#E5484D', '#00A3A3', '#D6409F']

/** 备用色板别名（面板里挑色用的就是这一套）。 */
export const AVATAR_PALETTE = AVATAR_COLORS

/** 按 id 散列取一个稳定颜色：同一个 Bot 每次刷新都是同一色。 */
export function avatarColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/** Bot 的最终墨色：显式设置优先，否则散列兜底。 */
export function botInk(bot: { id: string; avatarColor?: string } | null | undefined): string | null {
  if (!bot) return null
  return bot.avatarColor || avatarColor(bot.id)
}
