/**
 * OutputChannel — 输出通道抽象接口
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

  /** 发送宠物状态变化（可选，Electron 特有） */
  sendPetState?(state: string): void

  /** 发送 Flow 项目（可选，Electron 特有） */
  sendFlowItem?(type: string, content: string, meta?: Record<string, unknown>): void

  /** 发送 Git 刷新事件（可选，Electron 特有） */
  sendGitRefresh?(): void

  /** 发送工具审批请求（可选，需要交互式审批时） */
  sendToolApprovalRequest?(approvalId: string, toolName: string, toolInput: unknown): void

  /** 检查通道是否可用 */
  isReady(): boolean
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
