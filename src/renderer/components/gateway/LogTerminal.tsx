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
