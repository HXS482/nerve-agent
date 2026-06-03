/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GatewayView — 直接复用前端设计 AI 的设计
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Layers,
  RefreshCw,
  Network
} from 'lucide-react';

// Compact state definitions
export type GatewayStatus = 'running' | 'stopped' | 'degraded';

export interface GatewayMetrics {
  connections: number;
  sessions: number;
  memory: number; // MB
}

export interface IMAdapter {
  id: string;
  name: string;
  platform: 'wechat' | 'telegram' | 'slack' | 'discord' | 'feishu';
  status: 'connected' | 'disconnected' | 'reconnecting' | 'failed' | 'paused';
}

export type LogLevel = 'all' | 'info' | 'warn' | 'error';

export interface SidebarLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  category: string;
  text: string;
}

// Initial Mock adapters matching your image
const INITIAL_ADAPTERS: IMAdapter[] = [
  { id: 'ad-wechat', name: 'WeChat Bot Service', platform: 'wechat', status: 'connected' },
  { id: 'ad-telegram', name: 'Telegram Event stream', platform: 'telegram', status: 'reconnecting' },
  { id: 'ad-discord', name: 'Discord Command Dispatcher', platform: 'discord', status: 'connected' },
];

// Initial mock logs matching your exact image logs
const INITIAL_LOGS: SidebarLog[] = [
  { id: 'l1', timestamp: '23:35:41', level: 'info', category: 'ADAPTER', text: 'WeChat 侧边消息发送 ACK 回执: msgSeq=7382103' },
  { id: 'l2', timestamp: '23:35:45', level: 'error', category: 'FEISHU', text: '飞书 OpenAuthClient: APP_SECRET 验证不合规, 请检查全局参数配置文件' },
  { id: 'l3', timestamp: '23:35:48', level: 'info', category: 'SOCKET', text: '客户端 WSS 双向链接握手验证成功, userId=usr_928' },
  { id: 'l4', timestamp: '23:35:56', level: 'info', category: 'ADAPTER', text: 'WeChat 侧边消息发送 ACK 回执: msgSeq=7382103' },
  { id: 'l5', timestamp: '23:35:58', level: 'error', category: 'DISCORD', text: 'HTTP 429: Discord API 触发速率限制，正在将当前下行消息积存入本地队列' },
  { id: 'l6', timestamp: '23:36:01', level: 'info', category: 'ADAPTER', text: 'WeChat 侧边消息发送 ACK 回执: msgSeq=7382103' },
  { id: 'l7', timestamp: '23:36:06', level: 'error', category: 'DISCORD', text: 'HTTP 429: Discord API 触发速率限制，正在将当前下行消息积存入本地队列' },
  { id: 'l8', timestamp: '23:36:09', level: 'error', category: 'DISCORD', text: 'HTTP 429: Discord API 触发速率限制，正在将当前下行消息积存入本地队列' }
];

const MOCK_GEN_LOGS = [
  { level: 'info' as const, category: 'SOCKET', text: '新客户端连接握手建立成功, IP=192.168.1.144' },
  { level: 'info' as const, category: 'ADAPTER', text: '下行心跳同步包 ACK 接收成功, latency=21ms' },
  { level: 'warn' as const, category: 'SOCKET', text: '客户端触发重连退避机制 (Backoff), 正在尝试下一次探测' },
  { level: 'error' as const, category: 'SYSTEM', text: '网关写进程失败: SQLite 发生存储区暂时性锁止' }
];

export function GatewayView() {
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>('running');
  const [uptime, setUptime] = useState<number>(312); // in seconds
  const [metrics, setMetrics] = useState<GatewayMetrics>({
    connections: 582,
    sessions: 421,
    memory: 23 // in MB
  });

  const [adapters, setAdapters] = useState<IMAdapter[]>(INITIAL_ADAPTERS);
  const [activeLogLevel, setActiveLogLevel] = useState<LogLevel>('all');
  const [logs, setLogs] = useState<SidebarLog[]>(INITIAL_LOGS);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest log entries
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Uptime/Metrics Dynamic Simulation Ticker (Only counts when running)
  useEffect(() => {
    let interval: any = null;
    if (gatewayStatus === 'running') {
      interval = setInterval(() => {
        setUptime(prev => prev + 1);

        // Slightly jitter connections/sessions metric values to feel alive
        setMetrics(prev => {
          const rand = Math.random();
          const dConn = rand > 0.85 ? (rand > 0.5 ? 1 : -1) : 0;
          const dSess = rand > 0.90 ? (rand > 0.5 ? 1 : -1) : 0;
          const dMem = rand > 0.70 ? (rand > 0.5 ? 1 : -1) : 0;
          return {
            connections: Math.max(0, prev.connections + dConn),
            sessions: Math.max(0, prev.sessions + dSess),
            memory: Math.max(5, prev.memory + dMem)
          };
        });

        // Occasional live log generator to look organic
        if (Math.random() > 0.82) {
          const sample = MOCK_GEN_LOGS[Math.floor(Math.random() * MOCK_GEN_LOGS.length)];
          const nowStr = new Date().toLocaleTimeString().substring(0, 8);
          setLogs(prev => [
            ...prev,
            {
              id: Date.now().toString(),
              timestamp: nowStr,
              level: sample.level,
              category: sample.category,
              text: sample.text
            }
          ]);
        }
      }, 1500);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [gatewayStatus]);

  // Actions
  const handleStartGateway = () => {
    setGatewayStatus('running');
    setUptime(1);
    setMetrics({ connections: 12, sessions: 8, memory: 14 });
    const nowStr = new Date().toLocaleTimeString().substring(0, 8);
    setLogs(prev => [
      ...prev,
      { id: Date.now().toString(), timestamp: nowStr, level: 'info', category: 'SYSTEM', text: 'Nerve micro gateway engine started successfully.' }
    ]);
  };

  const handleStopGateway = () => {
    setGatewayStatus('stopped');
    setUptime(0);
    setMetrics({ connections: 0, sessions: 0, memory: 0 });
    const nowStr = new Date().toLocaleTimeString().substring(0, 8);
    setLogs(prev => [
      ...prev,
      { id: Date.now().toString(), timestamp: nowStr, level: 'warn', category: 'SYSTEM', text: 'Gateway engine manual shutdown finalized. All connections socket term.' }
    ]);
  };

  const handleToggleAdapter = (id: string) => {
    setAdapters(prev => prev.map(ad => {
      if (ad.id === id) {
        const nextStatusMap: Record<IMAdapter['status'], IMAdapter['status']> = {
          'connected': 'disconnected',
          'disconnected': 'reconnecting',
          'reconnecting': 'failed',
          'failed': 'paused',
          'paused': 'connected'
        };
        const nextStat = nextStatusMap[ad.status];

        const nowStr = new Date().toLocaleTimeString().substring(0, 8);
        setLogs(l => [
          ...l,
          {
            id: Math.random().toString(),
            timestamp: nowStr,
            level: nextStat === 'connected' ? 'info' : 'warn',
            category: ad.platform.toUpperCase(),
            text: `Manual state mutate: [${ad.name}] -> Status changed to ${nextStat.toUpperCase()}`
          }
        ]);
        return { ...ad, status: nextStat };
      }
      return ad;
    }));
  };

  const formatUptimeValue = (totalSec: number) => {
    if (totalSec === 0) return '0s';
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    let res = '';
    if (h > 0) res += `${h}h `;
    if (m > 0 || h > 0) res += `${m}m `;
    res += `${s}s`;
    return res;
  };

  const filteredLogStream = logs.filter((l) => {
    if (activeLogLevel === 'all') return true;
    return l.level === activeLogLevel;
  });

  return (
    <div className="w-full h-full flex flex-col overflow-hidden text-[#E9ECF0] select-none font-sans">

      {/* 1. Status Overview Header (运行状态及 Uptime) */}
      <div className="px-4 pt-3.5 pb-3 border-b border-[#1F2228] space-y-3 flex-shrink-0">
        <div className="flex justify-between items-center text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              gatewayStatus === 'running'
                ? 'bg-[#34A853]'
                : gatewayStatus === 'degraded'
                ? 'bg-[#FBBC05]'
                : 'bg-[#EA4335]'
            }`} />
            <span className="font-bold text-[#D1D5DB] font-mono tracking-tight leading-none">Gateway</span>
            <span className="text-[#8B949E] text-[10px] font-mono leading-none">
              {gatewayStatus === 'running' ? formatUptimeValue(uptime) : '0s'}
            </span>
          </div>

          <span className={`text-[8.5px] px-1.5 py-0.2 rounded font-mono font-bold leading-tight ${
            gatewayStatus === 'running'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
              : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
          }`}>
            {gatewayStatus.toUpperCase()}
          </span>
        </div>

        {/* Three Compact Operational Indicators exactly from reference mockup */}
        <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
          {/* Connections */}
          <div className="bg-white/[0.015] border border-white/[0.04] p-2 rounded-lg text-left hover:border-[#2D3139] transition-colors group">
            <div className="text-[#8B949E] text-[9.5px] font-sans flex items-center justify-between mb-0.5 select-none">
              <span>连接</span>
              <span className="opacity-30 text-[8px]">L1</span>
            </div>
            <div className="text-[13px] font-bold text-[#F0F6FC]">
              {metrics.connections}
            </div>
          </div>

          {/* Sessions */}
          <div className="bg-white/[0.015] border border-white/[0.04] p-2 rounded-lg text-left hover:border-[#2D3139] transition-colors group">
            <div className="text-[#8B949E] text-[9.5px] font-sans flex items-center justify-between mb-0.5 select-none">
              <span>会话</span>
              <span className="opacity-30 text-[8px]">L2</span>
            </div>
            <div className="text-[13px] font-bold text-[#F0F6FC]">
              {metrics.sessions}
            </div>
          </div>

          {/* Memory */}
          <div className="bg-white/[0.015] border border-white/[0.04] p-2 rounded-lg text-left hover:border-[#2D3139] transition-colors group">
            <div className="text-[#8B949E] text-[9.5px] font-sans flex items-center justify-between mb-0.5 select-none">
              <span>内存</span>
              <span className="opacity-30 text-[8px]">RSS</span>
            </div>
            <div className="text-[13px] font-bold text-[#F0F6FC]">
              {gatewayStatus === 'running' ? `${metrics.memory}MB` : '0MB'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Compact Control Row (控制操作: 启动 / 停止) */}
      <div className="px-4 py-2 bg-[#0A0C0F] border-b border-[#1F2228] grid grid-cols-2 gap-2.5 flex-shrink-0">
        <button
          type="button"
          onClick={handleStartGateway}
          disabled={gatewayStatus === 'running'}
          className={`h-6.5 text-[10.5px] font-sans font-semibold rounded flex items-center justify-center gap-1.5 transition-all ${
            gatewayStatus === 'running'
              ? 'bg-[#181C1A] text-[#1E3B27]/40 border border-[#232926]/40 cursor-not-allowed opacity-50'
              : 'bg-[#09C063] hover:bg-[#0BCF6B] text-slate-950 font-bold shadow cursor-pointer active:scale-98'
          }`}
        >
          <Play className="w-3 h-3 fill-current" /> 启动
        </button>

        <button
          type="button"
          onClick={handleStopGateway}
          disabled={gatewayStatus === 'stopped'}
          className={`h-6.5 text-[10.5px] font-sans font-semibold rounded flex items-center justify-center gap-1.5 transition-all ${
            gatewayStatus === 'stopped'
              ? 'bg-[#231215] text-[#5A2027]/40 border border-[#3C1C21]/40 cursor-not-allowed opacity-50'
              : 'bg-[#16181D] hover:bg-[#1F2228] text-[#8B949E] hover:text-slate-100 border border-[#2B303B] cursor-pointer active:scale-98'
          }`}
        >
          <Square className="w-2.5 h-2.5 fill-current" /> 停止
        </button>
      </div>

      {/* 3. Operational Adaptors Context (已配 IM 适配器) */}
      <div className="px-4 pt-3.5 pb-2.5 border-b border-[#1F2228] flex-shrink-0 space-y-2">
        <div className="flex justify-between items-center text-[10px] text-[#8B949E] font-medium tracking-wide">
          <span>适配器列表 (Adapters Context)</span>
          <span className="text-[8px] opacity-40 font-mono tracking-widest uppercase">Instance Map</span>
        </div>

        <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5 select-text scrollbar-thin scrollbar-thumb-gray-800">
          {adapters.map((ad) => (
            <div
              key={ad.id}
              onClick={() => handleToggleAdapter(ad.id)}
              className="h-8 px-2.5 bg-[#13151A]/60 hover:bg-[#1E2129] border border-white/[0.015] hover:border-white/[0.05] rounded-md flex items-center justify-between text-[11px] transition-all duration-150 cursor-pointer group"
            >
              <div className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded text-[9.5px] font-extrabold font-mono flex items-center justify-center select-none ${
                  ad.platform === 'wechat' ? 'bg-[#09C063]/10 text-[#09C063]' :
                  ad.platform === 'slack' ? 'bg-[#E01E5A]/10 text-[#E01E5A]' :
                  ad.platform === 'telegram' ? 'bg-[#229ED9]/10 text-[#229ED9]' :
                  ad.platform === 'discord' ? 'bg-[#5865F2]/10 text-[#5865F2]' :
                  'bg-[#FFC107]/10 text-[#FFC107]'
                }`}>
                  {ad.platform[0].toUpperCase()}
                </span>
                <span className="text-[#C9D1D9] text-[10.5px] truncate max-w-[150px] font-medium tracking-tight">
                  {ad.name}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className={`text-[8px] font-bold font-mono tracking-wider ${
                  ad.status === 'connected' ? 'text-[#34A853]' :
                  ad.status === 'reconnecting' ? 'text-[#FBBC05] animate-pulse' :
                  ad.status === 'failed' ? 'text-[#EA4335]' :
                  'text-slate-500'
                }`}>
                  {ad.status === 'connected' ? 'OK' :
                   ad.status === 'reconnecting' ? 'RECONN' :
                   ad.status === 'failed' ? 'FAILED' : 'PAUSED'}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  ad.status === 'connected' ? 'bg-[#34A853]' :
                  ad.status === 'reconnecting' ? 'bg-[#FBBC05] animate-ping' :
                  ad.status === 'failed' ? 'bg-[#EA4335]' :
                  'bg-slate-600'
                }`} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Log Inspection List (日志诊断流) - Fills the rest of sidebar */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-[220px]">

        {/* Section header containing live console filter pills */}
        <div className="h-9 px-4 border-b border-[#1F2228] bg-[#090A0C] flex items-center justify-between flex-shrink-0 text-[10px] text-[#8B949E] font-medium">
          <span>日志诊断流 (Live Terminal)</span>

          {/* Toggle Pills block exactly as configured in screenshot */}
          <div className="flex items-center bg-[#13161C] border border-white/[0.03] p-0.5 rounded text-[9px] font-mono leading-none">
            {(['all', 'info', 'warn', 'error'] as const).map((level) => (
              <button
                key={level}
                onClick={() => setActiveLogLevel(level)}
                className={`px-1.5 py-0.5 rounded font-medium capitalize transition-colors cursor-pointer ${
                  activeLogLevel === level
                    ? 'bg-indigo-600 text-slate-100 font-bold shadow'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {level === 'all' ? 'All' : level}
              </button>
            ))}
          </div>
        </div>

        {/* Logs scroll workspace */}
        <div className="flex-1 overflow-y-auto bg-[#070809] p-3 space-y-1.5 font-mono text-[9px] leading-relaxed select-text scrollbar-thin">
          {filteredLogStream.length > 0 ? (
            filteredLogStream.map((log) => (
              <div key={log.id} className="text-[#8B949E] break-all flex items-start gap-1">
                <span className="text-[#484F58] flex-shrink-0 select-none">
                  [{log.timestamp}]
                </span>
                <span className={`font-bold select-none uppercase flex-shrink-0 text-[8.5px] ${
                  log.level === 'info' ? 'text-[#34A853]' :
                  log.level === 'warn' ? 'text-[#FBBC05]' :
                  'text-[#EA4335]'
                }`}>
                  [{log.category}]
                </span>
                <span className="text-[#C9D1D9] ml-0.5">{log.text}</span>
              </div>
            ))
          ) : (
            <div className="h-full flex items-center justify-center text-[#484F58] font-sans text-xs">
              暂无日志
            </div>
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Compact Diagnostics detail footer */}
        <div className="h-6.5 px-4 bg-[#090A0C] border-t border-[#1F2228] flex items-center justify-between text-[8px] text-slate-500 font-mono flex-shrink-0">
          <span>Queued: {logs.length}/150 stream</span>
          <span>Filtering: {activeLogLevel.toUpperCase()}</span>
        </div>

      </div>

      {/* Absolute bottom system telemetry tags */}
      <div className="h-8 bg-[#090A0C] border-t border-[#1F2228] px-4 flex items-center justify-between text-[9px] text-[#5A6372] font-mono flex-shrink-0">
        <span>Buffer limits: WSS core</span>
        <span>nerve-us-east1.core</span>
      </div>

    </div>
  );
}
