/**
 * AdapterChannel — 适配器输出通道实现
 *
 * 将 AgentCore 的输出通过 IM 适配器发送给用户
 * 支持伪流式更新（editMessageText）
 */

import { readFile } from 'fs/promises'
import sharp from 'sharp'
import type { OutputChannel } from '../core/output-channel'
import type { BaseAdapter } from './adapters/base-adapter'

export class AdapterChannel implements OutputChannel {
  private streamMessageId: string | null = null
  private streamBuffer = ''
  private toolBuffer = ''
  private streamTimer: NodeJS.Timeout | null = null
  private sending = false
  private _pendingSend: Promise<string | undefined> | null = null
  private _lastSentContent = ''
  private _charsSinceFlush = 0
  private readonly BUFFER_THRESHOLD = 10
  private readonly streamUpdateInterval = 300 // 300ms 更新一次

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
    this._charsSinceFlush += text.length

    if (!this.streamMessageId && !this.sending) {
      this.sending = true
      const snapshot = this.streamBuffer
      this._pendingSend = this.adapter.sendText(this.chatId, snapshot).then((msgId) => {
        this.sending = false
        this._pendingSend = null
        if (msgId) {
          this.streamMessageId = msgId
          this._lastSentContent = snapshot
        }
        this._charsSinceFlush = 0
        return msgId
      }).catch(() => {
        this.sending = false
        this._pendingSend = null
        return undefined
      })
      return
    }

    if (!this.streamMessageId) return

    if (!this.streamTimer && this._charsSinceFlush >= this.BUFFER_THRESHOLD) {
      this.streamTimer = setTimeout(() => this.flushStream(), this.streamUpdateInterval)
    }
  }

  sendThinkingDelta(thinking: string): void {
    // 思考过程不发送给用户（太冗长）
    // 可以在这里添加一个"正在思考..."的提示
  }

  sendToolCall(id: string, name: string, input: unknown): void {
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

    // 提取工具参数摘要
    let summary = ''
    if (name === 'Bash' && typeof input === 'object' && input !== null) {
      const cmd = (input as any).command || ''
      summary = cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd
    } else if ((name === 'Read' || name === 'Write' || name === 'Edit') && typeof input === 'object' && input !== null) {
      const fp = (input as any).file_path || ''
      summary = fp.split(/[/\\]/).pop() || fp
    } else if (name === 'Grep' || name === 'Glob') {
      summary = String((input as any)?.pattern || '')
    }

    const line = summary ? `${emoji} ${name}: ${summary}` : `${emoji} ${name}...`
    this.toolBuffer = line

    // 立即刷新到消息
    this.scheduleFlush()
  }

  sendToolResult(id: string, content: string, isError?: boolean): void {
    if (isError) {
      const snippet = content.length > 80 ? content.slice(0, 80) + '...' : content
      this.toolBuffer = `❌ ${snippet}`
      this.scheduleFlush()
    } else {
      this.toolBuffer = ''
    }
  }

  sendDone(sessionId: string, cost: number, maxContextTokens: number): void {
    if (this.streamTimer) {
      clearTimeout(this.streamTimer)
      this.streamTimer = null
    }

    this.toolBuffer = ''

    if (this._pendingSend) {
      this._pendingSend.then(() => {
        this._finalizeMessage()
      })
      return
    }

    this._finalizeMessage()
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

    // 重置所有状态
    this._resetState()
    this.toolBuffer = ''
  }

  sendImage(pathOrBuffer: string | Buffer, caption?: string): void {
    const send = async (buffer: Buffer) => {
      // PNG 转 JPEG：2MB → ~300KB，加速代理上传
      try {
        const meta = await sharp(buffer).metadata()
        if (meta.format === 'png') {
          buffer = await sharp(buffer).jpeg({ quality: 85 }).toBuffer()
          console.log(`[AdapterChannel] PNG→JPEG: ${meta.size} → ${buffer.length} bytes`)
        }
      } catch { /* sharp 失败不影响发送原图 */ }

      this.adapter.sendImage(this.chatId, buffer, caption).catch((err) => {
        console.error('[AdapterChannel] sendImage failed:', err)
      })
    }

    if (typeof pathOrBuffer === 'string') {
      readFile(pathOrBuffer).then(send).catch((err) => {
        console.error('[AdapterChannel] sendImage read failed:', err)
      })
    } else {
      send(pathOrBuffer)
    }
  }

  private scheduleFlush() {
    // 立即刷新（工具状态需要即时反馈）
    if (this.streamMessageId) {
      this.flushStream()
    } else if (!this.sending) {
      // 还没有消息，触发首次发送
      this.sending = true
      const snapshot = this.composeDisplay()
      this._pendingSend = this.adapter.sendText(this.chatId, snapshot).then((msgId) => {
        this.sending = false
        this._pendingSend = null
        if (msgId) {
          this.streamMessageId = msgId
          this._lastSentContent = snapshot
        }
        this._charsSinceFlush = 0
        return msgId
      }).catch(() => {
        this.sending = false
        this._pendingSend = null
        return undefined
      })
    }
  }

  /**
   * 组合显示文本：流式内容 + 工具状态
   */
  private composeDisplay(): string {
    if (this.toolBuffer) {
      return this.streamBuffer ? `${this.streamBuffer}\n\n${this.toolBuffer}` : this.toolBuffer
    }
    return this.streamBuffer
  }

  private flushStream() {
    if (!this.streamMessageId) return

    const display = this.composeDisplay()
    if (!display || display === this._lastSentContent) return

    this.adapter.editMessage(this.chatId, this.streamMessageId, display).catch((err) => {
      console.warn('[AdapterChannel] Stream flush failed:', err)
    })

    this._lastSentContent = display
    this._charsSinceFlush = 0
    this.streamTimer = null
  }

  private _finalizeMessage(): void {
    if (this.streamBuffer === this._lastSentContent && this.streamMessageId) {
      this._resetState()
      return
    }

    if (this.streamMessageId && this.streamBuffer) {
      this.adapter.editMessage(this.chatId, this.streamMessageId, this.streamBuffer).catch((err) => {
        console.warn('[AdapterChannel] Final update failed:', err)
      })
    } else if (this.streamBuffer) {
      this.adapter.send(this.chatId, this.streamBuffer).catch((err) => {
        console.warn('[AdapterChannel] Final send failed:', err)
      })
    }

    this._resetState()
  }

  private _resetState(): void {
    this.streamMessageId = null
    this.streamBuffer = ''
    this._lastSentContent = ''
    this._pendingSend = null
    this._charsSinceFlush = 0
  }
}
