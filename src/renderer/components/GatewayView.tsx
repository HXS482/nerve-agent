/**
 * GatewayView — Gateway 管理面板
 *
 * 位于 RightSidebar，提供 Gateway 状态监控和管理功能
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'

interface GatewayHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  uptime: number
  activeSessions: number
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number }
  clientCount: number
  adapters: Record<string, boolean>
}

interface AdapterInfo {
  name: string
  platform: string
  enabled: boolean
  connected: boolean
  config: Record<string, unknown>
}

interface LogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: number
}

function StatusDot({ status }: { status: 'healthy' | 'degraded' | 'unhealthy' | undefined }) {
  const color = status === 'healthy' ? '#22c55e'
    : status === 'degraded' ? '#f59e0b'
    : status === 'unhealthy' ? '#ef4444'
    : '#6b7280'

  return (
    <div
      className="w-2 h-2 rounded-full"
      style={{ background: color }}
    />
  )
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-surface-container)' }}>
      <div style={{ color: 'var(--text-outline-variant)' }}>{icon}</div>
      <div className="flex-1">
        <div className="text-[10px]" style={{ color: 'var(--text-outline-variant)' }}>{label}</div>
        <div className="text-[12px] font-medium" style={{ color: 'var(--text-on-surface)' }}>{value}</div>
      </div>
    </div>
  )
}

function formatUptime(ms: number): string {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`
  return `${Math.floor(ms / 86400000)}d`
}

function formatMemory(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.floor(bytes / 1024)}KB`
  return `${Math.floor(bytes / (1024 * 1024))}MB`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function StatusCard({ health }: { health: GatewayHealth | null }) {
  if (!health) {
    return (
      <div className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>
        加载中...
      </div>
    )
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 mb-3">
        <StatusDot status={health.status} />
        <span className="text-[12px] font-medium" style={{ color: 'var(--text-on-surface)' }}>
          Gateway
        </span>
        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-outline-variant)' }}>
          {formatUptime(health.uptime)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MetricCard
          icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>}
          label="连接"
          value={health.clientCount}
        />
        <MetricCard
          icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}
          label="会话"
          value={health.activeSessions}
        />
        <MetricCard
          icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /></svg>}
          label="内存"
          value={formatMemory(health.memoryUsage.heapUsed)}
        />
      </div>
    </div>
  )
}

function AdaptersCard({ adapters }: { adapters: AdapterInfo[] }) {
  const adapterIcons: Record<string, React.ReactNode> = {
    telegram: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#229ED9" strokeWidth="2">
        <path d="M21 3L9 13l-5-1 18-9z" /><path d="M9 13l-1 8 4-5" />
      </svg>
    ),
    discord: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5865F2" strokeWidth="2">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
    websocket: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    ),
  }

  return (
    <div className="px-3 py-2">
      <div className="text-[10px] mb-2" style={{ color: 'var(--text-outline-variant)' }}>适配器</div>
      <div className="flex flex-col gap-1">
        {adapters.map(adapter => (
          <div
            key={adapter.name}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
            style={{ background: 'var(--bg-surface-container)' }}
          >
            <div className="flex-shrink-0">
              {adapterIcons[adapter.name] || (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                </svg>
              )}
            </div>
            <span className="text-[11px] flex-1" style={{ color: 'var(--text-on-surface)' }}>
              {adapter.name}
            </span>
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: adapter.connected ? '#22c55e' : '#6b7280' }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function LogsCard({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs.length])

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter(log => log.level === filter)

  return (
    <div className="px-3 py-2 flex flex-col" style={{ maxHeight: 200 }}>
      <div className="flex items-center gap-1 mb-2">
        <span className="text-[10px] flex-1" style={{ color: 'var(--text-outline-variant)' }}>日志</span>
        {(['all', 'info', 'warn', 'error'] as const).map(level => (
          <button
            key={level}
            onClick={() => setFilter(level)}
            className="text-[9px] px-1.5 py-0.5 rounded transition-colors"
            style={{
              background: filter === level ? 'var(--accent-primary)' : 'transparent',
              color: filter === level ? 'white' : 'var(--text-outline-variant)',
            }}
          >
            {level === 'all' ? 'All' : level === 'info' ? 'Info' : level === 'warn' ? 'Warn' : 'Error'}
          </button>
        ))}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-hide rounded-lg"
        style={{
          background: 'var(--bg-surface-container)',
          padding: '4px 8px',
          fontFamily: 'monospace',
          fontSize: '10px',
          lineHeight: '1.5',
          maxHeight: 150,
        }}
      >
        {filteredLogs.length === 0 ? (
          <div className="text-center py-2" style={{ color: 'var(--text-outline-variant)' }}>
            暂无日志
          </div>
        ) : (
          filteredLogs.map((log, i) => (
            <div key={i} className="flex gap-1">
              <span style={{ color: 'var(--text-outline-variant)', opacity: 0.5 }}>
                {formatTime(log.timestamp)}
              </span>
              <span style={{
                color: log.level === 'error' ? '#ef4444'
                  : log.level === 'warn' ? '#f59e0b'
                  : 'var(--text-on-surface)',
              }}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function GatewayView() {
  const [health, setHealth] = useState<GatewayHealth | null>(null)
  const [adapters, setAdapters] = useState<AdapterInfo[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const [healthData, adaptersData] = await Promise.all([
        (window as any).claude.gatewayStatus(),
        (window as any).claude.gatewayAdapters(),
      ])
      setHealth(healthData)
      setAdapters(adaptersData || [])
    } catch (err) {
      console.error('[GatewayView] Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()

    // 定时刷新 (每 5 秒)
    const timer = setInterval(loadData, 5000)

    // 订阅日志事件
    const unsubscribe = (window as any).claude.onGatewayLog((entry: LogEntry) => {
      setLogs(prev => [...prev.slice(-100), entry])
    })

    return () => {
      clearInterval(timer)
      unsubscribe?.()
    }
  }, [loadData])

  const handleStart = async () => {
    const result = await (window as any).claude.gatewayStart()
    if (result.success) {
      loadData()
    }
  }

  const handleStop = async () => {
    const result = await (window as any).claude.gatewayStop()
    if (result.success) {
      loadData()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>
          加载中...
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 状态卡片 */}
      <StatusCard health={health} />

      {/* 控制按钮 */}
      <div className="px-3 py-2 flex gap-2">
        <button
          onClick={handleStart}
          disabled={health?.status === 'healthy'}
          className="flex-1 text-[11px] py-1.5 rounded-lg transition-colors"
          style={{
            background: health?.status === 'healthy' ? 'var(--bg-surface-container)' : '#22c55e',
            color: health?.status === 'healthy' ? 'var(--text-outline-variant)' : 'white',
            opacity: health?.status === 'healthy' ? 0.5 : 1,
          }}
        >
          启动
        </button>
        <button
          onClick={handleStop}
          disabled={health?.status !== 'healthy'}
          className="flex-1 text-[11px] py-1.5 rounded-lg transition-colors"
          style={{
            background: health?.status !== 'healthy' ? 'var(--bg-surface-container)' : '#ef4444',
            color: health?.status !== 'healthy' ? 'var(--text-outline-variant)' : 'white',
            opacity: health?.status !== 'healthy' ? 0.5 : 1,
          }}
        >
          停止
        </button>
      </div>

      {/* 适配器列表 */}
      <AdaptersCard adapters={adapters} />

      {/* 日志 */}
      <LogsCard logs={logs} />
    </div>
  )
}
