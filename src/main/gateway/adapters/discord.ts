/**
 * Discord 适配器
 *
 * 使用 discord.js 库连接 Discord Bot API
 * 支持：
 * - 文本消息收发
 * - 伪流式（编辑消息）
 * - Embed 富消息
 * - 文件/图片收发
 */

import { Client, GatewayIntentBits, Message, TextChannel, DMChannel, PartialMessage, Attachment } from 'discord.js'
import { BaseAdapter, IncomingMessage, MessageAttachment, AdapterConfig } from './base-adapter'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

export interface DiscordAdapterConfig extends AdapterConfig {
  token: string
  allowedUsers?: string[]
  /** 流式更新间隔（ms） */
  streamUpdateInterval?: number
  /** 消息分段长度 */
  maxMessageLength?: number
}

export class DiscordAdapter extends BaseAdapter {
  readonly name = 'discord'
  readonly platform = 'discord'

  private client: Client | null = null
  private config: DiscordAdapterConfig

  // 流式更新缓冲区
  private streamBuffers = new Map<string, {
    channelId: string
    messageId: string
    buffer: string
    timer: NodeJS.Timeout | null
    lastUpdate: number
    sending: boolean  // 防止并发 sendText
  }>()

  constructor(config: DiscordAdapterConfig) {
    super(config)
    this.config = {
      streamUpdateInterval: 1500, // 1.5 秒更新一次
      maxMessageLength: 1900, // Discord 限制 2000 字符
      ...config,
    }

    // 定期清理过期的流式缓冲区（5 分钟）
    setInterval(() => this.cleanupStreamBuffers(), 60_000)
  }

  async connect(): Promise<void> {
    if (this.client) {
      console.warn('[DiscordAdapter] Already connected')
      return
    }

    console.log('[DiscordAdapter] Connecting...')

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    })

    // 注册事件处理器
    this.client.on('messageCreate', (msg) => this.handleMessage(msg))
    this.client.on('messageUpdate', (oldMsg, newMsg) => this.handleMessageUpdate(oldMsg, newMsg))

    // 连接断开事件
    this.client.on('disconnect', () => {
      console.warn('[DiscordAdapter] Disconnected from Discord')
      this.markDisconnected()
    })

    // 错误事件
    this.client.on('error', (err) => {
      console.error('[DiscordAdapter] Error:', err)
      this.markError(err)
    })

    // 登录
    try {
      await this.client.login(this.config.token)
      this.connected = true
      this.resetReconnect()
      console.log(`[DiscordAdapter] Connected as ${this.client.user?.tag}`)
    } catch (err) {
      console.error('[DiscordAdapter] Connection failed:', err)
      this.markError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.stopReconnect()

    if (this.client) {
      this.client.destroy()
      this.client = null
      this.connected = false
      console.log('[DiscordAdapter] Disconnected')
    }

    // 清理流式缓冲区
    for (const buffer of this.streamBuffers.values()) {
      if (buffer.timer) {
        clearTimeout(buffer.timer)
      }
    }
    this.streamBuffers.clear()
  }

  async sendText(channelId: string, text: string): Promise<string | undefined> {
    if (!this.client) throw new Error('Not connected')

    const channel = await this.client.channels.fetch(channelId)
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} not found or not text-based`)
    }

    const message = await (channel as TextChannel | DMChannel).send(text)
    return message.id
  }

  async editMessage(channelId: string, messageId: string, text: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')

    const channel = await this.client.channels.fetch(channelId)
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} not found`)
    }

    try {
      const message = await (channel as TextChannel | DMChannel).messages.fetch(messageId)
      await message.edit(text)
    } catch (err) {
      console.warn('[DiscordAdapter] Edit message failed:', err)
    }
  }

  async sendFile(channelId: string, filePath: string, caption?: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')

    const channel = await this.client.channels.fetch(channelId)
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} not found`)
    }

    await (channel as TextChannel | DMChannel).send({
      content: caption,
      files: [filePath],
    })
  }

  async sendImage(channelId: string, imageBuffer: Buffer, caption?: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')

    const channel = await this.client.channels.fetch(channelId)
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} not found`)
    }

    await (channel as TextChannel | DMChannel).send({
      content: caption,
      files: [{ attachment: imageBuffer, name: 'image.png' }],
    })
  }

  async sendTyping(channelId: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')

    const channel = await this.client.channels.fetch(channelId)
    if (!channel || !channel.isTextBased()) {
      return
    }

    await (channel as TextChannel | DMChannel).sendTyping()
  }

  /**
   * 开始流式更新
   */
  startStream(channelId: string, initialText: string = ''): string {
    const bufferKey = `${channelId}:${Date.now()}`

    this.streamBuffers.set(bufferKey, {
      channelId,
      messageId: '',
      buffer: initialText,
      timer: null,
      lastUpdate: Date.now(),
      sending: false,
    })

    // 如果有初始文本，立即发送
    if (initialText) {
      this.sendText(channelId, initialText).then((messageId) => {
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
      this.sendText(buf.channelId, buf.buffer).then((messageId) => {
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
      await this.editMessage(buf.channelId, buf.messageId, buf.buffer)
    }

    // 清理缓冲区
    this.streamBuffers.delete(bufferKey)
  }

  private flushStream(bufferKey: string) {
    const buf = this.streamBuffers.get(bufferKey)
    if (!buf || !buf.messageId) return

    // 编辑消息
    this.editMessage(buf.channelId, buf.messageId, buf.buffer).catch((err) => {
      console.warn('[DiscordAdapter] Stream flush failed:', err)
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

  private handleMessage(msg: Message) {
    // 忽略 bot 消息
    if (msg.author.bot) return

    const userId = msg.author.id
    const channelId = msg.channelId

    // 检查用户权限
    if (!this.isUserAllowed(userId)) {
      console.warn(`[DiscordAdapter] User ${userId} not allowed`)
      return
    }

    // 处理附件
    const attachments: MessageAttachment[] = []
    for (const [id, attachment] of msg.attachments) {
      attachments.push({
        type: this.getAttachmentType(attachment),
        url: attachment.url,
        filename: attachment.name,
        mimeType: attachment.contentType || undefined,
        fileSize: attachment.size,
      })
    }

    const incoming: IncomingMessage = this.normalizeMessage({
      platform: 'discord',
      chatId: channelId,
      userId,
      username: msg.author.username,
      content: msg.content,
      messageId: msg.id,
      timestamp: msg.createdTimestamp,
      attachments: attachments.length > 0 ? attachments : undefined,
    })

    this.emit('message', incoming)
  }

  private handleMessageUpdate(oldMsg: Message | PartialMessage, newMsg: Message | PartialMessage) {
    // 消息更新不处理（可能需要未来扩展）
  }

  private getAttachmentType(attachment: Attachment): 'image' | 'file' | 'voice' | 'video' {
    const contentType = attachment.contentType || ''

    if (contentType.startsWith('image/')) return 'image'
    if (contentType.startsWith('video/')) return 'video'
    if (contentType.startsWith('audio/')) return 'voice'
    return 'file'
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
        console.log(`[DiscordAdapter] Cleaned up expired stream buffer: ${key}`)
      }
    }
  }
}
