/**
 * Tasks 视图的状态。
 *
 * 刻意不轮询：主进程每次 Ticket 阶段变化都会 push 一条 TICKET_CHANGED，
 * 这里 upsert 进列表就够了 —— 轮询要么迟滞要么白烧 CPU。
 */

import { create } from 'zustand'

export type TicketStage =
  | 'delivery' | 'answer' | 'review' | 'blocked' | 'queued' | 'idle' | 'working'

export interface Ticket {
  id: string
  title: string
  cwd: string
  sessionId: string
  platform?: string
  userId?: string
  chatId?: string
  threadKey: string
  stage: TicketStage
  createdAt: number
  lastActiveAt: number
  endedAt?: number
}

export type TicketFilter = 'active' | 'all' | 'local'

interface TicketState {
  tickets: Ticket[]
  loading: boolean
  error: string | null
  filter: TicketFilter

  refresh: () => Promise<void>
  stop: (id: string) => Promise<boolean>
  applyChange: (ticket: Ticket) => void
  setFilter: (f: TicketFilter) => void
  visible: () => Ticket[]
}

export const useTicketStore = create<TicketState>((set, get) => ({
  tickets: [],
  loading: false,
  error: null,
  filter: 'active',

  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const tickets = (await window.claude.listTickets({ includeEnded: false })) as Ticket[]
      set({ tickets: tickets ?? [], loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  stop: async (id) => {
    try {
      const res = (await window.claude.stopTicket(id)) as { success: boolean; error?: string }
      if (!res?.success) {
        set({ error: res?.error ?? '停止失败' })
        return false
      }
      // 本地先摘掉，避免等下一次推送才消失
      set({ tickets: get().tickets.filter((t) => t.id !== id) })
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return false
    }
  },

  applyChange: (ticket) => {
    const list = get().tickets
    const idx = list.findIndex((t) => t.id === ticket.id)
    if (idx === -1) {
      set({ tickets: [ticket, ...list] })
      return
    }
    const next = list.slice()
    next[idx] = ticket
    set({ tickets: next })
  },

  setFilter: (filter) => set({ filter }),

  /** 按当前过滤条件给出要展示的列表。派生函数，不单独存 state，避免两边不同步。 */
  visible: () => {
    const { tickets, filter } = get()
    if (filter === 'all') return tickets
    if (filter === 'local') return tickets.filter((t) => !t.platform || t.platform === 'local')
    return tickets.filter((t) => !t.endedAt)
  },
}))

/** 各阶段的展示文案与配色（配色走 tailwind token，不硬编码十六进制）。 */
export const STAGE_META: Record<TicketStage, { label: string; className: string }> = {
  delivery: { label: '投递失败', className: 'text-destructive' },
  answer: { label: '待回答', className: 'text-amber-500' },
  review: { label: '待验收', className: 'text-blue-500' },
  blocked: { label: '受阻', className: 'text-destructive' },
  queued: { label: '排队中', className: 'text-muted-foreground' },
  idle: { label: '空闲', className: 'text-muted-foreground' },
  working: { label: '执行中', className: 'text-emerald-500' },
}
