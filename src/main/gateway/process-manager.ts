/**
 * Gateway 进程管理器
 *
 * 职责：
 * - spawn Gateway 子进程
 * - 心跳检测
 * - 崩溃自动重启（指数退避）
 * - 优雅关闭
 */

import { fork, ChildProcess } from 'child_process'
import { join } from 'path'
import { EventEmitter } from 'events'

export interface ProcessManagerConfig {
  /** Gateway 脚本路径 */
  scriptPath: string
  /** 最大重试次数 */
  maxRetries?: number
  /** 重试窗口（ms） */
  retryWindow?: number
  /** 退避时间列表（ms） */
  backoff?: number[]
  /** 稳定运行后重置计数器（ms） */
  resetAfter?: number
  /** 心跳间隔（ms） */
  heartbeatInterval?: number
  /** 心跳超时（ms） */
  heartbeatTimeout?: number
}

const DEFAULT_CONFIG: Partial<ProcessManagerConfig> = {
  maxRetries: 5,
  retryWindow: 60_000,
  backoff: [1000, 2000, 5000, 10000, 30000],
  resetAfter: 60_000,
  heartbeatInterval: 10_000,
  heartbeatTimeout: 30_000,
}

export class GatewayProcessManager extends EventEmitter {
  private process: ChildProcess | null = null
  private config: ProcessManagerConfig
  private retryCount = 0
  private retryTimestamps: number[] = []
  private lastHeartbeat = 0
  private heartbeatTimer: NodeJS.Timeout | null = null
  private stableTimer: NodeJS.Timeout | null = null
  private stopping = false

  constructor(config: ProcessManagerConfig) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 启动 Gateway 子进程
   */
  async start(): Promise<void> {
    if (this.process) {
      console.warn('[ProcessManager] Already running')
      return
    }

    this.stopping = false
    this.spawn()
  }

  /**
   * 停止 Gateway 子进程
   */
  async stop(): Promise<void> {
    this.stopping = true

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }

    if (!this.process) {
      return
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // 超时强制杀死
        this.process?.kill('SIGKILL')
        resolve()
      }, 5000)

      this.process!.once('exit', () => {
        clearTimeout(timeout)
        this.process = null
        resolve()
      })

      // 发送优雅关闭信号
      this.process!.send({ type: 'shutdown' })
    })
  }

  /**
   * 是否正在运行
   */
  get isRunning(): boolean {
    return this.process !== null && !this.stopping
  }

  /**
   * 发送消息到 Gateway 子进程
   */
  send(message: any): boolean {
    if (!this.process) {
      return false
    }
    return this.process.send(message)
  }

  private spawn() {
    console.log('[ProcessManager] Spawning Gateway process...')

    const child = fork(this.config.scriptPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        NERVE_GATEWAY_MODE: 'child',
      },
    })

    this.process = child
    this.lastHeartbeat = Date.now()

    // 监听 IPC 消息
    child.on('message', (msg: any) => {
      if (msg.type === 'heartbeat') {
        this.lastHeartbeat = Date.now()
      } else if (msg.type === 'ready') {
        console.log('[ProcessManager] Gateway ready')
        this.retryCount = 0
        this.startHeartbeat()
        this.startStableTimer()
        this.emit('ready')
      } else if (msg.type === 'log') {
        console.log(`[Gateway] ${msg.message}`)
      }
    })

    // 监听 stdout/stderr
    child.stdout?.on('data', (data) => {
      console.log(`[Gateway:stdout] ${data.toString().trim()}`)
    })

    child.stderr?.on('data', (data) => {
      console.error(`[Gateway:stderr] ${data.toString().trim()}`)
    })

    // 监听退出
    child.on('exit', (code, signal) => {
      console.log(`[ProcessManager] Gateway exited (code: ${code}, signal: ${signal})`)
      this.process = null

      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
      }

      if (this.stableTimer) {
        clearTimeout(this.stableTimer)
        this.stableTimer = null
      }

      this.emit('exit', code, signal)

      // 如果不是主动停止，尝试重启
      if (!this.stopping) {
        this.scheduleRestart()
      }
    })

    // 监听错误
    child.on('error', (err) => {
      console.error('[ProcessManager] Gateway process error:', err)
      this.emit('error', err)
    })
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.lastHeartbeat

      if (elapsed > this.config.heartbeatTimeout!) {
        console.error(`[ProcessManager] Heartbeat timeout (${elapsed}ms)`)
        this.emit('heartbeat-timeout')

        // 杀死进程，触发重启
        this.process?.kill('SIGKILL')
      }
    }, this.config.heartbeatInterval!)
  }

  private startStableTimer() {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
    }

    this.stableTimer = setTimeout(() => {
      // 稳定运行，重置重试计数
      this.retryCount = 0
      this.retryTimestamps = []
      console.log('[ProcessManager] Gateway stable, reset retry counter')
    }, this.config.resetAfter!)
  }

  private scheduleRestart() {
    const now = Date.now()

    // 清理过期的重试时间戳
    this.retryTimestamps = this.retryTimestamps.filter(
      (t) => now - t < this.config.retryWindow!
    )

    // 检查是否超过最大重试次数
    if (this.retryTimestamps.length >= this.config.maxRetries!) {
      console.error(`[ProcessManager] Max retries (${this.config.maxRetries}) exceeded in ${this.config.retryWindow}ms window`)
      this.emit('max-retries-exceeded')
      return
    }

    // 计算退避时间
    const backoffIndex = Math.min(this.retryCount, this.config.backoff!.length - 1)
    const delay = this.config.backoff![backoffIndex]

    console.log(`[ProcessManager] Restarting in ${delay}ms (attempt ${this.retryCount + 1}/${this.config.maxRetries})`)

    this.retryCount++
    this.retryTimestamps.push(now)

    setTimeout(() => {
      if (!this.stopping) {
        this.spawn()
      }
    }, delay)
  }
}
