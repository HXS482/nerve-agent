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
