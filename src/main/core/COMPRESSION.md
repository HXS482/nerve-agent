# 两层压缩系统

## 职责边界

| 层 | 模块 | 阈值 | 触发时机 | 压缩对象 | 方式 |
|---|---|---|---|---|---|
| 热压缩 | `offload-bridge.ts` | 60% context window | 每次 agentic loop step 前 | 旧 tool_result 消息 | 替换为 LLM 摘要 |
| 冷压缩 | `compactor.ts` | 75% context window | 调用方按需检查 | 整段旧消息 | 折叠为 summary entry |

## 为什么分两层

- **热压缩（60%）**：轻量、高频。只压缩大块 tool output（Read/Grep 返回的文件内容等），保留消息结构不变。适合在 agentic loop 每步前快速瘦身。
- **冷压缩（75%）**：重量、低频。将整段历史折叠为一条 summary 消息，彻底丢弃原始消息结构。仅在热压缩不够时触发。

## 避免冲突

1. **阈值不重叠**：热压缩 60% < 冷压缩 75%，热压缩总是先触发。
2. **标记已压缩**：OffloadBridge 用 `compressedIds` 集合记录已压缩的 tool_call_id，不会重复压缩同一条消息。
3. **冷压缩不碰热压缩产物**：compactor 按消息位置切分（前 N 条压缩，后 M 条保留），不关心单条消息内容是否已被 offload 摘要过。

## Token 估算

两层共用 `token-estimator.ts` 提供的统一估算：

```
estimateTokens(text)     → 纯文本估算（中文/1.7 + 其他/4）
estimateObjectTokens(obj) → 结构化对象估算（JSON.stringify 后走 estimateTokens）
```

比纯 `length/4` 更准确，尤其在中文为主的对话场景。
