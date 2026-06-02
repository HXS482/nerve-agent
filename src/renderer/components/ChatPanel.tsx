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

function ApprovalCard({ req }: { req: ToolApprovalRequest }) {
  const handleResponse = useCallback((approved: boolean) => {
    useChatStore.getState().removeApproval(req.approvalId)
    window.claude.respondToolApproval({ approvalId: req.approvalId, approved })
  }, [req.approvalId])

  return (
    <div
      className="flex items-center gap-2 py-1 px-2 rounded-lg animate-fade-in"
      style={{
        background: 'rgba(255, 193, 7, 0.08)',
        border: '1px solid rgba(255, 193, 7, 0.2)',
        fontSize: 'var(--fs-sm)',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffc107" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <span style={{ color: 'var(--text-on-surface-variant)', fontWeight: 500 }}>{req.toolName}</span>
      <span className="truncate font-mono" style={{ color: 'var(--text-outline)', fontSize: 'var(--fs-xs)', flex: 1 }}>
        {getApprovalSummary(req)}
      </span>
      <button
        onClick={() => handleResponse(true)}
        className="px-2 py-0.5 rounded text-xs font-medium"
        style={{ background: 'rgba(76, 175, 80, 0.15)', color: '#4caf50', border: '1px solid rgba(76, 175, 80, 0.3)' }}
      >
        Allow
      </button>
      <button
        onClick={() => handleResponse(false)}
        className="px-2 py-0.5 rounded text-xs font-medium"
        style={{ background: 'rgba(244, 67, 54, 0.15)', color: '#f44336', border: '1px solid rgba(244, 67, 54, 0.3)' }}
      >
        Deny
      </button>
    </div>
  )
}

function getApprovalSummary(req: ToolApprovalRequest): string {
  const input = req.toolInput
  if (req.toolName === 'Bash') return (input.command as string)?.slice(0, 60) || ''
  if (req.toolName === 'Write' || req.toolName === 'Edit') {
    const path = (input.file_path as string) || ''
    return path.split(/[/\\]/).slice(-2).join('/') || path
  }
  if (req.toolName === 'Read' || req.toolName === 'Glob' || req.toolName === 'Grep') return (input.pattern as string) || ''
  return JSON.stringify(input).slice(0, 60)
}

export function ChatPanel({ messages, isLoading, onSend }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const pendingApprovals = useChatStore((s) => s.pendingApprovals)

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
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto w-full"
      style={{ paddingTop: '32px', paddingBottom: '80px' }}
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
          {pendingApprovals.map((req) => (
            <ApprovalCard key={req.approvalId} req={req} />
          ))}
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
  )
}
