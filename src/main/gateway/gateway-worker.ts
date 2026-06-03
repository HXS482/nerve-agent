/**
 * Gateway 子进程入口
 *
 * 当被 Electron spawn 时运行此脚本
 * 通过 IPC 与父进程通信
 */

import { NerveGateway } from './gateway'
import { homedir } from 'os'
import { join } from 'path'

// 从环境变量读取配置
const port = parseInt(process.env.NERVE_GATEWAY_PORT || '18789', 10)
const authMode = process.env.NERVE_GATEWAY_AUTH || 'token'
const authToken = process.env.NERVE_GATEWAY_TOKEN || 'nerve-default-token'
const dataDir = process.env.NERVE_GATEWAY_DATA || join(homedir(), '.nerve')
const projectDir = process.env.NERVE_GATEWAY_PROJECT || process.cwd()
const sourceDir = process.env.NERVE_GATEWAY_SOURCE || projectDir

let gateway: NerveGateway | null = null

// 发送消息到父进程
function sendToParent(msg: any) {
  if (process.send) {
    process.send(msg)
  }
}

// 定期发送心跳
let heartbeatTimer: NodeJS.Timeout | null = null
function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    sendToParent({ type: 'heartbeat' })
  }, 5000)
}

// 处理来自父进程的消息
process.on('message', async (msg: any) => {
  if (msg.type === 'shutdown') {
    console.log('[GatewayWorker] Received shutdown signal')
    await shutdown()
    process.exit(0)
  }
})

// 优雅关闭
async function shutdown() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  if (gateway) {
    await gateway.stop()
    gateway = null
  }
}

// 处理进程信号
process.on('SIGTERM', async () => {
  console.log('[GatewayWorker] Received SIGTERM')
  await shutdown()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('[GatewayWorker] Received SIGINT')
  await shutdown()
  process.exit(0)
})

// 未捕获异常处理
process.on('uncaughtException', (err) => {
  console.error('[GatewayWorker] Uncaught exception:', err)
  sendToParent({ type: 'log', message: `Uncaught exception: ${err.message}` })
})

process.on('unhandledRejection', (reason) => {
  console.error('[GatewayWorker] Unhandled rejection:', reason)
  sendToParent({ type: 'log', message: `Unhandled rejection: ${reason}` })
})

// 启动 Gateway
async function main() {
  console.log('[GatewayWorker] Starting...')
  console.log(`[GatewayWorker] Port: ${port}`)
  console.log(`[GatewayWorker] Auth: ${authMode}`)
  console.log(`[GatewayWorker] Data: ${dataDir}`)
  console.log(`[GatewayWorker] Project: ${projectDir}`)

  try {
    gateway = new NerveGateway({
      port,
      auth: authMode === 'token' ? { mode: 'token', secret: authToken } : { mode: 'none' },
      dataDir,
      projectDir,
      sourceDir,
    })

    await gateway.start()
    startHeartbeat()

    // 通知父进程就绪
    sendToParent({ type: 'ready' })

    console.log('[GatewayWorker] Ready')
  } catch (err) {
    console.error('[GatewayWorker] Failed to start:', err)
    sendToParent({ type: 'log', message: `Failed to start: ${err}` })
    process.exit(1)
  }
}

main()
