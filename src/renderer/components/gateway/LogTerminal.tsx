import React, { useRef, useEffect } from 'react';
import type { SidebarLog } from './index';

interface LogTerminalProps {
  logs: SidebarLog[];
}

const levelTag: Record<string, { label: string; color: string }> = {
  info:  { label: 'SYS', color: 'var(--accent-primary-container)' },
  warn:  { label: 'WARN', color: '#FBBC05' },
  error: { label: 'ERR', color: 'var(--error)' },
};

export function LogTerminal({ logs }: LogTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visible = logs.slice(-20);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div className="flex-shrink-0" style={{ padding: '0 14px' }}>
      <div
        ref={containerRef}
        style={{
          backgroundColor: 'var(--bg-surface-container-lowest)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          padding: '6px 8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          lineHeight: 1.6,
          color: 'var(--text-outline)',
          maxHeight: '160px',
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--scrollbar-thumb) transparent',
        }}
      >
        {visible.length > 0 ? (
          visible.map((log) => {
            const tag = levelTag[log.level] ?? { label: 'SYS', color: 'var(--accent-primary-container)' };
            return (
              <div key={log.id}>
                <span style={{ color: 'var(--text-outline-variant)' }}>{log.timestamp}</span>{' '}
                <span style={{ color: tag.color }}>{tag.label}</span>{' '}
                <span style={{ color: 'var(--text-on-surface-variant)' }}>{log.text}</span>
              </div>
            );
          })
        ) : (
          <div style={{ color: 'var(--text-outline-variant)' }}>Waiting for logs...</div>
        )}
      </div>
    </div>
  );
}
