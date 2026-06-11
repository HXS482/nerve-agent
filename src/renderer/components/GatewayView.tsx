/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GatewayView — IM Gateway Control Panel (Right Sidebar)
 * 仪表盘风格容器：渐变光晕 + HeroGauge + 紧凑指标 + 胶囊按钮
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { GatewayHealth, AdapterInfo } from '../../shared/types';
import type { GatewayStatus, SidebarLog } from './gateway';
import { StatusHeader } from './gateway/StatusHeader';
import { MetricCards } from './gateway/MetricCards';
import { ControlButtons } from './gateway/ControlButtons';
import { AdapterList } from './gateway/AdapterList';
import { LogTerminal } from './gateway/LogTerminal';

// ── Gateway IPC API ──────────────────────────────────────────
interface GatewayAPI {
  gatewayStatus: () => Promise<GatewayHealth>;
  gatewayAdapters: () => Promise<AdapterInfo[]>;
  gatewayStart: () => Promise<{ success: boolean; error?: string }>;
  gatewayStop: () => Promise<{ success: boolean; error?: string }>;
  gatewayAdapterToggle: (name: string, enabled: boolean) => Promise<void>;
  mcpBridgeStatus: () => Promise<{ status: string; toolCount: number; port: number; tunnelUrl: string | null }>;
  mcpBridgeToggle: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  onGatewayLog: (callback: (entry: { level: string; message: string; timestamp: number }) => void) => () => void;
}

function getGatewayAPI(): GatewayAPI {
  return window.claude as unknown as GatewayAPI;
}

// ── Component ────────────────────────────────────────────────
export function GatewayView() {
  const [status, setStatus] = useState<GatewayStatus>('stopped');
  const [uptime, setUptime] = useState(0);
  const [connections, setConnections] = useState(0);
  const [sessions, setSessions] = useState(0);
  const [memory, setMemory] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [bridgeHealth, setBridgeHealth] = useState<{ toolCount: number; tunnelUrl: string | null } | null>(null);
  const [logs, setLogs] = useState<SidebarLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [sparklineData, setSparklineData] = useState<number[]>([]);
  const logIdCounter = useRef(0);

  // ── Fetch health ──
  const fetchHealth = useCallback(async () => {
    try {
      const health = await getGatewayAPI().gatewayStatus();
      const newStatus = health.status === 'healthy' ? 'running' : health.status === 'degraded' ? 'degraded' : 'stopped';
      setStatus(newStatus);
      setUptime(health.uptime);
      setConnections(health.clientCount);
      setSessions(health.activeSessions);
      setMemory(health.memoryUsage?.rss ?? 0);
      // Update sparkline
      setSparklineData(prev => [...prev.slice(-19), health.clientCount]);
    } catch {
      setStatus('stopped');
    }
  }, []);

  // ── Fetch adapters ──
  const fetchAdapters = useCallback(async () => {
    try {
      const list = await getGatewayAPI().gatewayAdapters();
      setAdapters(list);
    } catch {
      setAdapters([]);
    }
  }, []);

  // ── Fetch MCP Bridge status ──
  const fetchBridgeHealth = useCallback(async () => {
    try {
      const health = await getGatewayAPI().mcpBridgeStatus();
      if (health.status === 'ok') {
        setBridgeHealth({ toolCount: health.toolCount, tunnelUrl: health.tunnelUrl });
      } else {
        setBridgeHealth(null);
      }
    } catch {
      setBridgeHealth(null);
    }
  }, []);

  // ── Count errors from logs ──
  useEffect(() => {
    setErrorCount(logs.filter(l => l.level === 'error').length);
  }, [logs]);

  // ── Init: fetch + subscribe logs ──
  useEffect(() => {
    fetchHealth();
    fetchAdapters();
    fetchBridgeHealth();

    const unsub = getGatewayAPI().onGatewayLog((entry) => {
      const now = new Date(entry.timestamp).toLocaleTimeString().substring(0, 8);
      const category = entry.level === 'error' ? 'ERR' : entry.level === 'warn' ? 'WARN' : 'SYS';
      setLogs((prev) => [
        ...prev.slice(-149),
        {
          id: `log-${logIdCounter.current++}`,
          timestamp: now,
          level: entry.level as 'info' | 'warn' | 'error',
          category,
          text: entry.message,
        },
      ]);
    });
    return unsub;
  }, [fetchHealth, fetchAdapters, fetchBridgeHealth]);

  // ── Poll health when running (5s) ──
  useEffect(() => {
    if (status !== 'running') return;
    const timer = setInterval(() => {
      fetchHealth();
      fetchAdapters();
      fetchBridgeHealth();
    }, 5000);
    return () => clearInterval(timer);
  }, [status, fetchHealth, fetchAdapters, fetchBridgeHealth]);

  // ── Local log helper ──
  const addLocalLog = useCallback((level: 'info' | 'warn' | 'error', category: string, text: string) => {
    const now = new Date().toLocaleTimeString().substring(0, 8);
    setLogs((prev) => [...prev.slice(-149), { id: `log-${logIdCounter.current++}`, timestamp: now, level, category, text }]);
  }, []);

  // ── Start ──
  const handleStart = useCallback(async () => {
    setLoading(prev => {
      if (prev) return prev;
      return true;
    });
    try {
      const result = await getGatewayAPI().gatewayStart();
      if (result.success) {
        setStatus('running');
        addLocalLog('info', 'SYS', 'Gateway engine started');
        fetchHealth();
        fetchAdapters();
      } else {
        addLocalLog('error', 'ERR', `Start failed: ${result.error}`);
      }
    } catch (err: any) {
      addLocalLog('error', 'ERR', `Start error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [addLocalLog, fetchHealth, fetchAdapters]);

  // ── Stop ──
  const handleStop = useCallback(async () => {
    setLoading(prev => {
      if (prev) return prev;
      return true;
    });
    try {
      const result = await getGatewayAPI().gatewayStop();
      if (result.success) {
        setStatus('stopped');
        setUptime(0);
        setConnections(0);
        setSessions(0);
        setMemory(0);
        setSparklineData([]);
        addLocalLog('warn', 'WARN', 'Gateway engine stopped');
      } else {
        addLocalLog('error', 'ERR', `Stop failed: ${result.error}`);
      }
    } catch (err: any) {
      addLocalLog('error', 'ERR', `Stop error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [addLocalLog]);

  // ── Adapter toggle ──
  const handleAdapterToggle = useCallback(async (name: string, enabled: boolean) => {
    try {
      await getGatewayAPI().gatewayAdapterToggle(name, enabled);
    } catch (err: any) {
      addLocalLog('error', 'ERR', `Toggle ${name} failed: ${err.message}`);
    }
    fetchAdapters();
  }, [fetchAdapters, addLocalLog]);

  // ── MCP Bridge toggle ──
  const handleBridgeToggle = useCallback(async (enabled: boolean) => {
    try {
      const result = await getGatewayAPI().mcpBridgeToggle(enabled);
      if (result.success) {
        if (enabled) {
          await fetchBridgeHealth();
        } else {
          setBridgeHealth(null);
        }
        addLocalLog('info', 'SYS', `MCP Bridge ${enabled ? 'started' : 'stopped'}`);
      } else {
        // 失败后刷新真实状态，确保 UI 同步
        await fetchBridgeHealth();
        addLocalLog('error', 'ERR', `MCP Bridge toggle failed: ${result.error}`);
      }
    } catch (err: any) {
      await fetchBridgeHealth();
      addLocalLog('error', 'ERR', `MCP Bridge toggle error: ${err.message}`);
    }
  }, [fetchBridgeHealth, addLocalLog]);

  // ── Render ──
  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden select-none relative"
      style={{
        color: 'var(--text-on-surface)',
        fontFamily: 'var(--font-sans)',
        backgroundColor: 'var(--bg-background)',
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          top: '-40px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '200px',
          height: '120px',
          background: 'radial-gradient(ellipse, var(--accent-primary-container) 0%, transparent 70%)',
          opacity: 0.06,
          pointerEvents: 'none',
        }}
      />

      <StatusHeader
        status={status}
        uptime={uptime}
        connections={connections}
        sessions={sessions}
        sparklineData={sparklineData}
      />
      <MetricCards
        sessions={sessions}
        memoryBytes={memory}
        errorCount={errorCount}
        running={status === 'running'}
      />
      <ControlButtons status={status} loading={loading} onStart={handleStart} onStop={handleStop} />
      <AdapterList adapters={adapters} running={status === 'running'} onToggle={handleAdapterToggle} bridgeHealth={bridgeHealth} onBridgeToggle={handleBridgeToggle} />
      <LogTerminal logs={logs} />
    </div>
  );
}
