/**
 * AdapterChannel — 适配器输出通道实现
 *
 * 将 AgentCore 的输出通过 IM 适配器发送给用户
 * 支持伪流式更新（editMessageText）
 */

import type { OutputChannel } from '../core/output-channel'
import type { BaseAdapter } from './adapters/base-adapter'

export class AdapterChannel implements OutputChannel {
  private streamMessageId: string | null = null
  private streamBuffer = ''
  private streamTimer: NodeJS.Timeout | null = null
  private readonly streamUpdateInterval = 1500 // 1.5 秒更新一次

  constructor(
    private adapter: BaseAdapter,
    private chatId: string,
    private replyToMessageId?: string,
  ) {}

  isReady(): boolean {
    return this.adapter.isConnected
  }

  sendStreamDelta(text: string): void {
    this.streamBuffer += text

    // 如果还没有发送第一条消息，先发送
    if (!this.streamMessageId) {
      this.adapter.sendText(this.chatId, this.streamBuffer).then((msgId) => {
        if (msgId) {
          this.streamMessageId = msgId
        }
      })
      return
    }

    // 设置定时更新
    if (!this.streamTimer) {
      this.streamTimer = setTimeout(() => {
        this.flushStream()
      }, this.streamUpdateInterval)
    }
  }

  sendThinkingDelta(thinking: string): void {
    // 思考过程不发送给用户（太冗长）
    // 可以在这里添加一个"正在思考..."的提示
  }

  sendToolCall(id: string, name: string, input: unknown): void {
    // 工具调用可以发送一个简短的状态提示
    // 例如：🔧 执行工具: bash
    const toolEmoji: Record<string, string> = {
      'Bash': '💻',
      'Read': '📖',
      'Write': '✏️',
      'Edit': '✏️',
      'Glob': '🔍',
      'Grep': '🔍',
      'GenerateImage': '🎨',
    }

    const emoji = toolEmoji[name] || '🔧'
    this.adapter.sendTyping(this.chatId).catch(() => {})
  }

  sendToolResult(id: string, content: string, isError?: boolean): void {
    // 工具结果不发送给用户（太冗长）
    // 错误可以发送一个简短的提示
    if (isError) {
      // 不发送完整错误，只标记
    }
  }

  sendDone(sessionId: string, cost: number, maxContextTokens: number): void {
    // 清除流式更新定时器
    if (this.streamTimer) {
      clearTimeout(this.streamTimer)
      this.streamTimer = null
    }

    // 最终更新消息
    if (this.streamMessageId && this.streamBuffer) {
      this.adapter.editMessage(this.chatId, this.streamMessageId, this.streamBuffer).catch((err) => {
        console.warn('[AdapterChannel] Final update failed:', err)
      })
    } else if (this.streamBuffer) {
      // 还没有发送过消息，现在发送
      this.adapter.send(this.chatId, this.streamBuffer).catch((err) => {
        console.warn('[AdapterChannel] Final send failed:', err)
      })
    }

    // 重置状态
    this.streamMessageId = null
    this.streamBuffer = ''
  }

  sendError(message: string): void {
    // 清除流式更新定时器
    if (this.streamTimer) {
      clearTimeout(this.streamTimer)
      this.streamTimer = null
    }

    // 发送错误消息
    const errorMsg = `❌ Error: ${message}`
    this.adapter.send(this.chatId, errorMsg).catch((err) => {
      console.error('[AdapterChannel] Error send failed:', err)
    })

    // 重置状态
    this.streamMessageId = null
    this.streamBuffer = ''
  }

  private flushStream() {
    if (!this.streamMessageId || !this.streamBuffer) return

    // 编辑消息
    this.adapter.editMessage(this.chatId, this.streamMessageId, this.streamBuffer).catch((err) => {
      console.warn('[AdapterChannel] Stream flush failed:', err)
    })

    // 重置定时器
    this.streamTimer = null
  }
}
