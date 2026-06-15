/**
 * IPCChannel — Electron IPC 输出通道实现
 *
 * 将 AgentCore 的输出转发到 Electron 渲染进程
 */

import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { OutputChannel } from './output-channel'

export class IPCChannel implements OutputChannel {
  constructor(
    private mainWindow: BrowserWindow,
    private petWindow: BrowserWindow | null = null,
  ) {}

  private send(channel: string, data: unknown) {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }

  isReady(): boolean {
    return !this.mainWindow.isDestroyed()
  }

  sendStreamDelta(text: string): void {
    this.send(IPC_CHANNELS.MESSAGE, {
      type: 'stream_event',
      event: { delta: { text } },
    })
  }

  sendThinkingDelta(thinking: string): void {
    this.send(IPC_CHANNELS.MESSAGE, {
      type: 'stream_event',
      event: { delta: { thinking } },
    })
  }

  sendToolCall(id: string, name: string, input: unknown): void {
    this.send(IPC_CHANNELS.MESSAGE, {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id, name, input }] },
    })
  }

  sendToolResult(id: string, content: string, isError?: boolean): void {
    this.send(IPC_CHANNELS.MESSAGE, {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_result', toolCallId: id, content, is_error: isError }],
      },
    })
  }

  sendDone(sessionId: string, cost: number, maxContextTokens: number): void {
    this.send(IPC_CHANNELS.DONE, { sessionId, cost, maxContextTokens })
  }

  sendError(message: string): void {
    this.send(IPC_CHANNELS.ERROR, { message })
  }

  sendImage(pathOrBuffer: string | Buffer, caption?: string): void {
    if (typeof pathOrBuffer === 'string') {
      this.send(IPC_CHANNELS.FLOW_ITEM, { type: 'image', content: pathOrBuffer, meta: { caption, localPath: pathOrBuffer } })
    }
  }

  sendPetState(state: string): void {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.webContents.send(IPC_CHANNELS.PET_STATE_CHANGE, state)
    }
  }

  sendFlowItem(type: string, content: string, meta?: Record<string, unknown>): void {
    this.send(IPC_CHANNELS.FLOW_ITEM, { type, content, meta })
  }

  sendGitRefresh(): void {
    this.send(IPC_CHANNELS.GIT_REFRESH, {})
  }

  sendToolApprovalRequest(approvalId: string, toolName: string, toolInput: unknown): void {
    this.send(IPC_CHANNELS.TOOL_APPROVAL_REQUEST, {
      approvalId,
      toolName,
      toolInput,
    })
  }

  /** 更新主窗口引用（窗口重建时） */
  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  /** 更新宠物窗口引用 */
  setPetWindow(window: BrowserWindow) {
    this.petWindow = window
  }
}
