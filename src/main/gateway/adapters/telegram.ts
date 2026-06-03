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
import { existsSync } from 'fs'
import { BaseAdapter, IncomingMessage, MessageAttachment, AdapterConfig } from './base-adapter'
import { StreamBufferManager } from '../stream-buffer'

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
  private streamBufferManager: StreamBufferManager

  constructor(config: TelegramAdapterConfig) {
    super(config)
    this.config = {
      streamUpdateInterval: 1500, // 1.5 秒更新一次
      maxMessageLength: 4000,
      ...config,
    }

    // 初始化流式缓冲区管理器
    this.streamBufferManager = new StreamBufferManager(
      { updateInterval: this.config.streamUpdateInterval },
      (chatId, text) => this.sendText(chatId, text),
      (chatId, messageId, text) => this.editMessage(chatId, messageId, text),
    )
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
    this.streamBufferManager.destroy()
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
    return this.streamBufferManager.create(chatId, initialText)
  }

  /**
   * 追加流式内容
   */
  appendStream(bufferKey: string, delta: string) {
    this.streamBufferManager.append(bufferKey, delta)
  }

  /**
   * 完成流式更新
   */
  async finishStream(bufferKey: string): Promise<void> {
    await this.streamBufferManager.finish(bufferKey)
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
}
