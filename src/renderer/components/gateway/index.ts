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
