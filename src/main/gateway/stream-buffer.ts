/**
 * StreamBuffer — 流式缓冲区工具类
 *
 * 统一处理 IM 平台的伪流式更新逻辑
 * 消除 TelegramAdapter / DiscordAdapter / AdapterChannel 的重复代码
 */

export interface StreamBufferConfig {
  /** 流式更新间隔（ms） */
  updateInterval?: number
  /** 最大缓冲区大小（字符数） */
  maxBufferSize?: number
  /** 过期时间（ms） */
  maxAge?: number
}

export interface StreamBuffer {
  /** 聊天 ID */
  chatId: string
  /** 消息 ID（发送后设置） */
  messageId: string
  /** 缓冲区内容 */
  buffer: string
  /** 更新定时器 */
  timer: NodeJS.Timeout | null
  /** 最后更新时间 */
  lastUpdate: number
  /** 是否正在发送（防止并发） */
  sending: boolean
}

export type SendTextFn = (chatId: string, text: string) => Promise<string | undefined>
export type EditMessageFn = (chatId: string, messageId: string, text: string) => Promise<void>

export class StreamBufferManager {
  private buffers = new Map<string, StreamBuffer>()
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(
    private config: StreamBufferConfig = {},
    private sendText: SendTextFn,
    private editMessage: EditMessageFn,
  ) {
    this.config = {
      updateInterval: 1500,
      maxBufferSize: 100_000,
      maxAge: 5 * 60 * 1000, // 5 分钟
      ...config,
    }

    // 定期清理过期缓冲区
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000)
  }

  /**
   * 创建新的流式缓冲区
   */
  create(chatId: string, initialText: string = ''): string {
    const bufferKey = `${chatId}:${Date.now()}`

    this.buffers.set(bufferKey, {
      chatId,
      messageId: '',
      buffer: initialText,
      timer: null,
      lastUpdate: Date.now(),
      sending: false,
    })

    // 如果有初始文本，立即发送
    if (initialText) {
      this.sendText(chatId, initialText).then((messageId) => {
        const buf = this.buffers.get(bufferKey)
        if (buf && messageId) {
          buf.messageId = messageId
        }
      })
    }

    return bufferKey
  }

  /**
   * 追加流式内容
   */
  append(bufferKey: string, delta: string): void {
    const buf = this.buffers.get(bufferKey)
    if (!buf) return

    // 检查缓冲区大小限制
    if (this.config.maxBufferSize && buf.buffer.length + delta.length > this.config.maxBufferSize) {
      console.warn(`[StreamBuffer] Buffer size limit reached for ${bufferKey}`)
      return
    }

    buf.buffer += delta
    buf.lastUpdate = Date.now()

    // 如果还没有发送第一条消息，先发送
    // 使用 sending 标志防止并发 sendText
    if (!buf.messageId && !buf.sending) {
      buf.sending = true
      this.sendText(buf.chatId, buf.buffer).then((messageId) => {
        buf.sending = false
        if (messageId) {
          buf.messageId = messageId
        }
      }).catch(() => {
        buf.sending = false
      })
      return
    }

    // 设置定时更新（只有在 messageId 已设置时才更新）
    if (!buf.timer && buf.messageId) {
      buf.timer = setTimeout(() => {
        this.flush(bufferKey)
      }, this.config.updateInterval)
    }
  }

  /**
   * 完成流式更新
   */
  async finish(bufferKey: string): Promise<void> {
    const buf = this.buffers.get(bufferKey)
    if (!buf) return

    // 清除定时器
    if (buf.timer) {
      clearTimeout(buf.timer)
      buf.timer = null
    }

    // 最终更新
    if (buf.messageId) {
      await this.editMessage(buf.chatId, buf.messageId, buf.buffer)
    }

    // 清理缓冲区
    this.buffers.delete(bufferKey)
  }

  /**
   * 刷新缓冲区（发送更新）
   */
  private flush(bufferKey: string): void {
    const buf = this.buffers.get(bufferKey)
    if (!buf || !buf.messageId) return

    // 编辑消息
    this.editMessage(buf.chatId, buf.messageId, buf.buffer).catch((err) => {
      console.warn(`[StreamBuffer] Flush failed for ${bufferKey}:`, err)
    })

    // 重置定时器
    buf.timer = null
  }

  /**
   * 清理过期缓冲区
   */
  private cleanup(): void {
    const now = Date.now()
    const maxAge = this.config.maxAge || 5 * 60 * 1000

    for (const [key, buf] of this.buffers.entries()) {
      if (now - buf.lastUpdate > maxAge) {
        if (buf.timer) {
          clearTimeout(buf.timer)
        }
        this.buffers.delete(key)
        console.log(`[StreamBuffer] Cleaned up expired buffer: ${key}`)
      }
    }
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    // 清理所有缓冲区
    for (const [, buf] of this.buffers.entries()) {
      if (buf.timer) {
        clearTimeout(buf.timer)
      }
    }
    this.buffers.clear()
  }

  /**
   * 获取缓冲区数量
   */
  get size(): number {
    return this.buffers.size
  }
}
