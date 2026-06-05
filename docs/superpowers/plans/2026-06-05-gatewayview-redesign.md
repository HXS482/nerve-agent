# GatewayView 重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 GatewayView 从硬编码 hex 色值的单文件重写为 Vercel Dashboard 风格的模块化组件，接入 CSS 变量体系，加入 sparkline 数据可视化。

**Architecture:** 421 行单文件拆为 5 个子组件（StatusHeader / MetricCards / ControlButtons / AdapterList / LogTerminal），GatewayView.tsx 降级为容器负责 IPC 数据拉取和状态管理。所有样式从硬编码 hex 迁移到 `var(--bg-surface-container)` 等 CSS 自定义属性，支持 dark/light/aurora 三主题。Sparkline 用纯 SVG polyline 实现，数据存储在 `useRef` 环形缓冲区。

**Tech Stack:** React 19, Tailwind CSS v4, Motion (Framer Motion), lucide-react, CSS custom properties (globals.css)

**Testing:** 项目 vitest 环境为 `node`，renderer 排除在 coverage 之外，无 React Testing Library。每个 Task 完成后通过 dev server 手动验证视觉和功能正确性。

**Spec:** `docs/superpowers/specs/2026-06-05-gatewayview-redesign.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/renderer/components/gateway/index.ts` | Create | Barrel export + 共享类型 + 常量 |
| `src/renderer/components/gateway/StatusHeader.tsx` | Create | 状态点 + 运行时长 + 状态 badge |
| `src/renderer/components/gateway/MetricCards.tsx` | Create | 3 格 sparkline 指标卡 |
| `src/renderer/components/gateway/ControlButtons.tsx` | Create | Start / Stop 双按钮 |
| `src/renderer/components/gateway/AdapterList.tsx` | Create | 适配器列表 + toggle |
| `src/renderer/components/gateway/LogTerminal.tsx` | Create | 日志终端 + 过滤 + 自动滚动 |
| `src/renderer/components/GatewayView.tsx` | Rewrite | 容器，IPC 数据拉取，组装子组件 |

---

### Task 1: 创建 gateway 目录 + 共享类型和常量

**Files:**
- Create: `src/renderer/components/gateway/index.ts`

- [ ] **Step 1: 创建目录和 barrel export 文件**

```bash
mkdir -p "G:/worktree/nerve-agent/src/renderer/components/gateway"
```

然后创建 `src/renderer/components/gateway/index.ts`：

```typescript
/**
 * gateway/ — GatewayView 子组件
 */

// ── 共享类型 ──────────────────────────────────────────────────
export type GatewayStatus = 'running' | 'stopped' | 'degraded';

export interface SidebarLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  category: string;
  text: string;
}

export type LogLevel = 'all' | 'info' | 'warn' | 'error';

// ── 共享常量 ──────────────────────────────────────────────────
export const PLATFORM_COLOR: Record<string, string> = {
  wechat:   '#09C063',
  slack:    '#E01E5A',
  telegram: '#229ED9',
  discord:  '#5865F2',
  feishu:   '#FFC107',
  dingtalk: '#FFC107',
  gateway:  '#8B5CF6',
};

export const STATUS_LABEL: Record<string, string> = {
  connected:    'Connected',
  reconnecting: 'Reconnecting',
  failed:       'Failed',
  disconnected: 'OFF',
  paused:       'Paused',
};

// ── 共享工具函数 ──────────────────────────────────────────────
export function formatUptime(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  let res = '';
  if (h > 0) res += `${h}h `;
  if (m > 0 || h > 0) res += `${m}m `;
  res += `${s}s`;
  return res.trim();
}

export function formatMemory(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}
```

- [ ] **Step 2: 验证文件创建成功**

```bash
cat "G:/worktree/nerve-agent/src/renderer/components/gateway/index.ts" | head -5
```

Expected: 看到文件头部注释，无报错。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/index.ts
git commit -m "feat: add gateway component directory with shared types and constants"
```

---

### Task 2: StatusHeader 组件

**Files:**
- Create: `src/renderer/components/gateway/StatusHeader.tsx`

- [ ] **Step 1: 创建 StatusHeader 组件**

```typescript
import React from 'react';
import { motion } from 'motion/react';
import type { GatewayStatus } from './index';
import { formatUptime } from './index';

interface StatusHeaderProps {
  status: GatewayStatus;
  uptime: number;
}

const statusColor: Record<GatewayStatus, string> = {
  running:  'var(--accent-primary)',
  degraded: '#FBBC05',
  stopped:  'var(--error)',
};

const statusBg: Record<GatewayStatus, string> = {
  running:  'rgba(173, 198, 255, 0.1)',
  degraded: 'rgba(251, 188, 5, 0.1)',
  stopped:  'var(--error-container)',
};

const statusText: Record<GatewayStatus, string> = {
  running:  'RUNNING',
  degraded: 'DEGRADED',
  stopped:  'STOPPED',
};

export function StatusHeader({ status, uptime }: StatusHeaderProps) {
  return (
    <div
      className="flex items-center justify-between h-8 border-b flex-shrink-0"
      style={{
        borderColor: 'var(--border-subtle)',
        paddingLeft: '22px',
        paddingRight: '22px',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: statusColor[status],
            boxShadow: `0 0 8px ${statusColor[status]}60`,
          }}
        />
        <span
          className="font-semibold text-sm leading-none"
          style={{ color: 'var(--text-on-surface)', fontFamily: 'var(--font-sans)' }}
        >
          Gateway
        </span>
        <span
          className="text-xs leading-none"
          style={{ color: 'var(--text-on-surface-variant)', fontFamily: 'var(--font-mono)' }}
        >
          {status === 'running' ? formatUptime(uptime) : '—'}
        </span>
      </div>

      <motion.span
        key={status}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-[9px] px-1.5 py-0.5 rounded font-semibold leading-none"
        style={{
          backgroundColor: statusBg[status],
          color: statusColor[status],
          fontFamily: 'var(--font-mono)',
        }}
      >
        {statusText[status]}
      </motion.span>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit src/renderer/components/gateway/StatusHeader.tsx 2>&1 | head -10
```

Expected: 无错误输出（或只有不影响此文件的项目级错误）。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/StatusHeader.tsx
git commit -m "feat: add StatusHeader component with design tokens"
```

---

### Task 3: MetricCards 组件（含 sparkline）

**Files:**
- Create: `src/renderer/components/gateway/MetricCards.tsx`

- [ ] **Step 1: 创建 MetricCards 组件**

```typescript
import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface MetricCardsProps {
  connections: number;
  sessions: number;
  memoryBytes: number;
  running: boolean;
}

interface MetricCardProps {
  label: string;
  value: number;
  unit?: string;
  dataRef: React.MutableRefObject<number[]>;
  color?: string;
}

// ── Sparkline ────────────────────────────────────────────────
function Sparkline({ data, color = 'var(--accent-primary)' }: { data: number[]; color?: string }) {
  if (data.length < 2) {
    return (
      <svg width="100%" height="16" viewBox="0 0 60 16">
        <line x1="0" y1="14" x2="60" y2="14" stroke="var(--text-outline-variant)" strokeWidth="1" opacity="0.3" />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const step = 60 / (data.length - 1);
  const points = data
    .map((v, i) => `${i * step},${16 - (v / max) * 14}`)
    .join(' ');

  return (
    <svg width="100%" height="16" viewBox="0 0 60 16">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Single Metric Card ───────────────────────────────────────
function MetricCard({ label, value, unit, dataRef, color }: MetricCardProps) {
  const [prev, setPrev] = useState(value);
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    const diff = value - prev;
    setDelta(diff);
    setPrev(value);
  }, [value]);

  return (
    <div
      className="rounded-md flex flex-col justify-center px-2 py-1.5"
      style={{
        backgroundColor: 'var(--bg-surface-container-low)',
        border: '1px solid var(--border-subtle)',
        minWidth: 0,
      }}
    >
      <div
        className="text-[9px] uppercase tracking-wider mb-0.5 select-none"
        style={{ color: 'var(--text-outline-variant)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </div>

      <div className="flex items-baseline gap-1">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={value}
            initial={{ scale: 1.05, opacity: 0.7 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="text-lg font-semibold leading-none"
            style={{ color: 'var(--text-on-surface)' }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
        {unit && (
          <span className="text-[10px]" style={{ color: 'var(--text-on-surface-variant)' }}>
            {unit}
          </span>
        )}
        {delta !== 0 && (
          <span
            className="text-[9px] font-medium"
            style={{ color: delta > 0 ? 'var(--accent-primary)' : 'var(--error)' }}
          >
            {delta > 0 ? `↑+${delta}` : `↓${delta}`}
          </span>
        )}
      </div>

      <Sparkline data={dataRef.current} color={color} />
    </div>
  );
}

// ── MetricCards Container ────────────────────────────────────
const BUFFER_SIZE = 20;

export function MetricCards({ connections, sessions, memoryBytes, running }: MetricCardsProps) {
  const connRef = useRef<number[]>([]);
  const sessRef = useRef<number[]>([]);
  const memRef = useRef<number[]>([]);

  useEffect(() => {
    connRef.current = [...connRef.current.slice(-(BUFFER_SIZE - 1)), connections];
    sessRef.current = [...sessRef.current.slice(-(BUFFER_SIZE - 1)), sessions];
    memRef.current = [...memRef.current.slice(-(BUFFER_SIZE - 1)), Math.round(memoryBytes / 1024 / 1024)];
  }, [connections, sessions, memoryBytes]);

  const memMB = running ? Math.round(memoryBytes / 1024 / 1024) : 0;

  return (
    <div
      className="grid grid-cols-3 gap-1.5 flex-shrink-0"
      style={{ padding: '0 22px', marginTop: '10px' }}
    >
      <MetricCard label="连接" value={running ? connections : 0} dataRef={connRef} />
      <MetricCard label="会话" value={running ? sessions : 0} dataRef={sessRef} />
      <MetricCard label="内存" value={memMB} unit="MB" dataRef={memRef} color="var(--text-outline)" />
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit src/renderer/components/gateway/MetricCards.tsx 2>&1 | head -10
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/MetricCards.tsx
git commit -m "feat: add MetricCards component with sparkline SVG"
```

---

### Task 4: ControlButtons 组件

**Files:**
- Create: `src/renderer/components/gateway/ControlButtons.tsx`

- [ ] **Step 1: 创建 ControlButtons 组件**

```typescript
import React from 'react';
import { Play, Square, Loader2 } from 'lucide-react';
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
      className="grid grid-cols-2 gap-1.5 flex-shrink-0"
      style={{ padding: '0 22px', marginTop: '10px' }}
    >
      {/* Start */}
      <button
        type="button"
        onClick={onStart}
        disabled={startDisabled}
        className="h-8 rounded-md flex items-center justify-center gap-1.5 text-xs font-semibold transition-all cursor-pointer disabled:cursor-not-allowed active:scale-[0.97]"
        style={{
          backgroundColor: startDisabled ? 'var(--bg-surface-container)' : 'var(--accent-primary)',
          color: startDisabled ? 'var(--text-outline)' : 'var(--accent-on-primary)',
          fontFamily: 'var(--font-sans)',
          boxShadow: startDisabled ? 'none' : undefined,
        }}
        onMouseEnter={(e) => {
          if (!startDisabled) e.currentTarget.style.boxShadow = '0 0 12px rgba(173, 198, 255, 0.2)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Play className="w-3 h-3 fill-current" />
        )}
        启动
      </button>

      {/* Stop */}
      <button
        type="button"
        onClick={onStop}
        disabled={stopDisabled}
        className="h-8 rounded-md flex items-center justify-center gap-1.5 text-xs font-semibold transition-all cursor-pointer disabled:cursor-not-allowed active:scale-[0.97]"
        style={{
          backgroundColor: 'var(--bg-surface-container)',
          color: stopDisabled ? 'var(--text-outline)' : 'var(--text-on-surface-variant)',
          border: `1px solid ${stopDisabled ? 'var(--border-subtle)' : 'var(--border-subtle)'}`,
          fontFamily: 'var(--font-sans)',
        }}
        onMouseEnter={(e) => {
          if (!stopDisabled) {
            e.currentTarget.style.borderColor = 'var(--error)';
            e.currentTarget.style.color = 'var(--error)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-subtle)';
          e.currentTarget.style.color = stopDisabled ? 'var(--text-outline)' : 'var(--text-on-surface-variant)';
        }}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Square className="w-2.5 h-2.5 fill-current" />
        )}
        停止
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit src/renderer/components/gateway/ControlButtons.tsx 2>&1 | head -10
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/ControlButtons.tsx
git commit -m "feat: add ControlButtons component with design tokens"
```

---

### Task 5: AdapterList 组件

**Files:**
- Create: `src/renderer/components/gateway/AdapterList.tsx`

- [ ] **Step 1: 创建 AdapterList 组件**

```typescript
import React from 'react';
import type { AdapterInfo } from '../../../shared/types';
import { PLATFORM_COLOR, STATUS_LABEL } from './index';

interface AdapterListProps {
  adapters: AdapterInfo[];
  running: boolean;
  onToggle: (name: string, enabled: boolean) => void;
}

export function AdapterList({ adapters, running, onToggle }: AdapterListProps) {
  return (
    <div
      className="flex-shrink-0"
      style={{ padding: '0 22px', marginTop: '12px' }}
    >
      <div
        className="flex justify-between items-center mb-2 text-[10px]"
        style={{ color: 'var(--text-on-surface-variant)' }}
      >
        <span style={{ fontFamily: 'var(--font-sans)' }}>适配器</span>
        <span
          className="text-[9px] opacity-50"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {adapters.length} loaded
        </span>
      </div>

      <div
        className="rounded-md p-2 max-h-44 overflow-y-auto"
        style={{ backgroundColor: 'var(--bg-surface-container-low)' }}
      >
        {adapters.length === 0 ? (
          <div
            className="h-8 flex items-center justify-center text-xs"
            style={{ color: 'var(--text-outline)' }}
          >
            {running ? 'No adapters configured' : 'Gateway not running'}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {adapters.map((ad) => {
              const platformColor = PLATFORM_COLOR[ad.platform] ?? PLATFORM_COLOR.gateway;
              const isConnected = ad.connected;

              return (
                <div
                  key={ad.name}
                  className="h-9 rounded-md flex items-center justify-between px-3 transition-colors cursor-pointer"
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid transparent',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-surface-container)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: isConnected ? platformColor : 'var(--text-outline-variant)',
                        boxShadow: isConnected ? `0 0 6px ${platformColor}60` : 'none',
                      }}
                    />
                    <span
                      className="text-xs font-medium truncate max-w-[140px]"
                      style={{ color: 'var(--text-on-surface)' }}
                    >
                      {ad.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: isConnected ? 'rgba(173, 198, 255, 0.1)' : 'transparent',
                        color: isConnected ? 'var(--accent-primary)' : 'var(--text-outline-variant)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {isConnected ? STATUS_LABEL.connected : STATUS_LABEL.disconnected}
                    </span>

                    {/* Toggle */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(ad.name, !ad.enabled);
                      }}
                      className="relative w-8 h-[18px] rounded-full transition-colors cursor-pointer flex-shrink-0"
                      style={{
                        backgroundColor: ad.enabled ? 'var(--accent-primary)' : 'var(--bg-surface-variant)',
                      }}
                    >
                      <span
                        className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-transform duration-200"
                        style={{
                          backgroundColor: ad.enabled ? 'var(--accent-on-primary)' : 'var(--text-outline)',
                          left: '2px',
                          transform: ad.enabled ? 'translateX(14px)' : 'translateX(0)',
                        }}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit src/renderer/components/gateway/AdapterList.tsx 2>&1 | head -10
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/AdapterList.tsx
git commit -m "feat: add AdapterList component with toggle and platform colors"
```

---

### Task 6: LogTerminal 组件

**Files:**
- Create: `src/renderer/components/gateway/LogTerminal.tsx`

- [ ] **Step 1: 创建 LogTerminal 组件**

```typescript
import React, { useRef, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Trash2 } from 'lucide-react';
import type { SidebarLog, LogLevel } from './index';

interface LogTerminalProps {
  logs: SidebarLog[];
  activeLevel: LogLevel;
  onLevelChange: (level: LogLevel) => void;
  onClear: () => void;
}

const LEVEL_TABS: { key: LogLevel; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'info', label: 'Info' },
  { key: 'warn', label: 'Warn' },
  { key: 'error', label: 'Error' },
];

const levelColor: Record<string, string> = {
  info:  'var(--accent-primary)',
  warn:  '#FBBC05',
  error: 'var(--error)',
};

export function LogTerminal({ logs, activeLevel, onLevelChange, onClear }: LogTerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const filtered = activeLevel === 'all'
    ? logs
    : logs.filter((l) => l.level === activeLevel);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden min-h-[180px] mt-3"
    >
      {/* Header */}
      <div
        className="h-6 flex items-center justify-between flex-shrink-0 text-[10px]"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-background)',
          paddingLeft: '22px',
          paddingRight: '22px',
        }}
      >
        <span style={{ color: 'var(--text-on-surface-variant)', fontFamily: 'var(--font-sans)' }}>
          Logs
        </span>

        <div className="flex items-center gap-1">
          {/* Level tabs */}
          <div
            className="flex items-center rounded px-1 py-0.5 gap-0.5"
            style={{ backgroundColor: 'var(--bg-surface-container-low)' }}
          >
            {LEVEL_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onLevelChange(tab.key)}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer relative"
                style={{
                  color: activeLevel === tab.key ? 'var(--accent-primary)' : 'var(--text-outline)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {tab.label}
                {activeLevel === tab.key && (
                  <motion.div
                    layoutId="log-tab-indicator"
                    className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Auto-scroll toggle */}
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className="px-1 py-0.5 rounded text-[9px] cursor-pointer"
            style={{
              color: autoScroll ? 'var(--accent-primary)' : 'var(--text-outline)',
              backgroundColor: autoScroll ? 'rgba(173, 198, 255, 0.08)' : 'transparent',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Auto
          </button>

          {/* Clear */}
          <button
            type="button"
            onClick={onClear}
            className="p-0.5 rounded cursor-pointer transition-colors"
            style={{ color: 'var(--text-outline)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-outline)'; }}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Log body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto select-text"
        style={{
          backgroundColor: 'var(--bg-background)',
          padding: '8px 22px',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          lineHeight: '18px',
        }}
      >
        {filtered.length > 0 ? (
          filtered.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.1 }}
              className="flex items-start gap-1 relative"
              style={{
                borderLeft: log.level === 'error' ? '2px solid var(--error)' : '2px solid transparent',
                paddingLeft: log.level === 'error' ? '6px' : '0',
                backgroundColor: log.level === 'error' ? 'rgba(255, 180, 171, 0.04)' : 'transparent',
                marginLeft: '-2px',
              }}
            >
              <span style={{ color: 'var(--text-outline-variant)' }}>
                [{log.timestamp}]
              </span>
              <span
                className="font-bold uppercase flex-shrink-0"
                style={{ color: levelColor[log.level] ?? 'var(--text-outline)', fontSize: '9px' }}
              >
                [{log.category}]
              </span>
              <span style={{ color: 'var(--text-on-surface-variant)' }}>{log.text}</span>
            </motion.div>
          ))
        ) : (
          <div
            className="h-full flex items-center justify-center"
            style={{ color: 'var(--text-outline)', fontSize: '11px' }}
          >
            No logs
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="h-5 flex items-center justify-between flex-shrink-0 text-[9px]"
        style={{
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-background)',
          color: 'var(--text-outline-variant)',
          paddingLeft: '22px',
          paddingRight: '22px',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <span>{filtered.length} entries</span>
        <span>{activeLevel === 'all' ? 'All levels' : activeLevel.toUpperCase()}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit src/renderer/components/gateway/LogTerminal.tsx 2>&1 | head -10
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/gateway/LogTerminal.tsx
git commit -m "feat: add LogTerminal component with level filter and auto-scroll"
```

---

### Task 7: 重写 GatewayView.tsx 为容器组件

**Files:**
- Rewrite: `src/renderer/components/GatewayView.tsx`

- [ ] **Step 1: 重写 GatewayView.tsx**

```typescript
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
```

- [ ] **Step 2: 删除旧的 export 类型（已移至 gateway/index.ts）**

确认 `GatewayView.tsx` 不再导出 `GatewayStatus`、`SidebarLog`、`LogLevel`、`PLATFORM_BADGE`、`STATUS_LABEL`。如有其他文件 import 这些类型，需更新 import 路径。

```bash
cd "G:/worktree/nerve-agent" && grep -r "from.*GatewayView" src/renderer/ 2>/dev/null
```

Expected: 无外部 import（这些类型只在 GatewayView 内部使用）。

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd "G:/worktree/nerve-agent" && npx tsc --noEmit 2>&1 | grep -E "(GatewayView|gateway/)" | head -10
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/GatewayView.tsx
git commit -m "feat: rewrite GatewayView as container with modular sub-components"
```

---

### Task 8: 手动验证 + 主题测试

**Files:** 无新增/修改

- [ ] **Step 1: 启动 dev server**

```bash
cd "G:/worktree/nerve-agent" && npm run dev
```

Expected: Electron 窗口打开，无编译错误。

- [ ] **Step 2: 验证 Dark 主题**

1. 打开 RightSidebar → Gateway tab
2. 检查 StatusHeader：状态点颜色正确，badge 显示 STOPPED
3. 检查 MetricCards：3 张卡片样式正确，无数据显示平直线
4. 点击 Start：按钮状态切换，loading spinner 显示
5. 等待 health 回来：数值更新，sparkline 开始画线，delta 指示器出现
6. 检查 AdapterList：适配器正确显示，toggle 可切换
7. 检查 LogTerminal：日志正常显示，level 过滤工作，auto-scroll 工作
8. 点击 Stop：状态回到 stopped

- [ ] **Step 3: 验证 Light 主题**

切换到 light 主题，重复 Step 2 检查：
- 所有文字在白色背景上可读
- 边框和分割线在浅色背景下可见
- 按钮颜色对比度足够
- sparkline 线条在浅色背景下清晰

- [ ] **Step 4: 验证 Aurora 主题**

切换到 aurora 主题，重复 Step 2 检查：
- 毛玻璃效果下文字可读
- 半透明背景下边框和颜色正常

- [ ] **Step 5: 验证边界情况**

1. 无适配器时：显示 "No adapters configured"
2. 无日志时：显示 "No logs"
3. Gateway 未运行时：所有数值为 0，sparkline 显示平直线

- [ ] **Step 6: 最终 Commit**

```bash
git add -A
git commit -m "feat: GatewayView redesign — Vercel Dashboard style with sparklines"
```
