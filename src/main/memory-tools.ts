/**
 * 把 TDAI 的两个检索工具接进 agent 的工具列表。
 *
 * 背景：vendor 里 core/tools/memory-search.ts 与 conversation-search.ts 已经实现了
 * 这两个工具，auto-recall.ts 也已经把「你可以调它们」写进系统提示词 —— 但整个 src 里
 * 没有任何地方 import 过它们，所以工具从未注册。
 *
 * 后果不是「少了个功能」，而是系统提示词在**宣传两个不存在的工具**：模型被明确告知
 * 可以调 tdai_memory_search / tdai_conversation_search（每轮限 3 次），照做却撞空。
 * 这里补上缺的那一环。
 *
 * ## scope 为什么在这里
 *
 * 工具是模型主动调的，它不知道自己是谁 —— 只能由构建工具的人钉死当前 Bot 的可见范围。
 * 不钉的后果很具体：redbook 问一句「老板叫什么」，能搜到 nerve 那次对话里记的东西，
 * 于是它对老板的认知来自另一个 Bot 的转述。
 */

import type { MemoryTdaiCore } from './memory-tdai'

interface MemoryToolEntry {
  description: string
  input_schema: Record<string, unknown>
  execute: (args: any) => Promise<any>
}

/** 只取真正要调的两个方法，避免与 vendor 内部类型耦合 */
type MemorySearcher = Pick<MemoryTdaiCore, 'searchMemories' | 'searchConversations'>

const QUERY_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '检索关键词或自然语言问题' },
    limit: { type: 'number', description: '返回条数上限，默认 5' },
  },
  required: ['query'],
}

/**
 * @param scope 当前 Bot 的可见范围（自己的 + shared），见 vendor/utils/scope.ts。
 *              不传 = 全库 —— 只在升级前的老调用点才会漏。
 * @param sessionKey 当前会话的 scope key；会话搜索用它做精确定位（可选）。
 */
export function createMemoryTools(
  memory: MemorySearcher,
  scope?: string[],
  sessionKey?: string,
): Record<string, MemoryToolEntry> {
  return {
    tdai_memory_search: {
      description:
        '搜索结构化长期记忆（L1）。适用于回忆用户偏好、历史事件节点、既定规则等关键信息。当已注入的记忆片段不足以回答时使用。',
      input_schema: QUERY_SCHEMA,
      execute: async (args: { query: string; limit?: number }) => {
        // 注意：shim 上是位置参数，不是对象
        const result = await memory.searchMemories(args.query, args.limit, scope)
        return result.text
      },
    },

    tdai_conversation_search: {
      description:
        '搜索原始对话记录（L0）。适用于查找具体消息原文、时间线、上下文细节；也可用于补充或校验 tdai_memory_search 的结果。',
      input_schema: QUERY_SCHEMA,
      execute: async (args: { query: string; limit?: number }) => {
        const result = await memory.searchConversations(args.query, args.limit, sessionKey, scope)
        return result.text
      },
    },
  }
}
