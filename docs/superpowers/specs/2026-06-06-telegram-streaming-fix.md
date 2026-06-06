# Telegram Gateway 流式回复优化 + 重复消息修复

**日期**: 2026-06-06
**状态**: 已确认

## 问题

1. **重复消息**: 同一条用户消息收到两条 bot 回复（如 "您好" + "您好，想干啥"）
2. **流式体验差**: editInterval=1500ms 太慢，用户看到"等一会儿突然蹦出一大段"

## 根因分析

### 重复消息 — `AdapterChannel.sendDone()` 竞态

```
sendStreamDelta("您好") → sendText("您好") 异步，sending=true
sendDone("您好，想干啥") → streamMessageId=null → 发新消息
sendText 返回 → 创建第二条消息 "您好"
```

`sendDone()` 没等待进行中的 `sendText` 完成，直接走了 `send()` 新消息分支。

### 流式体验差

- `streamUpdateInterval = 1500ms`，edit 频率太低
- 无字符缓冲阈值，小增量也会触发 edit
- 无 flood control 保护

## 方案

### 改动一：`adapter-channel.ts` — 竞态修复 + 流式优化

**新增状态：**
```ts
private _pendingSend: Promise<string | undefined> | null = null
private _lastFlushedContent = ''
private _charsSinceFlush = 0
private readonly BUFFER_THRESHOLD = 30
```

**sendStreamDelta：**
- sendText 时捕获 buffer 快照（`const snapshot = this.streamBuffer`）
- 追踪 `_pendingSend` Promise
- `_charsSinceFlush` 计数，累积 ≥ BUFFER_THRESHOLD 才允许 timer flush
- `streamUpdateInterval` 改为 300ms

**sendDone：**
- `await _pendingSend`（如果存在）
- 比较 `streamBuffer === _lastFlushedContent`，相同则跳过编辑
- 清理所有状态

**flushStream：**
- 记录 `_lastFlushedContent`

### 改动二：`telegram.ts` — Flood Control

`editMessage` 中：
- 捕获 flood control 错误（`429` / `RetryAfter`）
- 连续失败次数追踪，超过阈值后回退到纯文本编辑

### 改动三：配置默认值

- `streamUpdateInterval` 默认值：1500ms → 300ms

## 不做的事

- 不重写为生产者-消费者模式（当前架构够用，只修竞态）
- 不改 TelegramClient（update 去重已有）
- 不改 SessionRouter（串行队列没问题）

## 验证

- 发送消息，确认只收到一条回复
- 观察回复是否逐步编辑出现（300ms 间隔）
- 长回复测试（>4096 字符分割）
- flood control 测试（快速连续发消息触发限流）
