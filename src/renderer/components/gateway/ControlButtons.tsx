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
          boxShadow: 'none',
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
          border: '1px solid var(--border-subtle)',
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
