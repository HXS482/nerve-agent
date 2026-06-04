/**
 * Telegram Bot API 客户端（代理隧道版）
 *
 * 不依赖 telegraf / proxy-agent
 * 使用原生 https 模块 + 自定义 CONNECT 隧道 Agent
 *
 * 代理隧道流程：net.connect → CONNECT 请求 → TLS 握手 → https.request
 */

import net from 'net'
import https from 'https'
import tls from 'tls'
import { EventEmitter } from 'events'

export interface TelegramClientOptions {
  token: string
  /** HTTP 代理地址，如 http://127.0.0.1:7897 */
  proxy?: string
  /** Long polling 超时（秒） */
  pollingTimeout?: number
}

function parseProxy(proxyUrl: string): { host: string; port: number } {
  const url = new URL(proxyUrl)
  return { host: url.hostname, port: parseInt(url.port, 10) || 80 }
}

export class TelegramClient extends EventEmitter {
  private token: string
  private proxyHost: string | null = null
  private proxyPort: number = 0
  private pollingTimeout: number
  private offset = 0
  private processedIds = new Set<number>()
  private polling = false
  private aborted = false

  constructor(options: TelegramClientOptions) {
    super()
    this.token = options.token
    this.pollingTimeout = options.pollingTimeout ?? 30

    if (options.proxy) {
      const { host, port } = parseProxy(options.proxy)
      this.proxyHost = host
      this.proxyPort = port
    }
  }

  // ─── 生命周期 ───────────────────────────────────────

  async startPolling(): Promise<void> {
    if (this.polling) return
    this.polling = true
    this.aborted = false

    if (this.proxyHost && this.proxyPort) {
      console.log(`[TelegramClient] Using proxy: http://${this.proxyHost}:${this.proxyPort}`)
    }

    console.log('[TelegramClient] Starting long polling...')
    this.pollLoop()
  }

  stopPolling(): void {
    this.aborted = true
    this.polling = false
    console.log('[TelegramClient] Stopped polling')
  }

  // ─── Long Polling 循环 ──────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.polling && !this.aborted) {
      try {
        const updates = await this.callApi<Update[]>('getUpdates', {
          offset: this.offset,
          timeout: this.pollingTimeout,
          allowed_updates: JSON.stringify(['message']),
        })

        for (const update of updates) {
          this.offset = update.update_id + 1
          // 去重：防止 poll 重试时重复处理
          if (this.processedIds.has(update.update_id)) continue
          this.processedIds.add(update.update_id)
          this.processUpdate(update)
        }

        // 清理过旧的 ID（保留最近 1000 个）
        if (this.processedIds.size > 1000) {
          const arr = Array.from(this.processedIds)
          this.processedIds = new Set(arr.slice(-500))
        }
      } catch (err: any) {
        if (this.aborted) break

        // 409 Conflict = 另一个实例在 polling，停止
        if (err.statusCode === 409) {
          console.error('[TelegramClient] 409 Conflict: another bot instance is polling. Stopping.')
          this.stopPolling()
          this.emit('error', err)
          break
        }

        console.error('[TelegramClient] Poll error:', err.message)
        await sleep(3000)
      }
    }
  }

  private processUpdate(update: Update): void {
    if (!update.message) return
    const msg = update.message

    if (msg.text) {
      this.emit('text', msg)
    } else if (msg.photo) {
      this.emit('photo', msg)
    } else if (msg.document) {
      this.emit('document', msg)
    } else if (msg.voice) {
      this.emit('voice', msg)
    }
  }

  // ─── API 方法 ───────────────────────────────────────

  async getMe(): Promise<any> {
    return this.callApi('getMe')
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    options?: { parse_mode?: string; reply_to_message_id?: number },
  ): Promise<any> {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      ...options,
    })
  }

  async editMessageText(
    chatId: string | number,
    messageId: number,
    text: string,
    options?: { parse_mode?: string },
  ): Promise<any> {
    return this.callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options,
    })
  }

  async sendPhoto(
    chatId: string | number,
    photo: string | Buffer,
    options?: { caption?: string },
  ): Promise<any> {
    if (typeof photo === 'string' && !photo.includes('/') && !photo.includes('\\')) {
      return this.callApi('sendPhoto', {
        chat_id: chatId,
        photo,
        ...options,
      })
    }
    return this.callApiMultipart('sendPhoto', { chat_id: chatId, ...options }, [
      { field: 'photo', filename: 'photo.jpg', buffer: photo as Buffer, mime: 'image/jpeg' },
    ])
  }

  async sendDocument(
    chatId: string | number,
    document: string | { source: string | Buffer; filename?: string },
    options?: { caption?: string },
  ): Promise<any> {
    if (typeof document === 'string') {
      return this.callApi('sendDocument', {
        chat_id: chatId,
        document,
        ...options,
      })
    }

    const { source, filename } = document
    if (typeof source === 'string') {
      const fs = require('fs')
      const buffer = fs.readFileSync(source)
      return this.callApiMultipart('sendDocument', { chat_id: chatId, ...options }, [
        { field: 'document', filename: filename || source.split(/[/\\]/).pop() || 'file', buffer, mime: 'application/octet-stream' },
      ])
    }

    return this.callApiMultipart('sendDocument', { chat_id: chatId, ...options }, [
      { field: 'document', filename: filename || 'file', buffer: source, mime: 'application/octet-stream' },
    ])
  }

  async sendChatAction(chatId: string | number, action: string): Promise<any> {
    return this.callApi('sendChatAction', {
      chat_id: chatId,
      action,
    })
  }

  async getFile(fileId: string): Promise<any> {
    return this.callApi('getFile', { file_id: fileId })
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`
    return this.httpGet(url)
  }

  // ─── 底层 HTTP（Node 原生 https 模块）──────────────

  private async callApi<T = any>(method: string, params?: Record<string, any>): Promise<T> {
    const url = `https://api.telegram.org/bot${this.token}/${method}`
    const body = params ? JSON.stringify(params) : '{}'

    const raw = await this.httpPost(url, body, 'application/json')
    const parsed = JSON.parse(raw)

    if (!parsed.ok) {
      const err: any = new Error(`Telegram API ${method} failed: ${parsed.description}`)
      err.statusCode = parsed.error_code
      throw err
    }

    return parsed.result as T
  }

  private async callApiMultipart(
    method: string,
    fields: Record<string, any>,
    files: Array<{ field: string; filename: string; buffer: Buffer; mime: string }>,
  ): Promise<any> {
    const boundary = `----NerveBoundary${Date.now()}`
    const parts: Buffer[] = []

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
        ),
      )
    }

    for (const file of files) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
        ),
      )
      parts.push(file.buffer)
      parts.push(Buffer.from('\r\n'))
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`))
    const body = Buffer.concat(parts)

    const url = `https://api.telegram.org/bot${this.token}/${method}`
    const raw = await this.httpPost(url, body, `multipart/form-data; boundary=${boundary}`)
    const parsed = JSON.parse(raw)

    if (!parsed.ok) {
      const err: any = new Error(`Telegram API ${method} failed: ${parsed.description}`)
      err.statusCode = parsed.error_code
      throw err
    }

    return parsed.result
  }

  /**
   * HTTPS POST — 有代理时直接创建 TLS socket，无代理时用原生 https
   */
  private httpPost(url: string, body: string | Buffer, contentType: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const bodyBuf = typeof body === 'string' ? Buffer.from(body) : body

      if (this.proxyHost && this.proxyPort) {
        this.createTlsSocket(parsed.hostname, parseInt(parsed.port) || 443).then((socket) => {
          const reqStr =
            `POST ${parsed.pathname} HTTP/1.1\r\n` +
            `Host: ${parsed.host}\r\n` +
            `Content-Type: ${contentType}\r\n` +
            `Content-Length: ${bodyBuf.length}\r\n` +
            `Connection: close\r\n\r\n`

          // 合并 headers + body 为一次写入，避免 TLS 分片问题
          const fullRequest = Buffer.concat([Buffer.from(reqStr), bodyBuf])
          socket.write(fullRequest)

          readTlsResponse(socket).then(resolve).catch(reject)
        }).catch(reject)
      } else {
        // 直连（不需要代理）
        const options: https.RequestOptions = {
          hostname: parsed.hostname,
          port: parseInt(parsed.port) || 443,
          path: parsed.pathname,
          method: 'POST',
          headers: { 'Content-Type': contentType, 'Content-Length': bodyBuf.length },
        }
        const req = https.request(options, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve(Buffer.concat(chunks).toString()))
        })
        req.on('error', reject)
        req.write(bodyBuf)
        req.end()
      }
    })
  }

  private httpGet(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url)

      if (this.proxyHost && this.proxyPort) {
        this.createTlsSocket(parsed.hostname, parseInt(parsed.port) || 443).then((socket) => {
          const reqStr =
            `GET ${parsed.pathname}${parsed.search || ''} HTTP/1.1\r\n` +
            `Host: ${parsed.host}\r\n` +
            `Connection: close\r\n\r\n`

          socket.write(reqStr)
          readTlsResponseRaw(socket).then(resolve).catch(reject)
        }).catch(reject)
      } else {
        const req = https.request(url, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('error', reject)
        req.end()
      }
    })
  }

  /**
   * 通过代理建立 CONNECT 隧道，完成 TLS 握手，返回可用的 TLS socket
   */
  private createTlsSocket(host: string, port: number): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      console.log(`[createTlsSocket] Connecting to proxy ${this.proxyHost}:${this.proxyPort}`)
      const socket = net.connect(this.proxyPort!, this.proxyHost!, () => {
        console.log(`[createTlsSocket] TCP connected, sending CONNECT`)
        socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`)
      })

      const chunks: Buffer[] = []
      const onData = (chunk: Buffer) => {
        chunks.push(chunk)
        const header = Buffer.concat(chunks).toString()
        if (!header.includes('\r\n\r\n')) return

        socket.removeListener('data', onData)
        console.log(`[createTlsSocket] CONNECT response: ${header.split('\r\n')[0]}`)

        if (!header.startsWith('HTTP/1.1 200') && !header.startsWith('HTTP/1.0 200')) {
          socket.destroy()
          reject(new Error(`CONNECT failed: ${header.split('\r\n')[0]}`))
          return
        }

        // 检查是否有 header 之后的剩余数据
        const headerEnd = header.indexOf('\r\n\r\n')
        const remaining = Buffer.concat(chunks).slice(headerEnd + 4)
        console.log(`[createTlsSocket] Remaining bytes after CONNECT header: ${remaining.length}`)

        console.log(`[createTlsSocket] Starting TLS handshake...`)
        const tlsSocket = tls.connect({ socket, servername: host } as any, () => {
          console.log(`[createTlsSocket] TLS done, protocol: ${tlsSocket.getProtocol()}, cipher: ${tlsSocket.getCipher()?.name}`)
          resolve(tlsSocket)
        })
        tlsSocket.on('error', (err) => {
          console.error(`[createTlsSocket] TLS error: ${err.message}`)
          reject(err)
        })
        tlsSocket.on('close', () => console.log(`[createTlsSocket] TLS socket closed`))
      }

      socket.on('data', onData)
      socket.on('error', (err) => {
        console.error(`[createTlsSocket] Socket error: ${err.message}`)
        reject(err)
      })
      socket.on('close', () => console.log(`[createTlsSocket] Raw socket closed`))
    })
  }
}

// ─── 工具函数 ─────────────────────────────────────────

/**
 * 从 TLS socket 读取完整 HTTP 响应，返回 body 字符串
 */
function readTlsResponse(socket: tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const timeout = setTimeout(() => {
      socket.destroy(new Error('Response timeout (60s)'))
    }, 60_000)

    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => {
      clearTimeout(timeout)
      const raw = Buffer.concat(chunks).toString()
      const headerEnd = raw.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        reject(new Error(`Invalid HTTP response (${raw.length} bytes)`))
        return
      }
      const headerPart = raw.slice(0, headerEnd)
      let bodyPart = raw.slice(headerEnd + 4)

      if (/transfer-encoding:\s*chunked/i.test(headerPart)) {
        bodyPart = decodeChunked(bodyPart)
      }

      const encoding = (headerPart.match(/content-encoding:\s*(\S+)/i) || [])[1]?.toLowerCase()
      if (encoding === 'gzip' || encoding === 'deflate') {
        const zlib = require('zlib')
        const buf = Buffer.from(bodyPart, 'binary')
        const decoded = encoding === 'gzip' ? zlib.gunzipSync(buf) : zlib.inflateSync(buf)
        resolve(decoded.toString())
      } else {
        resolve(bodyPart)
      }
    })
    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

/**
 * 从 TLS socket 读取完整 HTTP 响应，返回原始 Buffer
 */
function readTlsResponseRaw(socket: tls.TLSSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const timeout = setTimeout(() => {
      socket.destroy(new Error('Response timeout (60s)'))
    }, 60_000)

    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => {
      clearTimeout(timeout)
      const raw = Buffer.concat(chunks)
      const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'))
      if (headerEnd === -1) {
        reject(new Error('Invalid HTTP response'))
        return
      }
      const headerPart = raw.slice(0, headerEnd).toString()
      let bodyPart = raw.slice(headerEnd + 4)

      if (/transfer-encoding:\s*chunked/i.test(headerPart)) {
        bodyPart = Buffer.from(decodeChunked(bodyPart.toString('binary')), 'binary')
      }

      const encoding = (headerPart.match(/content-encoding:\s*(\S+)/i) || [])[1]?.toLowerCase()
      if (encoding === 'gzip' || encoding === 'deflate') {
        const zlib = require('zlib')
        bodyPart = encoding === 'gzip' ? zlib.gunzipSync(bodyPart) : zlib.inflateSync(bodyPart)
      }

      resolve(bodyPart)
    })
    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── 类型 ─────────────────────────────────────────────

interface Update {
  update_id: number
  message?: TelegramMessage
}

export interface TelegramMessage {
  message_id: number
  from: { id: number; username?: string; first_name?: string }
  chat: { id: number; type: string }
  date: number
  text?: string
  caption?: string
  photo?: Array<{ file_id: string; file_unique_id: string; file_size: number; width: number; height: number }>
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
  voice?: { file_id: string; duration?: number; mime_type?: string; file_size?: number }
}
