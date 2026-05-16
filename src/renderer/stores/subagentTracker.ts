import { create } from 'zustand'

export interface SubagentTask {
  id: string
  toolCallId: string
  task: string
  status: 'running' | 'completed' | 'error'
  startedAt: number
  completedAt?: number
  error?: string
}

export interface SubagentCard {
  id: string
  type: 'spawn' | 'parallel' | 'chain'
  startedAt: number
  tasks: SubagentTask[]
  collapsed: boolean
}

interface TrackerState {
  cards: SubagentCard[]
  addCard: (card: SubagentCard) => void
  addTask: (cardId: string, task: SubagentTask) => void
  completeTask: (cardId: string, toolCallId: string) => void
  failTask: (cardId: string, toolCallId: string, error: string) => void
  completeAll: () => void
  toggleCollapse: (cardId: string) => void
  clear: () => void
}

export const useSubagentTracker = create<TrackerState>((set) => ({
  cards: [],

  addCard: (card) => set((s) => ({ cards: [...s.cards, card] })),

  addTask: (cardId, task) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === cardId ? { ...c, tasks: [...c.tasks, task] } : c
      ),
    })),

  completeTask: (cardId, toolCallId) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              tasks: c.tasks.map((t) =>
                t.toolCallId === toolCallId
                  ? { ...t, status: 'completed' as const, completedAt: Date.now() }
                  : t
              ),
            }
          : c
      ),
    })),

  failTask: (cardId, toolCallId, error) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              tasks: c.tasks.map((t) =>
                t.toolCallId === toolCallId
                  ? { ...t, status: 'error' as const, completedAt: Date.now(), error }
                  : t
              ),
            }
          : c
      ),
    })),

  completeAll: () =>
    set((s) => ({
      cards: s.cards.map((c) => ({
        ...c,
        tasks: c.tasks.map((t) =>
          t.status === 'running'
            ? { ...t, status: 'completed' as const, completedAt: Date.now() }
            : t
        ),
      })),
    })),

  toggleCollapse: (cardId) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === cardId ? { ...c, collapsed: !c.collapsed } : c
      ),
    })),

  clear: () => set({ cards: [] }),
}))
