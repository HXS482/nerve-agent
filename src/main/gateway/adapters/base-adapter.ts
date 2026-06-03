/**
 * IM 适配器基类
 *
 * 职责：
 * - 定义统一的适配器接口
 * - 消息格式标准化
 * - 生命周期管理
 */

import { EventEmitter } from 'events'

export interface IncomingMessage {
  /** 平台名称 */
  platform: string
  /** 聊天ID（群组/私聊） */
  chatId: string
  /** 用户ID */
  userId: string
  /** 用户名（可选） */
  username?: string
  /** 消息内容 */
  content: string
  /** 消息ID（用于编辑/删除） */
  messageId?: string
  /** 时间戳 */
  timestamp: number
  /** 附件 */
  attachments?: MessageAttachment[]
  /** 原始消息（平台特定） */
  raw?: any
}

export interface MessageAttachment {
  type: 'image' | 'file' | 'voice' | 'video'
  url?: string
  buffer?: Buffer
  filename?: string
  mimeType?: string
  fileSize?: number
}

export interface AdapterConfig {
  enabled: boolean
  allowedUsers?: string[]
  [key: string]: any
}

export abstract class BaseAdapter extends EventEmitter {
  abstract readonly name: string
  abstract readonly platform: string

  protected config: AdapterConfig
  protected connected = false

  constructor(config: AdapterConfig) {
    super()
    this.config = config
  }

  /**
   * 连接到平台
   */
  abstract connect(): Promise<void>

  /**
   * 断开连接
   */
  abstract disconnect(): Promise<void>

  /**
   * 发送文本消息
   */
  abstract sendText(chatId: string, text: string): Promise<string | undefined>

  /**
   * 编辑消息（用于流式更新）
   */
  abstract editMessage(chatId: string, messageId: string, text: string): Promise<void>

  /**
   * 发送消息（带分段）
   * Telegram 限制 4096 字符，需要分段发送
   */
  async send(chatId: string, content: string): Promise<void> {
    const chunks = this.splitMessage(content)
    for (const chunk of chunks) {
      await this.sendText(chatId, chunk)
    }
  }

  /**
   * 发送文件
   */
  abstract sendFile(chatId: string, filePath: string, caption?: string): Promise<void>

  /**
   * 发送图片
   */
  abstract sendImage(chatId: string, imageBuffer: Buffer, caption?: string): Promise<void>

  /**
   * 设置"正在输入"状态
   */
  abstract sendTyping(chatId: string): Promise<void>

  /**
   * 检查用户是否允许
   */
  protected isUserAllowed(userId: string): boolean {
    if (!this.config.allowedUsers || this.config.allowedUsers.length === 0) {
      return true // 没有配置白名单，允许所有用户
    }
    return this.config.allowedUsers.includes(userId)
  }

  /**
   * 分段消息（默认实现，子类可覆盖）
   */
  protected splitMessage(text: string, maxLength: number = 4000): string[] {
    if (text.length <= maxLength) {
      return [text]
    }

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining)
        break
      }

      // 尝试在换行符处分割
      let splitIndex = remaining.lastIndexOf('\n', maxLength)
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // 没有合适的换行符，在空格处分割
        splitIndex = remaining.lastIndexOf(' ', maxLength)
      }
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // 没有合适的空格，强制分割
        splitIndex = maxLength
      }

      chunks.push(remaining.slice(0, splitIndex))
      remaining = remaining.slice(splitIndex).trimStart()
    }

    return chunks
  }

  /**
   * 标准化消息
   */
  protected normalizeMessage(raw: any): IncomingMessage {
    return {
      platform: this.platform,
      chatId: raw.chatId,
      userId: raw.userId,
      username: raw.username,
      content: raw.content,
      messageId: raw.messageId,
      timestamp: raw.timestamp || Date.now(),
      attachments: raw.attachments,
      raw,
    }
  }

  /**
   * 是否已连接
   */
  get isConnected(): boolean {
    return this.connected
  }
}
