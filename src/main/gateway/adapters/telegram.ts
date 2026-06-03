/**
 * Telegram 适配器
 *
 * 使用 telegraf 库连接 Telegram Bot API
 * 支持：
 * - 文本消息收发
 * - 伪流式（editMessageText）
 * - 文件/图片收发
 * - Markdown 格式化
 */

import { Telegraf, Context } from 'telegraf'
import { Message } from 'telegraf/types'
import { BaseAdapter, IncomingMessage, MessageAttachment, AdapterConfig } from './base-adapter'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

export interface TelegramAdapterConfig extends AdapterConfig {
  token: string
  allowedUsers?: string[]
  /** 流式更新间隔（ms） */
  streamUpdateInterval?: number
  /** 消息分段长度 */
  maxMessageLength?: number
}

export class TelegramAdapter extends BaseAdapter {
  readonly name = 'telegram'
  readonly platform = 'telegram'

  private bot: Telegraf | null = null
  private config: TelegramAdapterConfig

  // 流式更新缓冲区
  private streamBuffers = new Map<string, {
    chatId: string
    messageId: string
    buffer: string
    timer: NodeJS.Timeout | null
    lastUpdate: number
    sending: boolean  // 防止并发 sendText
  }>()

  constructor(config: TelegramAdapterConfig) {
    super(config)
    this.config = {
      streamUpdateInterval: 1500, // 1.5 秒更新一次
      maxMessageLength: 4000,
      ...config,
    }

    // 定期清理过期的流式缓冲区（5 分钟）
    setInterval(() => this.cleanupStreamBuffers(), 60_000)
  }

  async connect(): Promise<void> {
    if (this.bot) {
      console.warn('[TelegramAdapter] Already connected')
      return
    }

    console.log('[TelegramAdapter] Connecting...')

    this.bot = new Telegraf(this.config.token)

    // 注册消息处理器
    this.bot.on('text', (ctx) => this.handleText(ctx))
    this.bot.on('photo', (ctx) => this.handlePhoto(ctx))
    this.bot.on('document', (ctx) => this.handleDocument(ctx))
    this.bot.on('voice', (ctx) => this.handleVoice(ctx))

    // 启动 bot
    try {
      await this.bot.launch()
      this.connected = true
      this.resetReconnect()
      console.log('[TelegramAdapter] Connected')
    } catch (err) {
      console.error('[TelegramAdapter] Connection failed:', err)
      this.markError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.stopReconnect()

    if (this.bot) {
      this.bot.stop('disconnect')
      this.bot = null
      this.connected = false
      console.log('[TelegramAdapter] Disconnected')
    }

    // 清理流式缓冲区
    for (const buffer of this.streamBuffers.values()) {
      if (buffer.timer) {
        clearTimeout(buffer.timer)
      }
    }
    this.streamBuffers.clear()
  }

  async sendText(chatId: string, text: string): Promise<string | undefined> {
    if (!this.bot) throw new Error('Not connected')

    try {
      const message = await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
      })
      return message.message_id.toString()
    } catch (err) {
      // Markdown 解析失败，尝试纯文本
      console.warn('[TelegramAdapter] Markdown parse failed, trying plain text')
      const message = await this.bot.telegram.sendMessage(chatId, text)
      return message.message_id.toString()
    }
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    if (!this.bot) throw new Error('Not connected')

    try {
      await this.bot.telegram.editMessageText(
        chatId,
        parseInt(messageId),
        undefined,
        text,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      // Markdown 解析失败，尝试纯文本
      try {
        await this.bot.telegram.editMessageText(
          chatId,
          parseInt(messageId),
          undefined,
          text
        )
      } catch (editErr) {
        console.warn('[TelegramAdapter] Edit message failed:', editErr)
      }
    }
  }

  async sendFile(chatId: string, filePath: string, caption?: string): Promise<void> {
    if (!this.bot) throw new Error('Not connected')

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    await this.bot.telegram.sendDocument(chatId, {
      source: filePath,
    }, {
      caption,
    })
  }

  async sendImage(chatId: string, imageBuffer: Buffer, caption?: string): Promise<void> {
    if (!this.bot) throw new Error('Not connected')

    await this.bot.telegram.sendPhoto(chatId, {
      source: imageBuffer,
    }, {
      caption,
    })
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.bot) throw new Error('Not connected')
    await this.bot.telegram.sendChatAction(chatId, 'typing')
  }

  /**
   * 开始流式更新
   * 返回一个 bufferKey，用于后续追加内容和完成
   */
  startStream(chatId: string, initialText: string = ''): string {
    const bufferKey = `${chatId}:${Date.now()}`

    this.streamBuffers.set(bufferKey, {
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
        const buf = this.streamBuffers.get(bufferKey)
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
  appendStream(bufferKey: string, delta: string) {
    const buf = this.streamBuffers.get(bufferKey)
    if (!buf) return

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
        this.flushStream(bufferKey)
      }, this.config.streamUpdateInterval)
    }
  }

  /**
   * 完成流式更新
   */
  async finishStream(bufferKey: string): Promise<void> {
    const buf = this.streamBuffers.get(bufferKey)
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
    this.streamBuffers.delete(bufferKey)
  }

  private flushStream(bufferKey: string) {
    const buf = this.streamBuffers.get(bufferKey)
    if (!buf || !buf.messageId) return

    // 编辑消息
    this.editMessage(buf.chatId, buf.messageId, buf.buffer).catch((err) => {
      console.warn('[TelegramAdapter] Stream flush failed:', err)
    })

    // 重置定时器
    buf.timer = null

    // 如果距离上次更新超过间隔，设置新的定时器
    const elapsed = Date.now() - buf.lastUpdate
    if (elapsed < this.config.streamUpdateInterval!) {
      buf.timer = setTimeout(() => {
        this.flushStream(bufferKey)
      }, this.config.streamUpdateInterval! - elapsed)
    }
  }

  private handleText(ctx: Context) {
    const message = ctx.message as Message.TextMessage
    if (!message) return

    const userId = message.from.id.toString()
    const chatId = message.chat.id.toString()

    // 检查用户权限
    if (!this.isUserAllowed(userId)) {
      console.warn(`[TelegramAdapter] User ${userId} not allowed`)
      return
    }

    const incoming: IncomingMessage = this.normalizeMessage({
      platform: 'telegram',
      chatId,
      userId,
      username: message.from.username,
      content: message.text,
      messageId: message.message_id.toString(),
      timestamp: message.date * 1000,
    })

    this.emit('message', incoming)
  }

  private handlePhoto(ctx: Context) {
    const message = ctx.message as Message.PhotoMessage
    if (!message) return

    const userId = message.from.id.toString()
    const chatId = message.chat.id.toString()

    if (!this.isUserAllowed(userId)) return

    // 获取最大分辨率的图片
    const photo = message.photo[message.photo.length - 1]

    const incoming: IncomingMessage = this.normalizeMessage({
      platform: 'telegram',
      chatId,
      userId,
      username: message.from.username,
      content: message.caption || '[图片]',
      messageId: message.message_id.toString(),
      timestamp: message.date * 1000,
      attachments: [{
        type: 'image',
        url: `telegram:photo:${photo.file_id}`,
        filename: `photo_${photo.file_id}.jpg`,
        mimeType: 'image/jpeg',
        fileSize: photo.file_size,
      }],
    })

    this.emit('message', incoming)
  }

  private handleDocument(ctx: Context) {
    const message = ctx.message as Message.DocumentMessage
    if (!message) return

    const userId = message.from.id.toString()
    const chatId = message.chat.id.toString()

    if (!this.isUserAllowed(userId)) return

    const doc = message.document

    const incoming: IncomingMessage = this.normalizeMessage({
      platform: 'telegram',
      chatId,
      userId,
      username: message.from.username,
      content: message.caption || `[文件: ${doc.file_name}]`,
      messageId: message.message_id.toString(),
      timestamp: message.date * 1000,
      attachments: [{
        type: 'file',
        url: `telegram:document:${doc.file_id}`,
        filename: doc.file_name,
        mimeType: doc.mime_type,
        fileSize: doc.file_size,
      }],
    })

    this.emit('message', incoming)
  }

  private handleVoice(ctx: Context) {
    const message = ctx.message as Message.VoiceMessage
    if (!message) return

    const userId = message.from.id.toString()
    const chatId = message.chat.id.toString()

    if (!this.isUserAllowed(userId)) return

    const voice = message.voice

    const incoming: IncomingMessage = this.normalizeMessage({
      platform: 'telegram',
      chatId,
      userId,
      username: message.from.username,
      content: '[语音消息]',
      messageId: message.message_id.toString(),
      timestamp: message.date * 1000,
      attachments: [{
        type: 'voice',
        url: `telegram:voice:${voice.file_id}`,
        mimeType: voice.mime_type || 'audio/ogg',
        fileSize: voice.file_size,
      }],
    })

    this.emit('message', incoming)
  }

  /**
   * 清理过期的流式缓冲区（5 分钟未更新）
   */
  private cleanupStreamBuffers() {
    const now = Date.now()
    const maxAge = 5 * 60 * 1000 // 5 分钟

    for (const [key, buf] of this.streamBuffers.entries()) {
      if (now - buf.lastUpdate > maxAge) {
        if (buf.timer) {
          clearTimeout(buf.timer)
        }
        this.streamBuffers.delete(key)
        console.log(`[TelegramAdapter] Cleaned up expired stream buffer: ${key}`)
      }
    }
  }
}
