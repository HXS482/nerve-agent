/**
 * Telegram 适配器
 *
 * 使用自研 TelegramClient（原生 HTTP CONNECT 隧道）
 * 替代 telegraf + proxy-agent，直接走代理更稳定
 *
 * 支持：
 * - 文本消息收发
 * - 伪流式（editMessageText）
 * - 文件/图片收发
 * - Markdown 格式化（自动降级纯文本）
 */

import { existsSync } from 'fs'
import { BaseAdapter, IncomingMessage, MessageAttachment, AdapterConfig } from './base-adapter'
import { TelegramClient, TelegramMessage } from './telegram-client'
import { StreamBufferManager } from '../stream-buffer'

export interface TelegramAdapterConfig extends AdapterConfig {
  token: string
  allowedUsers?: string[]
  /** 流式更新间隔（ms） */
  streamUpdateInterval?: number
  /** 消息分段长度 */
  maxMessageLength?: number
  /** 代理地址，如 http://127.0.0.1:7897 */
  proxy?: string
}

export class TelegramAdapter extends BaseAdapter {
  readonly name = 'telegram'
  readonly platform = 'telegram'

  private client: TelegramClient | null = null
  protected config: TelegramAdapterConfig
  private streamBufferManager: StreamBufferManager

  constructor(config: TelegramAdapterConfig) {
    super(config)
    this.config = {
      streamUpdateInterval: 300,
      maxMessageLength: 4000,
      ...config,
    }

    this.streamBufferManager = new StreamBufferManager(
      { updateInterval: this.config.streamUpdateInterval },
      (chatId, text) => this.sendText(chatId, text),
      (chatId, messageId, text) => this.editMessage(chatId, messageId, text),
    )
  }

  async connect(): Promise<void> {
    if (this.client) {
      console.warn('[TelegramAdapter] Already connected')
      return
    }

    console.log('[TelegramAdapter] Connecting...')

    try {
      this.client = new TelegramClient({
        token: this.config.token,
        proxy: this.config.proxy,
        pollingTimeout: 30,
      })

      // 事件桥接：TelegramClient → IncomingMessage
      this.client.on('text', (msg: TelegramMessage) => this.handleText(msg))
      this.client.on('photo', (msg: TelegramMessage) => this.handlePhoto(msg))
      this.client.on('document', (msg: TelegramMessage) => this.handleDocument(msg))
      this.client.on('voice', (msg: TelegramMessage) => this.handleVoice(msg))

      this.client.on('error', (err: Error) => {
        console.error('[TelegramAdapter] Client error:', err.message)
        // 409 Conflict 等致命错误：标记断开，触发 BaseAdapter 重连
        if (!this.connected) return
        this.connected = false
        this.markError(err)
        this.markDisconnected()
      })

      await this.client.startPolling()

      // 验证连接：调用 getMe
      await this.client.getMe()

      this.connected = true
      this.resetReconnect()
      console.log('[TelegramAdapter] Connected')
    } catch (err) {
      console.error('[TelegramAdapter] Connection failed:', err)
      this.client?.stopPolling()
      this.client = null
      this.connected = false
      this.markError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.stopReconnect()

    if (this.client) {
      this.client.stopPolling()
      this.client = null
      this.connected = false
      console.log('[TelegramAdapter] Disconnected')
    }

    this.streamBufferManager.destroy()
  }

  async sendText(chatId: string, text: string): Promise<string | undefined> {
    if (!this.client) throw new Error('Not connected')

    try {
      const result = await this.client.sendMessage(chatId, text, { parse_mode: 'Markdown' })
      return result.message_id.toString()
    } catch (err) {
      // Markdown 解析失败，降级纯文本
      console.warn('[TelegramAdapter] Markdown parse failed, trying plain text')
      const result = await this.client.sendMessage(chatId, text)
      return result.message_id.toString()
    }
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')

    try {
      await this.client.editMessageText(chatId, parseInt(messageId), text, { parse_mode: 'Markdown' })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)

      // "message is not modified" — harmless, ignore
      if (errMsg.includes('message is not modified')) return

      // 回退到纯文本
      try {
        await this.client.editMessageText(chatId, parseInt(messageId), text)
      } catch (editErr) {
        const innerMsg = editErr instanceof Error ? editErr.message : String(editErr)
        if (!innerMsg.includes('message is not modified')) {
          console.warn('[TelegramAdapter] Edit message failed:', editErr)
        }
      }
    }
  }

  async sendFile(chatId: string, filePath: string, caption?: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    await this.client.sendDocument(chatId, { source: filePath }, { caption })
  }

  async sendImage(chatId: string, imageBuffer: Buffer, caption?: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')

    await this.client.sendPhoto(chatId, imageBuffer, { caption })
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')
    await this.client.sendChatAction(chatId, 'typing')
  }

  /**
   * 通过 file_id 下载 Telegram 图片
   * 返回图片 Buffer，供 base64 编码后传给 Agent
   */
  async downloadPhoto(fileId: string): Promise<Buffer> {
    if (!this.client) throw new Error('Not connected')

    const fileInfo = await this.client.getFile(fileId)
    return this.client.downloadFile(fileInfo.file_path)
  }

  startStream(chatId: string, initialText: string = ''): string {
    return this.streamBufferManager.create(chatId, initialText)
  }

  appendStream(bufferKey: string, delta: string) {
    this.streamBufferManager.append(bufferKey, delta)
  }

  async finishStream(bufferKey: string): Promise<void> {
    await this.streamBufferManager.finish(bufferKey)
  }

  // ─── 事件处理：raw TelegramMessage → IncomingMessage ───────────

  private handleText(msg: TelegramMessage) {
    const userId = msg.from.id.toString()
    const chatId = msg.chat.id.toString()

    if (!this.isUserAllowed(userId)) {
      console.warn(`[TelegramAdapter] User ${userId} not allowed`)
      return
    }

    const incoming: IncomingMessage = this.normalizeMessage({
      platform: 'telegram',
      chatId,
      userId,
      username: msg.from.username,
      content: msg.text!,
      messageId: msg.message_id.toString(),
      timestamp: msg.date * 1000,
    })

    this.emit('message', incoming)
  }

  private handlePhoto(msg: TelegramMessage) {
    const userId = msg.from.id.toString()
    const chatId = msg.chat.id.toString()

    if (!this.isUserAllowed(userId)) return

    const photo = msg.photo![msg.photo!.length - 1]

    const incoming: IncomingMessage = this.normalizeMessage({
      platform: 'telegram',
      chatId,
      userId,
      username: msg.from.username,
      content: msg.caption || '[图片]',
      messageId: msg.message_id.toString(),
      timestamp: msg.date * 1000,
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

  private handleDocument(msg: TelegramMessage) {
    const userId = msg.from.id.toString()
    const chatId = msg.chat.id.toString()

    if (!this.isUserAllowed(userId)) return

    const doc = msg.document!

    const incoming: IncomingMessage = this.normalizeMessage({
      platform: 'telegram',
      chatId,
      userId,
      username: msg.from.username,
      content: msg.caption || `[文件: ${doc.file_name}]`,
      messageId: msg.message_id.toString(),
      timestamp: msg.date * 1000,
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

  private handleVoice(msg: TelegramMessage) {
    const userId = msg.from.id.toString()
    const chatId = msg.chat.id.toString()

    if (!this.isUserAllowed(userId)) return

    const voice = msg.voice!

    const incoming: IncomingMessage = this.normalizeMessage({
      platform: 'telegram',
      chatId,
      userId,
      username: msg.from.username,
      content: '[语音消息]',
      messageId: msg.message_id.toString(),
      timestamp: msg.date * 1000,
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
