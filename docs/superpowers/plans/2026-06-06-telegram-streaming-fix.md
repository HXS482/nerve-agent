# Telegram Gateway 流式回复优化 + 重复消息修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Telegram Gateway 发送重复消息的竞态 bug，优化流式编辑体验（300ms 间隔 + 字符缓冲阈值 + flood control）。

**Architecture:** `AdapterChannel` 是 AgentCore 输出到 IM 的桥梁。当前 `sendStreamDelta()` fire-and-forget 模式导致 `sendDone()` 与 pending `sendText()` 竞态，产生重复消息。修复方案：追踪 pending Promise，sendDone 等待完成后再判断；同时降低 editInterval、加字符阈值优化流式体感。

**Tech Stack:** TypeScript, vitest, Node.js EventEmitter

---

### Task 1: 修复 AdapterChannel sendDone 竞态 — 追踪 pending sendText

**Files:**
- Modify: `src/main/gateway/adapter-channel.ts`
- Create: `src/main/gateway/adapter-channel.test.ts`

- [ ] **Step 1: 写失败测试 — sendDone 不应产生重复消息**

```ts
// src/main/gateway/adapter-channel.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AdapterChannel } from './adapter-channel'
import type { BaseAdapter } from './adapters/base-adapter'

function createMockAdapter(): BaseAdapter {
  return {
    isConnected: true,
    sendText: vi.fn().mockResolvedValue('msg_1'),
    editMessage: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  } as any
}

describe('AdapterChannel', () => {
  it('sendDone should not send duplicate message when sendText is pending', async () => {
    const adapter = createMockAdapter()
    // sendText 延迟返回，模拟慢网络
    let resolveSendText: (v: string) => void
    adapter.sendText = vi.fn().mockImplementation(() => new Promise(r => { resolveSendText = r }))

    const channel = new AdapterChannel(adapter, 'chat_123')

    // 触发 sendText（fire-and-forget）
    channel.sendStreamDelta('您好')

    // sendText 还没返回，立刻调 sendDone
    channel.sendDone('session_1', 0, 0)

    // 解析 sendText
    resolveSendText!('msg_1')

    // 等待 microtask
    await new Promise(r => setTimeout(r, 10))

    // sendText 应该只被调用一次（sendDone 里的分支）
    // 不应该出现 send + sendText 各一次的情况
    const sendCalls = (adapter.sendText as any).mock.calls.length
    const editCalls = (adapter.editMessage as any).mock.calls.length
    const sendDirectCalls = (adapter.send as any).mock.calls.length

    // 总共只应该有 1 次消息发送（sendDone 应等待 sendText 后 edit，或只 sendText 一次）
    expect(sendCalls + sendDirectCalls).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/main/gateway/adapter-channel.test.ts`
Expected: FAIL — sendDone 发了新消息，sendText 也创建了消息，共 2 次

- [ ] **Step 3: 实现修复 — 追踪 _pendingSend**

在 `AdapterChannel` 类中添加：

```ts
// 新增属性
private _pendingSend: Promise<string | undefined> | null = null
private _lastSentContent = ''
```

修改 `sendStreamDelta` 中的 sendText 调用：

```ts
sendStreamDelta(text: string): void {
  this.streamBuffer += text

  if (!this.streamMessageId && !this.sending) {
    this.sending = true
    // 捕获快照 + 追踪 Promise
    const snapshot = this.streamBuffer
    this._pendingSend = this.adapter.sendText(this.chatId, snapshot).then((msgId) => {
      this.sending = false
      this._pendingSend = null
      if (msgId) {
        this.streamMessageId = msgId
        this._lastSentContent = snapshot
      }
      return msgId
    }).catch(() => {
      this.sending = false
      this._pendingSend = null
      return undefined
    })
    return
  }

  if (!this.streamMessageId) return

  if (!this.streamTimer) {
    this.streamTimer = setTimeout(() => this.flushStream(), this.streamUpdateInterval)
  }
}
```

修改 `sendDone`：

```ts
sendDone(sessionId: string, cost: number, maxContextTokens: number): void {
  if (this.streamTimer) {
    clearTimeout(this.streamTimer)
    this.streamTimer = null
  }
  this.toolBuffer = ''

  // 关键修复：等待 pending sendText 完成
  if (this._pendingSend) {
    this._pendingSend.then(() => {
      this._finalizeMessage()
    })
    return
  }

  this._finalizeMessage()
}

private _finalizeMessage(): void {
  // 去重：内容未变化则跳过
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
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/main/gateway/adapter-channel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/gateway/adapter-channel.ts src/main/gateway/adapter-channel.test.ts
git commit -m "fix: prevent duplicate messages by tracking pending sendText in AdapterChannel"
```

---

### Task 2: 优化流式参数 — 300ms 间隔 + 字符缓冲阈值

**Files:**
- Modify: `src/main/gateway/adapter-channel.ts`
- Modify: `src/main/gateway/adapter-channel.test.ts`

- [ ] **Step 1: 写测试 — 验证字符阈值行为**

```ts
// 追加到 adapter-channel.test.ts
it('should not flush until buffer threshold is reached', async () => {
  vi.useFakeTimers()
  const adapter = createMockAdapter()
  adapter.sendText = vi.fn().mockResolvedValue('msg_1')
  adapter.editMessage = vi.fn().mockResolvedValue(undefined)

  const channel = new AdapterChannel(adapter, 'chat_123')

  // 发送小增量（< 30 字符阈值）
  channel.sendStreamDelta('Hi')
  await vi.advanceTimersByTimeAsync(10)
  // sendText 已触发（首次发送不受阈值限制）

  // 等 sendText resolve
  await vi.advanceTimersByTimeAsync(10)

  // 发送小增量，timer 触发但不到阈值 → 不应 edit
  channel.sendStreamDelta(' there')
  await vi.advanceTimersByTimeAsync(400)

  // 因为增量不到阈值，editMessage 不应被调用
  expect(adapter.editMessage).not.toHaveBeenCalled()

  // 累积超过阈值
  channel.sendStreamDelta('! This is a longer message that exceeds the threshold')
  await vi.advanceTimersByTimeAsync(400)

  // 现在应该 edit
  expect(adapter.editMessage).toHaveBeenCalled()

  vi.useRealTimers()
})

it('should use 300ms stream update interval', async () => {
  vi.useFakeTimers()
  const adapter = createMockAdapter()
  adapter.sendText = vi.fn().mockResolvedValue('msg_1')
  adapter.editMessage = vi.fn().mockResolvedValue(undefined)

  const channel = new AdapterChannel(adapter, 'chat_123')

  channel.sendStreamDelta('Hello World this is a test message')
  await vi.advanceTimersByTimeAsync(10)
  await vi.advanceTimersByTimeAsync(10)

  // 200ms — 还没到 300ms
  channel.sendStreamDelta(' more text here to exceed threshold')
  await vi.advanceTimersByTimeAsync(200)
  expect(adapter.editMessage).not.toHaveBeenCalled()

  // 300ms 到了
  await vi.advanceTimersByTimeAsync(100)
  expect(adapter.editMessage).toHaveBeenCalled()

  vi.useRealTimers()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/main/gateway/adapter-channel.test.ts`
Expected: FAIL — 当前 1500ms 间隔，无阈值逻辑

- [ ] **Step 3: 实现字符阈值 + 300ms 间隔**

修改 `AdapterChannel`：

```ts
// 属性
private _charsSinceFlush = 0
private readonly BUFFER_THRESHOLD = 30
private readonly streamUpdateInterval = 300  // 从 1500 改为 300
```

修改 `sendStreamDelta` 中的 timer 逻辑：

```ts
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
```

修改 `flushStream`：

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/main/gateway/adapter-channel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/gateway/adapter-channel.ts src/main/gateway/adapter-channel.test.ts
git commit -m "feat: optimize streaming with 300ms interval and 30-char buffer threshold"
```

---

### Task 3: TelegramAdapter Flood Control 保护

**Files:**
- Modify: `src/main/gateway/adapters/telegram.ts`
- Create: `src/main/gateway/adapters/telegram.test.ts`

- [ ] **Step 1: 写测试 — flood control 回退**

```ts
// src/main/gateway/adapters/telegram.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TelegramAdapter } from './telegram'

describe('TelegramAdapter flood control', () => {
  it('should fallback to plain text after repeated Markdown failures', async () => {
    const adapter = new TelegramAdapter({
      enabled: true,
      token: 'test_token',
    })

    // mock client
    const mockClient = {
      editMessageText: vi.fn()
        .mockRejectedValueOnce(new Error('flood control'))
        .mockRejectedValueOnce(new Error('flood control'))
        .mockRejectedValueOnce(new Error('flood control'))
        .mockResolvedValue({}),
    }
    ;(adapter as any).client = mockClient
    ;(adapter as any).connected = true

    await adapter.editMessage('chat_1', 'msg_1', 'test')

    // 前 3 次 Markdown 失败后，应尝试纯文本
    expect(mockClient.editMessageText).toHaveBeenCalledTimes(4)
    // 最后一次不带 parse_mode
    expect(mockClient.editMessageText).toHaveBeenLastCalledWith(
      'chat_1', 1, 'test', {}
    )
  })

  it('should not throw on edit failure', async () => {
    const adapter = new TelegramAdapter({
      enabled: true,
      token: 'test_token',
    })

    const mockClient = {
      editMessageText: vi.fn().mockRejectedValue(new Error('message not modified')),
    }
    ;(adapter as any).client = mockClient
    ;(adapter as any).connected = true

    // 不应抛出
    await expect(adapter.editMessage('chat_1', 'msg_1', 'test')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/main/gateway/adapters/telegram.test.ts`
Expected: FAIL — 当前 editMessage 没有 flood control 逻辑

- [ ] **Step 3: 实现 flood control**

修改 `TelegramAdapter`：

```ts
// 新增属性
private _editFailures = 0
private readonly MAX_EDIT_FAILURES = 3

async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
  if (!this.client) throw new Error('Not connected')

  try {
    await this.client.editMessageText(chatId, parseInt(messageId), text, { parse_mode: 'Markdown' })
    this._editFailures = 0  // 成功则重置
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)

    // "message is not modified" — 无害，忽略
    if (errMsg.includes('message is not modified')) return

    // Flood control 追踪
    if (errMsg.includes('flood') || errMsg.includes('retry after') || (err as any).statusCode === 429) {
      this._editFailures++
      if (this._editFailures >= this._MAX_EDIT_FAILURES) {
        console.warn(`[TelegramAdapter] Flood control: ${this._editFailures} consecutive failures, falling back to plain text`)
      }
    }

    // 回退到纯文本（不带 parse_mode）
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/main/gateway/adapters/telegram.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/gateway/adapters/telegram.ts src/main/gateway/adapters/telegram.test.ts
git commit -m "feat: add flood control protection to TelegramAdapter editMessage"
```

---

### Task 4: 更新配置默认值 + 清理 StreamBufferManager

**Files:**
- Modify: `src/main/gateway/adapters/telegram.ts` (config defaults)
- Modify: `src/main/gateway/stream-buffer.ts` (optional: sync interval)

- [ ] **Step 1: 修改 TelegramAdapterConfig 默认值**

```ts
// telegram.ts constructor
this.config = {
  streamUpdateInterval: 300,  // 从 1500 改为 300
  maxMessageLength: 4000,
  ...config,
}
```

- [ ] **Step 2: 同步 StreamBufferManager 默认间隔**

```ts
// stream-buffer.ts constructor
this.config = {
  updateInterval: 300,  // 从 1500 改为 300
  maxBufferSize: 100_000,
  maxAge: 5 * 60 * 1000,
  ...config,
}
```

- [ ] **Step 3: 运行全量测试**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/gateway/adapters/telegram.ts src/main/gateway/stream-buffer.ts
git commit -m "chore: update default stream interval to 300ms"
```

---

### Task 5: 集成验证 — build 通过

**Files:**
- None (verification only)

- [ ] **Step 1: TypeScript 编译检查**

Run: `npx electron-vite build`
Expected: 成功，无 TS 错误

- [ ] **Step 2: 全量测试**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit（如果有类型修复）**

```bash
# 如果有类型修复
git add -A
git commit -m "fix: type errors in streaming optimization"
```
