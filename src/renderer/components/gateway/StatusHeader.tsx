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
  const circumference = 150.8; // 2 * π * 24
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
