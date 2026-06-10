import React from 'react';
import type { AdapterInfo } from '../../../shared/types';
import { PLATFORM_COLOR } from './index';

interface AdapterListProps {
  adapters: AdapterInfo[];
  running: boolean;
  onToggle: (name: string, enabled: boolean) => void;
  bridgeHealth: { toolCount: number; tunnelUrl: string | null } | null;
  onBridgeToggle: (enabled: boolean) => void;
}

export function AdapterList({ adapters, running, onToggle, bridgeHealth, onBridgeToggle }: AdapterListProps) {
  const bridgeEnabled = bridgeHealth !== null;
  const bridgeConnected = bridgeHealth !== null;
  return (
    <div className="flex-shrink-0" style={{ padding: '0 14px', marginBottom: '12px' }}>
      {/* Section label */}
      <div
        style={{
          color: '#8B949E',
          fontSize: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          marginBottom: '6px',
        }}
      >
        适配器
      </div>

      {/* Card container */}
      <div
        style={{
          backgroundColor: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        {adapters.length === 0 ? (
          <div
            className="flex items-center justify-center"
            style={{ height: '36px', color: '#484F58', fontSize: '11px' }}
          >
            {running ? 'No adapters' : 'Gateway not running'}
          </div>
        ) : (
          adapters.map((ad, idx) => {
            const platformColor = PLATFORM_COLOR[ad.platform] ?? PLATFORM_COLOR.gateway;
            const isConnected = ad.connected;
            const isLast = idx === adapters.length - 1;

            return (
              <div
                key={ad.name}
                className="flex items-center justify-between"
                style={{
                  padding: '8px 10px',
                  borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.03)',
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex-shrink-0"
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: isConnected ? platformColor : '#484F58',
                      boxShadow: isConnected ? `0 0 6px ${platformColor}60` : 'none',
                    }}
                  />
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 500,
                      color: isConnected ? '#E9ECF0' : '#8B949E',
                    }}
                  >
                    {ad.name}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    style={{
                      color: isConnected ? '#34A853' : '#484F58',
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {isConnected ? '● ON' : '○ OFF'}
                  </span>

                  {/* Capsule toggle */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(ad.name, !ad.enabled);
                    }}
                    className="relative cursor-pointer flex-shrink-0"
                    style={{
                      width: '28px',
                      height: '14px',
                      borderRadius: '7px',
                      backgroundColor: ad.enabled ? '#4d8eff' : 'rgba(255,255,255,0.06)',
                      transition: 'background-color 0.2s',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: '2px',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: ad.enabled ? '#fff' : '#484F58',
                        left: ad.enabled ? '16px' : '2px',
                        transition: 'left 0.2s',
                      }}
                    />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* MCP Bridge card */}
      <div
        style={{
          backgroundColor: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: '8px',
          marginTop: '6px',
          overflow: 'hidden',
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ padding: '8px 10px' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="flex-shrink-0"
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: bridgeConnected ? '#34A853' : '#484F58',
                boxShadow: bridgeConnected ? '0 0 6px #34A85360' : 'none',
              }}
            />
            <span
              style={{
                fontSize: '11px',
                fontWeight: 500,
                color: bridgeConnected ? '#E9ECF0' : '#8B949E',
              }}
            >
              MCP Bridge
            </span>
            {bridgeHealth && (
              <span
                style={{
                  fontSize: '9px',
                  fontFamily: 'var(--font-mono)',
                  color: '#484F58',
                }}
              >
                {bridgeHealth.toolCount} tools
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span
              style={{
                color: bridgeConnected ? '#34A853' : '#484F58',
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {bridgeConnected ? '● ON' : '○ OFF'}
            </span>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBridgeToggle(!bridgeEnabled);
              }}
              className="relative cursor-pointer flex-shrink-0"
              style={{
                width: '28px',
                height: '14px',
                borderRadius: '7px',
                backgroundColor: bridgeEnabled ? '#4d8eff' : 'rgba(255,255,255,0.06)',
                transition: 'background-color 0.2s',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: '2px',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: bridgeEnabled ? '#fff' : '#484F58',
                  left: bridgeEnabled ? '16px' : '2px',
                  transition: 'left 0.2s',
                }}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
