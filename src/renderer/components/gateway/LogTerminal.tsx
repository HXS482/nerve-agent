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
