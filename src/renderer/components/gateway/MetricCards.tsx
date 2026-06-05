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
  const prevRef = useRef(value);
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    setDelta(value - prevRef.current);
    prevRef.current = value;
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
