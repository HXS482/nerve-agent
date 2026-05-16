import { useEffect, useRef, useState, useMemo } from 'react'
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

  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  const thinkingText = useMemo(() => {
    if (!isLoading) return ''
    const lastMsg = filteredMessages[filteredMessages.length - 1]
    if (!lastMsg || lastMsg.role !== 'assistant') return ''
    const block = lastMsg.content.find((b) => b.type === 'thinking')
    return (block as any)?.thinking || ''
  }, [filteredMessages, isLoading])

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
        {filteredMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <SubagentTracker />
        {isLoading && (
          <div className="mb-6 animate-fade-in">
            <div className="flex items-center gap-2.5">
              <span
                className="w-2 h-2 rounded-full animate-pulse-soft"
                style={{ background: '#34d399' }}
              />
              <button
                onClick={() => thinkingText && setThinkingExpanded(!thinkingExpanded)}
                className="flex items-center gap-1 transition-colors"
                style={{ cursor: thinkingText ? 'pointer' : 'default' }}
              >
                <span
                  className="text-[var(--fs-sm)]"
                  style={{ color: 'var(--text-outline)' }}
                >
                  Thinking
                </span>
                {thinkingText && (
                  <svg
                    className="w-2.5 h-2.5 transition-transform duration-150"
                    style={{
                      color: 'var(--text-outline-variant)',
                      transform: thinkingExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    viewBox="0 0 16 16"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                )}
              </button>
            </div>
            {thinkingExpanded && thinkingText && (
              <div className="mt-2.5 ml-6">
                <div
                  className="whitespace-pre-wrap rounded-xl leading-relaxed max-h-48 overflow-y-auto"
                  style={{
                    padding: 'var(--sp-sm)',
                    fontSize: 'var(--fs-xs)',
                    color: 'var(--text-on-surface-variant)',
                    background: 'var(--bg-surface-container)',
                    border: '1px solid var(--border-subtle)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {thinkingText}
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
