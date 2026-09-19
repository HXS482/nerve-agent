import { create } from 'zustand'
import type { TodoItem } from '../../shared/types'

// TodoWrite 任务清单状态：主进程 TodoWrite 工具经 FLOW_ITEM('todo') 推送，
// 按会话分别存放（bySession），会话切换各持一份、互不覆盖。
// aliases：首轮流式期间渲染端临时 session id（session-<ts>）→ 后端真实 id
// 的映射——meta.sessionId 是后端 id，而 Stage 首轮还在用临时 id，登记别名后
// 两个 id 都能查到同一份清单，修复「首次新会话第一轮卡片隐藏」。onDone 交换
// 完成后 releaseAlias 清掉别名，此后 Stage 直接用后端 id 直查。

export interface TodoState {
  /** 后端 session id → 该会话最新一份清单 */
  bySession: Record<string, TodoItem[]>
  /** 临时 session id → 后端 session id */
  aliases: Record<string, string>
  updatedAt: number
  setTodos: (sessionId: string, todos: TodoItem[]) => void
  /** 登记临时 id → 真实 id 的别名（读取时两者都能命中同一份清单） */
  recordAlias: (tempId: string, realId: string) => void
  /** 临时 id 已被后端 id 取代（onDone 交换）时清理别名 */
  releaseAlias: (tempId: string, realId: string) => void
  /** 删除会话时清除其清单及指向它的别名 */
  clearSession: (sessionId: string) => void
  clear: () => void
}

export const useTodoStore = create<TodoState>((set) => ({
  bySession: {},
  aliases: {},
  updatedAt: 0,
  setTodos: (sessionId, todos) =>
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: todos }, updatedAt: Date.now() })),
  recordAlias: (tempId, realId) =>
    set((s) => {
      if (s.aliases[tempId] === realId) return s
      return { aliases: { ...s.aliases, [tempId]: realId } }
    }),
  releaseAlias: (tempId, realId) =>
    set((s) => {
      if (!s.aliases[tempId]) return s
      const aliases = { ...s.aliases }
      delete aliases[tempId]
      const bySession = { ...s.bySession }
      if (bySession[realId] && bySession[tempId]) {
        // 同 id 下不可并存：保留后端 id 的份
        delete bySession[tempId]
      } else if (bySession[tempId] && !bySession[realId]) {
        bySession[realId] = bySession[tempId]
        delete bySession[tempId]
      }
      return { bySession, aliases }
    }),
  clearSession: (sessionId) =>
    set((s) => {
      const bySession = { ...s.bySession }
      delete bySession[sessionId]
      const aliases = { ...s.aliases }
      for (const [k, v] of Object.entries(aliases)) {
        if (k === sessionId || v === sessionId) delete aliases[k]
      }
      return { bySession, aliases }
    }),
  clear: () => set({ bySession: {}, aliases: {}, updatedAt: 0 }),
}))

const EMPTY: TodoItem[] = []

/** 读取某会话的清单（自动解析临时 id → 后端 id）；缺省返回稳定空数组引用 */
export const selectTodos = (s: TodoState, sessionId: string | null): TodoItem[] => {
  if (!sessionId) return EMPTY
  const real = s.aliases[sessionId] ?? sessionId
  return s.bySession[real] ?? EMPTY
}