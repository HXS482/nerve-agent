import React, { useEffect, useRef, useMemo, Fragment } from 'react'
import { ChatMessage } from '../../shared/types'
import { MessageBubble } from './MessageBubble'
import { SubagentTracker } from './SubagentTracker'
import { useChatStore } from '../stores/chatStore'
import ASCIIText from './ASCIIText'

interface Props {
  messages: ChatMessage[]
  isLoading: boolean
  onSend?: (prompt: string) => void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function ChatPanel({ messages, isLoading, onSend }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const currentSessionId = useChatStore((s) => s.currentSessionId)

  const filteredMessages = useMemo(
    () => currentSessionId ? messages.filter((m) => m.sessionId === currentSessionId) : [],
    [messages, currentSessionId]
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
      style={{ paddingTop: 'var(--sp-xl)', paddingBottom: '72px' }}
    >
      <div style={{ paddingInline: 'var(--sp-md)' }}>
        {filteredMessages.map((msg, i) => {
          const prev = i > 0 ? filteredMessages[i - 1] : undefined
          const showTimestamp = prev && prev.role !== msg.role && msg.timestamp
          return (
            <Fragment key={msg.id}>
              {showTimestamp && (
                <div className="flex justify-center my-3">
                  <span style={{ fontSize: '11px', color: 'var(--text-outline)' }}>
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              )}
              <MessageBubble message={msg} prevRole={prev?.role} />
            </Fragment>
          )
        })}
        <SubagentTracker />
        {isLoading && (
          <div className="flex justify-center my-4 animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse-soft" style={{ background: 'var(--accent-primary)' }} />
              <span style={{ fontSize: '11px', color: 'var(--text-outline)' }}>思考中...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
