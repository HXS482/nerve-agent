/**
 * WebSocketChannel — WebSocket 输出通道实现
 *
 * 将 AgentCore 的输出通过 WebSocket 发送给客户端
 */

import type { OutputChannel } from '../core/output-channel'
import type { GatewayWSServer } from './ws-server'
import type { StreamEvent, ToolEvent, LifecycleEvent, ErrorEvent } from './protocol'

export class WebSocketChannel implements OutputChannel {
  private seqCounter = 0

  constructor(
    private server: GatewayWSServer,
    private clientId: string,
    private sessionId: string,
    private runId?: string,
  ) {}

  private nextSeq(): number {
    return ++this.seqCounter
  }

  isReady(): boolean {
    return this.server.clientCount > 0
  }

  sendStreamDelta(text: string): void {
    const event: StreamEvent = {
      type: 'event',
      event: 'stream',
      sessionId: this.sessionId,
      runId: this.runId,
      payload: { delta: text },
      seq: this.nextSeq(),
    }
    this.server.sendEvent(this.clientId, event)
  }

  sendThinkingDelta(thinking: string): void {
    const event: StreamEvent = {
      type: 'event',
      event: 'stream',
      sessionId: this.sessionId,
      runId: this.runId,
      payload: { thinking },
      seq: this.nextSeq(),
    }
    this.server.sendEvent(this.clientId, event)
  }

  sendToolCall(id: string, name: string, input: unknown): void {
    const event: ToolEvent = {
      type: 'event',
      event: 'tool',
      sessionId: this.sessionId,
      runId: this.runId,
      payload: {
        action: 'call',
        id,
        name,
        input,
      },
      seq: this.nextSeq(),
    }
    this.server.sendEvent(this.clientId, event)
  }

  sendToolResult(id: string, content: string, isError?: boolean): void {
    const event: ToolEvent = {
      type: 'event',
      event: 'tool',
      sessionId: this.sessionId,
      runId: this.runId,
      payload: {
        action: 'result',
        id,
        content,
        isError,
      },
      seq: this.nextSeq(),
    }
    this.server.sendEvent(this.clientId, event)
  }

  sendDone(sessionId: string, cost: number, maxContextTokens: number): void {
    const event: LifecycleEvent = {
      type: 'event',
      event: 'lifecycle',
      sessionId: this.sessionId,
      runId: this.runId,
      payload: {
        state: 'completed',
        cost,
        maxContextTokens,
      },
      seq: this.nextSeq(),
    }
    this.server.sendEvent(this.clientId, event)
  }

  sendError(message: string): void {
    const event: ErrorEvent = {
      type: 'event',
      event: 'error',
      sessionId: this.sessionId,
      payload: {
        code: 'AGENT_ERROR',
        message,
      },
      seq: this.nextSeq(),
    }
    this.server.sendEvent(this.clientId, event)
  }

  sendImage(pathOrBuffer: string | Buffer, caption?: string): void {
    if (typeof pathOrBuffer === 'string') {
      const event: StreamEvent = {
        type: 'event',
        event: 'stream',
        sessionId: this.sessionId,
        runId: this.runId,
        payload: { delta: caption ? `[image: ${caption}]` : '[image]' },
        seq: this.nextSeq(),
      }
      this.server.sendEvent(this.clientId, event)
    }
  }

  /** 设置 runId（Agent 开始执行时） */
  setRunId(runId: string) {
    this.runId = runId
  }
}
