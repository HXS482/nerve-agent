import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ChatMessage, ClaudeConfig, Theme, ModelInfo, SessionUsage, ProviderInfo, ToolApprovalRequest, AskUserRequest } from '../../shared/types'

const MAX_FLOW_ITEMS = 30

export interface Session {
  id: string
  title: string
  preview: string
  createdAt: number
  updatedAt: number
  platform?: string
  /** 会话所属界面模式；旧会话无此字段 → 归 chat */
  mode?: 'chat' | 'stage'
}

export interface FlowItem {
  id: string
  type: 'html' | 'text' | 'image' | 'component'
  content: string
  timestamp: number
  meta?: Record<string, any>
  /** 产生该产物的工作区；旧数据无此字段 → 归 chat */
  workspace?: 'chat' | 'stage'
}

interface ChatState {
  // Chat
  messages: ChatMessage[]
  isLoading: boolean
  currentSessionId: string | null
  config: ClaudeConfig
  sidebarOpen: boolean
  sidebarWidth: number

  // Theme
  theme: Theme

  /** Stage 自定义壁纸（data URL，canvas 压缩后持久化）；null = 默认壁纸 */
  stageBg: string | null

  // Sessions
  sessions: Session[]
  /** 会话归属工作区的权威记录（sessionId → chat/stage），独立持久化，
      不受 sessions 列表同步/合并覆盖影响 */
  sessionModes: Record<string, 'chat' | 'stage'>

  // Available models from Nerve config
  availableModels: ModelInfo[]

  // Providers
  providers: ProviderInfo[]

  // Per-provider models
  providerModels: Record<string, string[]>
  defaultProvider: string

  // Session usage
  sessionUsage: SessionUsage | null

  // Pet customization
  petColorScheme: string
  petSkinId: string

  // Orb state
  orbState: 'idle' | 'active' | 'thinking' | 'morphing'
  orbMorphTimer: number | null

  // Right sidebar
  rightSidebarOpen: boolean
  rightSidebarWidth: number
  rightSidebarView: 'flow' | 'folder' | 'git' | 'diff'

  // Flow event stream
  flowItems: FlowItem[]

  // Tool approvals
  pendingApprovals: ToolApprovalRequest[]
  addApproval: (req: ToolApprovalRequest) => void
  removeApproval: (approvalId: string) => void
  // AskUser 提问队列（agent 结构化提问，卡片逐个作答）
  pendingAsks: AskUserRequest[]
  addAsk: (req: AskUserRequest) => void
  removeAsk: (askId: string) => void

  // Chat actions
  addMessage: (msg: ChatMessage) => void
  updateLastMessage: (updater: (msg: ChatMessage) => ChatMessage, sessionId?: string) => void
  setLoading: (loading: boolean) => void
  setSessionId: (id: string | null) => void
  setConfig: (config: Partial<ClaudeConfig>) => void
  setSidebarOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
  clearMessages: () => void
  setMessages: (messages: ChatMessage[]) => void

  // Theme actions
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
  /** 设置/清除 Stage 自定义壁纸（data URL | null） */
  setStageBg: (bg: string | null) => void

  // Session actions
  addSession: (session: Session) => void
  updateSession: (id: string, partial: Partial<Session>) => void
  deleteSession: (id: string) => void
  /** 记录会话的工作区归属（权威源，见 sessionModes） */
  markSessionMode: (id: string, mode: 'chat' | 'stage') => void

  // Model actions
  setAvailableModels: (models: ModelInfo[]) => void

  // Provider actions
  setProviders: (providers: ProviderInfo[]) => void
  setProviderModels: (providerId: string, models: string[]) => void
  setDefaultProvider: (provider: string) => void

  // Usage actions
  setSessionUsage: (usage: SessionUsage | null) => void

  // Pet actions
  setPetColorScheme: (scheme: string) => void
  setPetSkinId: (id: string) => void

  // Orb actions
  setOrbState: (state: 'idle' | 'active' | 'thinking' | 'morphing') => void

  // Right sidebar actions
  setRightSidebarOpen: (open: boolean) => void
  setRightSidebarWidth: (width: number) => void
  setRightSidebarView: (view: 'flow' | 'folder' | 'git' | 'diff') => void
  toggleRightSidebar: () => void

  // Flow actions
  pushFlowItem: (item: Omit<FlowItem, 'id' | 'timestamp'>) => void
  clearFlow: () => void
  removeFlowItem: (id: string) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      // Chat state
      messages: [],
      isLoading: false,
      currentSessionId: null,
      config: {
        model: 'sonnet',
        effort: 'medium',
        cwd: '',
        permissionMode: 'bypassPermissions',
      },
      sidebarOpen: true,
      sidebarWidth: 208,

      // Theme state
      theme: 'dark',
      stageBg: null,

      // Sessions state
      sessions: [],
      sessionModes: {},

      // Available models
      availableModels: [],

      // Providers
      providers: [],

      // Per-provider models
      providerModels: {},
      defaultProvider: '',

      // Session usage
      sessionUsage: null,

      // Pet customization
      petColorScheme: 'purple',
      petSkinId: 'default',

      // Orb state
      orbState: 'idle',
      orbMorphTimer: null,

      // Right sidebar
      rightSidebarOpen: false,
      rightSidebarWidth: 280,
      rightSidebarView: 'flow',

      // Flow event stream
      flowItems: [],

      // Tool approvals
      pendingApprovals: [],
      addApproval: (req) => set((s) => ({ pendingApprovals: [...s.pendingApprovals, req] })),
      removeApproval: (approvalId) => set((s) => ({ pendingApprovals: s.pendingApprovals.filter((a) => a.approvalId !== approvalId) })),
      pendingAsks: [],
      addAsk: (req) => set((s) => ({ pendingAsks: [...s.pendingAsks, req] })),
      removeAsk: (askId) => set((s) => ({ pendingAsks: s.pendingAsks.filter((a) => a.askId !== askId) })),

      // Chat actions
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      updateLastMessage: (updater, sessionId) =>
        set((s) => {
          const msgs = [...s.messages]
          // Find the last message belonging to the given session (or global last if no session)
          let idx = -1
          if (sessionId) {
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].sessionId === sessionId) { idx = i; break }
            }
          } else if (msgs.length > 0) {
            idx = msgs.length - 1
          }
          if (idx >= 0) {
            msgs[idx] = updater(msgs[idx])
          }
          return { messages: msgs }
        }),
      setLoading: (loading) => set({ isLoading: loading }),
      setSessionId: (id) => set({ currentSessionId: id }),
      setConfig: (partial) => set((s) => ({ config: { ...s.config, ...partial } })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarWidth: (width) => set({ sidebarWidth: Math.max(160, Math.min(360, width)) }),
      clearMessages: () => set({ currentSessionId: null, messages: [] }),
      setMessages: (messages) => set({ messages }),

      // Theme actions
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark'
        document.documentElement.setAttribute('data-theme', next)
        set({ theme: next })
      },
      setTheme: (theme) => {
        document.documentElement.setAttribute('data-theme', theme)
        set({ theme })
      },
      setStageBg: (bg) => set({ stageBg: bg }),

      // Session actions
      addSession: (session) =>
        set((s) => ({
          sessions: [session, ...s.sessions],
          ...(session.mode ? { sessionModes: { ...s.sessionModes, [session.id]: session.mode } } : {}),
        })),
      updateSession: (id, partial) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === id ? { ...sess, ...partial } : sess
          ),
        })),
      deleteSession: (id) =>
        set((s) => {
          const sessionModes = { ...s.sessionModes }
          delete sessionModes[id]
          return { sessions: s.sessions.filter((sess) => sess.id !== id), sessionModes }
        }),
      markSessionMode: (id, mode) =>
        set((s) => ({ sessionModes: { ...s.sessionModes, [id]: mode } })),

      // Model actions
      setAvailableModels: (models) => set({ availableModels: models }),

      // Provider actions
      setProviders: (providers) => set({ providers }),
      setProviderModels: (providerId, models) => set((s) => ({
        providerModels: { ...s.providerModels, [providerId]: models }
      })),
      setDefaultProvider: (provider) => set({ defaultProvider: provider }),

      // Usage actions
      setSessionUsage: (usage) => set({ sessionUsage: usage }),

      // Pet actions
      setPetColorScheme: (scheme) => set({ petColorScheme: scheme }),
      setPetSkinId: (id) => set({ petSkinId: id }),

      // Orb actions
      setOrbState: (orbState) => {
        if (orbState === 'active') {
          // Start morph timer when entering active state
          const orbMorphTimer = Date.now()
          set({ orbState, orbMorphTimer })
        } else if (orbState === 'idle') {
          set({ orbState, orbMorphTimer: null })
        } else {
          set({ orbState })
        }
      },

      // Right sidebar actions
      setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
      setRightSidebarWidth: (width) => set({ rightSidebarWidth: Math.min(380, Math.max(220, width)) }),
      setRightSidebarView: (view) => set({ rightSidebarView: view }),
      toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),

      // Flow actions
      pushFlowItem: (item) => set((s) => ({
        flowItems: [...s.flowItems, {
          ...item,
          id: `flow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
        }],
      })),
      clearFlow: () => set({ flowItems: [] }),
      removeFlowItem: (id) => set((s) => ({
        flowItems: s.flowItems.filter((item) => item.id !== id),
      })),
    }),
    {
      name: 'nerve-state',
      partialize: (state) => ({
        theme: state.theme,
        stageBg: state.stageBg,
        sessions: state.sessions,
        sessionModes: state.sessionModes,
        config: state.config,
        sidebarOpen: state.sidebarOpen,
        currentSessionId: state.currentSessionId,
        petColorScheme: state.petColorScheme,
        petSkinId: state.petSkinId,
        rightSidebarOpen: state.rightSidebarOpen,
        rightSidebarView: state.rightSidebarView,
        flowItems: state.flowItems.slice(-MAX_FLOW_ITEMS),
      }),
      onRehydrate: () => {
        return (state) => {
          if (state?.theme) {
            document.documentElement.setAttribute('data-theme', state.theme)
          }
          // Sanitize stale persisted view values
          const validViews = ['flow', 'folder', 'git', 'diff']
          if (state?.rightSidebarView && !validViews.includes(state.rightSidebarView)) {
            state.rightSidebarView = 'flow'
          }
        }
      },
    }
  )
)
