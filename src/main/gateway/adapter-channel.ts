/**
 * AdapterChannel — 适配器输出通道实现
 *
 * 将 AgentCore 的输出通过 IM 适配器发送给用户
 * 支持伪流式更新（editMessageText）+ 流式光标 + 自适应限流退避
 */

import { readFile } from 'fs/promises'
import sharp from 'sharp'
import type { OutputChannel } from '../core/output-channel'
import type { BaseAdapter } from './adapters/base-adapter'

export class AdapterChannel implements OutputChannel {
  private readonly CURSOR = ' ▉'

  private streamMessageId: string | null = null
  private streamBuffer = ''
  private toolBuffer = ''
  private streamTimer: NodeJS.Timeout | null = null
  private sending = false
  private _pendingSend: Promise<string | undefined> | null = null
  private _lastSentContent = ''
  private _charsSinceFlush = 0
  private _lastFlushTime = 0
  private _editInterval = 800
  private readonly _BASE_EDIT_INTERVAL = 800
  private readonly _MAX_EDIT_INTERVAL = 10000

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

    // 首次发送：创建消息
    if (!this.streamMessageId && !this.sending) {
      this.sending = true
      const snapshot = this.streamBuffer
      this._pendingSend = this.adapter.sendText(this.chatId, snapshot).then((msgId) => {
        this.sending = false
        this._pendingSend = null
        if (msgId) {
          this.streamMessageId = msgId
          this._lastSentContent = snapshot
          this._lastFlushTime = Date.now()
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

    // 自适应 flush：按时间间隔排队触发
    const now = Date.now()
    const elapsed = now - this._lastFlushTime
    if (elapsed >= this._editInterval && this._charsSinceFlush > 0) {
      this.flushStream()
    } else if (!this.streamTimer) {
      this.streamTimer = setTimeout(() => {
        this.streamTimer = null
        this.flushStream()
      }, this._editInterval - elapsed)
    }
  }

  sendThinkingDelta(thinking: string): void {
    // 思考过程不发送给用户（太冗长）
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
          this._lastFlushTime = Date.now()
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
   * 组合显示文本：流式内容 + 工具状态 + 流式光标
   */
  private composeDisplay(): string {
    let text = this.streamBuffer
    if (this.toolBuffer) {
      text = text ? `${text}\n\n${this.toolBuffer}` : this.toolBuffer
    }
    return text + this.CURSOR
  }

  private async flushStream(): Promise<void> {
    if (!this.streamMessageId) return

    const display = this.composeDisplay()
    if (!display || display === this._lastSentContent) return

    try {
      await this.adapter.editMessage(this.chatId, this.streamMessageId, display)
      this._lastSentContent = display
      this._lastFlushTime = Date.now()
      this._editInterval = this._BASE_EDIT_INTERVAL
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('429') || msg.includes('Too Many') || msg.includes('flood')) {
        this._editInterval = Math.min(this._editInterval * 2, this._MAX_EDIT_INTERVAL)
        console.warn(`[AdapterChannel] Flood control, interval → ${this._editInterval}ms`)
      }
    }

    this._charsSinceFlush = 0
    this.streamTimer = null
  }

  private _finalizeMessage(): void {
    // Compare against last sent content minus cursor — cursor is stripped on done
    const lastContentNoCursor = this._lastSentContent.endsWith(this.CURSOR)
      ? this._lastSentContent.slice(0, -this.CURSOR.length)
      : this._lastSentContent
    if (this.streamBuffer === lastContentNoCursor && this.streamMessageId) {
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
    this._lastFlushTime = 0
    this._editInterval = this._BASE_EDIT_INTERVAL
  }
}
