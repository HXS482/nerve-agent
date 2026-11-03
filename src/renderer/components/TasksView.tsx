/**
 * 右侧栏 Tasks 视图。
 *
 * 与左栏会话列表的分工：左边是"我跟谁说过话"，这里是"哪些活还在跑"。
 * 一个 Ticket 可以出现在这里但不在当前会话里 —— 那正是这个视图存在的意义。
 *
 * 数据靠主进程 push（TICKET_CHANGED），不轮询。
 */

import { useEffect } from 'react'
import { useTicketStore, STAGE_META, type Ticket } from '../stores/ticketStore'
import { useChatStore } from '../stores/chatStore'

/** 相对时间：任务列表里绝对时间戳没人看，只关心"多久没动了"。 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

/** 目录只显示最后两段，完整路径太长且前几段往往都一样。 */
function shortPath(p: string): string {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

function StageBadge({ stage }: { stage: Ticket['stage'] }) {
  const meta = STAGE_META[stage]
  return (
    <span className={`text-[10px] font-medium ${meta.className}`}>
      {meta.label}
    </span>
  )
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  const stop = useTicketStore((s) => s.stop)
  const setSessionId = useChatStore((s) => s.setSessionId)

  const openSession = () => {
    // 跳到左栏对应会话。sessionId 是后端真 id：Ticket 建立时就分配了，
    // 所以这里不需要经过临时 id 的别名解析。
    setSessionId(ticket.sessionId)
  }

  return (
    <div className="group px-3 py-2 rounded-md hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={openSession}
          className="text-left text-xs font-medium text-foreground truncate flex-1 min-w-0"
          title={ticket.title}
        >
          {ticket.title}
        </button>
        <StageBadge stage={ticket.stage} />
      </div>

      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
        <span>{relativeTime(ticket.lastActiveAt)}</span>
        {ticket.cwd && (
          <>
            <span>·</span>
            <span className="truncate" title={ticket.cwd}>{shortPath(ticket.cwd)}</span>
          </>
        )}
        {ticket.platform && (
          <>
            <span>·</span>
            <span>{ticket.platform}</span>
          </>
        )}
      </div>

      <div className="flex gap-2 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={openSession}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          打开会话
        </button>
        <button
          onClick={() => { void stop(ticket.id) }}
          className="text-[10px] text-muted-foreground hover:text-destructive"
        >
          停止
        </button>
      </div>
    </div>
  )
}

export function TasksView() {
  const { loading, error, filter, setFilter, refresh, applyChange, visible, tickets } = useTicketStore()

  useEffect(() => {
    void refresh()
    // 订阅主进程的推送；卸载时退订，避免热重载后重复渲染
    const unsub = window.claude.onTicketChanged?.((t: unknown) => {
      if (t && typeof t === 'object' && 'id' in (t as any)) {
        applyChange(t as Ticket)
      }
    })
    return () => { unsub?.() }
  }, [refresh, applyChange])

  const list = visible()

  return (
    <div className="flex flex-col h-full">
      {/* 过滤切换 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/50">
        {([
          ['active', '进行中'],
          ['all', '全部'],
          ['local', '仅本地'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
              filter === id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {tickets.length > 0 ? `${list.length}/${tickets.length}` : ''}
        </span>
      </div>

      {error && (
        <div className="px-3 py-2 text-[10px] text-destructive">{error}</div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {loading && list.length === 0 && (
          <div className="px-3 py-6 text-center text-[10px] text-muted-foreground">加载中…</div>
        )}

        {!loading && list.length === 0 && (
          <div className="px-3 py-6 text-center text-[10px] text-muted-foreground leading-relaxed">
            还没有任务
            <br />
            <span className="text-muted-foreground/70">
              Gateway 收到消息后会在这里出现
            </span>
          </div>
        )}

        {list.map((t) => (
          <TicketRow key={t.id} ticket={t} />
        ))}
      </div>
    </div>
  )
}
