/**
 * 主进程 IPC：config setter 的 sessionId 透传
 *
 * 这里是四条链路的第 3 环：preload 把 sessionId 当第二个参数 invoke 过来，
 * ipc.ts 的 handler 必须原样交给 claude.setXxx —— 漏了这一步，渲染层永远改不到
 * 会话级配置（选择器写着新模型、实际跑的仍是旧的）。
 *
 * ipc.ts 顶部只 import 了 electron 的 ipcMain / dialog / BrowserWindow / shell，
 * 其余依赖都是 handler 里惰性用的，所以 mock 掉 electron 就能把真 handler 抓出来直接调。
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const handlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => {
      handlers.set(channel, fn)
    },
  },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  BrowserWindow: class {},
  shell: {},
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd(), isPackaged: false },
}))

import { IPC_CHANNELS } from '../../shared/types'
import { setupIPC } from '../ipc'

const claude = {
  setModel: vi.fn(async () => {}),
  setProvider: vi.fn(async () => {}),
  setEffort: vi.fn(async () => {}),
  setPermissionMode: vi.fn(async () => {}),
  setCwd: vi.fn(async () => {}),
  cancel: vi.fn(),
  sendMessage: vi.fn(async () => {}),
}

const fakeWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }

const call = (channel: string, ...args: any[]) => handlers.get(channel)!({}, ...args)

beforeAll(() => {
  setupIPC(
    fakeWindow as any,
    claude as any,
    {} as any,
    {} as any,
  )
})

beforeEach(() => {
  for (const fn of Object.values(claude)) fn.mockClear()
})

describe('IPC config setters — sessionId', () => {
  it('SET_MODEL 把 sessionId 透传给 claude.setModel', async () => {
    await call(IPC_CHANNELS.SET_MODEL, 'opus', 'sess-1')
    expect(claude.setModel).toHaveBeenCalledWith('opus', 'sess-1')
  })

  it('SET_PROVIDER 把 sessionId 透传给 claude.setProvider', async () => {
    await call(IPC_CHANNELS.SET_PROVIDER, 'p1', 'sess-2')
    expect(claude.setProvider).toHaveBeenCalledWith('p1', 'sess-2')
  })

  it('SET_EFFORT 把 sessionId 透传给 claude.setEffort', async () => {
    await call(IPC_CHANNELS.SET_EFFORT, 'high', 'sess-3')
    expect(claude.setEffort).toHaveBeenCalledWith('high', 'sess-3')
  })

  it('SET_PERMISSION_MODE 把 sessionId 透传给 claude.setPermissionMode', async () => {
    await call(IPC_CHANNELS.SET_PERMISSION_MODE, 'ask', 'sess-4')
    expect(claude.setPermissionMode).toHaveBeenCalledWith('ask', 'sess-4')
  })

  it('不传 sessionId 时仍是 undefined（旧的全局写入行为）', async () => {
    await call(IPC_CHANNELS.SET_MODEL, 'sonnet')
    expect(claude.setModel).toHaveBeenCalledWith('sonnet', undefined)
  })
})
