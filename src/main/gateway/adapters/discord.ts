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
import { StreamBufferManager } from '../stream-buffer'

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
  private streamBufferManager: StreamBufferManager

  constructor(config: DiscordAdapterConfig) {
    super(config)
    this.config = {
      streamUpdateInterval: 1500, // 1.5 秒更新一次
      maxMessageLength: 1900, // Discord 限制 2000 字符
      ...config,
    }

    // 初始化流式缓冲区管理器
    this.streamBufferManager = new StreamBufferManager(
      { updateInterval: this.config.streamUpdateInterval },
      (channelId, text) => this.sendText(channelId, text),
      (channelId, messageId, text) => this.editMessage(channelId, messageId, text),
    )
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
    return this.streamBufferManager.create(channelId, initialText)
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
}
