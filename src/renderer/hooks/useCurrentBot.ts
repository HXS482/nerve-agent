import { useMemo } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useRoutineStore } from '../stores/routineStore'
import { botInk } from '../lib/bot-avatar'
import { SHAPES_BY_ID, shapeForBot } from '../lib/bot-shapes'
import { useBotStatus } from './useBotStatus'
import type { BotStatus } from '../lib/botStatus'

/**
 * 「当前该露脸的那个 Bot」—— 顶栏那颗球和空会话中间的小人共用同一套判定，
 * 所以抽成 hook，避免两处各写一遍、然后慢慢长得不一样。
 *
 * 优先级：侧栏显式选中的 > 当前会话绑定的 > 默认 Bot > 列表第一个。
 *
 * 状态还有一条额外规则：如果「当前 Bot」和「当前会话所属 Bot」不是同一个，
 * 那这只球不该跟着这一轮跑状态（在转的不是它），一律按 idle 处理。
 */
export function useCurrentBot() {
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const bots = useRoutineStore((s) => s.bots)
  const activeBotId = useChatStore((s) => s.activeBotId)
  const sessionBotId = useChatStore((s) =>
    s.sessions.find((x) => x.id === s.currentSessionId)?.botId
  )
  const botStatus = useBotStatus(currentSessionId)

  const bot = useMemo(() => {
    if (bots.length === 0) return null
    const byActive = activeBotId ? bots.find((b) => b.id === activeBotId) : null
    if (byActive) return byActive
    const bySession = sessionBotId ? bots.find((b) => b.id === sessionBotId) : null
    return bySession ?? bots.find((b) => b.isDefault) ?? bots[0] ?? null
  }, [bots, activeBotId, sessionBotId])

  const shape = useMemo(() => {
    if (!bot) return shapeForBot('nerve')
    return (bot.avatarShape && SHAPES_BY_ID[bot.avatarShape]) || shapeForBot(bot.id)
  }, [bot])

  const ink = botInk(bot)
  const status: BotStatus =
    !bot || !sessionBotId || bot.id === sessionBotId ? botStatus : 'idle'

  return {
    bot,
    name: bot?.name ?? 'Bot',
    shape,
    ink,
    status,
    material: (bot?.avatarMaterial === 'fluffy' ? 'fluffy' : 'flat') as 'flat' | 'fluffy',
  }
}
