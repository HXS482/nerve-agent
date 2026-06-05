import React from 'react';

interface MetricCardsProps {
  sessions: number;
  memoryBytes: number;
  errorCount: number;
  running: boolean;
}

export function MetricCards({ sessions, memoryBytes, errorCount, running }: MetricCardsProps) {
  const memMB = running ? Math.round(memoryBytes / 1024 / 1024) : 0;

  const metrics = [
    { label: '会话', value: running ? sessions : 0 },
    { label: '内存', value: memMB, unit: 'MB' },
    { label: '错误', value: errorCount, isError: true },
  ];

  return (
    <div
      className="flex-shrink-0"
      style={{ padding: '0 14px', marginBottom: '14px' }}
    >
      <div
        className="flex overflow-hidden"
        style={{ borderRadius: '6px', gap: '1px', background: 'rgba(255,255,255,0.01)' }}
      >
        {metrics.map((m) => (
          <div
            key={m.label}
            className="flex-1 flex flex-col items-center justify-center"
            style={{
              backgroundColor: 'rgba(255,255,255,0.03)',
              padding: '8px 10px',
            }}
          >
            <div
              style={{
                color: '#8B949E',
                fontSize: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {m.label}
            </div>
            <div
              className="flex items-baseline"
              style={{ marginTop: '2px' }}
            >
              <span
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: m.isError && m.value === 0 ? '#34A853' : '#E9ECF0',
                }}
              >
                {m.value}
              </span>
              {m.unit && (
                <span style={{ fontSize: '9px', color: '#8B949E', marginLeft: '2px' }}>
                  {m.unit}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
