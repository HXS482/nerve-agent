import React, { useEffect, useRef, useMemo, useCallback, Fragment } from 'react'
import { ChatMessage } from '../../shared/types'
import { MessageBubble } from './MessageBubble'
import { useChatStore } from '../stores/chatStore'
import ASCIIText from './ASCIIText'

interface Props {
  messages: ChatMessage[]
  isLoading: boolean
  onSend?: (prompt: string) => void
}

export function getApprovalSummary(req: ToolApprovalRequest): string {
  const input = req.toolInput
  if (req.toolName === 'Bash') return (input.command as string)?.slice(0, 80) || ''
  if (req.toolName === 'Write' || req.toolName === 'Edit') {
    const path = (input.file_path as string) || ''
    return path.split(/[/\\]/).slice(-2).join('/') || path
  }
  return JSON.stringify(input).slice(0, 80)
}

export function ChatPanel({ messages, isLoading, onSend }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const currentSessionId = useChatStore((s) => s.currentSessionId)

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

  // 只滚动聊天自己的容器，不能用 scrollIntoView 污染根窗口滚动位置
  useEffect(() => {
    const container = containerRef.current
    container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
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
      data-chat-scroll
      style={{ paddingTop: '32px', paddingBottom: '80px' }}
    >
      <div style={{ paddingInline: 'var(--sp-md)' }}>
        <div style={{ maxWidth: '90%', margin: '0 auto' }}>
          {filteredMessages.map((msg, i) => {
            const prev = i > 0 ? filteredMessages[i - 1] : undefined
            return (
              <Fragment key={msg.id}>
                <MessageBubble message={msg} prevRole={prev?.role} onRetry={msg.role === 'assistant' ? onRetryMessage : undefined} isStreaming={msg.role === 'assistant' && isLoading && i === filteredMessages.length - 1} />
              </Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
