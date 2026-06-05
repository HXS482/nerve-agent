# GatewayView V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 GatewayView V1 的 5 个子组件重写为仪表盘风格，一比一还原 mockup A——圆环 gauge、渐变光晕、紧凑指标条、胶囊按钮、带边框适配器容器。

**Architecture:** 复用 V1 的组件拆分结构和容器 IPC 逻辑，只重写各子组件的 UI 层。StatusHeader 改为 HeroGauge（圆环 gauge + 状态信息 + sparkline），MetricCards 改为紧凑指标条，ControlButtons 改为渐变胶囊，AdapterList 改为带边框容器，LogTerminal 精简为固定高度极简日志。

**Tech Stack:** React 19, Tailwind CSS v4, Motion (Framer Motion), lucide-react

**Spec:** `docs/superpowers/specs/2026-06-05-gatewayview-v2-redesign.md`

---

## File Map

| File | Action | Change Summary |
|------|--------|---------------|
| `src/renderer/components/gateway/StatusHeader.tsx` | Rewrite | 从简单状态行 → HeroGauge（56px 圆环 + 状态信息 + sparkline） |
| `src/renderer/components/gateway/MetricCards.tsx` | Rewrite | 从 3 张独立卡片 → 紧凑三列指标条（gap:1px 共享边框） |
| `src/renderer/components/gateway/ControlButtons.tsx` | Rewrite | 从普通按钮 → 渐变胶囊 Start + 44px Stop |
| `src/renderer/components/gateway/AdapterList.tsx` | Rewrite | 从无容器列表 → 带边框卡片容器 + 延迟显示 + 胶囊 toggle |
| `src/renderer/components/gateway/LogTerminal.tsx` | Rewrite | 从完整日志终端 → 极简固定 48px 日志（无过滤/无底栏） |
| `src/renderer/components/GatewayView.tsx` | Modify | 添加 background glow div，传 errorCount 给 MetricCards |
| `src/renderer/components/gateway/index.ts` | Modify | 添加 `logLevelTag` 常量 |

---

### Task 1: 重写 StatusHeader → HeroGauge

**Files:**
- Rewrite: `src/renderer/components/gateway/StatusHeader.tsx`

- [ ] **Step 1: 重写 StatusHeader.tsx**

用以下内容完全替换文件：

```typescript
import React from 'react';
import type { GatewayStatus } from './index';
import { formatUptime } from './index';

interface StatusHeaderProps {
  status: GatewayStatus;
  uptime: number;
  connections: number;
  sessions: number;
  sparklineData: number[];
}

const statusBadge: Record<GatewayStatus, { label: string; bg: string; color: string }> = {
  running:  { label: 'LIVE', bg: 'rgba(52,168,83,0.12)', color: '#34A853' },
  degraded: { label: 'WARN', bg: 'rgba(251,188,5,0.12)', color: '#FBBC05' },
  stopped:  { label: 'OFF',  bg: 'rgba(234,67,53,0.12)', color: '#EA4335' },
};

export function StatusHeader({ status, uptime, connections, sessions, sparklineData }: StatusHeaderProps) {
  const badge = statusBadge[status];
  const gaugeValue = status === 'running' ? connections : 0;
  // 113 = full circumference of r=18 circle (2 * π * 18 ≈ 113.1)
  const circumference = 113;
  const maxConnections = 50;
  const dashLen = Math.min((gaugeValue / maxConnections) * circumference, circumference);
  const dashGap = circumference - dashLen;

  // sparkline path
  const sparkW = 100;
  const sparkH = 12;
  const sparkPoints = sparklineData.length >= 2
    ? sparklineData.map((v, i) => {
        const x = (i / (sparklineData.length - 1)) * sparkW;
        const max = Math.max(...sparklineData, 1);
        const y = sparkH - (v / max) * (sparkH - 2);
        return `${x},${y}`;
      }).join(' ')
    : `0,${sparkH} ${sparkW},${sparkH}`;

  const sparkFillPoints = sparkPoints
    ? `${sparkPoints} ${sparkW},${sparkH} 0,${sparkH}`
    : '';

  return (
    <div className="flex-shrink-0" style={{ padding: '0 14px', marginTop: '14px' }}>
      <div className="flex items-center gap-3" style={{ marginBottom: '16px' }}>
        {/* Circular Gauge */}
        <svg width="56" height="56" viewBox="0 0 56 56" className="flex-shrink-0">
          <defs>
            <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#adc6ff" />
              <stop offset="100%" stopColor="#4d8eff" />
            </linearGradient>
          </defs>
          <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="4" />
          <circle
            cx="28" cy="28" r="24"
            fill="none"
            stroke="url(#gauge-grad)"
            strokeWidth="4"
            strokeDasharray={`${dashLen} ${dashGap}`}
            strokeLinecap="round"
            transform="rotate(-90 28 28)"
          />
          <text x="28" y="25" textAnchor="middle" fontSize="14" fontWeight="700" fill="#E9ECF0">
            {gaugeValue}
          </text>
          <text x="28" y="36" textAnchor="middle" fontSize="7" fill="#8B949E">
            连接
          </text>
        </svg>

        {/* Info area */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm" style={{ color: '#E9ECF0' }}>Gateway</span>
            <span
              className="font-semibold leading-none"
              style={{
                backgroundColor: badge.bg,
                color: badge.color,
                fontSize: '8px',
                padding: '2px 6px',
                borderRadius: '10px',
              }}
            >
              {badge.label}
            </span>
          </div>
          <div style={{ color: '#8B949E', fontSize: '10px', marginTop: '2px' }}>
            {status === 'running' ? `UP ${formatUptime(uptime)} · ${sessions} sessions` : '—'}
          </div>
          {/* Sparkline */}
          {status === 'running' && sparklineData.length >= 2 && (
            <svg width={sparkW} height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`} style={{ marginTop: '3px' }}>
              <defs>
                <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4d8eff" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#4d8eff" stopOpacity="0" />
                </linearGradient>
              </defs>
              {sparkFillPoints && <polygon points={sparkFillPoints} fill="url(#spark-fill)" />}
              <polyline
                points={sparkPoints}
                fill="none"
                stroke="#4d8eff"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit 2>&1 | grep "StatusHeader" | grep -v "TS6305" | head -5
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/StatusHeader.tsx
git commit -m "feat: rewrite StatusHeader as HeroGauge with circular gauge and sparkline"
```

---

### Task 2: 重写 MetricCards → 紧凑指标条

**Files:**
- Rewrite: `src/renderer/components/gateway/MetricCards.tsx`

- [ ] **Step 1: 重写 MetricCards.tsx**

用以下内容完全替换文件：

```typescript
import React from 'react';

interface MetricCardsProps {
  sessions: number;
  memoryBytes: number;
  errorCount: number;
  running: boolean;
}

export function MetricCards({ sessions, memoryBytes, errorCount, running }: MetricCardsProps) {
  const memMB = running ? Math.round(memoryBytes / 1024 / 1024) : 0;

  const metrics = [
    { label: '会话', value: running ? sessions : 0 },
    { label: '内存', value: memMB, unit: 'MB' },
    { label: '错误', value: errorCount, isError: true },
  ];

  return (
    <div
      className="flex-shrink-0"
      style={{ padding: '0 14px', marginBottom: '14px' }}
    >
      <div
        className="flex overflow-hidden"
        style={{ borderRadius: '6px', gap: '1px', background: 'rgba(255,255,255,0.01)' }}
      >
        {metrics.map((m) => (
          <div
            key={m.label}
            className="flex-1 flex flex-col items-center justify-center"
            style={{
              backgroundColor: 'rgba(255,255,255,0.03)',
              padding: '8px 10px',
            }}
          >
            <div
              style={{
                color: '#8B949E',
                fontSize: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {m.label}
            </div>
            <div
              className="flex items-baseline"
              style={{ marginTop: '2px' }}
            >
              <span
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: m.isError && m.value === 0 ? '#34A853' : '#E9ECF0',
                }}
              >
                {m.value}
              </span>
              {m.unit && (
                <span style={{ fontSize: '9px', color: '#8B949E', marginLeft: '2px' }}>
                  {m.unit}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit 2>&1 | grep "MetricCards" | grep -v "TS6305" | head -5
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/MetricCards.tsx
git commit -m "feat: rewrite MetricCards as compact metric strip"
```

---

### Task 3: 重写 ControlButtons → 渐变胶囊

**Files:**
- Rewrite: `src/renderer/components/gateway/ControlButtons.tsx`

- [ ] **Step 1: 重写 ControlButtons.tsx**

用以下内容完全替换文件：

```typescript
import React from 'react';
import { Loader2 } from 'lucide-react';
import type { GatewayStatus } from './index';

interface ControlButtonsProps {
  status: GatewayStatus;
  loading: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function ControlButtons({ status, loading, onStart, onStop }: ControlButtonsProps) {
  const isRunning = status === 'running';
  const startDisabled = isRunning || loading;
  const stopDisabled = status === 'stopped' || loading;

  return (
    <div
      className="flex flex-shrink-0"
      style={{ padding: '0 14px', gap: '6px', marginBottom: '14px' }}
    >
      {/* Start */}
      <button
        type="button"
        onClick={onStart}
        disabled={startDisabled}
        className="flex-1 flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed active:scale-[0.97] transition-transform"
        style={{
          background: startDisabled
            ? 'rgba(255,255,255,0.04)'
            : 'linear-gradient(135deg, #34A853 0%, #2d9348 100%)',
          color: startDisabled ? '#484F58' : '#000',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          borderRadius: '8px',
          padding: '7px',
          boxShadow: startDisabled
            ? 'none'
            : '0 2px 12px rgba(52,168,83,0.2), inset 0 1px 0 rgba(255,255,255,0.15)',
          border: startDisabled ? '1px solid rgba(255,255,255,0.06)' : 'none',
        }}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          '▶ START'
        )}
      </button>

      {/* Stop */}
      <button
        type="button"
        onClick={onStop}
        disabled={stopDisabled}
        className="flex items-center justify-center cursor-pointer disabled:cursor-not-allowed active:scale-[0.97] transition-transform"
        style={{
          width: '44px',
          background: 'rgba(255,255,255,0.04)',
          color: stopDisabled ? '#30363D' : '#8B949E',
          fontSize: '11px',
          borderRadius: '8px',
          padding: '7px',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          '■'
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit 2>&1 | grep "ControlButtons" | grep -v "TS6305" | head -5
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/ControlButtons.tsx
git commit -m "feat: rewrite ControlButtons as gradient capsule buttons"
```

---

### Task 4: 重写 AdapterList → 带边框容器

**Files:**
- Rewrite: `src/renderer/components/gateway/AdapterList.tsx`

- [ ] **Step 1: 重写 AdapterList.tsx**

用以下内容完全替换文件：

```typescript
import React from 'react';
import type { AdapterInfo } from '../../../shared/types';
import { PLATFORM_COLOR } from './index';

interface AdapterListProps {
  adapters: AdapterInfo[];
  running: boolean;
  onToggle: (name: string, enabled: boolean) => void;
}

export function AdapterList({ adapters, running, onToggle }: AdapterListProps) {
  return (
    <div className="flex-shrink-0" style={{ padding: '0 14px', marginBottom: '12px' }}>
      {/* Section label */}
      <div
        style={{
          color: '#8B949E',
          fontSize: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          marginBottom: '6px',
        }}
      >
        适配器
      </div>

      {/* Card container */}
      <div
        style={{
          backgroundColor: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        {adapters.length === 0 ? (
          <div
            className="flex items-center justify-center"
            style={{ height: '36px', color: '#484F58', fontSize: '11px' }}
          >
            {running ? 'No adapters' : 'Gateway not running'}
          </div>
        ) : (
          adapters.map((ad, idx) => {
            const platformColor = PLATFORM_COLOR[ad.platform] ?? PLATFORM_COLOR.gateway;
            const isConnected = ad.connected;
            const isLast = idx === adapters.length - 1;

            return (
              <div
                key={ad.name}
                className="flex items-center justify-between"
                style={{
                  padding: '8px 10px',
                  borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.03)',
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex-shrink-0"
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: isConnected ? platformColor : '#484F58',
                      boxShadow: isConnected ? `0 0 6px ${platformColor}60` : 'none',
                    }}
                  />
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 500,
                      color: isConnected ? '#E9ECF0' : '#8B949E',
                    }}
                  >
                    {ad.name}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    style={{
                      color: isConnected ? '#34A853' : '#484F58',
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {isConnected ? '● 42ms' : '○ OFF'}
                  </span>

                  {/* Capsule toggle */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(ad.name, !ad.enabled);
                    }}
                    className="relative cursor-pointer flex-shrink-0"
                    style={{
                      width: '28px',
                      height: '14px',
                      borderRadius: '7px',
                      backgroundColor: ad.enabled ? '#4d8eff' : 'rgba(255,255,255,0.06)',
                      transition: 'background-color 0.2s',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: '2px',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: ad.enabled ? '#fff' : '#484F58',
                        left: ad.enabled ? '16px' : '2px',
                        transition: 'left 0.2s',
                      }}
                    />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit 2>&1 | grep "AdapterList" | grep -v "TS6305" | head -5
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/AdapterList.tsx
git commit -m "feat: rewrite AdapterList as bordered container with capsule toggle"
```

---

### Task 5: 重写 LogTerminal → 极简固定日志

**Files:**
- Rewrite: `src/renderer/components/gateway/LogTerminal.tsx`

- [ ] **Step 1: 重写 LogTerminal.tsx**

用以下内容完全替换文件：

```typescript
import React from 'react';
import type { SidebarLog } from './index';

interface LogTerminalProps {
  logs: SidebarLog[];
}

const levelTag: Record<string, { label: string; color: string }> = {
  info:  { label: 'SYS', color: '#4d8eff' },
  warn:  { label: 'WARN', color: '#FBBC05' },
  error: { label: 'ERR', color: '#EA4335' },
};

export function LogTerminal({ logs }: LogTerminalProps) {
  // Show only the latest entries that fit in 48px (~3 lines at line-height 1.6 * 9px)
  const visible = logs.slice(-3);

  return (
    <div className="flex-shrink-0" style={{ padding: '0 14px' }}>
      <div
        style={{
          backgroundColor: '#08090B',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: '8px',
          padding: '6px 8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          lineHeight: 1.6,
          color: '#8B949E',
          height: '48px',
          overflow: 'hidden',
        }}
      >
        {visible.length > 0 ? (
          visible.map((log) => {
            const tag = levelTag[log.level] ?? { label: 'SYS', color: '#4d8eff' };
            return (
              <div key={log.id}>
                <span style={{ color: '#484F58' }}>{log.timestamp}</span>{' '}
                <span style={{ color: tag.color }}>{tag.label}</span>{' '}
                <span style={{ color: '#C9D1D9' }}>{log.text}</span>
              </div>
            );
          })
        ) : (
          <div style={{ color: '#484F58' }}>Waiting for logs...</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit 2>&1 | grep "LogTerminal" | grep -v "TS6305" | head -5
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/LogTerminal.tsx
git commit -m "feat: rewrite LogTerminal as minimal fixed-height log strip"
```

---

### Task 6: 更新 GatewayView.tsx 容器

**Files:**
- Modify: `src/renderer/components/GatewayView.tsx`
- Modify: `src/renderer/components/gateway/index.ts`

- [ ] **Step 1: 更新 index.ts 添加 logLevelTag**

在 `src/renderer/components/gateway/index.ts` 的 `STATUS_LABEL` 常量后面添加：

```typescript
export const LOG_LEVEL_TAG: Record<string, { label: string; color: string }> = {
  info:  { label: 'SYS', color: '#4d8eff' },
  warn:  { label: 'WARN', color: '#FBBC05' },
  error: { label: 'ERR', color: '#EA4335' },
};
```

- [ ] **Step 2: 重写 GatewayView.tsx**

用以下内容完全替换 `src/renderer/components/GatewayView.tsx`：

```typescript
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GatewayView — IM Gateway Control Panel (Right Sidebar)
 * 仪表盘风格容器：渐变光晕 + HeroGauge + 紧凑指标 + 胶囊按钮
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
  const [errorCount, setErrorCount] = useState(0);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
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

  // ── Count errors from logs ──
  useEffect(() => {
    setErrorCount(logs.filter(l => l.level === 'error').length);
  }, [logs]);

  // ── Init: fetch + subscribe logs ──
  useEffect(() => {
    fetchHealth();
    fetchAdapters();

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

  // ── Render ──
  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden select-none relative"
      style={{
        color: '#E9ECF0',
        fontFamily: 'var(--font-sans)',
        backgroundColor: '#0D0D0D',
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
          background: 'radial-gradient(ellipse, rgba(77,142,255,0.08) 0%, transparent 70%)',
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
      <AdapterList adapters={adapters} running={status === 'running'} onToggle={handleAdapterToggle} />
      <LogTerminal logs={logs} />
    </div>
  );
}
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit 2>&1 | grep -E "(GatewayView|gateway)" | grep -v "TS6305" | head -10
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/GatewayView.tsx src/renderer/components/gateway/index.ts
git commit -m "feat: update GatewayView container for V2 dashboard layout"
```

---

### Task 7: 手动验证

**Files:** 无

- [ ] **Step 1: 启动 dev server**

```bash
cd "G:/worktree/nerve-agent" && npm run dev
```

- [ ] **Step 2: 验证视觉效果**

1. 打开 Gateway tab，确认与 mockup A 一致：
   - 顶部蓝色渐变光晕
   - 56px 圆环 gauge 显示连接数
   - Gateway + LIVE badge + uptime + sparkline
   - 紧凑三列指标条（会话/内存/错误）
   - 渐变绿色 START 按钮 + 灰色 Stop 按钮
   - 带边框适配器容器 + 胶囊 toggle
   - 48px 固定高度日志区

2. 功能验证：
   - 点 Start → gauge 数值更新、sparkline 画线、badge 变 LIVE
   - 点 Stop → 状态重置、sparkline 清空
   - 适配器 toggle → 切换生效

- [ ] **Step 3: 最终 Commit**

```bash
git add -A
git commit -m "feat: GatewayView V2 — dashboard gauge style, pixel-perfect to mockup"
```
