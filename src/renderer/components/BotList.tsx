import { useMemo, useState } from 'react'
import { useChatStore, type Session } from '../stores/chatStore'
import { useRoutineStore, type Bot } from '../stores/routineStore'
import { GrokBot } from './GrokBot/GrokBot'
import { AVATAR_PALETTE, avatarColor } from '../lib/bot-avatar'
export { AVATAR_PALETTE }

function relTime(ts: number): string {
  const d = new Date(ts)
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return mins + ' 分钟前'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours + ' 小时前'
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}


export function BotAvatar({
  bot,
  size = 34,
  animate = false,
  paper = '#0a0a0a',
  status = 'idle',
}: {
  bot: Bot
  size?: number
  /** 是否播放动画；列表里只让当前 Bot 动，其余画静帧（几十个 rAF 会卡主线程） */
  animate?: boolean
  /** 头像所在容器的底色：眼睛是轮廓上的洞，靠这层垫住，传错会透出背景 */
  paper?: string
  status?: 'idle' | 'thinking' | 'busy' | 'done' | 'error'
}) {
  const ink = bot.avatarColor || avatarColor(bot.id)

  if (bot.avatarOrb !== false) {
    return (
      <div className="flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
        <GrokBot size={size} color={ink} paper={paper} animate={animate} status={status} />
      </div>
    )
  }

  return (
    <div
      className="flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: ink,
        fontSize: Math.round(size * 0.46),
        lineHeight: 1,
        color: '#fff',
        fontWeight: 600,
      }}
    >
      {bot.emoji || bot.name.slice(0, 1)}
    </div>
  )
}

interface Props {
  onSelectSession: (session: Session) => void
  onNewChat: () => void
  /** 当前会话的运行状态：只喂给被选中的那个 Bot 的头像 */
  status?: 'idle' | 'thinking' | 'busy' | 'done' | 'error'
}

export function BotList({ onSelectSession, onNewChat, status = 'idle' }: Props) {
  const sessions = useChatStore((s) => s.sessions)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const activeBotId = useChatStore((s) => s.activeBotId)
  const theme = useChatStore((s) => s.theme)
  const setActiveBotId = useChatStore((s) => s.setActiveBotId)
  const bots = useRoutineStore((s) => s.bots)
  const loadBots = useRoutineStore((s) => s.loadBots)
  const loadRoutines = useRoutineStore((s) => s.loadRoutines)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useMemo(() => { void loadBots() }, [loadBots])

  const latestByBot = useMemo(() => {
    const map = new Map<string, Session>()
    for (const s of sessions) {
      if (s.mode === 'stage') continue
      const key = s.botId || ''
      const prev = map.get(key)
      if (!prev || (s.updatedAt || s.createdAt) > (prev.updatedAt || prev.createdAt)) map.set(key, s)
    }
    return map
  }, [sessions])

  const groups = useMemo(() => {
    const order: string[] = []
    const byGroup = new Map<string, Bot[]>()
    for (const b of bots) {
      const g = b.group || '未分组'
      if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g) }
      const list = byGroup.get(g)
      if (list) list.push(b)
    }
    order.sort((a, b) => (a === '未分组' ? 1 : b === '未分组' ? -1 : 0))
    return order.map((g) => ({ name: g, bots: byGroup.get(g) || [] }))
  }, [bots])

  const openBot = (bot: Bot) => {
    setActiveBotId(bot.id)
    void loadRoutines(bot.id)
    const latest = latestByBot.get(bot.id)
    if (latest) onSelectSession(latest)
    else onNewChat()
  }

  const toggleGroup = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  if (bots.length === 0) {
    return (
      <div className="px-3 py-4 text-[11px]" style={{ color: 'var(--text-on-surface-variant)' }}>
        还没有 Bot
      </div>
    )
  }

  return (
    <div>
      {groups.map(({ name, bots: groupBots }) => {
        const isCollapsed = collapsed.has(name)
        return (
          <div key={name} style={{ marginBottom: 6 }}>
            <button
              onClick={() => toggleGroup(name)}
              className="flex items-center gap-1.5 w-full text-left cursor-pointer transition-colors"
              style={{ padding: '6px 6px 4px 6px', background: 'transparent', border: 'none', borderRadius: 4 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-on-surface-variant)', flexShrink: 0 }}>
                <path d="M4 6a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
              </svg>
              <span className="text-[11px] flex-1 truncate" style={{ color: 'var(--text-on-surface-variant)', fontWeight: 600 }}>
                {name}
              </span>
            </button>

            {!isCollapsed && groupBots.map((bot) => {
              const latest = latestByBot.get(bot.id)
              const isActive = activeBotId === bot.id || (!!latest && latest.id === currentSessionId)
              const preview = latest && latest.preview ? latest.preview.trim() : ''
              return (
                <button
                  key={bot.id}
                  onClick={() => openBot(bot)}
                  className="flex items-start gap-2.5 w-full text-left transition-colors cursor-pointer"
                  style={{
                    padding: '7px 8px',
                    borderRadius: 9,
                    background: isActive ? 'var(--bg-surface-container-high)' : 'transparent',
                    border: 'none',
                    marginBottom: 2,
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-surface-container)' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <BotAvatar
                    bot={bot}
                    paper={theme === 'light' ? '#eeeeee' : '#201f1f'}
                    animate={isActive}
                    status={isActive ? status : 'idle'}
                  />
                  <div className="flex-1 min-w-0" style={{ paddingTop: 1 }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] truncate" style={{ color: 'var(--text-on-surface)', fontWeight: 600 }}>
                        {bot.name}
                      </span>
                      {bot.group ? (
                        <span
                          className="text-[9px] shrink-0"
                          style={{
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: 'var(--bg-surface-container-highest)',
                            color: 'var(--text-on-surface-variant)',
                          }}
                        >
                          {bot.group}
                        </span>
                      ) : null}
                      <span className="flex-1" />
                      <span className="text-[9px] shrink-0" style={{ color: 'var(--text-outline-variant)' }}>
                        {latest ? relTime(latest.updatedAt || latest.createdAt) : ''}
                      </span>
                    </div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--text-on-surface-variant)', marginTop: 1 }}>
                      {preview || 'No messages yet'}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
