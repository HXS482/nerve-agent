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
