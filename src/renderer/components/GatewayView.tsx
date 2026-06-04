/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GatewayView — IM Gateway Control Panel (Right Sidebar)
 * 对接真实后端 IPC，轮询 health，订阅日志事件
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Square,
} from 'lucide-react';
import type { GatewayHealth, AdapterInfo } from '../../shared/types';

// ── gateway 方法类型（window.claude 已在 useClaude.ts 声明）──
interface GatewayAPI {
  gatewayStatus: () => Promise<GatewayHealth>
  gatewayAdapters: () => Promise<AdapterInfo[]>
  gatewayStart: () => Promise<{ success: boolean; error?: string }>
  gatewayStop: () => Promise<{ success: boolean; error?: string }>
  gatewayAdapterToggle: (name: string, enabled: boolean) => Promise<void>
  onGatewayLog: (callback: (entry: { level: string; message: string; timestamp: number }) => void) => () => void
}

function getGatewayAPI(): GatewayAPI {
  return window.claude as unknown as GatewayAPI;
}

// ── Types ──────────────────────────────────────────────────────
export type GatewayStatus = 'running' | 'stopped' | 'degraded';

export interface SidebarLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  category: string;
  text: string;
}

export type LogLevel = 'all' | 'info' | 'warn' | 'error';

// ── Helpers ────────────────────────────────────────────────────
function formatUptime(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  let res = '';
  if (h > 0) res += `${h}h `;
  if (m > 0 || h > 0) res += `${m}m `;
  res += `${s}s`;
  return res;
}

function formatMemory(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

const PLATFORM_BADGE: Record<string, { bg: string; fg: string }> = {
  wechat:    { bg: 'bg-[#09C063]/10', fg: 'text-[#09C063]' },
  slack:     { bg: 'bg-[#E01E5A]/10', fg: 'text-[#E01E5A]' },
  telegram:  { bg: 'bg-[#229ED9]/10', fg: 'text-[#229ED9]' },
  discord:   { bg: 'bg-[#5865F2]/10', fg: 'text-[#5865F2]' },
  feishu:    { bg: 'bg-[#FFC107]/10', fg: 'text-[#FFC107]' },
  dingtalk:  { bg: 'bg-[#FFC107]/10', fg: 'text-[#FFC107]' },
  gateway:   { bg: 'bg-[#8B5CF6]/10', fg: 'text-[#8B5CF6]' },
};

const STATUS_LABEL: Record<string, string> = {
  connected: 'OK',
  reconnecting: 'RECONN',
  failed: 'FAILED',
  disconnected: 'OFF',
  paused: 'PAUSED',
};

// ── Component ──────────────────────────────────────────────────
export function GatewayView() {
  const [status, setStatus] = useState<GatewayStatus>('stopped');
  const [uptime, setUptime] = useState(0);
  const [connections, setConnections] = useState(0);
  const [sessions, setSessions] = useState(0);
  const [memory, setMemory] = useState(0);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [logs, setLogs] = useState<SidebarLog[]>([]);
  const [activeLogLevel, setActiveLogLevel] = useState<LogLevel>('all');
  const [loading, setLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── 拉取 health ──
  const fetchHealth = useCallback(async () => {
    try {
      const health = await getGatewayAPI().gatewayStatus();
      setStatus(health.status === 'healthy' ? 'running' : health.status === 'degraded' ? 'degraded' : 'stopped');
      setUptime(health.uptime);
      setConnections(health.clientCount);
      setSessions(health.activeSessions);
      setMemory(health.memoryUsage?.rss ?? 0);
    } catch {
      // gateway 未初始化时静默
      setStatus('stopped');
    }
  }, []);

  // ── 拉取适配器 ──
  const fetchAdapters = useCallback(async () => {
    try {
      const list = await getGatewayAPI().gatewayAdapters();
      setAdapters(list);
    } catch {
      setAdapters([]);
    }
  }, []);

  // ── 初始化：拉数据 + 订阅日志 ──
  useEffect(() => {
    fetchHealth();
    fetchAdapters();

    const unsub = getGatewayAPI().onGatewayLog((entry) => {
      const now = new Date(entry.timestamp).toLocaleTimeString().substring(0, 8);
      const category = entry.level === 'error' ? 'ERROR' : entry.level === 'warn' ? 'WARN' : 'SYSTEM';
      setLogs(prev => [
        ...prev.slice(-149),
        {
          id: `${entry.timestamp}-${Math.random()}`,
          timestamp: now,
          level: entry.level as 'info' | 'warn' | 'error',
          category,
          text: entry.message,
        },
      ]);
    });
    return unsub;
  }, [fetchHealth, fetchAdapters]);

  // ── 轮询 health（运行中时 5s 一次）──
  useEffect(() => {
    if (status !== 'running') return;
    const timer = setInterval(() => {
      fetchHealth();
      fetchAdapters();
    }, 5000);
    return () => clearInterval(timer);
  }, [status, fetchHealth, fetchAdapters]);

  // ── 日志自动滚底 ──
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── 启动 Gateway ──
  const handleStart = async () => {
    setLoading(true);
    try {
      const result = await getGatewayAPI().gatewayStart();
      if (result.success) {
        setStatus('running');
        addLocalLog('info', 'SYSTEM', 'Gateway engine started');
        fetchHealth();
        fetchAdapters();
      } else {
        addLocalLog('error', 'SYSTEM', `Start failed: ${result.error}`);
      }
    } catch (err: any) {
      addLocalLog('error', 'SYSTEM', `Start error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── 停止 Gateway ──
  const handleStop = async () => {
    setLoading(true);
    try {
      const result = await getGatewayAPI().gatewayStop();
      if (result.success) {
        setStatus('stopped');
        setUptime(0);
        setConnections(0);
        setSessions(0);
        setMemory(0);
        addLocalLog('warn', 'SYSTEM', 'Gateway engine stopped');
      } else {
        addLocalLog('error', 'SYSTEM', `Stop failed: ${result.error}`);
      }
    } catch (err: any) {
      addLocalLog('error', 'SYSTEM', `Stop error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── 本地日志 ──
  const addLocalLog = (level: 'info' | 'warn' | 'error', category: string, text: string) => {
    const now = new Date().toLocaleTimeString().substring(0, 8);
    setLogs(prev => [...prev.slice(-149), { id: `${Date.now()}`, timestamp: now, level, category, text }]);
  };

  const filteredLogs = activeLogLevel === 'all'
    ? logs
    : logs.filter(l => l.level === activeLogLevel);

  // ── Render ──
  return (
    <div className="w-full h-full flex flex-col overflow-hidden text-[#E9ECF0] select-none font-sans">

      {/* ─ 1. Status Overview Header ─ */}
      <div className="px-4 pt-3.5 pb-3 space-y-4 flex-shrink-0">
        <div className="flex items-center justify-between text-[11px]" style={{ paddingLeft: '22px', paddingRight: '22px' }}>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              status === 'running'  ? 'bg-[#34A853]'
              : status === 'degraded' ? 'bg-[#FBBC05]'
              : 'bg-[#EA4335]'
            }`} />
            <span className="font-bold text-[#D1D5DB] font-mono tracking-tight leading-none">Gateway</span>
            <span className="text-[#8B949E] text-[10px] font-mono leading-none">
              {status === 'running' ? formatUptime(uptime) : '0s'}
            </span>
          </div>

          <span className={`ml-auto text-[8.5px] px-1.5 py-0.2 rounded font-mono font-bold leading-tight ${
            status === 'running'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
              : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
          }`}>
            {status.toUpperCase()}
          </span>
        </div>

        {/* Three Compact Operational Indicators */}
        <div className="flex justify-between text-[9px] font-mono" style={{ paddingLeft: '22px', paddingRight: '22px', marginTop: '10px' }}>
          <div className="bg-white/[0.015] border border-white/[0.08] px-3 rounded-md text-left hover:border-[#2D3139] transition-colors w-[88px] h-[40px] flex flex-col justify-center">
            <div className="text-[#8B949E] text-[8px] font-sans flex items-center justify-between mb-0.5 select-none">
              <span>连接</span>
              <span className="opacity-30 text-[7px] font-mono">L1</span>
            </div>
            <div className="text-[11px] font-bold text-[#F0F6FC]">{connections}</div>
          </div>

          <div className="bg-white/[0.015] border border-white/[0.08] px-3 rounded-md text-left hover:border-[#2D3139] transition-colors w-[88px] h-[40px] flex flex-col justify-center">
            <div className="text-[#8B949E] text-[8px] font-sans flex items-center justify-between mb-0.5 select-none">
              <span>会话</span>
              <span className="opacity-30 text-[7px] font-mono">L2</span>
            </div>
            <div className="text-[11px] font-bold text-[#F0F6FC]">{sessions}</div>
          </div>

          <div className="bg-white/[0.015] border border-white/[0.08] px-3 rounded-md text-left hover:border-[#2D3139] transition-colors w-[88px] h-[40px] flex flex-col justify-center">
            <div className="text-[#8B949E] text-[8px] font-sans flex items-center justify-between mb-0.5 select-none">
              <span>内存</span>
              <span className="opacity-30 text-[7px] font-mono">RSS</span>
            </div>
            <div className="text-[11px] font-bold text-[#F0F6FC]">
              {status === 'running' ? formatMemory(memory) : '0MB'}
            </div>
          </div>
        </div>
      </div>

      {/* ─ 2. Control Buttons ─ */}
      <div className="py-2 bg-[#0A0C0F] grid grid-cols-2 gap-2.5 flex-shrink-0" style={{ marginTop: '10px', paddingLeft: '22px', paddingRight: '22px' }}>
        <button
          type="button"
          onClick={handleStart}
          disabled={status === 'running' || loading}
          className={`h-6.5 text-[10.5px] font-sans font-semibold rounded flex items-center justify-center gap-1.5 transition-all ${
            status === 'running' || loading
              ? 'bg-[#181C1A] text-[#1E3B27]/40 border border-[#232926]/40 cursor-not-allowed opacity-50'
              : 'bg-[#09C063] hover:bg-[#0BCF6B] text-slate-950 font-bold shadow cursor-pointer active:scale-98'
          }`}
        >
          <Play className="w-3 h-3 fill-current" /> 启动
        </button>

        <button
          type="button"
          onClick={handleStop}
          disabled={status === 'stopped' || loading}
          className={`h-6.5 text-[10.5px] font-sans font-semibold rounded flex items-center justify-center gap-1.5 transition-all ${
            status === 'stopped' || loading
              ? 'bg-[#231215] text-[#5A2027]/40 border border-[#3C1C21]/40 cursor-not-allowed opacity-50'
              : 'bg-[#16181D] hover:bg-[#1F2228] text-[#8B949E] hover:text-slate-100 border border-[#2B303B] cursor-pointer active:scale-98'
          }`}
        >
          <Square className="w-2.5 h-2.5 fill-current" /> 停止
        </button>
      </div>

      {/* ─ 3. Adapters List ─ */}
      <div className="pt-3.5 pb-2.5 flex-shrink-0 space-y-2" style={{ marginTop: '10px', paddingLeft: '22px', paddingRight: '22px' }}>
        <div className="flex justify-between items-center text-[10px] text-[#8B949E] font-medium tracking-wide">
          <span>适配器列表 (Adapters)</span>
          <span className="text-[8px] opacity-40 font-mono tracking-widest uppercase">{adapters.length} loaded</span>
        </div>

        <div className="max-h-44 overflow-y-auto select-text scrollbar-thin scrollbar-thumb-gray-800" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {adapters.length === 0 ? (
            <div className="h-8 flex items-center justify-center text-[#484F58] text-[10px] font-sans">
              {status === 'running' ? '无已注册适配器' : 'Gateway 未启动'}
            </div>
          ) : (
            adapters.map((ad) => {
              const badge = PLATFORM_BADGE[ad.platform] ?? PLATFORM_BADGE.gateway;
              const isConnected = ad.connected;
              return (
                <div
                  key={ad.name}
                  className="h-8 bg-[#13151A]/60 hover:bg-[#1E2129] border border-white/[0.015] hover:border-white/[0.05] rounded-md flex items-center justify-between text-[11px] transition-all duration-150 group"
                  style={{ paddingLeft: '12px', paddingRight: '10px' }}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded text-[9.5px] font-extrabold font-mono flex items-center justify-center select-none ${badge.bg} ${badge.fg}`}>
                      {ad.platform[0].toUpperCase()}
                    </span>
                    <span className="text-[#C9D1D9] text-[10.5px] truncate max-w-[150px] font-medium tracking-tight">
                      {ad.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-[8px] font-bold font-mono tracking-wider ${
                      isConnected ? 'text-[#34A853]' : 'text-slate-500'
                    }`}>
                      {isConnected ? STATUS_LABEL.connected : STATUS_LABEL.disconnected}
                    </span>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        const api = getGatewayAPI()
                        await api.gatewayAdapterToggle(ad.name, !ad.enabled)
                        fetchAdapters()
                      }}
                      className="cursor-pointer transition-colors"
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 8,
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: ad.enabled ? '#27c93f' : '#484f58',
                        background: ad.enabled ? 'rgba(39,201,63,0.1)' : 'transparent',
                        border: `1px solid ${ad.enabled ? 'rgba(39,201,63,0.25)' : 'rgba(255,255,255,0.06)'}`,
                      }}
                    >
                      {ad.enabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ─ 4. Live Log Terminal ─ */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-[220px]" style={{ marginTop: '10px' }}>

        <div className="h-9 border-b border-[#1F2228] bg-[#090A0C] flex items-center justify-between flex-shrink-0 text-[10px] text-[#8B949E] font-medium" style={{ paddingLeft: '22px', paddingRight: '22px' }}>
          <span>日志诊断流 (Live Terminal)</span>
          <div className="flex items-center bg-[#13161C] border border-white/[0.03] px-2 py-1 rounded text-[10px] font-mono gap-1">
            {(['all', 'info', 'warn', 'error'] as const).map((level) => (
              <button
                key={level}
                onClick={() => setActiveLogLevel(level)}
                className={`px-[3px] py-[1px] rounded font-medium capitalize transition-colors cursor-pointer ${
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

        <div className="flex-1 overflow-y-auto bg-[#070809] font-mono text-[9px] leading-relaxed select-text scrollbar-thin" style={{ padding: '12px 22px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {filteredLogs.length > 0 ? (
            filteredLogs.map((log) => (
              <div key={log.id} className="text-[#8B949E] break-all flex items-start gap-1">
                <span className="text-[#484F58] flex-shrink-0 select-none">
                  [{log.timestamp}]
                </span>
                <span className={`font-bold select-none uppercase flex-shrink-0 text-[8.5px] ${
                  log.level === 'info'  ? 'text-[#34A853]'
                  : log.level === 'warn' ? 'text-[#FBBC05]'
                  : 'text-[#EA4335]'
                }`}>
                  [{log.category}]
                </span>
                <span className="text-[#C9D1D9] ml-0.5">{log.text}</span>
              </div>
            ))
          ) : (
            <div className="h-full flex items-center justify-center text-[#484F58] font-sans text-xs">
              {status === 'running' ? '等待日志...' : 'Gateway 未启动'}
            </div>
          )}
          <div ref={logsEndRef} />
        </div>

        <div className="h-6.5 bg-[#090A0C] border-t border-[#1F2228] flex items-center justify-between text-[8px] text-slate-500 font-mono flex-shrink-0" style={{ paddingLeft: '22px', paddingRight: '22px' }}>
          <span>Queued: {logs.length}/150 stream</span>
          <span>Filtering: {activeLogLevel.toUpperCase()}</span>
        </div>

      </div>

      {/* ─ 5. Bottom Telemetry ─ */}
      <div className="h-8 bg-[#090A0C] border-t border-[#1F2228] flex items-center justify-between text-[9px] text-[#5A6372] font-mono flex-shrink-0" style={{ paddingLeft: '22px', paddingRight: '22px' }}>
        <span>Buffer limits: WSS core</span>
        <span>nerve-gateway</span>
      </div>

    </div>
  );
}
