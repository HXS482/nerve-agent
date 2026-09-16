import { create } from 'zustand'
import type { TodoItem } from '../../shared/types'

// TodoWrite 任务清单状态：主进程 TodoWrite 工具经 FLOW_ITEM('todo') 推送，
// Stage 画布 TaskRows 卡片按 sessionId 消费。只保留每个会话最新一份清单。
interface TodoState {
  sessionId: string | null
  todos: TodoItem[]
  updatedAt: number
  setTodos: (sessionId: string, todos: TodoItem[]) => void
  clear: () => void
}

export const useTodoStore = create<TodoState>((set) => ({
  sessionId: null,
  todos: [],
  updatedAt: 0,
  setTodos: (sessionId, todos) => set({ sessionId, todos, updatedAt: Date.now() }),
  clear: () => set({ sessionId: null, todos: [], updatedAt: 0 }),
}))
