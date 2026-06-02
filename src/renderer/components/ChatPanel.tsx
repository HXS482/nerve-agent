import React, { useEffect, useRef, useMemo, useCallback, Fragment } from 'react'
import { ChatMessage, ToolApprovalRequest } from '../../shared/types'
import { MessageBubble } from './MessageBubble'
import { SubagentTracker } from './SubagentTracker'
import { useChatStore } from '../stores/chatStore'
import ASCIIText from './ASCIIText'

interface Props {
  messages: ChatMessage[]
  isLoading: boolean
  onSend?: (prompt: string) => void
}

function getApprovalSummary(req: ToolApprovalRequest): string {
  const input = req.toolInput
  if (req.toolName === 'Bash') return (input.command as string)?.slice(0, 80) || ''
  if (req.toolName === 'Write' || req.toolName === 'Edit') {
    const path = (input.file_path as string) || ''
    return path.split(/[/\\]/).slice(-2).join('/') || path
  }
  return JSON.stringify(input).slice(0, 80)
}

function ApprovalBar() {
  const pendingApprovals = useChatStore((s) => s.pendingApprovals)
  const current = pendingApprovals[0]

  const handleResponse = useCallback((approved: boolean) => {
    if (!current) return
    useChatStore.getState().removeApproval(current.approvalId)
    window.claude.respondToolApproval({ approvalId: current.approvalId, approved })
  }, [current?.approvalId])

  // Keyboard shortcuts: Enter = allow, Escape = deny
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleResponse(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleResponse(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current?.approvalId, handleResponse])

  if (!current) return null

  return (
    <div
      style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(30,30,32,0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '8px 16px',
        animation: 'slideUp 0.2s ease-out',
      }}
    >
      <div className="flex items-center gap-3" style={{ maxWidth: '78%', margin: '0 auto' }}>
        {/* Warning icon */}
        <div
          style={{
            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
            background: 'rgba(255, 193, 7, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffc107" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>

        {/* Tool name + summary */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#e0e0e0', flexShrink: 0 }}>
            {current.toolName}
          </span>
          <span
            className="truncate font-mono"
            style={{ fontSize: '11px', color: '#9e9e9e' }}
          >
            {getApprovalSummary(current)}
          </span>
        </div>

        {/* Queue count */}
        {pendingApprovals.length > 1 && (
          <span style={{ fontSize: '11px', color: '#9e9e9e', flexShrink: 0 }}>
            +{pendingApprovals.length - 1}
          </span>
        )}

        {/* Deny */}
        <button
          onClick={() => handleResponse(false)}
          style={{
            fontSize: '12px', fontWeight: 500, padding: '4px 12px', borderRadius: 6,
            background: 'rgba(244, 67, 54, 0.08)', color: '#ef5350',
            border: '1px solid rgba(244, 67, 54, 0.15)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Deny
        </button>

        {/* Allow */}
        <button
          onClick={() => handleResponse(true)}
          autoFocus
          style={{
            fontSize: '12px', fontWeight: 500, padding: '4px 14px', borderRadius: 6,
            background: 'rgba(76, 175, 80, 0.12)', color: '#66bb6a',
            border: '1px solid rgba(76, 175, 80, 0.2)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Allow
        </button>
      </div>
    </div>
  )
}

export function ChatPanel({ messages, isLoading, onSend }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const pendingApprovals = useChatStore((s) => s.pendingApprovals) // read to trigger re-render for paddingBottom

  const filteredMessages = useMemo(
    () => currentSessionId ? messages.filter((m) => m.sessionId === currentSessionId) : [],
    [messages, currentSessionId]
  )

  const onRetryMessage = useCallback(
    (assistantMsg: ChatMessage) => {
      if (!onSend) return
      const idx = filteredMessages.findIndex((m) => m.id === assistantMsg.id)
      const userMsg = filteredMessages.slice(0, idx).reverse().find((m) => m.role === 'user')
      if (!userMsg) return
      const text = userMsg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      if (text) onSend(text)
    },
    [onSend, filteredMessages]
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filteredMessages.length])

  if (filteredMessages.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center"
        style={{ paddingInline: 'var(--sp-md)' }}
      >
        <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ position: 'relative', width: '100%', height: '300px' }}>
          <ASCIIText
            text="Hey!"
            enableWaves
            asciiFontSize={4}
          />
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto w-full"
        data-chat-scroll
        style={{ paddingTop: '32px', paddingBottom: pendingApprovals.length > 0 ? '16px' : '80px' }}
      >
        <div style={{ paddingInline: 'var(--sp-md)' }}>
          <div style={{ maxWidth: '78%', margin: '0 auto' }}>
            {filteredMessages.map((msg, i) => {
              const prev = i > 0 ? filteredMessages[i - 1] : undefined
              return (
                <Fragment key={msg.id}>
                  <MessageBubble message={msg} prevRole={prev?.role} onRetry={msg.role === 'assistant' ? onRetryMessage : undefined} />
                </Fragment>
              )
            })}
            <SubagentTracker />
            {isLoading && (
              <div className="flex justify-center my-4 animate-fade-in">
                <div
                  className="flex items-center gap-2 px-3 py-1 rounded-full"
                  style={{ background: 'rgba(223,168,143,0.12)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse-soft" style={{ background: '#dfa88f' }} />
                  <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08px', color: '#dfa88f', textTransform: 'uppercase' }}>Thinking</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
      <ApprovalBar />
    </>
  )
}
