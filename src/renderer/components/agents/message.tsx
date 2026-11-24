import type { ComponentPropsWithRef, HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

/**
 * Message / MessageContent / MessageGroup —— beUI 的对话行结构。
 *
 * 这三个组件本身没有样式重量，它们的价值在于**约定 DOM 契约**：
 * message-scroller 靠 `[data-slot="message"]` 找到每条消息、靠 `data-from`
 * 区分谁说的。所以宁可多这一层，也不要让滚动组件去猜 DOM 结构。
 *
 * 这里的实现比上游更薄（没有 status / streaming 的额外包装），因为真正的
 * 消息渲染仍然交给 nerve 自己的 MessageBubble —— 组件库只负责滚动与导航。
 */

export type MessageFrom = 'user' | 'assistant' | 'system' | 'conversation'

interface MessageProps extends ComponentPropsWithRef<'div'> {
  id: string
  from: MessageFrom
}

export function Message({ id, from, className, children, ...props }: MessageProps) {
  return (
    <div
      data-slot="message"
      data-from={from}
      data-message-id={id}
      className={cn('group/message', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function MessageContent({ className, children, ...props }: ComponentPropsWithRef<'div'>) {
  return (
    <div data-slot="message-content" className={className} {...props}>
      {children}
    </div>
  )
}

interface MessageGroupProps extends ComponentPropsWithRef<'div'> {
  /** 相邻消息的间距档位 */
  spacing?: 'compact' | 'default' | 'relaxed'
}

const GROUP_SPACING: Record<NonNullable<MessageGroupProps['spacing']>, string> = {
  compact: 'flex flex-col',
  default: 'flex flex-col',
  relaxed: 'flex flex-col',
}

export function MessageGroup({
  spacing = 'default',
  className,
  children,
  ...props
}: MessageGroupProps) {
  return (
    <div
      data-slot="message-group"
      data-spacing={spacing}
      className={cn(GROUP_SPACING[spacing], className)}
      {...props}
    >
      {children}
    </div>
  )
}

/** 让 data-slot="message-bubble-content" 能取到本文本 —— 供导航轨预览用 */
export function withMessageBubbleContent<T extends HTMLAttributes<HTMLElement>>(props: T): T {
  return { ...props, 'data-slot': 'message-bubble-content' } as T
}
