/**
 * Routine / Bot 状态（bot 驱动改造）。
 *
 * 数据源是主进程的 routines.db 与 bots/*.json；这里只做薄缓存 + 动作封装，
 * 不做乐观更新 —— 护栏拒绝（15 分钟下限、20 个上限）必须原样展示给用户。
 */

import { create } from 'zustand'

export interface Routine {
  id: string
  botId: string
  sessionId: string
  instruction: string
  schedule: string
  nextRunAt: number
  enabled: boolean
  consecutiveFailures: number
  failureNotified: boolean
  lastRunAt: number | null
  createdBy: 'user' | 'model'
  createdAt: number
  updatedAt: number
}

export interface Bot {
  id: string
  name: string
  /** 侧栏分组名（研发 / 调研 / 闲聊…），空 = 未分组 */
  group: string
  /** 头像单字 emoji，空 = 用名字首字 */
  emoji: string
  /** 头像本体颜色；空 = 按 id 散列取默认色 */
  avatarColor: string
  /** true = 动画圆球头像（GrokBot）；false = emoji 方块 */
  avatarOrb: boolean
  instructions: string
  isDefault: boolean
  homeSessionId: string
  boundSkills: string[]
  boundMcp: string[]
  createdAt: number
  updatedAt: number
}

interface SweepStatus {
  lastSweep: number | null
  healthy: boolean
}

interface RoutineState {
  bots: Bot[]
  routines: Routine[]
  activeBotId: string | null
  sweep: SweepStatus
  loading: boolean
  error: string | null

  loadBots: () => Promise<void>
  loadRoutines: (botId: string) => Promise<void>
  refreshSweep: () => Promise<void>
  create: (input: { botId: string; sessionId: string; instruction: string; schedule: string }) => Promise<boolean>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
  selectBot: (id: string) => void
  saveBot: (id: string, patch: { name?: string; group?: string; emoji?: string; avatarColor?: string; avatarOrb?: boolean; instructions?: string }) => Promise<void>
  createBot: (input: { name: string; group?: string; emoji?: string; avatarColor?: string; avatarOrb?: boolean; instructions?: string }) => Promise<string | null>
  clearError: () => void
}

const api = () => (window as any).claude

/** Electron 的 ipcMain.handle 拒绝会把主进程错误包装成
 *  "Error invoking remote method 'routine:create': Error: <原因>"，剥掉前缀只留原因。 */
function errText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

export const useRoutineStore = create<RoutineState>((set, get) => ({
  bots: [],
  routines: [],
  activeBotId: null,
  sweep: { lastSweep: null, healthy: false },
  loading: false,
  error: null,

  loadBots: async () => {
    try {
      const bots = (await api().botList()) as Bot[]
      set({
        bots,
        // 没选过就用默认 Bot
        activeBotId: get().activeBotId ?? bots.find((b) => b.isDefault)?.id ?? bots[0]?.id ?? null,
      })
    } catch (err) {
      set({ error: errText(err) })
    }
  },

  loadRoutines: async (botId: string) => {
    set({ loading: true })
    try {
      const routines = (await api().routineList(botId)) as Routine[]
      set({ routines, activeBotId: botId, loading: false })
    } catch (err) {
      set({ loading: false, error: errText(err) })
    }
  },

  refreshSweep: async () => {
    try {
      set({ sweep: (await api().routineSweepStatus()) as SweepStatus })
    } catch {
      // 心跳查询失败不弹错：面板上会显示"调度器未运行"就够了
    }
  },

  create: async (input) => {
    try {
      await api().routineCreate(input)
      await get().loadRoutines(input.botId)
      set({ error: null })
      return true
    } catch (err) {
      // 护栏拒绝（15 分钟下限 / 20 个上限）走这里，原样给用户看
      set({ error: errText(err) })
      return false
    }
  },

  setEnabled: async (id, enabled) => {
    try {
      await api().routineUpdate(id, { enabled })
      const botId = get().activeBotId
      if (botId) await get().loadRoutines(botId)
    } catch (err) {
      set({ error: errText(err) })
    }
  },

  remove: async (id) => {
    try {
      await api().routineDelete(id)
      const botId = get().activeBotId
      if (botId) await get().loadRoutines(botId)
    } catch (err) {
      set({ error: errText(err) })
    }
  },

  selectBot: (id) => set({ activeBotId: id }),

  createBot: async (input) => {
    try {
      const bot = (await api().botCreate(input)) as Bot
      set({ bots: [...get().bots, bot], activeBotId: bot.id })
      return bot.id
    } catch (err) {
      set({ error: errText(err) })
      return null
    }
  },

  saveBot: async (id, patch) => {
    try {
      const updated = (await api().botUpdate(id, patch)) as Bot
      set({ bots: get().bots.map((b) => (b.id === updated.id ? updated : b)) })
    } catch (err) {
      set({ error: errText(err) })
    }
  },

  clearError: () => set({ error: null }),
}))
