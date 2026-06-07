/**
 * Core 模块 — 无 UI 依赖的 Agent 核心
 *
 * 导出：
 * - AgentCore: 核心 Agent 类，通过 OutputChannel 接口输出
 * - OutputChannel: 输出通道接口
 * - IPCChannel: Electron IPC 输出通道实现
 * - CollectingOutputChannel: 收集输出通道（测试用）
 * - NullOutputChannel: 空输出通道（测试用）
 * - SessionContext: 会话上下文
 * - SessionContextManager: 会话上下文管理器
 */

export { AgentCore } from './agent-core'
export type { AgentCoreConfig } from './agent-core'
export type { OutputChannel } from './output-channel'
export { NullOutputChannel, CollectingOutputChannel } from './output-channel'
export { IPCChannel } from './ipc-channel'
export type { SessionContext } from './session-context'
export { SessionContextManager, createSessionContext } from './session-context'
export { estimateTokens, estimateObjectTokens } from './token-estimator'
