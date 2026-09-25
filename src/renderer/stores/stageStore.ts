import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewMode = 'chat' | 'stage'

// Stage 侧栏宽度：应用表面让出的宽度 = 该值 + 2；拖右侧分割线可调，双击回默认值
export const STAGE_SIDEBAR_DEFAULT_WIDTH = 360
export const STAGE_SIDEBAR_MIN_WIDTH = 200
export const STAGE_SIDEBAR_MAX_WIDTH = 600

interface StageState {
  viewMode: ViewMode
  stageSessionId: string | null
  // Stage 设置视图是否打开（内存态）：打开时 Stage 主界面整体卸载，进入独立设置模式
  settingsOpen: boolean
  // Stage 侧栏是否展开（内存态）：应用表面整体右移，左边框即分割线
  sidebarOpen: boolean
  // Stage 侧栏宽度（可拖拽调节，持久化）
  sidebarWidth: number
  // 回看的轮次（内存态，null = 跟随最新轮）
  selectedRoundId: string | null
  // 卡片相对自动落位的拖拽偏移（内存态，不持久化）
  cardOffsets: Record<string, { x: number; y: number }>
  // 图片卡的自由缩放宽度（内存态）
  cardSizes: Record<string, number>
  // 代码卡的自由缩放高度（内存态，作用于代码区限高滚动）
  cardHeights: Record<string, number>
  // 从当前画布关闭的卡片（内存态，不删除会话内容）
  hiddenCardIds: Record<string, true>
  setViewMode: (mode: ViewMode) => void
  setStageSessionId: (sessionId: string | null) => void
  setSettingsOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
  setSelectedRoundId: (roundId: string | null) => void
  setCardOffset: (cardId: string, offset: { x: number; y: number }) => void
  setCardSize: (cardId: string, width: number) => void
  setCardHeight: (cardId: string, height: number) => void
  hideCard: (cardId: string) => void
  resetLayout: () => void
}

export const useStageStore = create<StageState>()(
  persist(
    (set) => ({
      viewMode: 'stage',
      stageSessionId: null,
      settingsOpen: false,
      sidebarOpen: false,
      sidebarWidth: STAGE_SIDEBAR_DEFAULT_WIDTH,
      selectedRoundId: null,
      cardOffsets: {},
      cardSizes: {},
      cardHeights: {},
      hiddenCardIds: {},
      setViewMode: (viewMode) => set({ viewMode }),
      // 切会话清掉回看选中，避免残留高亮
      setStageSessionId: (stageSessionId) => set({ stageSessionId, selectedRoundId: null }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSidebarWidth: (sidebarWidth) =>
        set({
          sidebarWidth: Math.min(
            STAGE_SIDEBAR_MAX_WIDTH,
            Math.max(STAGE_SIDEBAR_MIN_WIDTH, Math.round(sidebarWidth)),
          ),
        }),
      setSelectedRoundId: (selectedRoundId) => set({ selectedRoundId }),
      setCardOffset: (cardId, offset) =>
        set((s) => ({ cardOffsets: { ...s.cardOffsets, [cardId]: offset } })),
      setCardSize: (cardId, width) =>
        set((s) => ({ cardSizes: { ...s.cardSizes, [cardId]: width } })),
      setCardHeight: (cardId, height) =>
        set((s) => ({ cardHeights: { ...s.cardHeights, [cardId]: height } })),
      hideCard: (cardId) =>
        set((s) => ({ hiddenCardIds: { ...s.hiddenCardIds, [cardId]: true } })),
      resetLayout: () => set({ cardOffsets: {}, cardSizes: {}, cardHeights: {}, hiddenCardIds: {} }),
    }),
    {
      name: 'nerve-stage',
      partialize: (s) => ({
        viewMode: s.viewMode,
        stageSessionId: s.stageSessionId,
        sidebarWidth: s.sidebarWidth,
      }),
      // 旧宽度（260）低于新下限，hydration 时抬上来，否则加宽后的排版会被挤
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<StageState>) }
        merged.sidebarWidth = Math.min(
          STAGE_SIDEBAR_MAX_WIDTH,
          Math.max(STAGE_SIDEBAR_MIN_WIDTH, merged.sidebarWidth),
        )
        return merged
      },
    },
  ),
)
