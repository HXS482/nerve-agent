import { useEffect, useCallback, useRef } from 'react'
import { useChatStore, Session } from '../stores/chatStore'
import { useSubagentTracker } from '../stores/subagentTracker'
import { ContentBlock, ClaudeConfig, ChatMessage } from '../../shared/types'

const SUBAGENT_TOOLS = new Set(['spawn_subagent', 'parallel_subagents', 'chain_subagents'])

declare global {
  interface Window {
    claude: {
      sendMessage: (prompt: string, sessionId?: string) => Promise<void>
      cancel: () => Promise<void>
      getConfig: () => Promise<ClaudeConfig>
      setModel: (model: string) => Promise<void>
      setEffort: (effort: string) => Promise<void>
      setProvider: (providerId: string) => Promise<void>
      setCwd: (cwd: string) => Promise<void>
      setPermissionMode: (mode: string) => Promise<void>
      pickDirectory: () => Promise<string | null>
      getModels: () => Promise<{ alias: string; name: string }[]>
      listSessions: () => Promise<any[]>
      getSessionMessages: (sessionId: string) => Promise<any[]>
      deleteSessionRemote: (sessionId: string) => Promise<void>
      onPetStateChange: (callback: (state: string) => void) => () => void
      petDragStart: (mouseX: number, mouseY: number) => void
      petDragMove: (screenX: number, screenY: number) => void
      petDragEnd: () => void
      togglePet: () => Promise<boolean>
      onPetStatus: (callback: (status: { visible: boolean; docked: boolean }) => void) => () => void
      getPetState: () => Promise<{ visible: boolean; docked: boolean }>
      sendPetColorScheme: (scheme: string) => void
      onPetColorScheme: (callback: (scheme: string) => void) => () => void
      undockPet: () => Promise<void>
      listPetSkins: () => Promise<any[]>
      importPetSkin: () => Promise<any | null>
      deletePetSkin: (id: string) => Promise<boolean>
      setPetSkin: (id: string) => Promise<void>
      onPetSkinChanged: (callback: (skinId: string) => void) => () => void
      windowMinimize: () => void
      windowMaximize: () => void
      windowClose: () => void
      onMessage: (callback: (data: any) => void) => () => void
      onError: (callback: (data: { message: string }) => void) => () => void
      onDone: (callback: (data: { sessionId: string; cost: number; maxContextTokens: number }) => void) => () => void
      getNerveSettings: () => Promise<any>
      saveNerveSettings: (settings: any) => Promise<void>
      testConnection: (baseURL: string, authToken: string) => Promise<{ ok: boolean; error?: string }>
      fetchModels: (baseURL: string, authToken: string) => Promise<{ ok: boolean; models?: string[]; error?: string }>
      getMcpServers: () => Promise<Record<string, any>>
      saveMcpServers: (servers: Record<string, any>) => Promise<void>
      getSkills: () => Promise<any[]>
      toggleSkill: (id: string, enabled: boolean) => Promise<void>
      transcribeAudio: (audioData: Uint8Array, mimeType: string) => Promise<{ ok: boolean; text?: string; error?: string }>
      branchSession: (sessionId: string, fromEntryId: string, branchName?: string) => Promise<string>
      switchBranch: (sessionId: string, branchName: string) => Promise<void>
      listBranches: (sessionId: string) => Promise<Array<{ name: string; head: string; active: boolean }>>
      getProviders: () => Promise<Array<{ id: string; type: string; baseURL: string }>>
      getSessionUsage: (sessionId: string) => Promise<{ inputTokens: number; outputTokens: number; totalTokens: number; compactionCount: number; maxContextTokens: number }>
      onFlowItem: (callback: (data: { type: string; content: string; meta?: Record<string, any> }) => void) => () => void
      pushFlowItem: (type: string, content: string, meta?: Record<string, any>) => void
    }
  }
}

export function useClaude() {
  const {
    messages,
    isLoading,
    config,
    addMessage,
    updateLastMessage,
    setLoading,
    setSessionId,
    setConfig,
    clearMessages,
    addSession,
    deleteSession,
    setMessages,
  } = useChatStore()

  // Debounce ref for stream events
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingText = useRef('')
  const pendingThinking = useRef('')
  // Capture temp session ID at send() time for DONE handler
  const pendingTempSessionId = useRef<string | null>(null)

  // Flush pending text to store
  const flushPendingText = useCallback(() => {
    const text = pendingText.current
    const thinking = pendingThinking.current
    pendingText.current = ''
    pendingThinking.current = ''
    if (!text && !thinking) return
    const sid = useChatStore.getState().currentSessionId || undefined
    updateLastMessage((msg) => {
      const content = [...msg.content]
      if (thinking) {
        const thinkingBlock = content.find((b) => b.type === 'thinking')
        if (thinkingBlock) {
          thinkingBlock.thinking = (thinkingBlock.thinking || '') + thinking
        } else {
          content.unshift({ type: 'thinking', thinking })
        }
      }
      if (text) {
        const textBlock = content.find((b) => b.type === 'text')
        if (textBlock) {
          textBlock.text = (textBlock.text || '') + text
        } else {
          content.push({ type: 'text', text })
        }
      }
      return { ...msg, content }
    }, sid)
  }, [updateLastMessage])

  const syncSessions = useCallback(async () => {
    try {
      const remoteSessions = await window.claude.listSessions()
      console.log('[Nerve] syncSessions remote:', Array.isArray(remoteSessions) ? remoteSessions.length + ' sessions' : remoteSessions)
      if (!Array.isArray(remoteSessions)) return

      const store = useChatStore.getState()
      // Keep temp sessions (not yet persisted to backend)
      const tempSessions = store.sessions.filter((s) => s.id.startsWith('session-'))

      const remoteMapped: Session[] = remoteSessions.map((rs) => ({
        id: rs.sessionId,
        title: rs.customTitle || rs.firstPrompt?.slice(0, 50) || rs.summary?.slice(0, 50) || 'Untitled',
        preview: rs.summary?.slice(0, 80) || '',
        createdAt: rs.createdAt || rs.lastModified,
        updatedAt: rs.lastModified,
      }))

      // Merge: remote sessions + temp sessions not yet in remote
      const remoteIds = new Set(remoteMapped.map((s) => s.id))
      const merged = [...remoteMapped, ...tempSessions.filter((s) => !remoteIds.has(s.id))]

      console.log('[Nerve] syncSessions merged:', merged.length, 'sessions')
      useChatStore.setState({ sessions: merged })
    } catch (err) {
      console.error('[Nerve] syncSessions error:', err)
    }
  }, [])

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    setSessionId(sessionId)
    useChatStore.getState().setSessionUsage(null)

    // Check if messages already in store (but don't return early — still clear others)
    const store = useChatStore.getState()
    const existing = store.messages.filter((m) => m.sessionId === sessionId)

    // Clear all messages before loading to prevent cross-session contamination
    if (existing.length > 0) {
      useChatStore.setState({ messages: existing })
      return
    }

    // No existing messages for this session — clear and load fresh
    useChatStore.setState({ messages: [] })

    // Load from SDK
    try {
      const raw = await window.claude.getSessionMessages(sessionId)
      console.log('[Nerve] getSessionMessages raw:', sessionId, Array.isArray(raw) ? raw.length + ' entries' : raw)
      if (!Array.isArray(raw)) return

      const loaded: ChatMessage[] = raw
        .filter((m: any) => m.type === 'user' || m.type === 'assistant')
        .map((m: any) => ({
          id: m.uuid || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: m.type as 'user' | 'assistant',
          content: (() => {
            const raw = m.message?.content
            if (typeof raw === 'string') return [{ type: 'text' as const, text: raw }]
            if (!Array.isArray(raw)) return []
            return raw.map((c: any) => {
              if (c.type === 'text') return { type: 'text' as const, text: c.text }
              if (c.type === 'thinking') return { type: 'thinking' as const, thinking: c.thinking }
              if (c.type === 'tool_use') return { type: 'tool_use' as const, id: c.id, name: c.name, input: c.input }
              if (c.type === 'tool_result') return {
            type: 'tool_result' as const,
            toolCallId: c.toolCallId || c.tool_use_id,
            content: typeof c.content === 'string' ? c.content
              : Array.isArray(c.content) ? c.content.map((b: any) => b.text || JSON.stringify(b)).join('')
              : String(c.content ?? ''),
            is_error: c.is_error,
          }
              return { type: 'text' as const, text: JSON.stringify(c) }
            })
          })(),
          timestamp: new Date(m.timestamp).getTime(),
          sessionId,
        }))

      console.log('[Nerve] loaded messages:', loaded.length)
      if (loaded.length > 0) {
        const latest = useChatStore.getState()
        latest.setMessages([...latest.messages, ...loaded])
      }

      // Load session usage
      window.claude.getSessionUsage(sessionId).then((usage) => {
        useChatStore.getState().setSessionUsage(usage)
      }).catch(() => {})
    } catch (err) {
      console.error('[Nerve] loadSessionMessages error:', err)
    }
  }, [setSessionId])

  useEffect(() => {
    // Load config from backend
    window.claude.getConfig().then((cfg) => {
      if (cfg) setConfig(cfg)
    }).catch(() => {})

    // Load available models from Nerve settings.json
    window.claude.getModels().then((models) => {
      if (models && models.length > 0) {
        useChatStore.getState().setAvailableModels(models)
      }
    }).catch(() => {})

    // Load providers
    window.claude.getProviders().then((providers) => {
      if (providers && providers.length > 0) {
        useChatStore.getState().setProviders(providers)
      }
    }).catch(() => {})

    // Load per-provider models from settings
    window.claude.getNerveSettings().then((s: any) => {
      if (s.providers) {
        for (const [id, cfg] of Object.entries(s.providers) as [string, any][]) {
          if (cfg.models && cfg.models.length > 0) {
            useChatStore.getState().setProviderModels(id, cfg.models)
          }
        }
      }
    }).catch(() => {})

    // Sync sessions from SDK
    syncSessions()

    const unsubMessage = window.claude.onMessage((msg) => {
      if (msg.type === 'assistant' && msg.message?.content) {
        // Flush any pending stream text before processing assistant blocks
        // to preserve content ordering (text → tool_use → tool_result)
        if (flushTimer.current) {
          clearTimeout(flushTimer.current)
          flushTimer.current = null
        }
        flushPendingText()
        const blocks: ContentBlock[] = msg.message.content.map((c: any) => {
          if (c.type === 'text') return { type: 'text' as const, text: c.text }
          if (c.type === 'thinking') return { type: 'thinking' as const, thinking: c.thinking }
          if (c.type === 'tool_use') return { type: 'tool_use' as const, id: c.id, name: c.name, input: c.input }
          if (c.type === 'tool_result') return {
            type: 'tool_result' as const,
            toolCallId: c.toolCallId || c.tool_use_id,
            content: typeof c.content === 'string' ? c.content
              : Array.isArray(c.content) ? c.content.map((b: any) => b.text || JSON.stringify(b)).join('')
              : String(c.content ?? ''),
            is_error: c.is_error,
          }
          return { type: 'text' as const, text: JSON.stringify(c) }
        })

        const store = useChatStore.getState()
        const hasNewText = blocks.some((b) => b.type === 'text')
        const hasToolBlocks = blocks.some((b) => b.type === 'tool_use' || b.type === 'tool_result')

        // --- Subagent tracking ---
        const tracker = useSubagentTracker.getState()
        for (const b of blocks) {
          if (b.type === 'tool_use' && b.name && SUBAGENT_TOOLS.has(b.name)) {
            const input = b.input || {}
            const type = b.name === 'spawn_subagent' ? 'spawn' : b.name === 'parallel_subagents' ? 'parallel' : 'chain'
            const tasks = type === 'parallel'
              ? ((input as any).tasks || []).map((t: any, i: number) => ({
                  id: `${b.id}-t${i}`,
                  toolCallId: `${b.id}-t${i}`,
                  task: typeof t === 'string' ? t : (t.task || JSON.stringify(t)),
                  status: 'running' as const,
                  startedAt: Date.now(),
                }))
              : type === 'chain'
              ? ((input as any).steps || []).map((s: any, i: number) => ({
                  id: `${b.id}-s${i}`,
                  toolCallId: b.id,
                  task: typeof s === 'string' ? s : (s.task || `Step ${i + 1}`),
                  status: 'running' as const,
                  startedAt: Date.now(),
                }))
              : [{
                  id: b.id,
                  toolCallId: b.id,
                  task: (input as any).task || type,
                  status: 'running' as const,
                  startedAt: Date.now(),
                }]
            tracker.addCard({ id: b.id, type, startedAt: Date.now(), tasks, collapsed: false })
          }
          if (b.type === 'tool_result' && b.toolCallId) {
            // Find card by task toolCallId OR by card id (parallel/chain share parent id)
            const card = tracker.cards.find((c) =>
              c.id === b.toolCallId || c.tasks.some((t) => t.toolCallId === b.toolCallId)
            )
            if (card) {
              if (card.id === b.toolCallId) {
                // Parallel/chain: parent tool_use completed → complete all tasks
                for (const t of card.tasks) {
                  if (t.status === 'running') {
                    if (b.is_error) tracker.failTask(card.id, t.toolCallId, b.content as string)
                    else tracker.completeTask(card.id, t.toolCallId)
                  }
                }
              } else {
                // Spawn: individual task match
                if (b.is_error) tracker.failTask(card.id, b.toolCallId, b.content as string)
                else tracker.completeTask(card.id, b.toolCallId)
              }
            }
          }
        }

        // For tool-only blocks, find last assistant message in session to append to
        if (hasToolBlocks && !hasNewText) {
          const sessionMsgs = store.messages.filter((m) => m.sessionId === store.currentSessionId)
          const lastAssistant = [...sessionMsgs].reverse().find((m) => m.role === 'assistant')
          if (lastAssistant) {
            const idx = store.messages.findIndex((m) => m.id === lastAssistant.id)
            const msgs = [...store.messages]
            msgs[idx] = { ...lastAssistant, content: [...lastAssistant.content, ...blocks] }
            useChatStore.setState({ messages: msgs })
            return
          }
        }

        const sid = store.currentSessionId || undefined
        const sessionMsgs = store.messages.filter((m) => m.sessionId === sid)
        const last = sessionMsgs[sessionMsgs.length - 1]
        if (last?.role === 'assistant' && !hasNewText) {
          updateLastMessage((msg) => ({ ...msg, content: [...msg.content, ...blocks] }), sid)
        } else if (last?.role === 'assistant' && hasNewText) {
          updateLastMessage((msg) => ({ ...msg, content: blocks }), sid)
        } else {
          addMessage({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: blocks,
            timestamp: Date.now(),
            sessionId: store.currentSessionId || undefined,
          })
        }
      }

      if (msg.type === 'stream_event') {
        if (msg.event?.delta?.text) {
          pendingText.current += msg.event.delta.text
        }
        if (msg.event?.delta?.thinking) {
          pendingThinking.current += msg.event.delta.thinking
        }
        if (msg.event?.delta?.text || msg.event?.delta?.thinking) {
          if (!flushTimer.current) {
            flushTimer.current = setTimeout(() => {
              flushTimer.current = null
              flushPendingText()
            }, 16) // ~60fps
          }
        }
      }
    })

    const unsubError = window.claude.onError((data) => {
      flushPendingText()
      useSubagentTracker.getState().completeAll()
      addMessage({
        id: `err-${Date.now()}`,
        role: 'system',
        content: [{ type: 'text', text: data.message }],
        timestamp: Date.now(),
      })
      setLoading(false)
    })

    const unsubDone = window.claude.onDone((data) => {
      flushPendingText()
      useSubagentTracker.getState().completeAll()
      const store = useChatStore.getState()
      const backendSessionId = data.sessionId
      // Use captured temp session ID from send() time, not live currentSessionId
      const tempSessionId = pendingTempSessionId.current

      if (backendSessionId && tempSessionId) {
        // Atomic session ID swap
        const msgs = store.messages.map((m) =>
          m.sessionId === tempSessionId ? { ...m, sessionId: backendSessionId } : m
        )
        const sessionMsgs = msgs.filter((m) => m.sessionId === backendSessionId)
        const firstUserMsg = sessionMsgs.find((m) => m.role === 'user')
        const title = firstUserMsg
          ? (firstUserMsg.content[0] as any)?.text?.slice(0, 50) || 'New chat'
          : 'New chat'
        const lastAssistant = [...sessionMsgs].reverse().find((m) => m.role === 'assistant')
        const preview = lastAssistant
          ? (lastAssistant.content.find((b) => b.type === 'text') as any)?.text?.slice(0, 80) || ''
          : ''

        // Remove old temp session from list, add with real ID
        const sessions = store.sessions.filter((s) => s.id !== tempSessionId)
        sessions.push({
          id: backendSessionId,
          title,
          preview,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })

        useChatStore.setState({
          messages: msgs,
          sessions,
          currentSessionId: backendSessionId,
        })

        pendingTempSessionId.current = null

        // Refresh session usage after completion
        window.claude.getSessionUsage(backendSessionId).then((usage) => {
          useChatStore.getState().setSessionUsage(usage)
        }).catch(() => {})
      } else if (backendSessionId) {
        // Real session — just refresh usage
        pendingTempSessionId.current = null
        window.claude.getSessionUsage(backendSessionId).then((usage) => {
          useChatStore.getState().setSessionUsage(usage)
        }).catch(() => {})
      }

      setLoading(false)
    })

    // Handle stream clear on retry — reset current assistant message
    const unsubStreamClear = window.claude.onStreamClear(() => {
      const store = useChatStore.getState()
      const sessionMsgs = store.messages.filter((m) => m.sessionId === store.currentSessionId)
      const lastAssistant = [...sessionMsgs].reverse().find((m) => m.role === 'assistant')
      if (lastAssistant) {
        const idx = store.messages.findIndex((m) => m.id === lastAssistant.id)
        const msgs = [...store.messages]
        msgs[idx] = { ...lastAssistant, content: [] }
        useChatStore.setState({ messages: msgs })
      }
      pendingText.current = ''
      pendingThinking.current = ''
    })

    // Flow items from main process (tools pushing directly)
    const unsubFlowItem = window.claude.onFlowItem((data) => {
      useChatStore.getState().pushFlowItem({
        type: data.type as any,
        content: data.content,
        meta: data.meta,
      })
    })

    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current)
        flushTimer.current = null
      }
      flushPendingText()
      unsubMessage()
      unsubError()
      unsubDone()
      unsubStreamClear()
      unsubFlowItem()
    }
  }, [addMessage, setLoading, setSessionId, setConfig, updateLastMessage, flushPendingText, addSession, deleteSession, setMessages, syncSessions])

  const send = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || isLoading) return

      const store = useChatStore.getState()
      let sid = store.currentSessionId
      let isRealSession = !!sid

      // Create a temp session if none exists (first message of new chat)
      if (!sid) {
        sid = `session-${Date.now()}`
        addSession({
          id: sid,
          title: prompt.slice(0, 50) || 'New chat',
          preview: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        setSessionId(sid)
        pendingTempSessionId.current = sid
      } else {
        pendingTempSessionId.current = null
      }

      addMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        timestamp: Date.now(),
        sessionId: sid,
      })

      addMessage({
        id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: [],
        timestamp: Date.now(),
        sessionId: sid,
      })

      setLoading(true)
      // Safety timeout: auto-reset isLoading if DONE/ERROR never arrives (e.g. backend crash)
      const safetyTimer = setTimeout(() => {
        const state = useChatStore.getState()
        if (state.isLoading) {
          console.warn('[useClaude] safety timeout — resetting isLoading')
          setLoading(false)
        }
      }, 180000)
      try {
        // Only pass sessionId to backend if it's a real (persisted) session
        await window.claude.sendMessage(prompt, isRealSession ? sid : undefined)
        clearTimeout(safetyTimer)
      } catch (err: unknown) {
        clearTimeout(safetyTimer)
        const msg = err instanceof Error ? err.message : 'Failed to send message'
        addMessage({
          id: `err-${Date.now()}`,
          role: 'system',
          content: [{ type: 'text', text: msg }],
          timestamp: Date.now(),
        })
        setLoading(false)
      }
    },
    [isLoading, addMessage, setLoading, addSession, setSessionId]
  )

  const cancel = useCallback(async () => {
    await window.claude.cancel()
    setLoading(false)
  }, [setLoading])

  const updateConfig = useCallback(async (partial: Partial<ClaudeConfig>) => {
    if (partial.model) await window.claude.setModel(partial.model)
    if (partial.provider) await window.claude.setProvider(partial.provider)
    if (partial.effort) await window.claude.setEffort(partial.effort)
    if (partial.cwd) await window.claude.setCwd(partial.cwd)
    if (partial.permissionMode) await window.claude.setPermissionMode(partial.permissionMode)
    setConfig(partial)
  }, [setConfig])

  const pickDirectory = useCallback(async () => {
    const path = await window.claude.pickDirectory()
    if (path) setConfig({ cwd: path })
    return path
  }, [setConfig])

  const listBranches = useCallback(async (sessionId: string) => {
    return window.claude.listBranches(sessionId)
  }, [])

  const switchBranch = useCallback(async (sessionId: string, branchName: string) => {
    await window.claude.switchBranch(sessionId, branchName)
  }, [])

  const branchSession = useCallback(async (sessionId: string, fromEntryId: string, branchName?: string) => {
    return window.claude.branchSession(sessionId, fromEntryId, branchName)
  }, [])

  return {
    messages,
    isLoading,
    config,
    send,
    cancel,
    clearMessages,
    updateConfig,
    pickDirectory,
    syncSessions,
    loadSessionMessages,
    listBranches,
    switchBranch,
    branchSession,
  }
}
