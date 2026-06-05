/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GatewayView — IM Gateway Control Panel (Right Sidebar)
 * 容器组件：IPC 数据拉取 + 状态管理 + 子组件组装
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { GatewayHealth, AdapterInfo } from '../../shared/types';
import type { GatewayStatus, SidebarLog, LogLevel } from './gateway';
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
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [logs, setLogs] = useState<SidebarLog[]>([]);
  const [activeLogLevel, setActiveLogLevel] = useState<LogLevel>('all');
  const [loading, setLoading] = useState(false);

  // ── Fetch health ──
  const fetchHealth = useCallback(async () => {
    try {
      const health = await getGatewayAPI().gatewayStatus();
      setStatus(health.status === 'healthy' ? 'running' : health.status === 'degraded' ? 'degraded' : 'stopped');
      setUptime(health.uptime);
      setConnections(health.clientCount);
      setSessions(health.activeSessions);
      setMemory(health.memoryUsage?.rss ?? 0);
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

  // ── Init: fetch + subscribe logs ──
  useEffect(() => {
    fetchHealth();
    fetchAdapters();

    const unsub = getGatewayAPI().onGatewayLog((entry) => {
      const now = new Date(entry.timestamp).toLocaleTimeString().substring(0, 8);
      const category = entry.level === 'error' ? 'ERROR' : entry.level === 'warn' ? 'WARN' : 'SYSTEM';
      setLogs((prev) => [
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

  // ── Poll health when running (5s) ──
  useEffect(() => {
    if (status !== 'running') return;
    const timer = setInterval(() => {
      fetchHealth();
      fetchAdapters();
    }, 5000);
    return () => clearInterval(timer);
  }, [status, fetchHealth, fetchAdapters]);

  // ── Local log helper ──
  const addLocalLog = useCallback((level: 'info' | 'warn' | 'error', category: string, text: string) => {
    const now = new Date().toLocaleTimeString().substring(0, 8);
    setLogs((prev) => [...prev.slice(-149), { id: `${Date.now()}`, timestamp: now, level, category, text }]);
  }, []);

  // ── Start ──
  const handleStart = useCallback(async () => {
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
  }, [addLocalLog, fetchHealth, fetchAdapters]);

  // ── Stop ──
  const handleStop = useCallback(async () => {
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
  }, [addLocalLog]);

  // ── Adapter toggle ──
  const handleAdapterToggle = useCallback(async (name: string, enabled: boolean) => {
    await getGatewayAPI().gatewayAdapterToggle(name, enabled);
    fetchAdapters();
  }, [fetchAdapters]);

  // ── Clear logs ──
  const handleClearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // ── Render ──
  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden select-none"
      style={{
        color: 'var(--text-on-surface)',
        fontFamily: 'var(--font-sans)',
        backgroundColor: 'var(--bg-background)',
      }}
    >
      <StatusHeader status={status} uptime={uptime} />
      <MetricCards connections={connections} sessions={sessions} memoryBytes={memory} running={status === 'running'} />
      <ControlButtons status={status} loading={loading} onStart={handleStart} onStop={handleStop} />
      <AdapterList adapters={adapters} running={status === 'running'} onToggle={handleAdapterToggle} />
      <LogTerminal logs={logs} activeLevel={activeLogLevel} onLevelChange={setActiveLogLevel} onClear={handleClearLogs} />
    </div>
  );
}
