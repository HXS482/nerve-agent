/**
 * GatewayView — Gateway 管理面板
 *
 * 基于前端设计 AI 的设计，适配到 Nerve RightSidebar
 * 保持现有的 Top Dock 导航栏不变
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Layers, RefreshCw } from 'lucide-react'

// 类型定义
type GatewayStatus = 'running' | 'stopped' | 'degraded'

interface GatewayMetrics {
  connections: number
  sessions: number
  memory: number
}

interface IMAdapter {
  id: string
  name: string
  platform: 'wechat' | 'telegram' | 'slack' | 'discord' | 'feishu'
  status: 'connected' | 'disconnected' | 'reconnecting' | 'failed' | 'paused'
}

type LogLevel = 'all' | 'info' | 'warn' | 'error'

interface SidebarLog {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  category: string
  text: string
}

// 适配器图标颜色映射
const ADAPTER_COLORS: Record<string, { bg: string; text: string }> = {
  wechat: { bg: 'rgba(9, 192, 99, 0.1)', text: '#09C063' },
  telegram: { bg: 'rgba(34, 158, 217, 0.1)', text: '#229ED9' },
  slack: { bg: 'rgba(224, 30, 90, 0.1)', text: '#E01E5A' },
  discord: { bg: 'rgba(88, 101, 242, 0.1)', text: '#5865F2' },
  feishu: { bg: 'rgba(255, 193, 7, 0.1)', text: '#FFC107' },
}

// 状态颜色
const STATUS_COLORS: Record<string, { text: string; dot: string }> = {
  connected: { text: '#34A853', dot: '#34A853' },
  reconnecting: { text: '#FBBC05', dot: '#FBBC05' },
  failed: { text: '#EA4335', dot: '#EA4335' },
  paused: { text: '#6b7280', dot: '#6b7280' },
  disconnected: { text: '#6b7280', dot: '#6b7280' },
}

// 格式化运行时间
function formatUptime(totalSec: number): string {
  if (totalSec === 0) return '0s'
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  let res = ''
  if (h > 0) res += `${h}h `
  if (m > 0 || h > 0) res += `${m}m `
  res += `${s}s`
  return res
}

export function GatewayView() {
  // 状态
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>('running')
  const [uptime, setUptime] = useState<number>(312)
  const [metrics, setMetrics] = useState<GatewayMetrics>({
    connections: 582,
    sessions: 421,
    memory: 23
  })
  const [adapters, setAdapters] = useState<IMAdapter[]>([
    { id: 'ad-wechat', name: 'WeChat Bot', platform: 'wechat', status: 'connected' },
    { id: 'ad-telegram', name: 'Telegram Stream', platform: 'telegram', status: 'reconnecting' },
    { id: 'ad-slack', name: 'Slack Hook', platform: 'slack', status: 'connected' },
    { id: 'ad-discord', name: 'Discord Bot', platform: 'discord', status: 'connected' },
    { id: 'ad-feishu', name: '飞书集成', platform: 'feishu', status: 'paused' }
  ])
  const [activeLogLevel, setActiveLogLevel] = useState<LogLevel>('all')
  const [logs, setLogs] = useState<SidebarLog[]>([
    { id: 'l1', timestamp: '23:35:41', level: 'info', category: 'ADAPTER', text: 'WeChat ACK: msgSeq=7382103' },
    { id: 'l2', timestamp: '23:35:45', level: 'error', category: 'FEISHU', text: 'OpenAuthClient: APP_SECRET 验证失败' },
    { id: 'l3', timestamp: '23:35:48', level: 'info', category: 'SOCKET', text: 'WSS 握手成功, userId=usr_928' },
    { id: 'l4', timestamp: '23:35:56', level: 'info', category: 'ADAPTER', text: 'WeChat ACK: msgSeq=7382103' },
    { id: 'l5', timestamp: '23:35:58', level: 'error', category: 'DISCORD', text: 'HTTP 429: Rate limit triggered' },
  ])
  const logsEndRef = useRef<HTMLDivElement>(null)

  // 日志自动滚动
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // 动态模拟（运行时）
  useEffect(() => {
    let interval: any = null
    if (gatewayStatus === 'running') {
      interval = setInterval(() => {
        setUptime(prev => prev + 1)
        setMetrics(prev => ({
          connections: Math.max(0, prev.connections + (Math.random() > 0.85 ? (Math.random() > 0.5 ? 1 : -1) : 0)),
          sessions: Math.max(0, prev.sessions + (Math.random() > 0.90 ? (Math.random() > 0.5 ? 1 : -1) : 0)),
          memory: Math.max(5, prev.memory + (Math.random() > 0.70 ? (Math.random() > 0.5 ? 1 : -1) : 0))
        }))
        // 偶尔生成日志
        if (Math.random() > 0.82) {
          const samples = [
            { level: 'info' as const, category: 'SOCKET', text: '新客户端连接成功' },
            { level: 'info' as const, category: 'ADAPTER', text: '心跳同步 ACK' },
            { level: 'warn' as const, category: 'SOCKET', text: '客户端重连退避中' },
            { level: 'error' as const, category: 'SYSTEM', text: '写进程失败: SQLite 锁止' }
          ]
          const sample = samples[Math.floor(Math.random() * samples.length)]
          setLogs(prev => [...prev, {
            id: Date.now().toString(),
            timestamp: new Date().toLocaleTimeString().substring(0, 8),
            ...sample
          }])
        }
      }, 1500)
    }
    return () => clearInterval(interval)
  }, [gatewayStatus])

  // 操作
  const handleStart = () => {
    setGatewayStatus('running')
    setUptime(1)
    setMetrics({ connections: 12, sessions: 8, memory: 14 })
    setLogs(prev => [...prev, {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString().substring(0, 8),
      level: 'info', category: 'SYSTEM', text: 'Gateway started'
    }])
  }

  const handleStop = () => {
    setGatewayStatus('stopped')
    setUptime(0)
    setMetrics({ connections: 0, sessions: 0, memory: 0 })
    setLogs(prev => [...prev, {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString().substring(0, 8),
      level: 'warn', category: 'SYSTEM', text: 'Gateway stopped'
    }])
  }

  const handleToggleAdapter = (id: string) => {
    setAdapters(prev => prev.map(ad => {
      if (ad.id === id) {
        const nextMap: Record<string, string> = {
          connected: 'disconnected', disconnected: 'reconnecting',
          reconnecting: 'failed', failed: 'paused', paused: 'connected'
        }
        const next = nextMap[ad.status] as IMAdapter['status']
        setLogs(l => [...l, {
          id: Math.random().toString(),
          timestamp: new Date().toLocaleTimeString().substring(0, 8),
          level: next === 'connected' ? 'info' : 'warn',
          category: ad.platform.toUpperCase(),
          text: `[${ad.name}] → ${next.toUpperCase()}`
        }])
        return { ...ad, status: next }
      }
      return ad
    }))
  }

  const filteredLogs = activeLogLevel === 'all' ? logs : logs.filter(l => l.level === activeLogLevel)

  return (
    <div className="flex flex-col h-full select-none">
      {/* 1. 状态概览 */}
      <div className="px-3 pt-3 pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex justify-between items-center text-[11px] mb-2.5">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              gatewayStatus === 'running' ? 'bg-[#34A853]' :
              gatewayStatus === 'degraded' ? 'bg-[#FBBC05]' : 'bg-[#EA4335]'
            }`} />
            <span className="font-bold" style={{ color: 'var(--text-on-surface)' }}>Gateway</span>
            <span className="font-mono" style={{ color: 'var(--text-outline-variant)', opacity: 0.6 }}>
              {gatewayStatus === 'running' ? formatUptime(uptime) : '0s'}
            </span>
          </div>
          <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-mono font-bold ${
            gatewayStatus === 'running'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
              : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
          }`}>
            {gatewayStatus.toUpperCase()}
          </span>
        </div>

        {/* 指标网格 */}
        <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
          <div className="p-2 rounded-lg border hover:border-[#2D3139] transition-colors" style={{ background: 'var(--bg-surface-container)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-0.5" style={{ color: 'var(--text-outline-variant)' }}>
              <span>连接</span>
              <span className="opacity-30 text-[8px]">L1</span>
            </div>
            <div className="text-[13px] font-bold" style={{ color: 'var(--text-on-surface)' }}>
              {metrics.connections}
            </div>
          </div>
          <div className="p-2 rounded-lg border hover:border-[#2D3139] transition-colors" style={{ background: 'var(--bg-surface-container)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-0.5" style={{ color: 'var(--text-outline-variant)' }}>
              <span>会话</span>
              <span className="opacity-30 text-[8px]">L2</span>
            </div>
            <div className="text-[13px] font-bold" style={{ color: 'var(--text-on-surface)' }}>
              {metrics.sessions}
            </div>
          </div>
          <div className="p-2 rounded-lg border hover:border-[#2D3139] transition-colors" style={{ background: 'var(--bg-surface-container)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-0.5" style={{ color: 'var(--text-outline-variant)' }}>
              <span>内存</span>
              <span className="opacity-30 text-[8px]">RSS</span>
            </div>
            <div className="text-[13px] font-bold" style={{ color: 'var(--text-on-surface)' }}>
              {gatewayStatus === 'running' ? `${metrics.memory}MB` : '0MB'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. 控制按钮 */}
      <div className="px-3 py-2 border-b grid grid-cols-2 gap-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-container)' }}>
        <button
          onClick={handleStart}
          disabled={gatewayStatus === 'running'}
          className={`h-7 text-[10.5px] font-semibold rounded flex items-center justify-center gap-1.5 transition-all ${
            gatewayStatus === 'running'
              ? 'opacity-50 cursor-not-allowed'
              : 'bg-[#09C063] hover:bg-[#0BCF6B] text-slate-950 shadow cursor-pointer active:scale-98'
          }`}
        >
          <Play className="w-3 h-3 fill-current" /> 启动
        </button>
        <button
          onClick={handleStop}
          disabled={gatewayStatus === 'stopped'}
          className={`h-7 text-[10.5px] font-semibold rounded flex items-center justify-center gap-1.5 transition-all ${
            gatewayStatus === 'stopped'
              ? 'opacity-50 cursor-not-allowed'
              : 'bg-[#16181D] hover:bg-[#1F2228] text-[#8B949E] hover:text-slate-100 border cursor-pointer active:scale-98'
          }`}
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <Square className="w-2.5 h-2.5 fill-current" /> 停止
        </button>
      </div>

      {/* 3. 适配器列表 */}
      <div className="px-3 pt-2.5 pb-2 border-b flex-shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex justify-between items-center text-[10px] mb-2" style={{ color: 'var(--text-outline-variant)' }}>
          <span>适配器</span>
          <span className="text-[8px] opacity-40 font-mono uppercase">Instance Map</span>
        </div>
        <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
          {adapters.map(ad => {
            const colors = ADAPTER_COLORS[ad.platform] || { bg: 'rgba(107,114,128,0.1)', text: '#6b7280' }
            const statusColor = STATUS_COLORS[ad.status] || STATUS_COLORS.disconnected
            return (
              <div
                key={ad.id}
                onClick={() => handleToggleAdapter(ad.id)}
                className="h-7 px-2 rounded-md flex items-center justify-between text-[11px] transition-all duration-150 cursor-pointer group"
                style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded text-[9.5px] font-extrabold font-mono flex items-center justify-center"
                    style={{ background: colors.bg, color: colors.text }}>
                    {ad.platform[0].toUpperCase()}
                  </span>
                  <span className="truncate max-w-[140px] font-medium" style={{ color: 'var(--text-on-surface)' }}>
                    {ad.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] font-bold font-mono" style={{ color: statusColor.text }}>
                    {ad.status === 'connected' ? 'OK' :
                     ad.status === 'reconnecting' ? 'RECONN' :
                     ad.status === 'failed' ? 'FAIL' : 'PAUSED'}
                  </span>
                  <span className={`w-1.5 h-1.5 rounded-full ${ad.status === 'reconnecting' ? 'animate-pulse' : ''}`}
                    style={{ background: statusColor.dot }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 4. 日志区域 */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="px-3 py-1.5 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-container)' }}>
          <span className="text-[10px] font-medium" style={{ color: 'var(--text-outline-variant)' }}>日志</span>
          <div className="flex items-center gap-0.5 p-0.5 rounded" style={{ background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)' }}>
            {(['all', 'info', 'warn', 'error'] as const).map(level => (
              <button
                key={level}
                onClick={() => setActiveLogLevel(level)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-medium capitalize transition-colors cursor-pointer ${
                  activeLogLevel === level
                    ? 'bg-indigo-600 text-slate-100 shadow'
                    : 'hover:text-slate-300'
                }`}
                style={{ color: activeLogLevel === level ? undefined : 'var(--text-outline-variant)' }}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2.5 font-mono text-[9px] leading-relaxed" style={{ background: 'var(--bg-mica)' }}>
          {filteredLogs.length > 0 ? (
            filteredLogs.map(log => (
              <div key={log.id} className="break-all flex items-start gap-1 py-0.5">
                <span className="flex-shrink-0 select-none" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>
                  [{log.timestamp}]
                </span>
                <span className={`font-bold select-none uppercase flex-shrink-0 text-[8.5px] ${
                  log.level === 'info' ? 'text-[#34A853]' :
                  log.level === 'warn' ? 'text-[#FBBC05]' : 'text-[#EA4335]'
                }`}>
                  [{log.category}]
                </span>
                <span style={{ color: 'var(--text-on-surface)', opacity: 0.8 }}>{log.text}</span>
              </div>
            ))
          ) : (
            <div className="h-full flex items-center justify-center" style={{ color: 'var(--text-outline-variant)', opacity: 0.4 }}>
              暂无日志
            </div>
          )}
          <div ref={logsEndRef} />
        </div>
        {/* 底部状态栏 */}
        <div className="h-5 px-3 border-t flex items-center justify-between text-[8px] font-mono flex-shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-container)', color: 'var(--text-outline-variant)', opacity: 0.5 }}>
          <span>Queued: {logs.length}/150</span>
          <span>Filter: {activeLogLevel.toUpperCase()}</span>
        </div>
      </div>
    </div>
  )
}
