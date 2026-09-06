# 上下文压缩

## 现状：单层热压缩

| 层 | 模块 | 阈值 | 触发时机 | 压缩对象 | 方式 |
|---|---|---|---|---|---|
| 热压缩 | `offload-bridge.ts` | 60% context window | 每次 agentic loop step 前 | 旧 tool_result 消息 | 替换为 LLM 摘要 |

- 轻量、高频。只压缩大块 tool output（Read/Grep 返回的文件内容等），保留消息结构不变。适合在 agentic loop 每步前快速瘦身。
- OffloadBridge 用 `compressedIds` 集合记录已压缩的 tool_call_id，不会重复压缩同一条消息。
- 仅在配置了 `settings.extraction.{baseURL, authToken}` 时启用。

> 历史上曾有冷压缩层（`compactor.ts`，75% 阈值折叠整段历史），因长期无调用方（死代码）已删除。如需恢复见 git 历史。

## Token 估算

`token-estimator.ts` 提供统一估算：

```
estimateTokens(text)     → 纯文本估算（中文/1.7 + 其他/4）
estimateObjectTokens(obj) → 结构化对象估算（JSON.stringify 后走 estimateTokens）
```

比纯 `length/4` 更准确，尤其在中文为主的对话场景。
