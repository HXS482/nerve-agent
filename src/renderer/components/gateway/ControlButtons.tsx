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
            ? 'var(--bg-surface-container-lowest)'
            : 'linear-gradient(135deg, #34A853 0%, #2d9348 100%)',
          color: startDisabled ? 'var(--text-outline-variant)' : '#000',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          borderRadius: '8px',
          padding: '7px',
          boxShadow: startDisabled
            ? 'none'
            : '0 2px 12px rgba(52,168,83,0.2), inset 0 1px 0 rgba(255,255,255,0.15)',
          border: startDisabled ? '1px solid var(--border-subtle)' : 'none',
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
          background: 'var(--bg-surface-container-lowest)',
          color: stopDisabled ? 'var(--text-outline-variant)' : 'var(--text-outline)',
          fontSize: '11px',
          borderRadius: '8px',
          padding: '7px',
          border: '1px solid var(--border-subtle)',
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
