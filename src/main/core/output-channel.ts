/**
 * OutputChannel — 核心输出通道接口
 *
 * 解耦 Agent 核心与具体输出目标（Electron IPC / WebSocket / IM 适配器）
 * 所有 Agent 输出都通过此接口，不直接依赖 BrowserWindow
 */
export interface OutputChannel {
  /** 发送流式文本增量 */
  sendStreamDelta(text: string): void

  /** 发送思考过程增量 */
  sendThinkingDelta(thinking: string): void

  /** 发送工具调用开始 */
  sendToolCall(id: string, name: string, input: unknown): void

  /** 发送工具调用结果 */
  sendToolResult(id: string, content: string, isError?: boolean): void

  /** 发送流式完成 */
  sendDone(sessionId: string, cost: number, maxContextTokens: number): void

  /** 发送错误 */
  sendError(message: string): void

  /** 检查通道是否可用 */
  isReady(): boolean
}

/**
 * ElectronOutputChannel — Electron 特有的输出通道接口
 *
 * 扩展核心 OutputChannel，添加 Electron/UI 特有的方法
 */
export interface ElectronOutputChannel extends OutputChannel {
  /** 发送宠物状态变化 */
  sendPetState(state: string): void

  /** 发送 Flow 项目 */
  sendFlowItem(type: string, content: string, meta?: Record<string, unknown>): void

  /** 发送 Git 刷新事件 */
  sendGitRefresh(): void

  /** 发送工具审批请求 */
  sendToolApprovalRequest(approvalId: string, toolName: string, toolInput: unknown): void
}

/**
 * 检查通道是否支持 Electron 特有功能
 */
export function isElectronChannel(channel: OutputChannel): channel is ElectronOutputChannel {
  return 'sendPetState' in channel && typeof channel.sendPetState === 'function'
}

/**
 * 空输出通道 — 用于测试或无输出场景
 */
export class NullOutputChannel implements OutputChannel {
  sendStreamDelta(): void {}
  sendThinkingDelta(): void {}
  sendToolCall(): void {}
  sendToolResult(): void {}
  sendDone(): void {}
  sendError(): void {}
  isReady(): boolean { return true }
}

/**
 * 收集输出通道 — 收集所有输出到内存，用于测试或 CLI
 */
export class CollectingOutputChannel implements OutputChannel {
  public deltas: string[] = []
  public thinkingDeltas: string[] = []
  public toolCalls: Array<{ id: string; name: string; input: unknown }> = []
  public toolResults: Array<{ id: string; content: string; isError?: boolean }> = []
  public done: { sessionId: string; cost: number; maxContextTokens: number } | null = null
  public error: string | null = null

  sendStreamDelta(text: string): void { this.deltas.push(text) }
  sendThinkingDelta(thinking: string): void { this.thinkingDeltas.push(thinking) }
  sendToolCall(id: string, name: string, input: unknown): void { this.toolCalls.push({ id, name, input }) }
  sendToolResult(id: string, content: string, isError?: boolean): void { this.toolResults.push({ id, content, isError }) }
  sendDone(sessionId: string, cost: number, maxContextTokens: number): void { this.done = { sessionId, cost, maxContextTokens } }
  sendError(message: string): void { this.error = message }
  isReady(): boolean { return true }

  get fullText(): string { return this.deltas.join('') }
  get fullThinking(): string { return this.thinkingDeltas.join('') }
}
