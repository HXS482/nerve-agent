import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewMode = 'chat' | 'stage'

interface StageState {
  viewMode: ViewMode
  stageSessionId: string | null
  // 回看的轮次（内存态，null = 跟随最新轮）
  selectedRoundId: string | null
  // 卡片相对自动落位的拖拽偏移（内存态，不持久化）
  cardOffsets: Record<string, { x: number; y: number }>
  // 图片卡的自由缩放宽度（内存态）
  cardSizes: Record<string, number>
  // 从当前画布关闭的卡片（内存态，不删除会话内容）
  hiddenCardIds: Record<string, true>
  setViewMode: (mode: ViewMode) => void
  setStageSessionId: (sessionId: string | null) => void
  setSelectedRoundId: (roundId: string | null) => void
  setCardOffset: (cardId: string, offset: { x: number; y: number }) => void
  setCardSize: (cardId: string, width: number) => void
  hideCard: (cardId: string) => void
  resetLayout: () => void
}

export const useStageStore = create<StageState>()(
  persist(
    (set) => ({
      viewMode: 'stage',
      stageSessionId: null,
      selectedRoundId: null,
      cardOffsets: {},
      cardSizes: {},
      hiddenCardIds: {},
      setViewMode: (viewMode) => set({ viewMode }),
      // 切会话清掉回看选中，避免残留高亮
      setStageSessionId: (stageSessionId) => set({ stageSessionId, selectedRoundId: null }),
      setSelectedRoundId: (selectedRoundId) => set({ selectedRoundId }),
      setCardOffset: (cardId, offset) =>
        set((s) => ({ cardOffsets: { ...s.cardOffsets, [cardId]: offset } })),
      setCardSize: (cardId, width) =>
        set((s) => ({ cardSizes: { ...s.cardSizes, [cardId]: width } })),
      hideCard: (cardId) =>
        set((s) => ({ hiddenCardIds: { ...s.hiddenCardIds, [cardId]: true } })),
      resetLayout: () => set({ cardOffsets: {}, cardSizes: {}, hiddenCardIds: {} }),
    }),
    {
      name: 'nerve-stage',
      partialize: (s) => ({ viewMode: s.viewMode, stageSessionId: s.stageSessionId }),
    },
  ),
)
