import React, { useEffect, useRef, useMemo, useCallback, Fragment } from 'react'
import { ChatMessage } from '../../shared/types'
import { MessageBubble } from './MessageBubble'
import { MessageScroller } from './agents/message-scroller'
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
  // 与底部输入栏共用同一上限：滑杆一动，正文列与胶囊左右边缘同步
  const conversationWidth = useChatStore((s) => s.conversationWidth)

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
    <MessageScroller
      className="flex-1 w-full"
      navigation="rail"
      label="对话"
      busy={isLoading}
      followOutput
      smooth
      viewportClassName="chat-scroll-viewport"
      contentClassName="chat-scroll-content"
    >
      <div style={{ paddingInline: 'var(--sp-md)' }}>
        {/* 列宽与输入胶囊共用 .chat-column（见 globals.css 的说明） */}
        <div
          className="chat-column"
          style={
            conversationWidth > 0
              ? ({ '--conversation-max': `${conversationWidth}px` } as React.CSSProperties)
              : undefined
          }
        >
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
    </MessageScroller>
  )
}
